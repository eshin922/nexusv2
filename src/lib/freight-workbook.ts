import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  freightCustomsBreaks,
  freightCustomsEntries,
  freightDestinationBreaks,
  freightDestinations,
  freightDestinationTracking,
  freightSubcategories,
  freightSubcategoryItems,
  quoteLeaves,
  quoteTiers,
} from "@/db/schema";

export type FreightWorkbook = {
  subcategories: Array<typeof freightSubcategories.$inferSelect>;
  memberships: Array<typeof freightSubcategoryItems.$inferSelect>;
  destinations: Array<typeof freightDestinations.$inferSelect>;
  breaks: Array<typeof freightDestinationBreaks.$inferSelect>;
  customsEntries: Array<typeof freightCustomsEntries.$inferSelect>;
  customsBreaks: Array<typeof freightCustomsBreaks.$inferSelect>;
  tracking: Array<typeof freightDestinationTracking.$inferSelect>;
  costingContext: {
    ownerSkuByAssembly: Record<string, string>;
    /**
     * OD-017 · anchor derived from the shipment's own MEMBERSHIP, for a
     * shipment that has no assembly. Keyed by subcategory id.
     *
     * Present for every shipment, but consumed only when `assembly_id` is NULL.
     * Assembly-owned shipments keep reading `ownerSkuByAssembly` so their
     * existing cost attribution does not move: the assembly anchor is its
     * lowest-position leaf, which is not necessarily a member of any one
     * shipment, so switching them to a membership anchor would change WHICH
     * leaf bears freight on live quotes. That is a separate change with its own
     * S-7 disposition, not a side effect of making the column nullable.
     */
    ownerSkuBySubcategory: Record<string, string>;
    tierUnitsByTier: Record<string, number>;
  };
};

/**
 * OD-017 · the costing anchor for a shipment that has NO assembly.
 *
 * Derivation lives here, beside the assembly anchor, because anchoring is a
 * freight concern — not in the costing path, which consumes anchors rather than
 * computing them.
 *
 * GOVERNING INVARIANT (Pattern 58, ratified 2026-08-12): membership may
 * determine ATTRIBUTION, but must never determine COMMERCIAL ARITHMETIC.
 * Freight amount, freight markup, customs, landed cost and quoted sell are
 * invariant to the anchor — nothing here divides, shares or allocates. The whole
 * shipment amount attributes to one leaf exactly as it always has.
 *
 * Membership decides WHERE an already-computed contribution belongs, not HOW
 * MUCH it is. Assembly-owned shipments retain their product owner as the anchor;
 * only a shipment with no assembly derives one from membership, because nothing
 * else in the model relates such a shipment to a commercial leaf.
 */
export async function loadShipmentMemberAnchors(
  subcategoryIds: string[],
  executor: Pick<typeof db, "select"> = db,
): Promise<Map<string, string>> {
  const anchors = new Map<string, string>();
  if (!subcategoryIds.length) return anchors;
  const rows = await executor
    .select({
      freightSubcategoryId: freightSubcategoryItems.freightSubcategoryId,
      quoteLeafId: freightSubcategoryItems.quoteLeafId,
    })
    .from(freightSubcategoryItems)
    .innerJoin(quoteLeaves, eq(quoteLeaves.id, freightSubcategoryItems.quoteLeafId))
    .where(inArray(freightSubcategoryItems.freightSubcategoryId, subcategoryIds))
    // Lowest position wins — the same rule the assembly anchor uses.
    .orderBy(asc(quoteLeaves.position), asc(freightSubcategoryItems.quoteLeafId));
  for (const row of rows) {
    if (!anchors.has(row.freightSubcategoryId)) {
      anchors.set(row.freightSubcategoryId, row.quoteLeafId);
    }
  }
  return anchors;
}

export async function loadFreightWorkbook(
  quoteId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<FreightWorkbook> {
  const subcategories = await executor.select().from(freightSubcategories).where(eq(freightSubcategories.quoteId, quoteId)).orderBy(asc(freightSubcategories.displayOrder));
  if (!subcategories.length) return { subcategories: [], memberships: [], destinations: [], breaks: [], customsEntries: [], customsBreaks: [], tracking: [], costingContext: { ownerSkuByAssembly: {}, ownerSkuBySubcategory: {}, tierUnitsByTier: {} } };
  const subIds = subcategories.map((row) => row.id);
  // OD-017 · a shipment may have no assembly. Nulls are filtered rather than
  // passed to `inArray`, which would otherwise build a comparison against NULL
  // that matches nothing and silently drop every anchor.
  const assemblyIds = [...new Set(subcategories.map((row) => row.assemblyId).filter((id): id is string => id !== null))];
  const [memberships, destinations, customsEntries, anchors, tiers] = await Promise.all([
    executor.select().from(freightSubcategoryItems).where(inArray(freightSubcategoryItems.freightSubcategoryId, subIds)).orderBy(asc(freightSubcategoryItems.createdAt)),
    executor.select().from(freightDestinations).where(inArray(freightDestinations.freightSubcategoryId, subIds)).orderBy(asc(freightDestinations.displayOrder)),
    executor.select().from(freightCustomsEntries).where(inArray(freightCustomsEntries.freightSubcategoryId, subIds)).orderBy(asc(freightCustomsEntries.createdAt)),
    // OD-017 · the costing anchor is now the CANONICAL leaf id, because that is
    // what the math layer keys a leaf by. Same leaf as before, named
    // canonically: `quote_leaves` is 1:1 with the junction and the attachment
    // validator rejects any row whose positions disagree, so the lowest-position
    // member is identical under either ordering.
    assemblyIds.length
      ? executor.select({ id: quoteLeaves.id, assemblyId: quoteLeaves.assemblyId, position: quoteLeaves.position })
          .from(quoteLeaves).where(inArray(quoteLeaves.assemblyId, assemblyIds)).orderBy(asc(quoteLeaves.position))
      : [],
    executor.select({ id: quoteTiers.id, qty: quoteTiers.qty }).from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId)).orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt)),
  ]);
  const destIds = destinations.map((row) => row.id);
  const entryIds = customsEntries.map((row) => row.id);
  // Defence in depth, NOT the alignment mechanism.
  //
  // Without an ORDER BY these arrived in Postgres heap order, which shifts as
  // rows are updated. Consumers must still resolve a break by `tierId` via
  // alignBreaksToTiers — a stable order here does not license positional
  // reads, because a cache, a realtime patch, or an optimistic insert can
  // reintroduce an arbitrary one. See src/lib/freight-tier-cells.ts.
  const memberAnchors = await loadShipmentMemberAnchors(subIds, executor);

  const [breaks, customsBreaks, tracking] = await Promise.all([
    destIds.length ? executor.select().from(freightDestinationBreaks).where(inArray(freightDestinationBreaks.freightDestinationId, destIds)).orderBy(asc(freightDestinationBreaks.freightDestinationId), asc(freightDestinationBreaks.tierId)) : [],
    entryIds.length ? executor.select().from(freightCustomsBreaks).where(inArray(freightCustomsBreaks.freightCustomsEntryId, entryIds)) : [],
    destIds.length ? executor.select().from(freightDestinationTracking).where(inArray(freightDestinationTracking.freightDestinationId, destIds)) : [],
  ]);
  return {
    subcategories,
    memberships,
    destinations,
    breaks,
    customsEntries,
    customsBreaks,
    tracking,
    costingContext: {
      ownerSkuByAssembly: Object.fromEntries(
        anchors.reduce<Array<[string, string]>>((entries, row) => {
          if (!row.assemblyId) return entries;
          if (!entries.some(([assemblyId]) => assemblyId === row.assemblyId)) entries.push([row.assemblyId, row.id]);
          return entries;
        }, []),
      ),
      ownerSkuBySubcategory: Object.fromEntries(memberAnchors),
      tierUnitsByTier: Object.fromEntries(tiers.map((row) => [row.id, row.qty ?? 0])),
    },
  };
}
