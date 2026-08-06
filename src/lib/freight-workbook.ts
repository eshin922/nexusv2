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
  assemblyLeaves,
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
    tierUnitsByTier: Record<string, number>;
  };
};

export async function loadFreightWorkbook(
  quoteId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<FreightWorkbook> {
  const subcategories = await executor.select().from(freightSubcategories).where(eq(freightSubcategories.quoteId, quoteId)).orderBy(asc(freightSubcategories.displayOrder));
  if (!subcategories.length) return { subcategories: [], memberships: [], destinations: [], breaks: [], customsEntries: [], customsBreaks: [], tracking: [], costingContext: { ownerSkuByAssembly: {}, tierUnitsByTier: {} } };
  const subIds = subcategories.map((row) => row.id);
  const assemblyIds = [...new Set(subcategories.map((row) => row.assemblyId))];
  const [memberships, destinations, customsEntries, anchors, tiers] = await Promise.all([
    executor.select().from(freightSubcategoryItems).where(inArray(freightSubcategoryItems.freightSubcategoryId, subIds)).orderBy(asc(freightSubcategoryItems.createdAt)),
    executor.select().from(freightDestinations).where(inArray(freightDestinations.freightSubcategoryId, subIds)).orderBy(asc(freightDestinations.displayOrder)),
    executor.select().from(freightCustomsEntries).where(inArray(freightCustomsEntries.freightSubcategoryId, subIds)).orderBy(asc(freightCustomsEntries.createdAt)),
    executor.select({ id: assemblyLeaves.id, assemblyId: assemblyLeaves.assemblyId, position: assemblyLeaves.position })
      .from(assemblyLeaves).where(inArray(assemblyLeaves.assemblyId, assemblyIds)).orderBy(asc(assemblyLeaves.position)),
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
          if (!entries.some(([assemblyId]) => assemblyId === row.assemblyId)) entries.push([row.assemblyId, row.id]);
          return entries;
        }, []),
      ),
      tierUnitsByTier: Object.fromEntries(tiers.map((row) => [row.id, row.qty ?? 0])),
    },
  };
}
