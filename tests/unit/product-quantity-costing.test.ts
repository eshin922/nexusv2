import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";

function fixture(): QuoteCostingInput {
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Other: 0.3, Production: 0.4 },
    skus: [0, 1, 2, 3, 4].map((i) => ({
      id: `product-${i}`, canonicalQuoteLeafId: `product-${i}`,
      parentSkuId: null, qtyPerParent: null, skuRole: "leaf",
      skuLabel: `G-${i}`, productName: `Gummy ${i}`, sortOrder: i,
      retailBenchmark: null, orderQuantities: { tier: 5000 },
    })),
    tiers: [{ id: "tier", label: "25k mix", qty: 25000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [0, 1, 2, 3, 4].map((i) => ({
      quoteSkuId: `product-${i}`, tierId: "tier", lineGroupId: "product",
      unitCost: i + 1, qtyPerSellableUnit: 1, category: "Other", markupPct: 0.3,
    })),
    production: [], freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  };
}

test("five 5,000-unit variants reconcile costing, pricing, and customer line amounts", () => {
  const input = fixture();
  const costing = computeQuoteCosting(input);
  assert.equal(costing.quoteRollup[0].totalCost, 75000);
  assert.ok(Math.abs(costing.quoteRollup[0].totalRevenue - 97500) < 0.000001);
  const projected = projectCommercial({ ...input, costing } as unknown as HydrateSnapshot);
  const lines = projected.lines.filter((line) => line.kind === "direct_product");
  assert.equal(lines.length, 5);
  for (const line of lines) {
    const cell = line.cells[0];
    assert.equal(cell.state, "priced");
    if (cell.state === "priced") assert.equal(cell.quantity, 5000);
  }
  assert.ok(Math.abs(projected.tiers[0].tierCommercialTotal - 97500) < 0.000001);
});

test("a 500-unit option supports unequal 200, 100, 100, 50, 50 product runs", () => {
  const input = fixture();
  input.tiers[0].qty = 500;
  const quantities = [200, 100, 100, 50, 50];
  input.skus.forEach((sku, index) => { sku.orderQuantities = { tier: quantities[index] }; });
  const costing = computeQuoteCosting(input);
  const projected = projectCommercial({ ...input, costing } as unknown as HydrateSnapshot);
  assert.deepEqual(costing.skuRollups.map((sku) => sku.perTier[0].orderQuantity), quantities);
  assert.equal(costing.quoteRollup[0].totalCost, 1150);
  assert.equal(costing.quoteRollup[0].totalRevenue, 1495);
  assert.equal(projected.tiers[0].tierCommercialTotal, 1495);
});

test("a grouped product can order 200 while another member and its group remain at 500", () => {
  const input = fixture();
  input.tiers[0].qty = 500;
  input.skus = [
    { ...input.skus[0], id: "group", canonicalQuoteLeafId: null, skuRole: "assembly", orderQuantities: undefined },
    { ...input.skus[0], parentSkuId: "group", qtyPerParent: 1, orderQuantities: { tier: 200 } },
    { ...input.skus[1], parentSkuId: "group", qtyPerParent: 1, orderQuantities: undefined },
  ];
  input.packaging = input.packaging.slice(0, 2);
  input.freightShipmentBreaks = [{ memberSkuId: "product-0", tierId: "tier", freightSubcategoryId: "shipment", treatment: "bundled", memberCount: 1, tierUnits: 500, freightAmount: 1000, freightMarkupPct: 0.3, dutyAmount: 0, dutyMarkupPct: 0, tariffAmount: 0, tariffMarkupPct: 0 }];
  const costing = computeQuoteCosting(input);
  assert.equal(costing.skuRollups.find((sku) => sku.skuId === "product-0")!.perTier[0].orderQuantity, 200);
  assert.equal(costing.skuRollups.find((sku) => sku.skuId === "product-1")!.perTier[0].orderQuantity, 500);
  assert.equal(costing.skuRollups.find((sku) => sku.skuId === "group")!.perTier[0].orderQuantity, 500);
  assert.equal(costing.quoteRollup[0].totalCost, 2200);
  assert.ok(Math.abs(costing.quoteRollup[0].totalRevenue - 2860) < 0.000001);
  assert.ok(Math.abs(projectCommercial({ ...input, costing } as unknown as HydrateSnapshot).tiers[0].tierCommercialTotal - 2860) < 0.000001);
});

test("mixed-jar composition uses the group quantity and fixed costs amortize over that run", () => {
  const input = fixture();
  input.skus = [
    { ...input.skus[0], id: "mixed-jar", canonicalQuoteLeafId: null, skuRole: "assembly", orderQuantities: { tier: 5000 } },
    { ...input.skus[1], parentSkuId: "mixed-jar", qtyPerParent: 2, orderQuantities: undefined },
  ];
  input.packaging = input.packaging.filter((p) => p.quoteSkuId === "product-1");
  input.assemblyProduction = [{
    assemblyId: "mixed-jar", tierId: "tier", allocateServiceFeesToCost: true,
    fillingBlendingCost: null, cmAssemblyTotal: null, setupFeeTotal: 1000,
    toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
    rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
    bulkRawCost: null, actualUnitsProduced: null,
  }];
  const costing = computeQuoteCosting(input);
  assert.equal(costing.skuRollups.find((s) => s.skuId === "product-1")!.perTier[0].orderQuantity, 10000);
  assert.equal(costing.quoteRollup[0].totalCost, 21000);
  assert.ok(Math.abs(costing.quoteRollup[0].totalRevenue - 27400) < 0.000001);
  const projected = projectCommercial({ ...input, costing } as unknown as HydrateSnapshot);
  assert.ok(Math.abs(projected.tiers[0].tierCommercialTotal - 27400) < 0.000001);
});

test("omitting product quantities retains legacy tier quantities and money", () => {
  const input = fixture();
  for (const sku of input.skus) delete sku.orderQuantities;
  const costing = computeQuoteCosting(input);
  assert.equal(costing.quoteRollup[0].totalCost, 375000);
  assert.ok(Math.abs(costing.quoteRollup[0].totalRevenue - 487500) < 0.000001);
});

test("one shipment can span unequal product runs without changing its total cost", () => {
  const input = fixture();
  input.skus = input.skus.slice(0, 2);
  input.skus[1].orderQuantities = { tier: 20000 };
  input.packaging = [];
  input.freightShipmentBreaks = input.skus.map((sku) => ({
    memberSkuId: sku.id, tierId: "tier", freightSubcategoryId: "combined-shipment",
    treatment: "bundled", memberCount: 2, tierUnits: 25000,
    freightAmount: 1000, freightMarkupPct: 0.3,
    dutyAmount: 0, dutyMarkupPct: 0, tariffAmount: 0, tariffMarkupPct: 0,
  }));
  const costing = computeQuoteCosting(input);
  assert.equal(costing.quoteRollup[0].totalCost, 1000);
  assert.equal(costing.quoteRollup[0].totalRevenue, 1300);
  const projected = projectCommercial({ ...input, costing } as unknown as HydrateSnapshot);
  assert.equal(projected.tiers[0].tierCommercialTotal, 1300);
});

test("a shipment member with recipe usage two reconciles its frozen line and group totals", () => {
  const input = fixture();
  input.skus = [
    { ...input.skus[0], id: "mixed-jar", canonicalQuoteLeafId: null, skuRole: "assembly", orderQuantities: { tier: 5000 } },
    { ...input.skus[1], parentSkuId: "mixed-jar", qtyPerParent: 2, orderQuantities: undefined },
  ];
  input.packaging = [];
  input.freightShipmentBreaks = [{
    memberSkuId: "product-1", tierId: "tier", freightSubcategoryId: "shipment",
    treatment: "bundled", memberCount: 1, tierUnits: 25000,
    freightAmount: 1000, freightMarkupPct: 0.3,
    dutyAmount: 0, dutyMarkupPct: 0, tariffAmount: 0, tariffMarkupPct: 0,
  }];
  const costing = computeQuoteCosting(input);
  assert.equal(costing.quoteRollup[0].totalCost, 1000);
  assert.equal(costing.quoteRollup[0].totalRevenue, 1300);
  const projected = projectCommercial({ ...input, costing } as unknown as HydrateSnapshot);
  assert.equal(projected.tiers[0].tierCommercialTotal, 1300);
});
