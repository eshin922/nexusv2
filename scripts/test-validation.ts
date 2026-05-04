// Slice 9.5 unit-test harness for src/lib/validation.ts
//
// Run via:
//   node --experimental-strip-types scripts/test-validation.ts
//
// Exercises each validation rule against minimal fixtures. Engine is
// pure; tests construct QuoteCostingInput + QuoteCostingResult inputs
// directly and assert on the WarningSpec[] output.
//
// On match: prints PASS for each assertion and exits 0.
// On divergence: prints FAIL with diff and exits 1.

import {
  computeQuoteCosting,
  type CostingFreightInput,
  type CostingPackagingInput,
  type CostingProductionInput,
  type CostingSku,
  type CostingTier,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "../src/lib/costing.ts";
import { validateQuote, type WarningSpec } from "../src/lib/validation.ts";

let failures = 0;

function assertWarnings(
  label: string,
  warnings: WarningSpec[],
  predicate: (w: WarningSpec[]) => boolean,
  detail: string,
) {
  const pass = predicate(warnings);
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (!pass) failures += 1;
}

// ---------- fixture helpers ----------

function makeSku(overrides: Partial<CostingSku> & { id: string }): CostingSku {
  return {
    parentSkuId: null,
    qtyPerParent: null,
    skuRole: "leaf",
    skuLabel: overrides.id.toUpperCase(),
    productName: `Product ${overrides.id}`,
    sortOrder: 0,
    dutyPct: null,
    tariffPct: null,
    retailBenchmark: null,
    ...overrides,
  };
}

function makeTier(id: string, qty: number, sortOrder = 0): CostingTier {
  return {
    id,
    label: `T${id.slice(-1)}`,
    qty,
    sortOrder,
    tierPriceAdjPct: null,
  };
}

function makeProductionInput(
  overrides: Partial<CostingProductionInput> & { quoteSkuId: string; tierId: string },
): CostingProductionInput {
  return {
    customerShipsRaws: false,
    allocateServiceFeesToCost: true,
    fillingBlendingCost: null,
    cmAssemblyTotal: null,
    setupFeeTotal: null,
    toolingArtworkTotal: null,
    rdTotal: null,
    otherServiceTotal: null,
    bulkRawCost: null,
    actualUnitsProduced: null,
    ...overrides,
  };
}

function makePackagingInput(
  overrides: Partial<CostingPackagingInput> & {
    quoteSkuId: string;
    tierId: string;
    lineGroupId: string;
  },
): CostingPackagingInput {
  return {
    unitCost: null,
    qtyPerSellableUnit: null,
    category: null,
    markupPct: null,
    ...overrides,
  };
}

function makeFreightInput(
  overrides: Partial<CostingFreightInput> & {
    quoteSkuId: string;
    tierId: string;
    lineGroupId: string;
  },
): CostingFreightInput {
  return {
    totalFreight: null,
    unitsInShipment: null,
    skuTotalCbm: null,
    markupPct: null,
    freightTreatment: "bundled",
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<QuoteCostingInput>,
): QuoteCostingInput {
  return {
    quote: { id: "q1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Manufacturing: 0.3, "Primary Packaging": 0.4 },
    skus: [],
    tiers: [],
    packaging: [],
    production: [],
    freight: [],
    cellOverrides: [],
    cellTargets: [],
    ...overrides,
  };
}

function compute(input: QuoteCostingInput): QuoteCostingResult {
  return computeQuoteCosting(input);
}

// ---------- tests ----------

console.log("\n=== Slice 9.5: empty quote (no SKUs, no tiers) ===");
{
  const input = makeInput({});
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "no_tiers_defined fires",
    out,
    (w) => w.some((x) => x.kind === "no_tiers_defined" && x.severity === "action_required"),
    JSON.stringify(out.map((x) => x.kind)),
  );
}

console.log("\n=== Slice 9.5: tiers + SKUs with no cost data → info-level warning ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000)],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "no_skus_with_cost_data fires (info)",
    out,
    (w) => w.some((x) => x.kind === "no_skus_with_cost_data" && x.severity === "info"),
    JSON.stringify(out.map((x) => x.kind)),
  );
  assertWarnings(
    "no_tiers_defined does NOT fire when tiers exist",
    out,
    (w) => !w.some((x) => x.kind === "no_tiers_defined"),
    "no no_tiers warning",
  );
}

console.log("\n=== Slice 9.5: tier coverage mismatch on packaging ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000), makeTier("t3", 10000)],
    packaging: [
      makePackagingInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        unitCost: 1.5,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const tierWarnings = out.filter((x) => x.kind === "tier_coverage_mismatch");
  assertWarnings(
    "tier_coverage_mismatch fires for each missing tier (2 warnings expected)",
    out,
    () => tierWarnings.length === 2,
    `expected 2 warnings, got ${tierWarnings.length}`,
  );
  assertWarnings(
    "tier_coverage_mismatch severity is review",
    out,
    () => tierWarnings.every((x) => x.severity === "review"),
    "all review-severity",
  );
  assertWarnings(
    "tier_coverage_mismatch suggested_fix is copy_from_tier",
    out,
    () =>
      tierWarnings.every(
        (x) =>
          (x.detail_json.suggested_fix as { kind: string }).kind ===
          "copy_from_tier",
      ),
    "suggested_fix.kind = copy_from_tier",
  );
}

console.log("\n=== Slice 9.5: service fee tier variance ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000), makeTier("t3", 10000)],
    production: [
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t1",
        setupFeeTotal: 5000,
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t2",
        setupFeeTotal: 5200,
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t3",
        setupFeeTotal: 5000,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const variance = out.filter((x) => x.kind === "service_fee_tier_variance");
  assertWarnings(
    "service_fee_tier_variance fires on setupFeeTotal",
    out,
    () =>
      variance.length === 1 &&
      variance[0].field_name === "setupFeeTotal" &&
      variance[0].severity === "review",
    `${variance.length} variance warning(s), field=${variance[0]?.field_name}`,
  );
}

console.log("\n=== Slice 9.5: service fee variance EXCLUDES fillingBlendingCost / bulkRawCost ===");
{
  // These columns scale with volume — variance is legitimate, not flagged.
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000)],
    production: [
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t1",
        fillingBlendingCost: 0.5,
        bulkRawCost: 1.0,
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t2",
        fillingBlendingCost: 0.4, // legitimate volume scaling
        bulkRawCost: 0.9,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "no service_fee_tier_variance for fillingBlendingCost (volume-scaling)",
    out,
    (w) => !w.some((x) => x.kind === "service_fee_tier_variance"),
    "no variance warning",
  );
}

console.log("\n=== Slice 9.5: pass-through freight missing customs ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1", dutyPct: null, tariffPct: null })],
    tiers: [makeTier("t1", 1000)],
    freight: [
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        totalFreight: 1000,
        freightTreatment: "pass_through",
        skuTotalCbm: null,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const customs = out.filter(
    (x) => x.kind === "pass_through_freight_missing_customs",
  );
  assertWarnings(
    "pass_through_freight_missing_customs fires action_required",
    out,
    () =>
      customs.length === 1 &&
      customs[0].severity === "action_required" &&
      (customs[0].detail_json.missing_fields as string[]).length === 3,
    `${customs.length} warning(s); missing fields: ${JSON.stringify(customs[0]?.detail_json.missing_fields)}`,
  );
}

console.log("\n=== Slice 9.5: bundled freight does NOT trigger missing-customs warning ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1", dutyPct: null, tariffPct: null })],
    tiers: [makeTier("t1", 1000)],
    freight: [
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        totalFreight: 1000,
        freightTreatment: "bundled",
        skuTotalCbm: null,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "no missing-customs warning on bundled freight",
    out,
    (w) => !w.some((x) => x.kind === "pass_through_freight_missing_customs"),
    "0 missing-customs warnings",
  );
}

console.log("\n=== Slice 9.5: CBM cross-tier variance fires when units_in_shipment matches ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000)],
    freight: [
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        totalFreight: 1000,
        unitsInShipment: 1000,
        skuTotalCbm: 5.0,
      }),
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t2",
        lineGroupId: "l1",
        totalFreight: 5000,
        unitsInShipment: 1000, // SAME — yield-mismatch suppression doesn't apply
        skuTotalCbm: 8.0, // ≠ T1's 5.0
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const cbm = out.filter((x) => x.kind === "cbm_cross_tier_variance");
  assertWarnings(
    "cbm_cross_tier_variance fires when units match",
    out,
    () => cbm.length === 1 && cbm[0].severity === "review",
    `${cbm.length} cbm variance warning(s)`,
  );
}

console.log("\n=== Slice 9.5: CBM variance SUPPRESSED when units_in_shipment differs (yield mismatch) ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000)],
    freight: [
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        totalFreight: 1000,
        unitsInShipment: 1000,
        skuTotalCbm: 5.0,
      }),
      makeFreightInput({
        quoteSkuId: "s1",
        tierId: "t2",
        lineGroupId: "l1",
        totalFreight: 5000,
        unitsInShipment: 5500, // DIFFERENT — yield mismatch
        skuTotalCbm: 8.0,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "cbm_cross_tier_variance suppressed on yield mismatch",
    out,
    (w) => !w.some((x) => x.kind === "cbm_cross_tier_variance"),
    "no cbm variance warning",
  );
}

console.log("\n=== Slice 9.5: markup above 5× firm default ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000)],
    markupDefaults: { "Primary Packaging": 0.4 },
    packaging: [
      makePackagingInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        unitCost: 1.0,
        category: "Primary Packaging",
        markupPct: 2.5, // 250%, > 5× 40% (200%)
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const markup = out.filter((x) => x.kind === "markup_above_5x_default");
  assertWarnings(
    "markup_above_5x_default fires at 2.5 vs default 0.4",
    out,
    () => markup.length === 1 && markup[0].severity === "review",
    `${markup.length} markup warning(s)`,
  );
}

console.log("\n=== Slice 9.5: markup at 4× default does NOT fire ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000)],
    markupDefaults: { "Primary Packaging": 0.4 },
    packaging: [
      makePackagingInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        unitCost: 1.0,
        category: "Primary Packaging",
        markupPct: 1.5, // 150% < 200% threshold
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "markup_above_5x_default does NOT fire below 5× threshold",
    out,
    (w) => !w.some((x) => x.kind === "markup_above_5x_default"),
    "no markup warning",
  );
}

console.log("\n=== Slice 9.5: negative cost ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000)],
    packaging: [
      makePackagingInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        unitCost: -0.5, // negative
        category: "Primary Packaging",
        qtyPerSellableUnit: 1,
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const neg = out.filter((x) => x.kind === "negative_cost");
  assertWarnings(
    "negative_cost fires action_required",
    out,
    () => neg.length === 1 && neg[0].severity === "action_required",
    `${neg.length} negative_cost warning(s)`,
  );
}

console.log("\n=== Slice 9.5: zero cost on populated row ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000)],
    packaging: [
      makePackagingInput({
        quoteSkuId: "s1",
        tierId: "t1",
        lineGroupId: "l1",
        unitCost: 0,
        qtyPerSellableUnit: 1, // populated
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  const zero = out.filter((x) => x.kind === "zero_cost_populated_row");
  assertWarnings(
    "zero_cost_populated_row fires review",
    out,
    () =>
      zero.length === 1 &&
      zero[0].severity === "review" &&
      zero[0].detail_json.suggested_accept_reason === "special_handling_fee",
    `${zero.length} zero_cost warning(s); suggested reason=${zero[0]?.detail_json.suggested_accept_reason}`,
  );
}

console.log("\n=== Slice 9.5: production without packaging ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000)],
    production: [
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t1",
        setupFeeTotal: 5000,
      }),
    ],
    // no packaging
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "production_without_packaging fires review",
    out,
    (w) =>
      w.some(
        (x) =>
          x.kind === "production_without_packaging" && x.severity === "review",
      ),
    "fired",
  );
}

console.log("\n=== Slice 9.5: retail benchmark with no cost ===");
{
  const input = makeInput({
    skus: [makeSku({ id: "s1", retailBenchmark: 9.99 })],
    tiers: [makeTier("t1", 1000)],
    // no packaging, no production
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "retail_benchmark_no_cost fires info",
    out,
    (w) =>
      w.some(
        (x) => x.kind === "retail_benchmark_no_cost" && x.severity === "info",
      ),
    "fired",
  );
}

console.log("\n=== Slice 9.5: 5× outlier rule fires at N=4 SKUs ===");
{
  // 4 SKUs in packaging; 3 cluster around $1, 1 at $8 (8× median).
  const tier = makeTier("t1", 1000);
  const skus = [
    makeSku({ id: "s1" }),
    makeSku({ id: "s2" }),
    makeSku({ id: "s3" }),
    makeSku({ id: "s4" }),
  ];
  const packaging = skus.map((s, i) =>
    makePackagingInput({
      quoteSkuId: s.id,
      tierId: tier.id,
      lineGroupId: `l${i}`,
      unitCost: i === 3 ? 8.0 : 1.0, // s4 is the outlier
      qtyPerSellableUnit: 1,
      category: "Primary Packaging",
      markupPct: 0.4,
    }),
  );
  const input = makeInput({ skus, tiers: [tier], packaging });
  const out = validateQuote(input, compute(input));
  const outliers = out.filter((x) => x.kind === "category_outlier_5x");
  assertWarnings(
    "category_outlier_5x fires for outlier SKU",
    out,
    () =>
      outliers.length === 1 &&
      (outliers[0].detail_json as { sku_id: string }).sku_id === "s4" &&
      outliers[0].severity === "review",
    `${outliers.length} outlier warning(s); sku=${outliers[0]?.detail_json.sku_id}`,
  );
}

console.log("\n=== Slice 9.5: outlier rule does NOT fire below N=4 ===");
{
  const tier = makeTier("t1", 1000);
  const skus = [makeSku({ id: "s1" }), makeSku({ id: "s2" }), makeSku({ id: "s3" })];
  const packaging = skus.map((s, i) =>
    makePackagingInput({
      quoteSkuId: s.id,
      tierId: tier.id,
      lineGroupId: `l${i}`,
      unitCost: i === 2 ? 100.0 : 1.0,
      qtyPerSellableUnit: 1,
      category: "Primary Packaging",
      markupPct: 0.4,
    }),
  );
  const input = makeInput({ skus, tiers: [tier], packaging });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "category_outlier_5x suppressed below N=4 (per Edward Q4)",
    out,
    (w) => !w.some((x) => x.kind === "category_outlier_5x"),
    "no outlier warning",
  );
}

console.log("\n=== Slice 9.5: auto-resolve scenario — fixed data → no warning ===");
{
  // Same shape as service-fee variance test, but all values match → no warning.
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000), makeTier("t3", 10000)],
    production: [
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t1",
        setupFeeTotal: 5000,
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t2",
        setupFeeTotal: 5000, // matches T1
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t3",
        setupFeeTotal: 5000, // matches
      }),
    ],
  });
  const out = validateQuote(input, compute(input));
  assertWarnings(
    "no service_fee_tier_variance when values match",
    out,
    (w) => !w.some((x) => x.kind === "service_fee_tier_variance"),
    "no variance warning",
  );
}

console.log("\n=== Slice 9.5: identity tuple stability — same input produces same warning specs ===");
{
  // Reconciliation depends on identity tuple stability. Same engine
  // input must produce specs with matching (table_name, row_id,
  // field_name, tier_id, kind) tuples on consecutive runs.
  const input = makeInput({
    skus: [makeSku({ id: "s1" })],
    tiers: [makeTier("t1", 1000), makeTier("t2", 5000)],
    production: [
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t1",
        setupFeeTotal: 5000,
      }),
      makeProductionInput({
        quoteSkuId: "s1",
        tierId: "t2",
        setupFeeTotal: 5200,
      }),
    ],
  });
  const out1 = validateQuote(input, compute(input));
  const out2 = validateQuote(input, compute(input));
  const tuple = (w: WarningSpec) =>
    `${w.table_name}::${w.row_id}::${w.field_name}::${w.tier_id}::${w.kind}`;
  assertWarnings(
    "consecutive runs produce stable identity tuples",
    out1,
    () =>
      out1.length === out2.length &&
      out1.every((w, i) => tuple(w) === tuple(out2[i])),
    `${out1.length} ↔ ${out2.length} warnings, tuples match`,
  );
}

console.log(
  `\n${failures === 0 ? "✓ ALL ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
);
process.exit(failures === 0 ? 0 : 1);
