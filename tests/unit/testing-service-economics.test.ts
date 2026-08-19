import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { DIRECT_SERVICE_PRODUCTION_INPUT } from "../../src/lib/product-structure/direct-service.ts";

/**
 * Testing / Micros prices as a one-time SERVICE charge.
 *
 * Business disposition, Accounting, 2026-08-19: `testing_micros` is a Direct
 * Service / one-time service charge, not internal manufacturing COGS. It joins
 * `oneTimeServiceFeeTotal` and must NOT enter `internalProductionCogsTotal`.
 *
 * ── WHAT THIS REGRESSION EXISTS TO CATCH ─────────────────────────────────
 *
 * Migration 0083 created `testing_micros_total` — its own column, because
 * BV-011 posts Testing and Other Service to different destinations — and
 * nothing ever added it to the arithmetic. A Testing Direct Service's cost
 * saved, displayed and persisted while contributing nothing: the line read
 * NOT PRICED at a real cost.
 *
 * That is the #298 family. There, a production loader inner-joined `assemblies`
 * and dropped service rows before the math saw them. Here, a sum omitted a
 * column. From the operator's side the two are indistinguishable — the number
 * is on screen and changes nothing — which is why this asserts the ECONOMICS
 * rather than the presence of a field.
 */

const TIER = "tier-1";
const LEAF = "leaf-1";
const QTY = 1000;
const PRODUCTION_MARKUP = 0.32;

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {
      Production: PRODUCTION_MARKUP,
      Manufacturing: PRODUCTION_MARKUP,
      Primary: 0.4,
      Other: 0.3,
    },
    skus: [
      {
        id: LEAF,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "SVC-TESTING-MICROS",
        productName: "Testing / Micros",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [{ id: TIER, label: "T1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
    ...over,
  };
}

/** A production row carrying NOTHING, so each test adds exactly one fee. */
function bare(over: Partial<CostingProductionInput> = {}): CostingProductionInput {
  return {
    quoteSkuId: LEAF,
    tierId: TIER,
    customerShipsRaws: false,
    // Separately billed, so the fee stays its own commercial line rather than
    // being absorbed into unit cost.
    allocateServiceFeesToCost: false,
    fillingBlendingCost: null,
    cmAssemblyTotal: null,
    setupFeeTotal: null,
    toolingArtworkTotal: null,
    toolingTotal: null,
    artworkTotal: null,
    rdTotal: null,
    testingMicrosTotal: null,
    otherServiceTotal: null,
    bulkRawCost: null,
    actualUnitsProduced: null,
    ...over,
  };
}

const rollup = (r: ReturnType<typeof computeQuoteCosting>) =>
  r.skuRollups.find((s) => s.skuId === LEAF)!.perTier.find((p) => p.tierId === TIER)!;

// ── 1 · a Testing cost produces a PRICED line ────────────────────────────

test("a Testing cost produces a priced line — it used to price at nothing", () => {
  const priced = computeQuoteCosting(
    input({ production: [bare({ testingMicrosTotal: 3200, allocateServiceFeesToCost: true })] }),
  );
  const empty = computeQuoteCosting(input({ production: [bare()] }));

  const withCost = rollup(priced);
  const without = rollup(empty);

  assert.ok(
    Number(withCost.requiredSellPerUnit) > 0,
    "a Testing cost still prices at zero — the column is not reaching the sum",
  );
  assert.equal(Number(without.requiredSellPerUnit ?? 0), 0);
  assert.notEqual(withCost.requiredSellPerUnit, without.requiredSellPerUnit);
});

// ── 2 · the sell is cost × the governed Production markup ────────────────

test("the sell is cost × the governed Production markup, not some other rate", () => {
  const COST = 3200;
  const r = computeQuoteCosting(
    input({ production: [bare({ testingMicrosTotal: COST, allocateServiceFeesToCost: true })] }),
  );
  const perUnit = Number(rollup(r).requiredSellPerUnit);

  // The fee is a tier total allocated across quoted units, then marked up at
  // the Production rate — the same treatment Setup and R&D receive.
  const expected = (COST / QTY) * (1 + PRODUCTION_MARKUP);
  assert.ok(
    Math.abs(perUnit - expected) < 1e-9,
    `expected ${expected} per unit (cost/qty × (1 + Production markup)), got ${perUnit}`,
  );
});

test("Production is the markup authority — changing it moves the Testing sell", () => {
  const COST = 3200;
  const at32 = computeQuoteCosting(
    input({ production: [bare({ testingMicrosTotal: COST, allocateServiceFeesToCost: true })] }),
  );
  const at50 = computeQuoteCosting(
    input({
      markupDefaults: { Production: 0.5, Manufacturing: 0.5, Primary: 0.4, Other: 0.3 },
      production: [bare({ testingMicrosTotal: COST, allocateServiceFeesToCost: true })],
    }),
  );
  // If Testing were priced off some other category, this would not move.
  assert.notEqual(
    Number(at32.skuRollups[0].perTier[0].requiredSellPerUnit),
    Number(at50.skuRollups[0].perTier[0].requiredSellPerUnit),
  );
});

// ── 3 · the other four identities are untouched ──────────────────────────

test("the other four Direct Service identities' economics are unchanged", () => {
  // Each identity's own column, priced alone, must be unaffected by Testing
  // joining the sum. Equal costs through equal-treatment columns must produce
  // equal sells.
  const COST = 3200;
  const sellFor = (field: keyof CostingProductionInput) =>
    Number(
      rollup(
        computeQuoteCosting(
          input({
            production: [bare({ [field]: COST, allocateServiceFeesToCost: true } as never)],
          }),
        ),
      ).requiredSellPerUnit,
    );

  // rdTotal (formulation) and otherServiceTotal (other_service) are the two
  // siblings in `oneTimeServiceFeeTotal`. Testing must now match them exactly.
  const rd = sellFor("rdTotal");
  const other = sellFor("otherServiceTotal");
  const testing = sellFor("testingMicrosTotal");

  assert.equal(rd, other, "the two existing one-time fee columns diverged");
  assert.equal(
    testing,
    rd,
    "Testing does not price like its one-time service siblings",
  );

  // NOT compared against a COGS column here. Under `allocateServiceFeesToCost:
  // true` a one-time fee and a COGS column price IDENTICALLY — both land in
  // unit cost and take the same markup — so asserting a difference under
  // allocation asserts something that should not be true, and this test
  // originally failed for exactly that reason.
  //
  // The COGS distinction is real but only observable with allocation OFF,
  // where a separately-billed service fee contributes nothing to unit cost.
  // That is asserted in its own test below, under the policy that can see it.
});

test("Testing is NOT in internal production COGS", () => {
  // The disposition is explicit: not COGS. With `allocateServiceFeesToCost`
  // OFF, a one-time SERVICE fee is billed separately and contributes nothing
  // to unit cost; a COGS column contributes regardless.
  const COST = 3200;
  const testing = rollup(
    computeQuoteCosting(
      input({ production: [bare({ testingMicrosTotal: COST, allocateServiceFeesToCost: false })] }),
    ),
  );
  const cogs = rollup(
    computeQuoteCosting(
      input({ production: [bare({ fillingBlendingCost: COST, allocateServiceFeesToCost: false })] }),
    ),
  );

  assert.equal(
    Number(testing.contributionCostPerUnit ?? 0),
    0,
    "Testing contributed to unit cost while separately billed — it is in COGS",
  );
  assert.ok(
    Number(cogs.contributionCostPerUnit ?? 0) > 0,
    "the COGS control contributed nothing — the comparison proves nothing",
  );
});

// ── 4 · no duplicate charge through another fee path ─────────────────────

test("Testing cannot double-charge through the separately-billed OTC path", async () => {
  const { readFile } = await import("node:fs/promises");

  // The OTC line emitter iterates ASSEMBLY-owned production rows via OTC_FEES.
  // Testing is safe from duplication for two independent reasons, and both are
  // asserted because either one alone could be removed by a future change.
  const projection = await readFile("src/lib/commercial-projection.ts", "utf8");
  const otcFees = projection.slice(
    projection.indexOf("const OTC_FEES = ["),
    projection.indexOf("] as const;", projection.indexOf("const OTC_FEES = [")),
  );
  assert.ok(otcFees.length > 0, "OTC_FEES was not found");
  assert.doesNotMatch(
    otcFees,
    /testingMicrosTotal/,
    "testingMicrosTotal joined OTC_FEES — a Direct Service Testing charge would " +
      "now emit a second line through the assembly fee path",
  );

  // …and it is not an assembly-authorable field, so no assembly row can carry
  // a value for it in the first place.
  const drilldown = await readFile(
    "src/components/costs/production-drilldown.tsx",
    "utf8",
  );
  const virtualLines = drilldown.slice(
    drilldown.indexOf("const VIRTUAL_LINES"),
    drilldown.indexOf("] as const", drilldown.indexOf("const VIRTUAL_LINES")),
  );
  assert.ok(virtualLines.length > 0, "VIRTUAL_LINES was not found");
  assert.doesNotMatch(virtualLines, /testingMicrosTotal/);

  // The write route stays the Direct Service one.
  assert.equal(DIRECT_SERVICE_PRODUCTION_INPUT.testing_micros, "testingMicrosTotal");
});
