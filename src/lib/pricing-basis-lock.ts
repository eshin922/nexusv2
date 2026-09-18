import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { ActionGuardError, ERR } from "./action-result";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Stabilize the existing draft's commercial inputs until Pricing commits.
 *
 * Lock parents FOR UPDATE to block new referencing rows via their FK checks;
 * lock existing input rows to block changes/deletes that do not recheck a FK.
 * An advisory quote lock alone would not protect any of those existing writers.
 * Settings are the two shared authorities: SHARE allows concurrent Pricing on
 * different quotes but holds admin changes (including new categories) briefly.
 *
 * Run inside inDatabaseTransaction so guards, bundle readers, both stale checks
 * and writes all use its connection. This also avoids exhausting a small pool
 * with transactions waiting for their own readers to acquire extra connections.
 */
export async function lockPricingBasis(tx: Tx, quoteId: string): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '2s'`);
  await tx.execute(sql`lock table firm_settings, markup_defaults in share mode`);
  const quoteRows = await tx.execute(sql`select id from quotes where id = ${quoteId} for update`);
  if (quoteRows.length === 0) throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");

  const groups = sql`select id from assemblies where quote_id = ${quoteId}`;
  const owners = sql`select id from quote_leaves where quote_id = ${quoteId}`;
  const legs = sql`select l.id from freight_legs l join freight_leg_groups g on g.id=l.leg_group_id where g.quote_id=${quoteId}`;
  const shipments = sql`select id from freight_subcategories where quote_id=${quoteId}`;
  const destinations = sql`select id from freight_destinations where freight_subcategory_id in (${shipments})`;
  const customs = sql`select id from freight_customs_entries where freight_subcategory_id in (${shipments})`;

  // Parent-before-child order is fixed. Quote lock serializes same-quote applies.
  const rows: readonly [string, SQL][] = [
    ["quote_tiers", sql`t.quote_id=${quoteId}`],
    ["assemblies", sql`t.quote_id=${quoteId}`],
    ["quote_leaves", sql`t.quote_id=${quoteId}`],
    ["assembly_leaves", sql`t.quote_leaf_id in (${owners}) or t.assembly_id in (${groups})`],
    ["quote_charge_instances", sql`t.quote_id=${quoteId}`],
    ["freight_leg_groups", sql`t.quote_id=${quoteId}`],
    ["freight_legs", sql`t.id in (${legs})`],
    ["freight_subcategories", sql`t.quote_id=${quoteId}`],
    ["freight_destinations", sql`t.freight_subcategory_id in (${shipments})`],
    ["freight_customs_entries", sql`t.freight_subcategory_id in (${shipments})`],
    ["assembly_leaf_inputs", sql`t.quote_leaf_id in (${owners})`],
    ["assembly_production_inputs", sql`t.quote_leaf_id in (${owners}) or t.assembly_id in (${groups})`],
    ["assembly_leaf_overrides", sql`t.quote_leaf_id in (${owners})`],
    ["quote_leaf_lifts", sql`t.quote_leaf_id in (${owners})`],
    ["quote_charge_instance_tiers", sql`t.charge_instance_id in (select id from quote_charge_instances where quote_id=${quoteId})`],
    ["quote_charge_recovery", sql`t.quote_id=${quoteId}`],
    ["freight_leg_tiers", sql`t.freight_leg_id in (${legs})`],
    ["freight_leg_component_tier_costs", sql`t.quote_leaf_id in (${owners})`],
    ["freight_subcategory_items", sql`t.freight_subcategory_id in (${shipments})`],
    ["freight_destination_breaks", sql`t.freight_destination_id in (${destinations})`],
    ["freight_customs_breaks", sql`t.freight_customs_entry_id in (${customs})`],
  ];
  for (const [table, predicate] of rows) {
    // table names are the literal inventory above, never caller input.
    await tx.execute(sql`select 1 from ${sql.identifier(table)} t where ${predicate} for update of t`);
  }
  // Library leaves are shared by quotes. SHARE protects their read metadata
  // without serializing two Pricing applies that use the same product.
  await tx.execute(sql`select 1 from leaves l where l.id in
    (select leaf_id from quote_leaves where quote_id=${quoteId}) for share of l`);
}

/** A busy/deadlocked basis is a refusal, never an automatic replay of intent. */
export function rethrowPricingContention(error: unknown): never {
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    const pg = cause as { code?: string; cause?: unknown };
    if (pg.code === "55P03" || pg.code === "40P01" || pg.code === "40001") {
      throw new ActionGuardError(ERR.COSTS_STALE,
        "This quote is being updated. No pricing changes were saved. Reload and review before applying again.");
    }
    cause = pg.cause;
  }
  throw error;
}
