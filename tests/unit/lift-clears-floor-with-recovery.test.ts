import assert from "node:assert/strict";
import test from "node:test";

import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { liftToClear } from "../../src/lib/pricing-suggestions.ts";

// ═══════════════════════════════════════════════════════════════════════
// "LIFT TO FLOOR" MUST ACTUALLY CLEAR THE FLOOR.
//
// End to end, through the real engine, on a cell that carries a governed
// recovery — not against the solver's own algebra.
//
// ── WHY THIS IS ITS OWN TEST ────────────────────────────────────────────
//
// OD-023 is the precedent. Freight was held out of the lever basis, the
// recommendation kept solving against the whole cell sell, and "Lift all to
// floor" left cells below the floor by exactly `freight x lift`. Both halves
// were individually defensible; only together were they wrong.
//
// Value-invariance holds the RECOVERY out of the lever basis, which is the
// same structural move. So the button's promise and the button's act are
// checked against each other here, by applying the offered lift and asking the
// engine what the margin became — never by re-deriving what it should be.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "66666666-6666-6666-6666-666666666666";
const LEAF_QL = "77777777-7777-7777-7777-777777777777";
const FLOOR = 0.25;

function input(lift: number | null): QuoteCostingInput {
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: FLOOR },
    markupDefaults: { Production: 0.4 },
    // Elected, so the charge is unambiguously governed.
    chargeElections: [{ chargeKey: "project_setup", mode: "included" }],
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "FG", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const, skuLabel: "L", productName: "Component", sortOrder: 0, retailBenchmark: null, canonicalQuoteLeafId: LEAF_QL },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: 5000, sortOrder: 0, tierPriceAdjPct: null }],
    // A thin markup, so the cell starts BELOW the floor and the lift has real
    // work to do. A comfortable cell would make every assertion vacuous.
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 3, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.1,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: TIER,
        allocateServiceFeesToCost: true,
        setupFeeTotal: 1200,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    ...(lift === null ? {} : { lifts: [{ quoteLeafId: LEAF_QL, tierId: TIER, liftPct: lift }] }),
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

const cell = (lift: number | null) =>
  computeQuoteCosting(input(lift)).skuRollups.find((s) => s.skuId === "leaf")!
    .perTier[0];

test("the offered lift clears the floor on a cell carrying recovery", () => {
  const before = cell(null);

  // The fixture must actually be below the floor, or everything below proves
  // nothing. This is the assertion OD-023's fixture could not make.
  assert.ok(
    before.marginPct !== null && before.marginPct < FLOOR,
    `fixture is not below the floor: margin ${before.marginPct}`,
  );

  // The recovery inside the cell, per unit — what the solver must hold out.
  const recoveryUnit =
    before.embeddedRecoveryTotal === null ? 0 : before.embeddedRecoveryTotal / 5000;
  assert.ok(recoveryUnit > 0, "the fixture carries no recovery");

  const offered = liftToClear(
    before.requiredSellPerUnit,
    before.contributionCostPerUnit,
    FLOOR,
    recoveryUnit,
  );
  assert.ok(offered !== null, "no lift was offered for a below-floor cell");

  // APPLY IT, and ask the engine. Not the algebra — the engine.
  const after = cell(offered!);
  assert.ok(
    after.marginPct !== null && after.marginPct >= FLOOR,
    `the offered ${offered} left the cell at ${after.marginPct}, below the ${FLOOR} floor it promised to clear`,
  );
});

test("FALSIFICATION · the recovery-blind solve does NOT clear it", () => {
  // Without this, the test above could pass because the fixture is forgiving
  // rather than because the solver is right. The pre-repair solve is run on
  // the same cell and must fall short — that is what makes the fourth argument
  // load-bearing rather than decorative.
  const before = cell(null);
  const blind = liftToClear(
    before.requiredSellPerUnit,
    before.contributionCostPerUnit,
    FLOOR,
  );
  assert.ok(blind !== null);

  const after = cell(blind!);
  assert.ok(
    after.marginPct !== null && after.marginPct < FLOOR,
    `the recovery-blind solve already clears (${after.marginPct}) — the fixture cannot express the failure`,
  );
});

test("the offered lift does not overshoot into a different problem", () => {
  // Clearing is the promise; wildly overshooting would be a different defect
  // wearing a passing test. One percentage point of headroom above the floor
  // is the ceil-at-storage-precision convention, not a licence to leap.
  const before = cell(null);
  const recoveryUnit =
    before.embeddedRecoveryTotal === null ? 0 : before.embeddedRecoveryTotal / 5000;
  const offered = liftToClear(
    before.requiredSellPerUnit,
    before.contributionCostPerUnit,
    FLOOR,
    recoveryUnit,
  )!;
  const after = cell(offered);
  assert.ok(
    after.marginPct! < FLOOR + 0.01,
    `cleared to ${after.marginPct}, far past the ${FLOOR} floor`,
  );
});
