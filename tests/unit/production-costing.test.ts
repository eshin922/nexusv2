import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

function input(overrides: Partial<QuoteCostingInput["production"][number]> = {}) {
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Other: 0, Manufacturing: 0 },
    skus: [
      {
        id: "leaf",
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf" as const,
        skuLabel: "SKU",
        productName: "Product",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [
      {
        id: "tier",
        label: "100",
        qty: 100,
        sortOrder: 0,
        tierPriceAdjPct: null,
      },
    ],
    packaging: [
      {
        quoteSkuId: "leaf",
        tierId: "tier",
        lineGroupId: "packaging",
        unitCost: 2,
        qtyPerSellableUnit: 3,
        category: "Other",
        markupPct: 0,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf",
        tierId: "tier",
        customerShipsRaws: false,
        allocateServiceFeesToCost: true,
        fillingBlendingCost: 100,
        cmAssemblyTotal: 50,
        setupFeeTotal: 10,
        toolingArtworkTotal: 10,
        toolingTotal: 0,
        artworkTotal: 0,
        rdTotal: 10,
        otherServiceTotal: 10,
        bulkRawCost: 200,
        actualUnitsProduced: null,
        ...overrides,
      },
    ],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
  } satisfies QuoteCostingInput;
}

function leaf(result: ReturnType<typeof computeQuoteCosting>) {
  return result.skuRollups[0].perTier[0];
}

test("production totals divide by tier quantity while packaging remains per-unit", () => {
  const result = leaf(computeQuoteCosting(input()));
  assert.equal(result.packagingCostPerUnit, 6);
  assert.equal(result.productionCostPerUnit, 1.9);
  assert.equal(result.rawCostPerUnit, 2);
  assert.equal(result.factoryCostPerUnit, 9.9);
  assert.equal(result.requiredSellPerUnit, 9.9);
});

test("actual production output never changes customer quote pricing", () => {
  const quoted = leaf(computeQuoteCosting(input()));
  const reconciled = leaf(
    computeQuoteCosting(input({ actualUnitsProduced: 80 })),
  );
  assert.equal(reconciled.productionCostPerUnit, quoted.productionCostPerUnit);
  assert.equal(reconciled.rawCostPerUnit, quoted.rawCostPerUnit);
  assert.equal(reconciled.requiredSellPerUnit, quoted.requiredSellPerUnit);
});

test("filling and CM remain COGS when one-time fee allocation is disabled", () => {
  const result = leaf(
    computeQuoteCosting(input({ allocateServiceFeesToCost: false })),
  );
  assert.equal(result.productionCostPerUnit, 1.5);
  assert.equal(result.separateServiceFeesPerUnit, 0);
  assert.equal(result.factoryCostPerUnit, 9.5);
  assert.equal(result.requiredSellPerUnit, 9.5);
});

test("customer-supplied bulk raw gates bulk raw only", () => {
  const result = leaf(
    computeQuoteCosting(
      input({
        customerShipsRaws: true,
        allocateServiceFeesToCost: false,
      }),
    ),
  );
  assert.equal(result.packagingCostPerUnit, 6);
  assert.equal(result.productionCostPerUnit, 1.5);
  assert.equal(result.rawCostPerUnit, 0);
  assert.equal(result.factoryCostPerUnit, 7.5);
});

test("one-time fees are included exactly once only when allocated", () => {
  const allocated = leaf(computeQuoteCosting(input()));
  const separate = leaf(
    computeQuoteCosting(input({ allocateServiceFeesToCost: false })),
  );
  assert.ok(
    Math.abs(
      allocated.requiredSellPerUnit - separate.requiredSellPerUnit - 0.4,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      allocated.contributionCostPerUnit -
        separate.contributionCostPerUnit -
        0.4,
    ) < 1e-9,
  );
});
