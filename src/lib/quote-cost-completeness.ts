import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assemblyLeafInputs, leaves, quoteLeaves, quoteTiers } from "@/db/schema";
import { loadFreightWorkbook } from "./freight-workbook";
import { assertQuoteCostsResolved, type UnresolvedQuoteCost } from "./quote-cost-completeness-contract";

export async function loadUnresolvedQuoteCosts(quoteId: string): Promise<UnresolvedQuoteCost[]> {
  const [packaging, workbook, tiers] = await Promise.all([
    // OD-017 · scoped through the canonical attachment. Reaching the quote via
    // `assemblies` meant an unpriced Direct Component was invisible to this
    // gate — the quote would have passed the Send check with a missing cost.
    // This is a correctness fix, not only a plumbing one.
    db.select({
      quoteLeafId: assemblyLeafInputs.quoteLeafId,
      assemblyLeafId: assemblyLeafInputs.assemblyLeafId,
      tierId: assemblyLeafInputs.tierId,
      tierLabel: quoteTiers.label,
      lineGroupId: assemblyLeafInputs.lineGroupId,
      leafSku: leaves.sku,
      leafName: leaves.name,
    }).from(assemblyLeafInputs)
      .innerJoin(quoteLeaves, eq(quoteLeaves.id, assemblyLeafInputs.quoteLeafId))
      .innerJoin(leaves, eq(leaves.id, quoteLeaves.leafId))
      .innerJoin(quoteTiers, eq(quoteTiers.id, assemblyLeafInputs.tierId))
      .where(and(eq(quoteLeaves.quoteId, quoteId), isNull(assemblyLeafInputs.unitCost))),
    loadFreightWorkbook(quoteId),
    db.select({ id: quoteTiers.id, label: quoteTiers.label }).from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId)),
  ]);

  const freight: UnresolvedQuoteCost[] = [];
  const unresolved = (subcategoryId: string, label: string, tierId: string, tierLabel: string, description: string) =>
    freight.push({ quoteLeafId: null, assemblyLeafId: subcategoryId, tierId, tierLabel, lineGroupId: subcategoryId, leafSku: null, leafName: label, description });

  for (const subcategory of workbook.subcategories) {
    const selected = workbook.destinations.filter(
      (row) => row.id === subcategory.selectedDestinationId && row.freightSubcategoryId === subcategory.id,
    );
    if (selected.length !== 1) {
      unresolved(subcategory.id, subcategory.label, "selection", "all tiers", `${subcategory.label}: select exactly one valid destination.`);
      continue;
    }
    for (const tier of tiers) {
      const breaks = workbook.breaks.filter(
        (row) => row.freightDestinationId === selected[0].id && row.tierId === tier.id,
      );
      if (breaks.length !== 1 || breaks[0].freightAmount === null || breaks[0].freightMarkupPct === null) {
        unresolved(subcategory.id, subcategory.label, tier.id, tier.label, `${subcategory.label} / ${selected[0].destination} / ${tier.label}: enter Freight and Freight Markup.`);
      }
      if (!subcategory.crossesInternationalBorder) continue;
      const entries = workbook.customsEntries.filter((row) => row.freightSubcategoryId === subcategory.id);
      for (const chargeType of ["duty", "tariff"] as const) {
        const charges = entries.length === 1
          ? workbook.customsBreaks.filter((row) => row.freightCustomsEntryId === entries[0].id && row.tierId === tier.id && row.chargeType === chargeType)
          : [];
        if (charges.length !== 1 || charges[0].amount === null || charges[0].markupPct === null) {
          unresolved(subcategory.id, subcategory.label, tier.id, tier.label, `${subcategory.label} / ${tier.label}: enter ${chargeType === "duty" ? "Duty" : "Tariff"} and markup.`);
        }
      }
    }
  }
  return [...packaging, ...freight];
}

export async function requireResolvedQuoteCosts(quoteId: string): Promise<void> {
  assertQuoteCostsResolved(await loadUnresolvedQuoteCosts(quoteId));
}
