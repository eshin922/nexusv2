import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db } from "../../db/index.ts";
import {
  assemblies,
  quoteClientTargets,
  assemblyLeafInputs,
  assemblyLeafOverrides,
  assemblyLeafTargets,
  assemblyLeaves,
  freightSubcategoryItems,
  quoteLeaves,
} from "../../db/schema.ts";
import { orderAfterMove } from "./drop-plan.ts";
import { assertMembershipQuantity } from "@/lib/product-structure/membership-quantity";

/**
 * Structural movement of an attached product. One primitive, four transitions.
 *
 * THE GOVERNING INVARIANT
 *
 *   Structural movement must preserve BOTH canonical product identity AND
 *   dependent economic-record identity.
 *
 * The first half is `quote_leaves.id`, which the math layer keys `skuRollups`
 * on. The second half is the one that is easy to miss, and it is why this is a
 * dedicated primitive rather than a detach followed by an attach:
 *
 * **The cost tables are DUAL-KEYED.** `assembly_leaf_inputs`,
 * `assembly_leaf_overrides`, `assembly_leaf_targets` and
 * `freight_subcategory_items` each carry `quote_leaf_id` (NOT NULL) *and*
 * `assembly_leaf_id` — and BOTH cascade on delete. So deleting the legacy
 * junction destroys a product's packaging inputs, per-cell overrides, client
 * targets and freight attachments, **while `quote_leaves.id` is preserved
 * perfectly**. An invariant asserting only identity would report success over
 * an empty cost structure.
 *
 * `detachGroupedMembership` deletes the junction first ON PURPOSE, to get
 * exactly that cascade. That is correct for a detach, which is meant to remove
 * the line. It is catastrophic for a move, which is meant to keep it.
 *
 * WHY NOT detach + attach. It would mint a new `quote_leaves.id`, orphaning the
 * rollup, and cascade the cost rows away on the detach. Two governed boundaries
 * crossed by an operation that leaves the tree looking exactly right.
 */

export type StructuralMoveTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export class StructuralMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuralMoveError";
  }
}

/** Where the product should end up. `direct` means quote level, no Item Group. */
export type MoveTarget =
  | { kind: "group"; assemblyId: string; position: number }
  | { kind: "direct"; position: number };

export type StructuralMoveEvidence = {
  /** Unchanged across every transition. The whole point. */
  quoteLeafId: string;
  leafId: string;
  quoteId: string;
  from: { assemblyId: string | null; assemblyLeafId: string | null };
  to: { assemblyId: string | null; assemblyLeafId: string | null };
  quantity: string;
  position: number;
  /** Dependent rows whose `assembly_leaf_id` was re-pointed or nulled. */
  dependentsRepointed: number;
  /**
   * Client targets removed because the product stopped being a sellable unit.
   *
   * Non-zero only when a Direct Product moved INTO a group. Reported rather
   * than silent: the operator entered those numbers.
   */
  clientTargetsDropped: number;
};

/** The four dual-keyed tables. Named once so a new one cannot be half-handled. */
const DEPENDENT_TABLES = [
  assemblyLeafInputs,
  assemblyLeafOverrides,
  assemblyLeafTargets,
  freightSubcategoryItems,
] as const;

// `quote_client_targets` is deliberately NOT in that list. These four are the
// DUAL-KEYED tables, carrying both a canonical `quote_leaf_id` and the legacy
// `assembly_leaf_id` that a move has to re-point. Client Target has no legacy
// column to re-point — it keys the sellable unit directly — so a move either
// leaves it alone or invalidates it outright, which is handled above.

/**
 * Re-point every dependent economic row from one junction to another, or to
 * NULL.
 *
 * Only `assembly_leaf_id` moves. `quote_leaf_id` is never touched — it is the
 * key the rows actually belong by, and it is NOT NULL on all four tables.
 *
 * Setting NULL before deleting a junction is what makes the delete safe: the
 * cascade finds nothing left to take.
 */
async function repointDependents(
  tx: StructuralMoveTransaction,
  fromAssemblyLeafId: string,
  toAssemblyLeafId: string | null,
): Promise<number> {
  let touched = 0;
  for (const table of DEPENDENT_TABLES) {
    // `.returning()` with no projection — two of these tables are keyed
    // (quote_leaf_id, tier_id) and have no `id` column at all.
    const rows = await tx
      .update(table)
      .set({ assemblyLeafId: toAssemblyLeafId })
      .where(eq(table.assemblyLeafId, fromAssemblyLeafId))
      .returning();
    touched += rows.length;
  }
  return touched;
}

/**
 * Move an attached product. Atomic — the caller supplies the transaction.
 *
 * Never creates or destroys the canonical `quote_leaves` row, and never lets a
 * dependent economic row be deleted. What changes is membership and order.
 */
export async function moveStructuralMembership(
  tx: StructuralMoveTransaction,
  args: { quoteLeafId: string; target: MoveTarget },
): Promise<StructuralMoveEvidence> {
  const [canonical] = await tx
    .select()
    .from(quoteLeaves)
    .where(eq(quoteLeaves.id, args.quoteLeafId))
    .limit(1);
  if (!canonical)
    throw new StructuralMoveError(`Attachment ${args.quoteLeafId} not found.`);

  // The legacy junction, if this product is currently in a group. Matched on
  // `quote_leaf_id` — the canonical link — rather than reconstructed from
  // (assembly, leaf), which cannot distinguish two attachments of one product.
  const [junction] = await tx
    .select()
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.quoteLeafId, canonical.id))
    .limit(1);

  const fromAssemblyId = canonical.assemblyId;
  const fromAssemblyLeafId = junction?.id ?? null;

  if (canonical.assemblyId !== null && !junction) {
    throw new StructuralMoveError(
      `Attachment ${canonical.id} claims Item Group membership with no legacy junction.`,
    );
  }

  // Target Item Group must belong to the same quote. A cross-quote move would
  // relocate commercial content between customers.
  if (args.target.kind === "group") {
    const [asm] = await tx
      .select({ quoteId: assemblies.quoteId })
      .from(assemblies)
      .where(eq(assemblies.id, args.target.assemblyId))
      .limit(1);
    if (!asm) throw new StructuralMoveError("Target Item Group not found.");
    if (asm.quoteId !== canonical.quoteId)
      throw new StructuralMoveError(
        "Target Item Group belongs to a different quote.",
      );
  }

  let toAssemblyLeafId: string | null = null;
  let dependentsRepointed = 0;

  if (args.target.kind === "group" && junction) {
    // ---- Group A -> Group B, or reorder within one group. IN PLACE.
    // No delete, so no cascade is reachable and dependents keep pointing at a
    // junction that still exists — only its parent changes.
    await tx
      .update(assemblyLeaves)
      .set({ assemblyId: args.target.assemblyId, position: args.target.position })
      .where(eq(assemblyLeaves.id, junction.id));
    toAssemblyLeafId = junction.id;
  } else if (args.target.kind === "group" && !junction) {
    // ---- Direct -> Group. The canonical row already exists; it gains a group
    // and the legacy junction it implies. The product is never recreated.
    const [created] = await tx
      .insert(assemblyLeaves)
      .values({
        assemblyId: args.target.assemblyId,
        leafId: canonical.leafId,
        // The SAME rule the update path enforces. A move PRESERVES the
        // composition fact rather than setting it, but preserving an invalid
        // value would make Direct -> Group a way around the rule that setting
        // it directly refuses -- one governed quantity, two write paths.
        quantity: assertMembershipQuantity(canonical.quantity),
        position: args.target.position,
        parentAssemblyLeafId: null,
        quoteLeafId: canonical.id,
      })
      .returning();
    toAssemblyLeafId = created.id;
    // Dependents authored while Direct carry a NULL junction. Adopt them so
    // legacy-keyed consumers see a consistent picture.
    dependentsRepointed = await adoptDirectDependents(tx, canonical.id, created.id);
  } else if (junction) {
    // ---- Group -> Direct. THE ORDER IS THE SAFETY.
    //
    // Null the dependents' `assembly_leaf_id` FIRST, so the junction delete has
    // nothing to cascade into. Reversing these two lines silently destroys the
    // product's economics while every identity assertion still passes.
    dependentsRepointed = await repointDependents(tx, junction.id, null);
    await tx.delete(assemblyLeaves).where(eq(assemblyLeaves.id, junction.id));
    toAssemblyLeafId = null;
  }
  // else: already Direct and staying Direct — position-only change below.

  // A DIRECT PRODUCT MOVING INTO A GROUP STOPS BEING A SELLABLE UNIT.
  //
  // Client Target is keyed to the top-level sellable unit, and a Direct Product
  // qualifies precisely because `quote_leaves.assembly_id IS NULL`. Move it
  // inside an Item Group and it becomes an internal member — the one identity
  // the target model refuses, because a client names a price for the finished
  // product and not for a component of it.
  //
  // The row would survive this move on its own: the FK still resolves and the
  // CHECK still holds. It would then be emitted as a target on a member leaf,
  // and the engine — which supports leaf-level targets — would compute a
  // verdict against it. A benchmark the customer never gave, on a component
  // they are not buying.
  //
  // So it is removed, and `clientTargetsDropped` reports how many, because a
  // structural move that quietly discards a commercial input is the kind of
  // loss nobody finds until they go looking for the number they entered.
  let clientTargetsDropped = 0;
  if (args.target.kind === "group" && fromAssemblyId === null) {
    const dropped = await tx
      .delete(quoteClientTargets)
      .where(eq(quoteClientTargets.quoteLeafId, canonical.id))
      .returning({ id: quoteClientTargets.id });
    clientTargetsDropped = dropped.length;
  }

  await tx
    .update(quoteLeaves)
    .set({
      assemblyId: args.target.kind === "group" ? args.target.assemblyId : null,
      position: args.target.position,
    })
    .where(eq(quoteLeaves.id, canonical.id));

  // Make the destination a TOTAL order. Writing one row's position leaves ties
  // that render by creation time, which no client can predict — see drop-plan.ts.
  const resolvedPosition =
    args.target.kind === "group"
      ? await placeInGroup(
          tx,
          args.target.assemblyId,
          canonical.id,
          args.target.position,
        )
      : await placeInDirect(tx, canonical.quoteId, canonical.id, args.target.position);

  // Compact the group the product LEFT, so its remaining members stay dense.
  if (
    fromAssemblyId &&
    (args.target.kind !== "group" || args.target.assemblyId !== fromAssemblyId)
  ) {
    await compactGroup(tx, fromAssemblyId);
  }

  return {
    quoteLeafId: canonical.id,
    leafId: canonical.leafId,
    quoteId: canonical.quoteId,
    from: { assemblyId: fromAssemblyId, assemblyLeafId: fromAssemblyLeafId },
    to: {
      assemblyId: args.target.kind === "group" ? args.target.assemblyId : null,
      assemblyLeafId: toAssemblyLeafId,
    },
    quantity: canonical.quantity,
    position: resolvedPosition,
    dependentsRepointed,
    clientTargetsDropped,
  };
}

/**
 * Rewrite a destination list densely with the moved product at `index`.
 *
 * Reads the destination in canonical `(position, created_at)` order, removes the
 * moved row, and re-inserts it via the SHARED rule — the same call the insertion
 * indicator makes. Returns the index actually persisted, which differs from the
 * requested one only when the request was out of range.
 */
async function placeInGroup(
  tx: StructuralMoveTransaction,
  assemblyId: string,
  movedQuoteLeafId: string,
  index: number,
): Promise<number> {
  const rows = await tx
    .select({ id: assemblyLeaves.id, quoteLeafId: assemblyLeaves.quoteLeafId })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.assemblyId, assemblyId))
    .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt));

  // A junction with no canonical link cannot be rendered (the tree keys on
  // `quote_leaf_id`) and so cannot be a position the operator chose. Excluded
  // rather than carried as a null, which would occupy an index slot and shift
  // every row after it by one relative to what the indicator promised.
  const others = rows
    .filter(
      (r): r is { id: string; quoteLeafId: string } =>
        r.quoteLeafId !== null && r.quoteLeafId !== movedQuoteLeafId,
    )
    .map((r) => r.quoteLeafId);
  const final = orderAfterMove(others, movedQuoteLeafId, index);
  const junctionByLeaf = new Map(rows.map((r) => [r.quoteLeafId, r.id] as const));

  for (const [i, quoteLeafId] of final.entries()) {
    const junctionId = junctionByLeaf.get(quoteLeafId);
    if (junctionId)
      await tx
        .update(assemblyLeaves)
        .set({ position: i })
        .where(eq(assemblyLeaves.id, junctionId));
    // Mirrored so the junction and the canonical row can never disagree about
    // order — two sources for one fact is how they drift.
    await tx
      .update(quoteLeaves)
      .set({ position: i })
      .where(eq(quoteLeaves.id, quoteLeafId));
  }
  return final.indexOf(movedQuoteLeafId);
}

async function placeInDirect(
  tx: StructuralMoveTransaction,
  quoteId: string,
  movedQuoteLeafId: string,
  index: number,
): Promise<number> {
  const rows = await tx
    .select({ id: quoteLeaves.id })
    .from(quoteLeaves)
    .where(and(eq(quoteLeaves.quoteId, quoteId), isNull(quoteLeaves.assemblyId)))
    .orderBy(asc(quoteLeaves.position), asc(quoteLeaves.createdAt));

  const others = rows.map((r) => r.id).filter((id) => id !== movedQuoteLeafId);
  const final = orderAfterMove(others, movedQuoteLeafId, index);
  for (const [i, id] of final.entries()) {
    await tx.update(quoteLeaves).set({ position: i }).where(eq(quoteLeaves.id, id));
  }
  return final.indexOf(movedQuoteLeafId);
}

/** Close the gap a departing member leaves behind. Order is preserved. */
async function compactGroup(
  tx: StructuralMoveTransaction,
  assemblyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: assemblyLeaves.id, quoteLeafId: assemblyLeaves.quoteLeafId })
    .from(assemblyLeaves)
    .where(eq(assemblyLeaves.assemblyId, assemblyId))
    .orderBy(asc(assemblyLeaves.position), asc(assemblyLeaves.createdAt));
  for (const [i, r] of rows.entries()) {
    await tx
      .update(assemblyLeaves)
      .set({ position: i })
      .where(eq(assemblyLeaves.id, r.id));
    if (r.quoteLeafId)
      await tx
        .update(quoteLeaves)
        .set({ position: i })
        .where(eq(quoteLeaves.id, r.quoteLeafId));
  }
}

/**
 * A product moving Direct -> Group brings dependents that were authored with no
 * junction. Point them at the new one.
 *
 * Scoped by `quote_leaf_id` AND `assembly_leaf_id IS NULL`, so it can only ever
 * adopt rows that belong to this attachment and are genuinely unparented.
 */
async function adoptDirectDependents(
  tx: StructuralMoveTransaction,
  quoteLeafId: string,
  assemblyLeafId: string,
): Promise<number> {
  let touched = 0;
  for (const table of DEPENDENT_TABLES) {
    const rows = await tx
      .update(table)
      .set({ assemblyLeafId })
      .where(
        and(eq(table.quoteLeafId, quoteLeafId), isNull(table.assemblyLeafId)),
      )
      .returning();
    touched += rows.length;
  }
  return touched;
}

/**
 * Every dependent economic row for an attachment, for before/after comparison.
 *
 * IDENTITY IS PER-TABLE, not assumed. `assembly_leaf_inputs` and
 * `freight_subcategory_items` are keyed by `id`; `assembly_leaf_overrides` and
 * `assembly_leaf_targets` are keyed by the composite
 * `(quote_leaf_id, tier_id)` and have no `id` column. A falsification that
 * assumed `id` everywhere would silently skip half the tables — and they are
 * the per-cell override and client-target rows, which is exactly the money a
 * move must not lose.
 */
export type DependentRowIdentity = {
  table: string;
  key: string;
  quoteLeafId: string;
  assemblyLeafId: string | null;
};

export async function dependentEconomicRows(
  tx: StructuralMoveTransaction,
  quoteLeafId: string,
): Promise<DependentRowIdentity[]> {
  const out: DependentRowIdentity[] = [];

  const inputs = await tx
    .select({
      key: assemblyLeafInputs.id,
      quoteLeafId: assemblyLeafInputs.quoteLeafId,
      assemblyLeafId: assemblyLeafInputs.assemblyLeafId,
    })
    .from(assemblyLeafInputs)
    .where(eq(assemblyLeafInputs.quoteLeafId, quoteLeafId));
  for (const r of inputs) out.push({ table: "assembly_leaf_inputs", ...r });

  const freight = await tx
    .select({
      key: freightSubcategoryItems.id,
      quoteLeafId: freightSubcategoryItems.quoteLeafId,
      assemblyLeafId: freightSubcategoryItems.assemblyLeafId,
    })
    .from(freightSubcategoryItems)
    .where(eq(freightSubcategoryItems.quoteLeafId, quoteLeafId));
  for (const r of freight) out.push({ table: "freight_subcategory_items", ...r });

  const overrides = await tx
    .select({
      tierId: assemblyLeafOverrides.tierId,
      quoteLeafId: assemblyLeafOverrides.quoteLeafId,
      assemblyLeafId: assemblyLeafOverrides.assemblyLeafId,
    })
    .from(assemblyLeafOverrides)
    .where(eq(assemblyLeafOverrides.quoteLeafId, quoteLeafId));
  for (const r of overrides)
    out.push({
      table: "assembly_leaf_overrides",
      key: `${r.quoteLeafId}:${r.tierId}`,
      quoteLeafId: r.quoteLeafId,
      assemblyLeafId: r.assemblyLeafId,
    });

  const targets = await tx
    .select({
      tierId: assemblyLeafTargets.tierId,
      quoteLeafId: assemblyLeafTargets.quoteLeafId,
      assemblyLeafId: assemblyLeafTargets.assemblyLeafId,
    })
    .from(assemblyLeafTargets)
    .where(eq(assemblyLeafTargets.quoteLeafId, quoteLeafId));
  for (const r of targets)
    out.push({
      table: "assembly_leaf_targets",
      key: `${r.quoteLeafId}:${r.tierId}`,
      quoteLeafId: r.quoteLeafId,
      assemblyLeafId: r.assemblyLeafId,
    });

  return out.sort((a, b) => (a.table + a.key).localeCompare(b.table + b.key));
}

export { DEPENDENT_TABLES };
