import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

// ═══════════════════════════════════════════════════════════════════════
// THE DIMENSIONAL BOUNDARY OF A GOVERNED RECOVERY.
//
// A recovery is a FIXED governed sell contribution. A component quantity is a
// MULTIPLIER. Put a fixed amount inside something that multiplies and it is
// counted once per component — arithmetic that is locally defensible at every
// step and wrong in total.
//
// ── WHY THIS TEST EXISTS BEFORE THE FIX ─────────────────────────────────
//
// `foldMixed(value, nonScalingPortion, qty)` is the obvious home for this, and
// the obvious home is exactly what OD-025 warns about: that repair's entire
// premise was that it moved no money, and a dimension-aware fold moved
// `blendedMarginPct` on three live quotes. So the dimension is MEASURED here
// first, on observable customer totals, and the implementation is chosen after
// — never the other way round.
//
// Every assertion below reads a total a customer would pay or a figure the
// operator is shown. None reads the fold, so none of them can be satisfied by
// moving a term into a slot that merely looks right.
//
// ── THE FIXTURE ─────────────────────────────────────────────────────────
//
// An Item Group whose single component appears THREE TIMES per finished good.
// A quantity of 1 is the coincidence that hides this entire class of defect:
// at `qtyPerParent = 1` a fixed amount and a scaled one are the same number.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "44444444-4444-4444-4444-444444444444";
const LEAF_QL = "55555555-5555-5555-5555-555555555555";
const QTY_PER_PARENT = 3;
const TIER_QTY = 1000;
const SETUP = 1200;
const RATE = 1.4; // Production markup 0.4
const RECOVERY = SETUP * RATE; // 1,680 governed recovery, ONCE
const UNIT_COST = 2;

function input(args: {
  fee?: number;
  lift?: number | null;
  gpa?: number;
  elections?: ChargeElection[];
  unitCost?: number;
}): QuoteCostingInput {
  const {
    fee = SETUP,
    lift = null,
    gpa = 0,
    elections = [],
    unitCost = UNIT_COST,
  } = args;
  return {
    quote: { id: "quote", globalPriceAdjPct: gpa, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "Finished good", sortOrder: 0, retailBenchmark: null },
      // THREE per finished good. The whole point of the fixture.
      { id: "leaf", parentSkuId: "asm", qtyPerParent: QTY_PER_PARENT, skuRole: "leaf" as const, skuLabel: "L", productName: "Component", sortOrder: 0, retailBenchmark: null, canonicalQuoteLeafId: LEAF_QL },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: TIER_QTY, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.4,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: TIER,
        allocateServiceFeesToCost: true,
        setupFeeTotal: fee,
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

/** What the customer pays for the tier, all in. */
function turnkey(args: Parameters<typeof input>[0]): number {
  const i = input(args);
  const costing = computeQuoteCosting(i);
  const bundle = {
    markupDefaults: i.markupDefaults, skus: i.skus,
    production: i.production, costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;
}

const cents = (n: number) => Math.round(n * 100) / 100;
function sameMoney(a: number, b: number, why: string) {
  assert.ok(Math.abs(a - b) < 0.005, `${why}: ${cents(a)} vs ${cents(b)}, delta ${a - b}`);
}

const INCLUDED: ChargeElection[] = [{ chargeKey: "project_setup", mode: "included" }];
const SEPARATE: ChargeElection[] = [{ chargeKey: "project_setup", mode: "separate" }];

// ── THE DIMENSION ───────────────────────────────────────────────────────

test("the recovery contributes EXACTLY ONCE, not once per component", () => {
  // Measured as a difference against the same quote with no fee, so the claim
  // is about the charge itself and not about any other term.
  const withFee = turnkey({ fee: SETUP, elections: INCLUDED });
  const noFee = turnkey({ fee: 0, elections: INCLUDED });

  sameMoney(
    withFee - noFee,
    RECOVERY,
    `the charge contributed ${cents(withFee - noFee)} where the governed recovery is ${RECOVERY}`,
  );

  // NON-VACUOUS, and this is the assertion that makes the fixture worth having:
  // at qtyPerParent = 3 the wrong answer is a DIFFERENT number, so the test can
  // fail. At qtyPerParent = 1 it could not.
  assert.notEqual(
    cents(RECOVERY),
    cents(RECOVERY * QTY_PER_PARENT),
    "the fixture cannot express the failure — is qtyPerParent 1?",
  );
});

test("the recovery is not multiplied by qtyPerParent — stated directly", () => {
  const contributed = turnkey({ fee: SETUP, elections: INCLUDED }) - turnkey({ fee: 0, elections: INCLUDED });
  assert.ok(
    Math.abs(contributed - RECOVERY * QTY_PER_PARENT) > 1,
    `the charge was scaled by qtyPerParent: ${cents(contributed)} = ${RECOVERY} x ${QTY_PER_PARENT}`,
  );
});

test("CONTROL · component sell still scales by qtyPerParent", () => {
  // The other half of the dimension. A COMPONENT cost is per-component and
  // must multiply — an implementation that stopped scaling everything would
  // satisfy the two assertions above and be catastrophically wrong.
  const base = turnkey({ unitCost: UNIT_COST, fee: 0, elections: INCLUDED });
  const dearer = turnkey({ unitCost: UNIT_COST + 1, fee: 0, elections: INCLUDED });

  // +$1 of component cost, carrying the 0.4 packaging markup, three per
  // finished good, across the tier.
  sameMoney(
    dearer - base,
    1 * 1.4 * QTY_PER_PARENT * TIER_QTY,
    "component cost stopped scaling by qtyPerParent",
  );
});

// ── PLACEMENT INVARIANCE, AT qtyPerParent != 1 ──────────────────────────

test("included vs separate leaves the total identical at qtyPerParent != 1", () => {
  sameMoney(
    turnkey({ elections: INCLUDED }),
    turnkey({ elections: SEPARATE }),
    "placement moved the total on a multi-component finished good",
  );
});

test("the invariant holds under a LIFT at qtyPerParent != 1", () => {
  const lift = 0.0167;
  sameMoney(
    turnkey({ lift, elections: INCLUDED }),
    turnkey({ lift, elections: SEPARATE }),
    "a lift made placement non-neutral on a multi-component finished good",
  );
});

test("the invariant holds under BOTH levers at qtyPerParent != 1", () => {
  sameMoney(
    turnkey({ gpa: 0.2, lift: 0.05, elections: INCLUDED }),
    turnkey({ gpa: 0.2, lift: 0.05, elections: SEPARATE }),
    "both levers together moved the total",
  );
});

// ── THE CHARGE STAYS OUT OF THE LEVER BASIS ─────────────────────────────

test("the lift moves the product portion only, on a 3-per-parent assembly", () => {
  const L = 0.1;
  const base = turnkey({ lift: null, elections: INCLUDED });
  const lifted = turnkey({ lift: L, elections: INCLUDED });
  sameMoney(
    lifted - base,
    (base - RECOVERY) * L,
    "the lift reached the recovery, or missed part of the product",
  );
});

test("the global adjustment moves the product portion only", () => {
  const G = 0.2;
  const base = turnkey({ gpa: 0, elections: INCLUDED });
  const adjusted = turnkey({ gpa: G, elections: INCLUDED });
  sameMoney(
    adjusted - base,
    (base - RECOVERY) * G,
    "the adjustment reached the recovery, or missed part of the product",
  );
});
