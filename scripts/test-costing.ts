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

console.log("\n=== Render order (top-down) ===");
const order = out.skuRollups.map((r) => r.skuLabel).join(" → ");
const expectedOrder = "GIFT-SET → LIP-OIL-10ML → BOTTLE → CAP → LABEL";
console.log(
  `  ${order === expectedOrder ? "PASS" : "FAIL"}  order: ${order}`,
);
if (order !== expectedOrder) failures += 1;

// ---- NULL sku_total_cbm graceful-handling test ----
// Build a minimal one-leaf one-tier quote where the freight line has
// total_freight set but sku_total_cbm IS NULL. Container freight should
// be 0 (no division-by-zero, no NaN); duty + tariff still apply.
console.log("\n=== NULL sku_total_cbm graceful handling ===");
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
assert("container/unit (NULL cbm)", nullLine.containerFreightPerUnit, 0);
assert("duty/unit (still applies)", nullLine.dutyPerUnit, 1 * 0.04);
assert("tariff/unit (still applies)", nullLine.tariffPerUnit, 1 * 0.25);
assert("landed_before (no container)", nullLine.landedFreightBeforeMarkup, 0.04 + 0.25);
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

console.log(
  `\n${failures === 0 ? "✓ ALL ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
