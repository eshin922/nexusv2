import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assemblyLeafInputs, leaves, quoteLeaves, quoteTiers } from "@/db/schema";
import { loadFreightWorkbook } from "./freight-workbook";
import { assertQuoteCostsResolved, type UnresolvedQuoteCost } from "./quote-cost-completeness-contract";
import { markupDefaults as markupDefaultsTable } from "@/db/schema";
import { PRODUCTION_MARKUP_CATEGORY } from "./costing";

export async function loadUnresolvedQuoteCosts(quoteId: string): Promise<UnresolvedQuoteCost[]> {
  const [packaging, workbook, tiers, productionDefault] = await Promise.all([
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
    // BV-013 · a missing governed Production default is a firm-configuration
    // gap, and it reaches the operator HERE rather than through a substitute
    // rate. Before this, the ladder's `Other` and firm-30% rungs meant it was
    // literally unreportable: there was no state in which the engine did not
    // have a number.
    db.select({ category: markupDefaultsTable.category })
      .from(markupDefaultsTable)
      .where(eq(markupDefaultsTable.category, PRODUCTION_MARKUP_CATEGORY))
      .limit(1),
  ]);

  const configuration: UnresolvedQuoteCost[] = [];
  if (productionDefault.length === 0) {
    // Quote-wide rather than per-line: the gap is one firm setting, so one row
    // saying so beats the same sentence repeated once per production cell.
    // `description` carries it, which is what that field exists for.
    configuration.push({
      source: "configuration",
      quoteLeafId: null,
      assemblyLeafId: null,
      tierId: tiers[0]?.id ?? "",
      tierLabel: tiers[0]?.label ?? "—",
      lineGroupId: `markup-default:${PRODUCTION_MARKUP_CATEGORY}`,
      leafSku: null,
      leafName: `${PRODUCTION_MARKUP_CATEGORY} markup default`,
      description: `No ${PRODUCTION_MARKUP_CATEGORY} markup default is configured, so production economics cannot be priced. An admin sets it in Settings → Markup Defaults. Production is deliberately NOT priced through another category when this is missing.`,
    });
  }

  const freight: UnresolvedQuoteCost[] = [];
  const unresolved = (subcategoryId: string, label: string, tierId: string, tierLabel: string, description: string) =>
    freight.push({ source: "freight", quoteLeafId: null, assemblyLeafId: subcategoryId, tierId, tierLabel, lineGroupId: subcategoryId, leafSku: null, leafName: label, description });

  for (const subcategory of workbook.subcategories) {
    const selected = workbook.destinations.filter(
      (row) => row.id === subcategory.selectedDestinationId && row.freightSubcategoryId === subcategory.id,
    );
    if (selected.length !== 1) {
      unresolved(subcategory.id, subcategory.label, "selection", "all tiers", `${subcategory.label}: select exactly one valid destination.`);
      continue;
    }
    // V1 FREIGHT DISTRIBUTION POLICY · membership is a required cost input.
    //
    // Freight is now distributed across the shipment's recorded members, so
    // with none recorded there is no recipient and the amount reaches no
    // product — the quote's freight is understated, quietly, by exactly this
    // shipment. That is precisely the shape this gate exists to refuse.
    //
    // It sits with the other freight conditions rather than in the loader
    // because it is the same KIND of thing as an unentered amount: something
    // the operator has not said yet. Tier-independent, so it is stated once.
    if (workbook.memberships.every((row) => row.freightSubcategoryId !== subcategory.id)) {
      unresolved(subcategory.id, subcategory.label, "membership", "all tiers", `${subcategory.label}: add the products in this shipment — its freight has nowhere to go until then.`);
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
  // Configuration first: an operator told "enter the missing costs" when the
  // real problem is an unset firm default would go and enter costs that were
  // never missing.
  //
  // `source` is stamped HERE for packaging because the select cannot carry a
  // literal; the array it comes from is the proof, exactly as it is for the
  // other two.
  return [
    ...configuration,
    ...packaging.map((row) => ({ ...row, source: "packaging" as const })),
    ...freight,
  ];
}

export async function requireResolvedQuoteCosts(quoteId: string): Promise<void> {
  assertQuoteCostsResolved(await loadUnresolvedQuoteCosts(quoteId));
}
