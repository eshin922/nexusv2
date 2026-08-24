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
        allocateServiceFeesToCost: true,
        fillingBlendingCost: 100,
        cmAssemblyTotal: 50,
        setupFeeTotal: 10,
        toolingArtworkTotal: 10,
        toolingTotal: 0,
        artworkTotal: 0,
        rdTotal: 10,
        testingMicrosTotal: 0,
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
  assert.equal(result.factoryCostPerUnit, 9.5);
  assert.equal(result.requiredSellPerUnit, 9.5);

  // REPAIR · this line used to assert `separateServiceFeesPerUnit === 0`,
  // which was asserting the DEFECT: an allocation-OFF charge was absent from
  // the engine while the customer was still billed for it. The fixture's
  // one-time fees total 40 over 100 units.
  //
  // The three assertions above are unchanged, and that is the point of keeping
  // them here: the repair moves the charge into the tier's totals WITHOUT
  // touching the per-unit build-up, the unit cost basis, or the unit sell.
  assert.equal(result.separateServiceFeesPerUnit, 0.4);
});

test("an unpriced separate charge books cost and NO revenue", () => {
  // The fixture declares no `Production` markup, so the rate does not resolve.
  // The projection fails visible in that case and bills nothing (BV-013), so
  // booking revenue here would credit money the customer was never charged —
  // the one outcome worse than booking none.
  //
  // Cost still enters. Margin falls. A margin falling because we are paying
  // for something we are not billing is the correct signal, not a defect.
  const result = leaf(
    computeQuoteCosting(input({ allocateServiceFeesToCost: false })),
  );
  assert.equal(result.separateServiceFeesPerUnit, 0.4);
  assert.equal(result.separateServicesMarkupSumPerUnit, 0);
});

test("a priced separate charge books cost AND its governed recovery", () => {
  // Isolate the CHARGE, not the rate. An earlier version of this compared a
  // priced run against an unpriced one and read the production/raw markup as
  // if it were the charge — the two fixtures differed in two ways at once.
  // Here the rate is held fixed and only the one-time fees move.
  const RATES = { Other: 0, Manufacturing: 0, Production: 0.4 };
  const base = input({ allocateServiceFeesToCost: false });

  const withFees = computeQuoteCosting({ ...base, markupDefaults: RATES });
  const noFees = computeQuoteCosting({
    ...base,
    markupDefaults: RATES,
    production: [
      {
        ...base.production[0],
        setupFeeTotal: 0,
        toolingArtworkTotal: 0,
        rdTotal: 0,
        otherServiceTotal: 0,
      },
    ],
  });

  assert.equal(leaf(withFees).separateServiceFeesPerUnit, 0.4);
  assert.equal(leaf(withFees).separateServicesMarkupSumPerUnit, 0.4 * 1.4);

  // THE UNIT BUILD-UP IS UNTOUCHED — asserted as an equality between the two
  // runs rather than against a hardcoded figure, so it keeps holding if the
  // rate or the fixture ever changes.
  for (const field of [
    "factoryCostPerUnit",
    "contributionCostPerUnit",
    "requiredSellPerUnit",
    "marginPct",
  ] as const) {
    assert.equal(
      leaf(withFees)[field],
      leaf(noFees)[field],
      `${field} moved — the charge reached the per-unit build-up, which is ` +
        `the NetSuite unit cost basis and the customer's unit price`,
    );
  }

  // And it reaches the TIER totals, which is where the defect lived: cost up
  // by the charge (40), revenue up by its governed recovery (40 x 1.4 = 56).
  const t = withFees.quoteRollup[0];
  const b = noFees.quoteRollup[0];
  assert.equal(round2(t.totalCost - b.totalCost), 40);
  assert.equal(round2(t.totalRevenue - b.totalRevenue), 56);

  // MARGIN MOVES, AND THE RULE DECIDES WHICH WAY — asserted as the rule
  // rather than as a direction, because the direction is a property of the
  // fixture and the rule is the finding.
  //
  // Restoring a charge at cost `e` and recovery `e(1+r)` raises the margin iff
  // the base margin sits BELOW r/(1+r). Above it, the charge dilutes. That is
  // why the old exclusion distorted margin inconsistently rather than
  // conservatively — and why it could not be reasoned around by a reader.
  const threshold = 0.4 / 1.4; // r / (1 + r)
  assert.ok(t.blendedMarginPct !== null && b.blendedMarginPct !== null);
  assert.notEqual(t.blendedMarginPct, b.blendedMarginPct, "margin did not move");
  assert.equal(
    t.blendedMarginPct! > b.blendedMarginPct!,
    b.blendedMarginPct! < threshold,
    `base margin ${b.blendedMarginPct} vs threshold ${threshold}: the charge ` +
      `moved the margin the wrong way`,
  );
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

test("bulk raw is included unconditionally — nothing gates it out", () => {
  // Replaces "customer-supplied bulk raw gates bulk raw only". That gate is
  // retired: `customer_ships_raws` was false on every row, so this asserts the
  // path all live data already took, now as the only path.
  const result = leaf(
    computeQuoteCosting(input({ allocateServiceFeesToCost: false })),
  );
  assert.equal(result.packagingCostPerUnit, 6);
  assert.equal(result.productionCostPerUnit, 1.5);
  assert.ok(
    result.rawCostPerUnit > 0,
    "an entered bulk raw cost reaches unit cost with no gate in front of it",
  );
  assert.equal(
    result.factoryCostPerUnit,
    result.packagingCostPerUnit + result.productionCostPerUnit + result.rawCostPerUnit,
  );
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
