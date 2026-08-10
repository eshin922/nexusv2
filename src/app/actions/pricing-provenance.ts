"use server";

// A-2 · the provenance loader — one query, and the identity bridge it needs.
//
// A-2 asks for "a written query per input type, proven against production, with
// the cost measured." This is that query, and it is ONE rather than thirteen:
// `audit_log` is indexed on `(entity_type, entity_id)`, so thirteen lookups
// against one index is thirteen round trips to answer one question.
//
// ── WHY IT IS SEPARATE FROM `getCostingBundle` ────────────────────────────
//
// The bundle is on the hot path of every Pricing and Costs render, and A-2's
// own note says the provenance queries are the likely cost and should be
// measured before being adopted. So this is its own action: a surface that
// wants attribution asks for it, and one that does not pays nothing. If
// measurement shows it is free, folding it in later is a one-line change; the
// reverse is not.
//
// ── WHAT "NO RECORD" MEANS ────────────────────────────────────────────────
//
// An input with no audit row resolves thin, and thin is a FINDING (F5) rather
// than a defect in this file. Two causes, and they are not the same thing:
//
//   · the value predates the audit trail for that input type
//   · nothing writes an audit row for that input type at all
//
// The second is the one worth acting on, so the loader reports which entity
// types produced zero rows rather than leaving the distinction to be guessed
// from an empty result.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  assemblyLeafInputs,
  assemblyLeaves,
  assemblyProductionInputs,
  auditLog,
  firmSettings,
  freightLegComponentTierCosts,
  freightSubcategories,
  quoteLeaves,
  quoteTiers,
} from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/action-result";
import {
  PROVENANCE_INPUTS,
  type ProvenanceRecord,
  type SerialisableIdentityIndex,
} from "@/lib/pricing-provenance";

export type QuoteProvenance = {
  records: ProvenanceRecord[];
  index: SerialisableIdentityIndex;
  /** A-2's measurement, carried with the answer rather than in a comment. */
  cost: { ms: number; auditRows: number; entityIds: number };
  /** Governed input types that produced no row at all. F5 findings. */
  unattributedInputTypes: string[];
};

const GOVERNED_ACTIONS = Array.from(
  new Set(Object.values(PROVENANCE_INPUTS).flatMap((s) => s.actions)),
);


export async function loadQuoteProvenance(
  quoteId: string,
): Promise<ActionResult<QuoteProvenance>> {
  return runAction(async () => {
    const startedAt = Date.now();

    // ── the identity bridge ──────────────────────────────────────────────
    //
    // Four of the thirteen inputs are recorded against an id the graph does not
    // carry. These reads build the bridge. They are NOT inferred: an inferred
    // id would attribute one commercial line's price to another, and the whole
    // reason this table is explicit is that a plausible guess is unfalsifiable.
    const [
      leafRows,
      packagingRows,
      productionRows,
      freightComponentRows,
      subcategoryRows,
      firmRow,
    ] = await Promise.all([
      db
        .select({
          canonicalId: quoteLeaves.id,
          legacyId: assemblyLeaves.id,
          assemblyId: assemblyLeaves.assemblyId,
        })
        .from(quoteLeaves)
        .leftJoin(assemblyLeaves, eq(assemblyLeaves.quoteLeafId, quoteLeaves.id))
        .where(eq(quoteLeaves.quoteId, quoteId)),
      db
        .select({
          id: assemblyLeafInputs.id,
          lineGroupId: assemblyLeafInputs.lineGroupId,
          tierId: assemblyLeafInputs.tierId,
        })
        .from(assemblyLeafInputs)
        .innerJoin(
          assemblyLeaves,
          eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
        )
        .innerJoin(assemblies, eq(assemblies.id, assemblyLeaves.assemblyId))
        .where(eq(assemblies.quoteId, quoteId)),
      db
        .select({
          id: assemblyProductionInputs.id,
          assemblyId: assemblyProductionInputs.assemblyId,
          tierId: assemblyProductionInputs.tierId,
        })
        .from(assemblyProductionInputs)
        .innerJoin(
          assemblies,
          eq(assemblies.id, assemblyProductionInputs.assemblyId),
        )
        .where(eq(assemblies.quoteId, quoteId)),
      db
        .select({
          id: freightLegComponentTierCosts.id,
          legId: freightLegComponentTierCosts.freightLegId,
          quoteLeafId: freightLegComponentTierCosts.quoteLeafId,
          tierId: freightLegComponentTierCosts.tierId,
        })
        .from(freightLegComponentTierCosts)
        .innerJoin(
          quoteLeaves,
          eq(quoteLeaves.id, freightLegComponentTierCosts.quoteLeafId),
        )
        .where(eq(quoteLeaves.quoteId, quoteId)),
      db
        .select({
          id: freightSubcategories.id,
          destinationId: freightSubcategories.selectedDestinationId,
        })
        .from(freightSubcategories)
        .where(eq(freightSubcategories.quoteId, quoteId)),
      db
        .select({ id: firmSettings.id })
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1),
    ]);

    // The engine's SKU id for a leaf IS the legacy junction id (the adapter's
    // `mathSkuId`), so the two per-SKU bridges key on it.
    const legacyLeafBySkuId: Array<[string, string]> = [];
    const canonicalLeafBySkuId: Array<[string, string]> = [];
    const assemblyBySkuId: Array<[string, string]> = [];
    for (const r of leafRows) {
      if (!r.legacyId) continue;
      legacyLeafBySkuId.push([r.legacyId, r.legacyId]);
      canonicalLeafBySkuId.push([r.legacyId, r.canonicalId]);
      if (r.assemblyId) assemblyBySkuId.push([r.legacyId, r.assemblyId]);
    }

    const index: SerialisableIdentityIndex = {
      packagingRowByLineTier: packagingRows.map((r) => [
        `${r.lineGroupId}::${r.tierId}`,
        r.id,
      ]),
      assemblyBySkuId,
      productionRowByAssemblyTier: productionRows.map((r) => [
        `${r.assemblyId}::${r.tierId}`,
        r.id,
      ]),
      legacyLeafBySkuId,
      canonicalLeafBySkuId,
      freightComponentRowByLegLeafTier: freightComponentRows.map((r) => [
        `${r.legId}::${r.quoteLeafId}::${r.tierId}`,
        r.id,
      ]),
      destinationBySubcategoryId: subcategoryRows
        .filter((r): r is typeof r & { destinationId: string } => r.destinationId !== null)
        .map((r) => [r.id, r.destinationId]),
      firmSettingsId: firmRow[0]?.id ?? null,
      quoteId,
    };

    // ── the entity ids this quote could be attributed through ────────────
    //
    // Bounded by the quote rather than scanning the whole log. Everything the
    // classifier can ask for is derivable from the bridge plus the quote's own
    // tiers, so the id set is known before the query rather than discovered by
    // it.
    const tierRows = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quoteId));

    const entityIds = new Set<string>([quoteId]);
    for (const [, v] of index.packagingRowByLineTier) entityIds.add(v);
    for (const [k] of index.packagingRowByLineTier) entityIds.add(k.split("::")[0]);
    for (const [, v] of index.productionRowByAssemblyTier) entityIds.add(v);
    for (const [, v] of index.assemblyBySkuId) entityIds.add(v);
    for (const [, v] of index.freightComponentRowByLegLeafTier) entityIds.add(v);
    for (const [, v] of index.destinationBySubcategoryId) entityIds.add(v);
    for (const t of tierRows) entityIds.add(t.id);
    if (index.firmSettingsId) entityIds.add(index.firmSettingsId);
    // Composite cell addresses: `${leaf}:${tier}` for lifts (canonical) and for
    // direct prices / client targets (legacy).
    for (const [, canonical] of canonicalLeafBySkuId) {
      for (const t of tierRows) entityIds.add(`${canonical}:${t.id}`);
    }
    for (const [, legacy] of legacyLeafBySkuId) {
      for (const t of tierRows) entityIds.add(`${legacy}:${t.id}`);
    }
    // Freight legs, for customs rates — the leg id is in the node key, so the
    // ids come from the component rows rather than a separate read.
    for (const [k] of index.freightComponentRowByLegLeafTier) {
      entityIds.add(k.split("::")[0]);
    }

    const ids = Array.from(entityIds);

    // ── ONE query ─────────────────────────────────────────────────────────
    //
    // `DISTINCT ON` keeps the newest row per (entity_type, entity_id) in the
    // database rather than fetching every historical row and reducing in JS.
    // Provenance is "who set it", not "how often" — the history is already
    // queryable, and pulling it here would make the cost scale with how much a
    // quote has been edited.
    const rows =
      ids.length === 0
        ? []
        : await db
            .selectDistinctOn([auditLog.entityType, auditLog.entityId], {
              entityType: auditLog.entityType,
              entityId: auditLog.entityId,
              action: auditLog.action,
              actor: auditLog.actorDisplayName,
              when: auditLog.createdAt,
            })
            .from(auditLog)
            .where(
              and(
                inArray(auditLog.entityId, ids),
                inArray(auditLog.action, GOVERNED_ACTIONS),
              ),
            )
            .orderBy(
              auditLog.entityType,
              auditLog.entityId,
              desc(auditLog.createdAt),
            );

    const records: ProvenanceRecord[] = rows.map((r) => ({
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      actor: r.actor,
      when: r.when instanceof Date ? r.when.toISOString() : (r.when as string | null),
    }));

    // By ACTION, not by entity type. Three input types share `entity_type =
    // 'quote'` — the quote-wide adjustment, the freight markup and the quote
    // target margin — so an entity-type test reports all three as recorded the
    // moment any one of them is, which is the opposite of the finding A-2 wants.
    const seenActions = new Set(records.map((r) => r.action));
    const unattributedInputTypes = Object.entries(PROVENANCE_INPUTS)
      .filter(([, spec]) => !spec.actions.some((a) => seenActions.has(a)))
      .map(([type]) => type);

    return {
      records,
      index,
      cost: { ms: Date.now() - startedAt, auditRows: records.length, entityIds: ids.length },
      unattributedInputTypes,
    };
  });
}
