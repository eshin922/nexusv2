// Slice 8 unit-test harness for src/lib/costing.ts
//
// Run via:
//   node --experimental-strip-types scripts/test-costing.ts
//
// Builds the canonical Gift Set → Lip Oil 10ml → {Bottle, Cap, Label}
// fixture from CLAUDE.md / actions/costing.ts spec, runs computeQuoteCosting,
// and asserts the canonical numbers (per Edward's spec).
//
// On match: prints PASS for each assertion and exits 0.
// On divergence: prints diff and exits 1.

import {
  computeQuoteCosting,
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
  type QuoteCostingInput,
} from "../src/lib/costing.ts";

const input: QuoteCostingInput = {
  quote: { id: "q1", globalPriceAdjPct: 0 },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "gs",
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "assembly",
      skuLabel: "GIFT-SET",
      productName: "Gift Set",
      sortOrder: 0,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
    {
      id: "lo",
      parentSkuId: "gs",
      qtyPerParent: 1,
      skuRole: "assembly",
      skuLabel: "LIP-OIL-10ML",
      productName: "Lip Oil 10ml",
      sortOrder: 0,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
    {
      id: "bt",
      parentSkuId: "lo",
      qtyPerParent: 1,
      skuRole: "leaf",
      skuLabel: "BOTTLE",
      productName: "Bottle",
      sortOrder: 0,
      dutyPct: 0.04,
      tariffPct: 0.25,
    },
    {
      id: "cp",
      parentSkuId: "lo",
      qtyPerParent: 1,
      skuRole: "leaf",
      skuLabel: "CAP",
      productName: "Cap",
      sortOrder: 1,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
    {
      id: "lb",
      parentSkuId: "lo",
      qtyPerParent: 1,
      skuRole: "leaf",
      skuLabel: "LABEL",
      productName: "Label",
      sortOrder: 2,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
  ],
  tiers: [{ id: "t1", label: "50k", qty: 50000, sortOrder: 0 }],
  packaging: [
    {
      quoteSkuId: "bt",
      tierId: "t1",
      lineGroupId: "bt-pkg",
      unitCost: 0.5,
      qtyPerSellableUnit: 1,
      category: null,
      markupPct: 0.4,
    },
    {
      quoteSkuId: "cp",
      tierId: "t1",
      lineGroupId: "cp-pkg",
      unitCost: 0.05,
      qtyPerSellableUnit: 1,
      category: null,
      markupPct: 0.4,
    },
    {
      quoteSkuId: "lb",
      tierId: "t1",
      lineGroupId: "lb-pkg",
      unitCost: 0.02,
      qtyPerSellableUnit: 1,
      category: null,
      markupPct: 0.5,
    },
  ],
  production: [
    {
      quoteSkuId: "bt",
      tierId: "t1",
      customerShipsRaws: false,
      allocateServiceFeesToCost: true,
      fillingBlendingCost: 5000,
      cmAssemblyTotal: null,
      setupFeeTotal: null,
      toolingArtworkTotal: null,
      rdTotal: null,
      otherServiceTotal: null,
      bulkRawCost: null,
      actualUnitsProduced: null,
    },
  ],
  freight: [
    {
      quoteSkuId: "bt",
      tierId: "t1",
      lineGroupId: "bt-frt",
      totalFreight: 5000,
      unitsInShipment: null,
      // Slice 8 schema correction: PM enters total CBM directly per
      // (SKU, line, tier). Single-SKU container at 50k bottles × 0.0001 m³
      // each = 5 m³ total.
      skuTotalCbm: 5,
      markupPct: 0.3,
      freightTreatment: "bundled",
    },
  ],
};

const out = computeQuoteCosting(input);

let failures = 0;
function approx(actual: number, expected: number, tol = 0.001): boolean {
  return Math.abs(actual - expected) <= tol;
}
function assert(label: string, actual: number, expected: number, tol = 0.001) {
  const ok = approx(actual, expected, tol);
  if (ok) {
    console.log(`  PASS  ${label}: ${actual.toFixed(4)} ≈ ${expected.toFixed(4)}`);
  } else {
    failures += 1;
    console.log(
      `  FAIL  ${label}: actual=${actual} expected=${expected} diff=${(actual - expected).toFixed(6)}`,
    );
  }
}

const byId = new Map(out.skuRollups.map((r) => [r.skuId, r]));
const bottle = byId.get("bt")!.perTier[0];
const cap = byId.get("cp")!.perTier[0];
const label = byId.get("lb")!.perTier[0];
const lipOil = byId.get("lo")!.perTier[0];
const giftSet = byId.get("gs")!.perTier[0];
const tierRollup = out.quoteRollup[0];

console.log("\n=== Bottle (leaf) ===");
assert("factoryCostPerUnit", bottle.factoryCostPerUnit, 0.6);
assert("productionCostPerUnit", bottle.productionCostPerUnit, 0.1);
assert("rawCostPerUnit", bottle.rawCostPerUnit, 0);
assert(
  "containerFreightPerUnit",
  bottle.freightLines[0].containerFreightPerUnit,
  0.1,
);
assert("dutyPerUnit", bottle.freightLines[0].dutyPerUnit, 0.024);
assert("tariffPerUnit", bottle.freightLines[0].tariffPerUnit, 0.15);
assert(
  "landedFreightBeforeMarkup",
  bottle.freightLines[0].landedFreightBeforeMarkup,
  0.274,
);
assert(
  "landedFreightWithMarkup",
  bottle.freightLines[0].landedFreightWithMarkup,
  0.3562,
);
assert("contributionCostPerUnit", bottle.contributionCostPerUnit, 0.874);
assert("requiredSellPerUnit", bottle.requiredSellPerUnit, 1.1862);

console.log("\n=== Cap (leaf) ===");
assert("contributionCostPerUnit", cap.contributionCostPerUnit, 0.05);
assert("requiredSellPerUnit", cap.requiredSellPerUnit, 0.07);

console.log("\n=== Label (leaf) ===");
assert("contributionCostPerUnit", label.contributionCostPerUnit, 0.02);
assert("requiredSellPerUnit", label.requiredSellPerUnit, 0.03);

console.log("\n=== Lip Oil (assembly) ===");
assert("contributionCostPerUnit", lipOil.contributionCostPerUnit, 0.944);
assert("requiredSellPerUnit", lipOil.requiredSellPerUnit, 1.2862);

console.log("\n=== Gift Set (top-level assembly) ===");
assert("contributionCostPerUnit", giftSet.contributionCostPerUnit, 0.944);
assert("requiredSellPerUnit", giftSet.requiredSellPerUnit, 1.2862);

console.log("\n=== Quote-level T1 (50k) ===");
assert("totalRevenue", tierRollup.totalRevenue, 64310, 0.5);
assert("totalCost", tierRollup.totalCost, 47200, 0.5);
assert("blendedMarginPct", tierRollup.blendedMarginPct, 0.266, 0.001);
console.log(
  `  ${tierRollup.blendedMarginStatus === "BELOW_TARGET" ? "PASS" : "FAIL"}  blendedMarginStatus = ${tierRollup.blendedMarginStatus} (expected BELOW_TARGET)`,
);
if (tierRollup.blendedMarginStatus !== "BELOW_TARGET") failures += 1;
assert(
  "suggestedGlobalAdjPct",
  tierRollup.suggestedGlobalAdjPct ?? -1,
  0.13,
  0.001,
);

console.log("\n=== Quote-level cost breakdown (T1) ===");
// Expected: pkg = (0.50 + 0.05 + 0.02) × 50000 = 28500
//           prod = (0.10 + 0 raw) × 50000 = 5000
//           freight = 0.274 (bottle landed_before) × 50000 = 13700
//           svc fees = 0 (allocate=true folds into prod)
//           sum = 47200 ≈ totalCost ✓
const b = tierRollup.costBreakdown;
assert("breakdown.packaging", b.packaging, 28500, 0.5);
assert("breakdown.production", b.production, 5000, 0.5);
assert("breakdown.freight", b.freight, 13700, 0.5);
assert("breakdown.serviceFees", b.serviceFees, 0, 0.5);
const breakdownSum = b.packaging + b.production + b.freight + b.serviceFees;
assert("breakdown sum ≈ totalCost", breakdownSum, tierRollup.totalCost, 0.5);

// Slice RI.8 Option B+ — D+T bucket split assertions. `freight` must
// equal `freightContainer + dutyAndTariff` exactly (it's a derived
// sum). Both component buckets must be non-negative.
assert(
  "breakdown.freight = freightContainer + dutyAndTariff",
  b.freight,
  b.freightContainer + b.dutyAndTariff,
  0.001,
);
console.log(
  `  ${b.freightContainer >= 0 ? "PASS" : "FAIL"}  freightContainer non-negative: ${b.freightContainer}`,
);
if (b.freightContainer < 0) failures += 1;
console.log(
  `  ${b.dutyAndTariff >= 0 ? "PASS" : "FAIL"}  dutyAndTariff non-negative: ${b.dutyAndTariff}`,
);
if (b.dutyAndTariff < 0) failures += 1;

// Slice RI.8 Option 2 — per-component marked-up sum invariants.
// Each markup sum must be ≥ its corresponding cost (markup is
// always ≥ 0 in valid inputs).
assert(
  "packagingMarkupSum ≥ packaging cost",
  Math.max(0, b.packagingMarkupSum - b.packaging),
  Math.abs(b.packagingMarkupSum - b.packaging),
  0.001,
);
assert(
  "productionMarkupSum ≥ production cost",
  Math.max(0, b.productionMarkupSum - b.production),
  Math.abs(b.productionMarkupSum - b.production),
  0.001,
);
assert(
  "freightContainerMarkupSum ≥ freightContainer cost",
  Math.max(0, b.freightContainerMarkupSum - b.freightContainer),
  Math.abs(b.freightContainerMarkupSum - b.freightContainer),
  0.001,
);
assert(
  "dutyAndTariffMarkupSum ≥ dutyAndTariff cost",
  Math.max(0, b.dutyAndTariffMarkupSum - b.dutyAndTariff),
  Math.abs(b.dutyAndTariffMarkupSum - b.dutyAndTariff),
  0.001,
);

console.log("\n=== Render order (top-down) ===");
const order = out.skuRollups.map((r) => r.skuLabel).join(" → ");
const expectedOrder = "GIFT-SET → LIP-OIL-10ML → BOTTLE → CAP → LABEL";
console.log(
  `  ${order === expectedOrder ? "PASS" : "FAIL"}  order: ${order}`,
);
if (order !== expectedOrder) failures += 1;

// ---- NULL sku_total_cbm graceful-handling test ----
// Slice RI.8 Option B+ — domestic-freight fallback. NULL cbm no
// longer zeros container freight; instead this SKU absorbs the
// full line (v1's per-SKU-per-line assumption makes this safe).
// Pre-RI.8 behavior was container=0 on NULL cbm; PMs entering
// domestic freight with no CBM data saw zero contribution. The
// fallback rule: when skuTotalCbm is unset, allocate the line's
// total_freight evenly across effective_units → container =
// total_freight / effective_units. Duty + tariff still apply on
// top (factory-cost × pct).
console.log("\n=== NULL sku_total_cbm — domestic-freight fallback ===");
const nullCbmInput: QuoteCostingInput = {
  quote: { id: "q2", globalPriceAdjPct: 0 },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "x",
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "leaf",
      skuLabel: "X",
      productName: "X",
      sortOrder: 0,
      dutyPct: 0.04,
      tariffPct: 0.25,
    },
  ],
  tiers: [{ id: "t1", label: "10k", qty: 10000, sortOrder: 0 }],
  packaging: [
    {
      quoteSkuId: "x",
      tierId: "t1",
      lineGroupId: "x-pkg",
      unitCost: 1,
      qtyPerSellableUnit: 1,
      category: null,
      markupPct: 0.4,
    },
  ],
  production: [],
  freight: [
    {
      quoteSkuId: "x",
      tierId: "t1",
      lineGroupId: "x-frt",
      totalFreight: 1000,
      unitsInShipment: null,
      skuTotalCbm: null, // NULL — no CBM data yet
      markupPct: 0.3,
      freightTreatment: "bundled",
    },
  ],
};
const nullOut = computeQuoteCosting(nullCbmInput);
const nullLeaf = nullOut.skuRollups[0].perTier[0];
const nullLine = nullLeaf.freightLines[0];
// Domestic fallback: container = totalFreight / effectiveUnits
// = 1000 / 10000 = 0.10 per unit. Prior assertion expected 0;
// behavior changed in Slice RI.8 Option B+.
assert(
  "container/unit (NULL cbm — domestic fallback)",
  nullLine.containerFreightPerUnit,
  1000 / 10000,
);
assert("duty/unit (still applies)", nullLine.dutyPerUnit, 1 * 0.04);
assert("tariff/unit (still applies)", nullLine.tariffPerUnit, 1 * 0.25);
assert(
  "landed_before (container + duty + tariff)",
  nullLine.landedFreightBeforeMarkup,
  0.1 + 0.04 + 0.25,
);
console.log(
  `  ${Number.isFinite(nullLeaf.contributionCostPerUnit) ? "PASS" : "FAIL"}  contributionCost is finite (no NaN): ${nullLeaf.contributionCostPerUnit}`,
);
if (!Number.isFinite(nullLeaf.contributionCostPerUnit)) failures += 1;
console.log(
  `  ${Number.isFinite(nullLeaf.requiredSellPerUnit) ? "PASS" : "FAIL"}  requiredSell is finite (no NaN): ${nullLeaf.requiredSellPerUnit}`,
);
if (!Number.isFinite(nullLeaf.requiredSellPerUnit)) failures += 1;

// ---- Slice 9.2: per-tier price-adj override REPLACES global ----
// Two tiers with the same costs; tier A inherits global GPA = 0.20,
// tier B overrides to 0.50. Revenue at B should be 25% higher than at
// A (1.50 / 1.20). Suggested-GPA on the overridden tier is null.
console.log("\n=== Slice 9.2: per-tier price-adj override ===");
const perTierInput: QuoteCostingInput = {
  quote: { id: "q3", globalPriceAdjPct: 0.2, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "x",
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "leaf",
      skuLabel: "X",
      productName: "X",
      sortOrder: 0,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
  ],
  tiers: [
    { id: "tA", label: "A", qty: 100, sortOrder: 0, tierPriceAdjPct: null },
    { id: "tB", label: "B", qty: 100, sortOrder: 1, tierPriceAdjPct: 0.5 },
  ],
  packaging: [
    { quoteSkuId: "x", tierId: "tA", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.4 },
    { quoteSkuId: "x", tierId: "tB", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.4 },
  ],
  production: [],
  freight: [],
};
const perTierOut = computeQuoteCosting(perTierInput);
const revA = perTierOut.quoteRollup[0].totalRevenue;
const revB = perTierOut.quoteRollup[1].totalRevenue;
// Per-unit revenue: cost=1, markup=0.4 → 1.40 base; × (1 + adj)
// A: 1.40 × 1.20 = 1.68; B: 1.40 × 1.50 = 2.10
assert("per-tier override A revenue (×1.20)", revA, 100 * 1.4 * 1.2);
assert("per-tier override B revenue (×1.50)", revB, 100 * 1.4 * 1.5);
// Tier B's per-tier suggested-adj must be null (override suppresses).
console.log(
  `  ${perTierOut.quoteRollup[1].suggestedGlobalAdjPct === null ? "PASS" : "FAIL"}  per-tier suggested null when overridden: ${perTierOut.quoteRollup[1].suggestedGlobalAdjPct}`,
);
if (perTierOut.quoteRollup[1].suggestedGlobalAdjPct !== null) failures += 1;

// ---- Slice 9.2: per-quote target margin override drives verdict ----
console.log("\n=== Slice 9.2: per-quote target override ===");
const targetOverrideInput: QuoteCostingInput = {
  ...perTierInput,
  quote: { id: "q4", globalPriceAdjPct: 0, targetMarginPct: 0.20 },
  tiers: [
    { id: "tA", label: "A", qty: 100, sortOrder: 0, tierPriceAdjPct: null },
  ],
};
const targetOut = computeQuoteCosting(targetOverrideInput);
// margin = 1 - 1/1.40 ≈ 0.286. firm target=0.35 (BELOW), quote
// override=0.20 (GOOD).
console.log(
  `  ${targetOut.quoteSummary.blendedMarginStatus === "GOOD" ? "PASS" : "FAIL"}  per-quote target override flips verdict to GOOD: ${targetOut.quoteSummary.blendedMarginStatus}`,
);
if (targetOut.quoteSummary.blendedMarginStatus !== "GOOD") failures += 1;
assert(
  "effective target reflects override",
  targetOut.quoteSummary.effectiveTargetMarginPct,
  0.20,
);

// ---- Slice 9.2: quote suggestion partitions overridden vs inheriting ----
console.log("\n=== Slice 9.2: quote-wide suggested GPA (partition) ===");
// Two tiers. cost=1/unit, markup=0.05 (thin). Tier A inherits global
// (start at 0), tier B overrides to +0.50. With floor=0.10 the
// blended verdict is BELOW_TARGET (not BELOW_FLOOR), so goal=target.
// Quote-suggestion holds B's revenue FIXED and solves only for A's
// GPA — closed form:
//   targetBlendedRev = (100+100)/(1-0.35) ≈ 307.69
//   requiredA       = 307.69 - 157.5     ≈ 150.19
//   suggestedAdj    = 150.19/105 - 1     ≈ 0.43
const partitionInput: QuoteCostingInput = {
  ...perTierInput,
  quote: { id: "q5", globalPriceAdjPct: 0, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.10 },
  packaging: [
    { quoteSkuId: "x", tierId: "tA", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.05 },
    { quoteSkuId: "x", tierId: "tB", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.05 },
  ],
};
const partitionOut = computeQuoteCosting(partitionInput);
console.log(
  `  ${partitionOut.quoteSummary.blendedMarginStatus === "BELOW_TARGET" ? "PASS" : "FAIL"}  blended verdict precondition (BELOW_TARGET): ${partitionOut.quoteSummary.blendedMarginStatus}`,
);
if (partitionOut.quoteSummary.blendedMarginStatus !== "BELOW_TARGET") failures += 1;
console.log(
  `  ${partitionOut.quoteSummary.suggestionGoal === "target" ? "PASS" : "FAIL"}  goal-shift: BELOW_TARGET → goal=target`,
);
if (partitionOut.quoteSummary.suggestionGoal !== "target") failures += 1;
console.log(
  `  ${partitionOut.quoteSummary.suggestedAdj !== null ? "PASS" : "FAIL"}  quote-wide suggestion produced (non-null): ${partitionOut.quoteSummary.suggestedAdj}`,
);
if (partitionOut.quoteSummary.suggestedAdj === null) failures += 1;
// Padded-up nearest 1%; expect ≈ 0.43.
if (partitionOut.quoteSummary.suggestedAdj !== null) {
  assert(
    "partition: suggested ≈ 0.43 (solves only for inheriting tier)",
    partitionOut.quoteSummary.suggestedAdj,
    0.43,
    0.011,
  );
}

// ---- Slice 9.2: goal-shift to floor when BELOW_FLOOR ----
console.log("\n=== Slice 9.2: goal-shift BELOW_FLOOR → goal=floor ===");
// Same shape but firm floor=0.25 keeps verdict at BELOW_FLOOR; goal
// must be floor (not target). Suggestion math then targets floor=0.25
// with B fixed: requiredA = 200/(1-0.25) - 157.5 = 109.17;
// suggestedAdj = 109.17/105 - 1 ≈ 0.04 (padded up).
const floorPartitionInput: QuoteCostingInput = {
  ...partitionInput,
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
};
const floorPartitionOut = computeQuoteCosting(floorPartitionInput);
console.log(
  `  ${floorPartitionOut.quoteSummary.blendedMarginStatus === "BELOW_FLOOR" ? "PASS" : "FAIL"}  blended verdict precondition (BELOW_FLOOR): ${floorPartitionOut.quoteSummary.blendedMarginStatus}`,
);
if (floorPartitionOut.quoteSummary.blendedMarginStatus !== "BELOW_FLOOR") failures += 1;
console.log(
  `  ${floorPartitionOut.quoteSummary.suggestionGoal === "floor" ? "PASS" : "FAIL"}  goal-shift: BELOW_FLOOR → goal=floor`,
);
if (floorPartitionOut.quoteSummary.suggestionGoal !== "floor") failures += 1;
if (floorPartitionOut.quoteSummary.suggestedAdj !== null) {
  assert(
    "floor partition: suggested ≈ 0.04 (lifts above floor)",
    floorPartitionOut.quoteSummary.suggestedAdj,
    0.04,
    0.011,
  );
}

// ---- Slice 9.3: per-cell sell-price override is terminal ----
// Global GPA = 0.50, no tier overrides. One leaf SKU; cell override at
// $7.00 for tier T1. The override REPLACES the computed sell entirely;
// neither global nor per-tier adj affects it. Computed value still
// exposed for "was $X" tooltip via computedSellPerUnit.
console.log("\n=== Slice 9.3: per-cell override is terminal ===");
const cellOverrideInput: QuoteCostingInput = {
  quote: { id: "q9.3a", globalPriceAdjPct: 0.5, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "x",
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "leaf",
      skuLabel: "X",
      productName: "X",
      sortOrder: 0,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
  ],
  tiers: [
    { id: "tA", label: "A", qty: 100, sortOrder: 0, tierPriceAdjPct: null },
  ],
  packaging: [
    { quoteSkuId: "x", tierId: "tA", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.4 },
  ],
  production: [],
  freight: [],
  cellOverrides: [
    { quoteSkuId: "x", tierId: "tA", sellPriceOverride: 7.0 },
  ],
};
const cellOverrideOut = computeQuoteCosting(cellOverrideInput);
const cellRollup = cellOverrideOut.skuRollups[0].perTier[0];
assert("cell override is used directly as requiredSell", cellRollup.requiredSellPerUnit, 7.0);
// Computed value would be: cost=1, markup=0.4 → base=1.40; × (1.50 GPA) = 2.10
assert("computedSellPerUnit shows pre-override value", cellRollup.computedSellPerUnit, 2.1);
console.log(
  `  ${cellRollup.sellSource === "cell_override" ? "PASS" : "FAIL"}  sellSource = "cell_override": ${cellRollup.sellSource}`,
);
if (cellRollup.sellSource !== "cell_override") failures += 1;
// Tier revenue uses override × tier.qty = 7 × 100 = 700
assert("tier revenue uses override × qty", cellOverrideOut.quoteRollup[0].totalRevenue, 700);

// ---- Slice 9.3: partition handles per-cell granularity within a
// tier-overridden tier (no double-counting) ----
// Tier T2 has tier_price_adj_pct = 0.10. One cell in T2 has a cell
// override. Verifies the partition treats the cell as ONE fixed
// contribution (not double-counted across tier-fixed AND cell-fixed
// classifications). At the top-level walk, each (SKU, tier) cell is
// classified once and contributes once to revenueFixed/costFixed.
console.log("\n=== Slice 9.3: partition handles per-cell granularity within tier-overridden tier (no double-counting) ===");
const partitionGranularityInput: QuoteCostingInput = {
  quote: { id: "q9.3b", globalPriceAdjPct: 0.2, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.5, floorMarginPct: 0.1 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "x",
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "leaf",
      skuLabel: "X",
      productName: "X",
      sortOrder: 0,
      dutyPct: null,
      tariffPct: null,
      retailBenchmark: null,
    },
  ],
  tiers: [
    { id: "t1", label: "T1", qty: 100, sortOrder: 0, tierPriceAdjPct: null },
    { id: "t2", label: "T2", qty: 100, sortOrder: 1, tierPriceAdjPct: 0.1 },
  ],
  packaging: [
    { quoteSkuId: "x", tierId: "t1", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.05 },
    { quoteSkuId: "x", tierId: "t2", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.05 },
  ],
  production: [],
  freight: [],
  // Cell-level override on T2 specifically (T2 also has tier-adj).
  cellOverrides: [
    { quoteSkuId: "x", tierId: "t2", sellPriceOverride: 1.5 },
  ],
};
const granularityOut = computeQuoteCosting(partitionGranularityInput);
// T2's revenue = override 1.50 × qty 100 = 150 (not 100 × 1.05 × 1.10 = 115.5).
assert(
  "T2 cell uses override (terminal — bypasses tier-adj)",
  granularityOut.quoteRollup[1].totalRevenue,
  150,
);
// T1 inherits global +20%: revenue = 100 × 1.05 × 1.20 = 126
assert(
  "T1 cell inherits global GPA",
  granularityOut.quoteRollup[0].totalRevenue,
  126,
);
// Blended: 126 + 150 = 276 revenue, 200 cost, margin = (276-200)/276 = 0.275
// Below target 0.50 → BELOW_TARGET. Both cells gpaFixed (T1 fixed because
// nothing inheriting in T1? actually T1 inherits global, T2 fixed by both
// cell-override and tier-adj). For partition: T1 gpaFixed = false (no
// tier-adj, no cell-override on this leaf). T2 gpaFixed = true.
console.log(
  `  ${granularityOut.quoteSummary.blendedMarginStatus === "BELOW_TARGET" ? "PASS" : "FAIL"}  blended verdict precondition (BELOW_TARGET): ${granularityOut.quoteSummary.blendedMarginStatus}`,
);
if (granularityOut.quoteSummary.blendedMarginStatus !== "BELOW_TARGET") failures += 1;
// Suggestion solves only for T1 (the inheriting cell). T1 needs to lift
// blended to target. Math:
//   targetBlendedRev = 200 / (1 - 0.50) = 400
//   requiredInheritingRev = 400 - 150 = 250
//   T1 revenue at GPA=0 = 126 / 1.20 = 105
//   adjNew = 250/105 - 1 = 1.381 → out of bounds (> SUGGESTION_MAX_PCT=1.0)
// So suggestion suppresses with "GPA alone cannot land blended at target" microcopy.
console.log(
  `  ${granularityOut.quoteSummary.suggestedAdj === null ? "PASS" : "FAIL"}  out-of-bounds suggestion suppresses: ${granularityOut.quoteSummary.suggestedAdj}`,
);
if (granularityOut.quoteSummary.suggestedAdj !== null) failures += 1;
console.log(
  `  ${granularityOut.quoteSummary.suggestionMicrocopy.includes("GPA alone cannot") ? "PASS" : "FAIL"}  microcopy reflects out-of-bounds: ${granularityOut.quoteSummary.suggestionMicrocopy}`,
);
if (!granularityOut.quoteSummary.suggestionMicrocopy.includes("GPA alone cannot")) failures += 1;

// ---- Slice 9.3: belt-and-suspenders negative-sell guard ----
// Action layer rejects override <= 0; this test exercises the costing
// math's defensive guard for the bypass case. Negative override would
// make (neg − pos) / neg = pos, falsely reporting positive margin
// without the guard. Sentinel value -1 signals "invalid: negative
// sell price" so consumers can render an error pill.
console.log("\n=== Slice 9.3: defensive guard against negative requiredSell ===");
const negativeOverrideInput: QuoteCostingInput = {
  ...cellOverrideInput,
  quote: { id: "q9.3c", globalPriceAdjPct: 0, targetMarginPct: null },
  cellOverrides: [
    { quoteSkuId: "x", tierId: "tA", sellPriceOverride: -5.0 },
  ],
};
const negativeOut = computeQuoteCosting(negativeOverrideInput);
const negCell = negativeOut.skuRollups[0].perTier[0];
assert(
  "negative requiredSell triggers -1 margin sentinel",
  negCell.marginPct,
  -1,
);

// ---- Slice 9.4b: competitive verdict classification ----
// Cell with no client target → competitiveStatus null (NULL-as-empty-signal).
// Cell with target above required_sell → COMPETITIVE.
// Cell with target below required_sell → OVER_CLIENT_TARGET.
console.log("\n=== Slice 9.4b: competitive verdict classification ===");
const competitiveBaseInput: QuoteCostingInput = {
  quote: { id: "q9.4b-a", globalPriceAdjPct: 0, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    {
      id: "x", parentSkuId: null, qtyPerParent: null, skuRole: "leaf",
      skuLabel: "X", productName: "X", sortOrder: 0,
      dutyPct: null, tariffPct: null, retailBenchmark: null,
    },
  ],
  tiers: [
    { id: "tA", label: "A", qty: 100, sortOrder: 0, tierPriceAdjPct: null },
  ],
  packaging: [
    { quoteSkuId: "x", tierId: "tA", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.4 },
  ],
  production: [], freight: [],
  cellOverrides: [],
  cellTargets: [],
};
// Computed sell at this state: cost=1, markup=0.4 → base=1.40; × (1+0) = 1.40.
const competitiveNullOut = computeQuoteCosting(competitiveBaseInput);
const cellNoTarget = competitiveNullOut.skuRollups[0].perTier[0];
console.log(
  `  ${cellNoTarget.competitiveStatus === null ? "PASS" : "FAIL"}  no target → competitiveStatus null: ${cellNoTarget.competitiveStatus}`,
);
if (cellNoTarget.competitiveStatus !== null) failures += 1;

const competitiveAboveOut = computeQuoteCosting({
  ...competitiveBaseInput,
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 2.0 }],
});
const cellAboveTarget = competitiveAboveOut.skuRollups[0].perTier[0];
console.log(
  `  ${cellAboveTarget.competitiveStatus === "COMPETITIVE" ? "PASS" : "FAIL"}  required_sell ($1.40) ≤ target ($2.00) → COMPETITIVE: ${cellAboveTarget.competitiveStatus}`,
);
if (cellAboveTarget.competitiveStatus !== "COMPETITIVE") failures += 1;

const competitiveBelowOut = computeQuoteCosting({
  ...competitiveBaseInput,
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 1.0 }],
});
const cellBelowTarget = competitiveBelowOut.skuRollups[0].perTier[0];
console.log(
  `  ${cellBelowTarget.competitiveStatus === "OVER_CLIENT_TARGET" ? "PASS" : "FAIL"}  required_sell ($1.40) > target ($1.00) → OVER_CLIENT_TARGET: ${cellBelowTarget.competitiveStatus}`,
);
if (cellBelowTarget.competitiveStatus !== "OVER_CLIENT_TARGET") failures += 1;

// Equality counts as COMPETITIVE per architect Q3 sign-off ("equality
// counts as COMPETITIVE — PM lands exactly at target; not over").
const competitiveEqualOut = computeQuoteCosting({
  ...competitiveBaseInput,
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 1.4 }],
});
const cellEqualTarget = competitiveEqualOut.skuRollups[0].perTier[0];
console.log(
  `  ${cellEqualTarget.competitiveStatus === "COMPETITIVE" ? "PASS" : "FAIL"}  required_sell == target → COMPETITIVE: ${cellEqualTarget.competitiveStatus}`,
);
if (cellEqualTarget.competitiveStatus !== "COMPETITIVE") failures += 1;

// ---- Slice 9.4b: reverse-solve happy path ----
// Cell with cost=1, markup=0.4 → base=1.40. Target $2.00.
// Math: tier_adj = 2.00 / 1.40 - 1 = 0.4286.
console.log("\n=== Slice 9.4b: reverse-solve happy path ===");
const solveOut = suggestTierAdjForClientTarget(
  "x", "tA", competitiveAboveOut, {
    ...competitiveBaseInput,
    cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 2.0 }],
  },
);
console.log(
  `  ${solveOut.ok ? "PASS" : "FAIL"}  reverse-solve produces value (ok=true)`,
);
if (!solveOut.ok) failures += 1;
if (solveOut.ok) {
  assert(
    "reverse-solve: tier_adj = T/base - 1 = 2.0/1.4 - 1 ≈ 0.4286",
    solveOut.suggestedTierAdj,
    0.4286,
    0.001,
  );
}

// ---- Slice 9.4b: reverse-solve edge cases ----
console.log("\n=== Slice 9.4b: reverse-solve edge cases ===");

// (a) no_target_set
const noTargetSolve = suggestTierAdjForClientTarget(
  "x", "tA", competitiveNullOut, competitiveBaseInput,
);
console.log(
  `  ${!noTargetSolve.ok && noTargetSolve.reason === "no_target_set" ? "PASS" : "FAIL"}  no target → no_target_set: ${noTargetSolve.ok ? "ok=true" : noTargetSolve.reason}`,
);
if (!(!noTargetSolve.ok && noTargetSolve.reason === "no_target_set")) failures += 1;

// (b) cell_overridden — target set, but cell also has sell_price_override
const overriddenInput: QuoteCostingInput = {
  ...competitiveBaseInput,
  cellOverrides: [{ quoteSkuId: "x", tierId: "tA", sellPriceOverride: 1.5 }],
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 2.0 }],
};
const overriddenOut = computeQuoteCosting(overriddenInput);
const overriddenSolve = suggestTierAdjForClientTarget(
  "x", "tA", overriddenOut, overriddenInput,
);
console.log(
  `  ${!overriddenSolve.ok && overriddenSolve.reason === "cell_overridden" ? "PASS" : "FAIL"}  cell overridden → cell_overridden: ${overriddenSolve.ok ? "ok=true" : overriddenSolve.reason}`,
);
if (!(!overriddenSolve.ok && overriddenSolve.reason === "cell_overridden")) failures += 1;

// (d) cost_exceeds_target — base ($1.40) >= T ($1.00)
const costExceedsInput: QuoteCostingInput = {
  ...competitiveBaseInput,
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 1.0 }],
};
const costExceedsOut = computeQuoteCosting(costExceedsInput);
const costExceedsSolve = suggestTierAdjForClientTarget(
  "x", "tA", costExceedsOut, costExceedsInput,
);
console.log(
  `  ${!costExceedsSolve.ok && costExceedsSolve.reason === "cost_exceeds_target" ? "PASS" : "FAIL"}  base >= T → cost_exceeds_target: ${costExceedsSolve.ok ? "ok=true" : costExceedsSolve.reason}`,
);
if (!(!costExceedsSolve.ok && costExceedsSolve.reason === "cost_exceeds_target")) failures += 1;

// (e) solution_out_of_range — base very small, T very large → tier_adj > 9.99
// base=1.40, T=20 → tier_adj = 20/1.40 - 1 = 13.28 → above bound (9.99)
const oorInput: QuoteCostingInput = {
  ...competitiveBaseInput,
  cellTargets: [{ quoteSkuId: "x", tierId: "tA", clientTargetPricePerUnit: 20.0 }],
};
const oorOut = computeQuoteCosting(oorInput);
const oorSolve = suggestTierAdjForClientTarget(
  "x", "tA", oorOut, oorInput,
);
console.log(
  `  ${!oorSolve.ok && oorSolve.reason === "solution_out_of_range" ? "PASS" : "FAIL"}  out-of-range solution suppresses: ${oorSolve.ok ? "ok=true value=" + oorSolve.suggestedTierAdj : oorSolve.reason}`,
);
if (!(!oorSolve.ok && oorSolve.reason === "solution_out_of_range")) failures += 1;

// ---- Slice 9.4b: leaf-only invariant (math layer ignores assembly targets) ----
// Workflow correction surfaced during 9.4b smoke: customers state
// client targets at SKU level (per leaf SKU, per tier) OR quote level
// (Slice 9.4c, separate column). Never at assembly level. Action layer
// rejects assembly writes; math layer is defense in depth — even if a
// stray assembly target lands in input.cellTargets (impossible via UI;
// only possible via direct DB write), the math computes
// competitiveStatus: null on the assembly rollup. Mirrors the
// leaf-only invariant on Slice 9.3 sell-price overrides.
console.log("\n=== Slice 9.4b: math layer ignores assembly cellTargets ===");
const assemblyInput: QuoteCostingInput = {
  quote: { id: "q9.4b-asm", globalPriceAdjPct: 0, targetMarginPct: null },
  firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
  markupDefaults: { Manufacturing: 0.3, Other: 0.3 },
  skus: [
    { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly",
      skuLabel: "ASM", productName: "Kit", sortOrder: 0, dutyPct: null, tariffPct: null, retailBenchmark: null },
    { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf",
      skuLabel: "L", productName: "Leaf", sortOrder: 0, dutyPct: null, tariffPct: null, retailBenchmark: null },
  ],
  tiers: [{ id: "tA", label: "A", qty: 10, sortOrder: 0, tierPriceAdjPct: null }],
  packaging: [
    { quoteSkuId: "leaf", tierId: "tA", lineGroupId: "g", unitCost: 1, qtyPerSellableUnit: 1, category: null, markupPct: 0.4 },
  ],
  production: [], freight: [],
  cellOverrides: [],
  cellTargets: [
    // Stray assembly target in input — should be ignored by math layer.
    // (Impossible via UI; included here to verify defense in depth.)
    { quoteSkuId: "asm", tierId: "tA", clientTargetPricePerUnit: 2.0 },
  ],
};
const assemblyOut = computeQuoteCosting(assemblyInput);
const assemblyRollup = assemblyOut.skuRollups.find((r) => r.skuId === "asm")!;
const assemblyCell = assemblyRollup.perTier[0];
console.log(
  `  ${assemblyCell.competitiveStatus === null ? "PASS" : "FAIL"}  assembly cellTarget ignored → competitiveStatus null: ${assemblyCell.competitiveStatus}`,
);
if (assemblyCell.competitiveStatus !== null) failures += 1;

// ---- Slice 9.4b: cost_exceeds_target apply path (naive helper) ----
// Bug surfaced during 9.4b smoke: action layer rejected the destructive-
// case apply (base >= T) because `suggestTierAdjForClientTarget` returns
// ok=false for cost_exceeds_target. Cell.tsx hand-computed the naive
// solution inline; action layer didn't mirror. Fix extracts the naive
// math to `naiveTierAdjForCostExceedsTarget` so both call sites stay
// aligned. Math: tier_adj = clientTarget / base - 1, bounded to
// [-0.99, 9.99] (sane price-near-zero floor; non-finite → null).
console.log("\n=== Slice 9.4b: cost_exceeds_target naive helper ===");

// Happy path: target < base → negative naive in bounds.
// base=2, target=1 → naive = 1/2 - 1 = -0.5 (sell at 50% of base, not
// at-cost). Within [-0.99, 9.99].
const naiveHappy = naiveTierAdjForCostExceedsTarget(2, 1);
console.log(
  `  ${naiveHappy === -0.5 ? "PASS" : "FAIL"}  base=2, target=1 → naive=-0.5 (in bounds): ${naiveHappy}`,
);
if (naiveHappy !== -0.5) failures += 1;

// Edge: target = base → naive = 0 (apply with no change; no-op edge).
const naiveEqual = naiveTierAdjForCostExceedsTarget(3, 3);
console.log(
  `  ${naiveEqual === 0 ? "PASS" : "FAIL"}  base=3, target=3 → naive=0: ${naiveEqual}`,
);
if (naiveEqual !== 0) failures += 1;

// Out of range LOW: target ≪ base → naive < -0.99 → null.
// base=100, target=0.5 → naive = 0.005 - 1 = -0.995. Below -0.99.
const naiveTooLow = naiveTierAdjForCostExceedsTarget(100, 0.5);
console.log(
  `  ${naiveTooLow === null ? "PASS" : "FAIL"}  target ≪ base (sell ≈ 0%) → null: ${naiveTooLow}`,
);
if (naiveTooLow !== null) failures += 1;

// Defensive: base = 0 → null (singular).
const naiveZeroBase = naiveTierAdjForCostExceedsTarget(0, 1);
console.log(
  `  ${naiveZeroBase === null ? "PASS" : "FAIL"}  base=0 → null: ${naiveZeroBase}`,
);
if (naiveZeroBase !== null) failures += 1;

// Defensive: negative base → null (invariant violation).
const naiveNegBase = naiveTierAdjForCostExceedsTarget(-1, 1);
console.log(
  `  ${naiveNegBase === null ? "PASS" : "FAIL"}  base<0 → null: ${naiveNegBase}`,
);
if (naiveNegBase !== null) failures += 1;

// Defensive: non-finite inputs → null.
const naiveNaN = naiveTierAdjForCostExceedsTarget(NaN, 1);
console.log(
  `  ${naiveNaN === null ? "PASS" : "FAIL"}  base=NaN → null: ${naiveNaN}`,
);
if (naiveNaN !== null) failures += 1;

// Round-trip verification: applying naive to base lands at target
// within float precision. Mirrors the action-layer tolerance check.
const baseRT = 2.5355;
const targetRT = 2.0;
const naiveRT = naiveTierAdjForCostExceedsTarget(baseRT, targetRT)!;
const sellAfterApply = baseRT * (1 + naiveRT);
console.log(
  `  ${Math.abs(sellAfterApply - targetRT) < 1e-9 ? "PASS" : "FAIL"}  applying naive lands sell at target: base*(1+adj)=${sellAfterApply.toFixed(6)} vs target=${targetRT}`,
);
if (Math.abs(sellAfterApply - targetRT) > 1e-9) failures += 1;

console.log(
  `\n${failures === 0 ? "✓ ALL ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
