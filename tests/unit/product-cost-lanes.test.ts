import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { quoteScopeKey } from "../../src/lib/costing-nodes.ts";
import { productCostLane } from "../../src/lib/costs/product-cost-lane.ts";

const tierId = "tier";
const leaf = (id: string, productType: string, parentSkuId: string | null = null) => ({
  id,
  canonicalQuoteLeafId: `quote-${id}`,
  parentSkuId,
  qtyPerParent: 1,
  skuRole: "leaf" as const,
  skuLabel: id,
  productName: id,
  productType,
  sortOrder: 0,
  retailBenchmark: null,
});
const line = (id: string, cost: number) => ({
  quoteSkuId: id,
  tierId,
  lineGroupId: `line-${id}`,
  unitCost: cost,
  qtyPerSellableUnit: 1,
  category: "Other",
  markupPct: 0,
});
function quote(grouped: boolean): QuoteCostingInput {
  const group = {
    ...leaf("kit", "Turnkey"),
    canonicalQuoteLeafId: null,
    skuRole: "assembly" as const,
  };
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [
      ...(grouped ? [group] : []),
      leaf("jar", "Primary", grouped ? "kit" : null),
      { ...leaf("gummy", "Ingestibles", grouped ? "kit" : null), ...(grouped ? { orderQuantities: { [tierId]: 50 } } : {}) },
      leaf("ingredient", "Raw ingredients", grouped ? "kit" : null),
    ],
    tiers: [{ id: tierId, label: "100 units", qty: 100, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [line("jar", 2), line("gummy", 3), line("ingredient", 5)],
    production: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  };
}
function priceBuild(input: QuoteCostingInput) {
  const result = computeQuoteCosting(input);
  const nodes = result.graph.nodes;
  const find = (node: any, key: string): any =>
    node.key === key ? node : (node.operands ?? []).map((child: any) => find(child, key)).find(Boolean);
  const value = (lane: string) => nodes.map((node: any) => find(node, quoteScopeKey(tierId, `per-unit/${lane}`))).find(Boolean)?.value;
  return { result, pkg: value("pkg"), prod: value("prod"), raw: value("raw") };
}

test("MISTR-like product costs display in Packaging, Production, and Raw lanes without changing the total", () => {
  const { result, pkg, prod, raw } = priceBuild(quote(false));
  assert.equal(pkg, 2);
  assert.equal(prod, 3);
  assert.equal(raw, 5);
  assert.equal(pkg + prod + raw, 10);
  assert.equal(result.quoteRollup[0].totalCost, 1000);
});

test("an item-group member's sub-quantity moves only its own cost into its product-type lane", () => {
  const { result, pkg, prod, raw } = priceBuild(quote(true));
  assert.equal(pkg, 2);
  assert.equal(prod, 1.5);
  assert.equal(raw, 5);
  assert.equal(pkg + prod + raw, 8.5);
  assert.equal(result.quoteRollup[0].totalCost, 850);
});

test("only known product types are reclassified; untyped products remain in Packaging", () => {
  assert.equal(productCostLane(" Ingestibles "), "prod");
  assert.equal(productCostLane("Raw ingredients"), "raw");
  assert.equal(productCostLane("Secondary"), "pkg");
  assert.equal(productCostLane(null), "pkg");
});

test("reclassifying marked-up product lines does not change customer revenue or margin", () => {
  const typed = quote(false);
  typed.packaging[1].markupPct = 0.2;
  typed.packaging[2].markupPct = 0.5;
  const untyped = {
    ...typed,
    skus: typed.skus.map((sku) => ({ ...sku, productType: null })),
  };
  const classified = priceBuild(typed);
  const original = priceBuild(untyped);
  assert.equal(classified.pkg, 2);
  assert.equal(classified.prod, 3.6);
  assert.equal(classified.raw, 7.5);
  assert.equal(classified.pkg + classified.prod + classified.raw, original.pkg);
  assert.equal(classified.result.quoteRollup[0].totalRevenue, original.result.quoteRollup[0].totalRevenue);
  assert.equal(classified.result.quoteRollup[0].totalCost, original.result.quoteRollup[0].totalCost);
});
