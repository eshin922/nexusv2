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
    executor.select().from(freightSubcategoryItems).where(inArray(freightSubcategoryItems.freightSubcategoryId, subIds)),
    executor.select().from(freightDestinations).where(inArray(freightDestinations.freightSubcategoryId, subIds)).orderBy(asc(freightDestinations.displayOrder)),
    executor.select().from(freightCustomsEntries).where(inArray(freightCustomsEntries.freightSubcategoryId, subIds)),
    executor.select({ id: assemblyLeaves.id, assemblyId: assemblyLeaves.assemblyId, position: assemblyLeaves.position })
      .from(assemblyLeaves).where(inArray(assemblyLeaves.assemblyId, assemblyIds)).orderBy(asc(assemblyLeaves.position)),
    executor.select({ id: quoteTiers.id, qty: quoteTiers.qty }).from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId)),
  ]);
  const destIds = destinations.map((row) => row.id);
  const entryIds = customsEntries.map((row) => row.id);
  const [breaks, customsBreaks, tracking] = await Promise.all([
    destIds.length ? executor.select().from(freightDestinationBreaks).where(inArray(freightDestinationBreaks.freightDestinationId, destIds)) : [],
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
