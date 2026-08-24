import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import {
  RecoveryPolicyError,
  refusalFor,
  type ChargeElection,
} from "../../src/lib/commercial-recovery/resolve.ts";

// ═══════════════════════════════════════════════════════════════════════
// WHAT AN ELECTION ACTUALLY DOES TO THE CUSTOMER'S TOTAL.
//
// Driven through the REAL PATH since the cutover: elections reach
// `computeQuoteCosting`, which constructs once, and the projection reads that
// construction. Before, this fixture handed elections straight to the
// projection — which is no longer a thing that can happen, so a test doing it
// would be testing a path that does not exist.
//
// ── THE MEASUREMENT THAT PRODUCED THE REFUSAL ────────────────────────────
//
// Before the refusal existed, a disagreeing election measured this damage on a
// $1,000 fee at a 1.4 rate:
//
//     included, assembly NOT allocating  ->  $1,400 vanishes from the total
//     separate, assembly IS allocating   ->  $1,400 billed twice
//     absorbed                           ->  $1,400 removed from what the
//                                            customer pays, with NO movement
//                                            in the tier revenue the floor
//                                            gate and the below-floor
//                                            fingerprint are computed from
//
// The cause was that the election overrode PROJECTION only while the engine
// decided whether a fee sat inside the unit price. The constructor removes
// that split; the refusals stay until every consumer reads it, and these
// tripwires are what fail if one is lifted early.
// ═══════════════════════════════════════════════════════════════════════

const TIER = "11111111-1111-1111-1111-111111111111";
const SETUP = 1000;
const RATE = 1.4;

function costingInput(
  allocate: boolean,
  chargeElections: ChargeElection[] = [],
): QuoteCostingInput {
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections,
    skus: [
      { id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const, skuLabel: "IG", productName: "Group", sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const, skuLabel: "L", productName: "Leaf", sortOrder: 0, retailBenchmark: null },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 1, qtyPerSellableUnit: 1, category: "Production", markupPct: 0,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: TIER,
        allocateServiceFeesToCost: allocate,
        setupFeeTotal: SETUP,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } satisfies QuoteCostingInput;
}

/** The customer document, through engine -> construction -> projection. */
function project(allocate: boolean, elections: ChargeElection[] = []) {
  const input = costingInput(allocate, elections);
  const costing = computeQuoteCosting(input);
  const bundle = {
    markupDefaults: input.markupDefaults,
    skus: input.skus,
    production: input.production,
    costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle);
}

/** The customer's tier total. */
function total(allocate: boolean, elections: ChargeElection[] = []): number {
  return project(allocate, elections).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;
}

const round = (n: number) => Math.round(n * 100) / 100;

// ── the magnitude at stake, measured through a legal path ───────────────

test("the legacy boolean is ALREADY revenue-neutral through the real path", () => {
  // The strongest form of the included <-> separate gate, and it holds today
  // without any election: allocation ON puts the marked-up fee inside the unit
  // price; OFF bills it as its own line. The customer's total is the same.
  //
  //     ON   unit 2400  otc    0   total 2400
  //     OFF  unit 1000  otc 1400   total 2400
  //
  // An earlier version of this test asserted a 1400 GAP between the two. That
  // was an artifact of a hand-built fixture that held `requiredSellPerUnit`
  // constant across both allocation states — something the real engine never
  // does, because an allocated fee is IN the unit sell by construction. The
  // fixture could not express the property it was measuring, so it measured
  // the fixture.
  const off = total(false);
  const on = total(true);
  assert.equal(off, on, "moving the fee between placements moved the total");

  // And the composition genuinely differs — otherwise this proves nothing.
  const offP = project(false);
  const onP = project(true);
  assert.equal(offP.tiers[0].otcSubtotal, SETUP * RATE);
  assert.equal(onP.tiers[0].otcSubtotal, 0);
  assert.equal(onP.tiers[0].unitSubtotal - offP.tiers[0].unitSubtotal, SETUP * RATE);
});

// ── the refusal, now at the ENGINE rather than the seam ─────────────────

test("a disagreeing election is refused before any projection happens", () => {
  // It now fails inside `computeQuoteCosting`, which is strictly earlier: the
  // construction is where placement is decided, so an election policy denies
  // can no longer reach a customer document by any route.
  for (const [mode, allocate] of [
    ["included", false],
    ["separate", true],
    ["absorbed", false],
    ["absorbed", true],
  ] as const) {
    assert.throws(
      () => computeQuoteCosting(costingInput(allocate, [{ chargeKey: "project_setup", mode }])),
      RecoveryPolicyError,
      `${mode} at allocate=${allocate} was applied instead of refused`,
    );
  }
});

test("an election that AGREES with the legacy boolean is exact", () => {
  // The only currently-correct elections are the ones that change nothing —
  // the finding stated as its passing case rather than buried in a comment.
  assert.equal(total(true, [{ chargeKey: "project_setup", mode: "included" }]), total(true));
  assert.equal(total(false, [{ chargeKey: "project_setup", mode: "separate" }]), total(false));
});

// ── the tripwires ───────────────────────────────────────────────────────

test("TRIPWIRE — if the refusal lifts, included and separate must be revenue-neutral", () => {
  // Vacuous today, and deliberately so: it asserts nothing while the refusal
  // stands, and becomes the governing invariant the moment someone lifts it.
  //
  // Written this way because the alternative is a comment saying "remember to
  // check revenue-neutrality", and a comment does not fail. This does — with
  // the exact number, on the first run after the lift, through the real path.
  const cases = [
    { allocate: false, mode: "included" as const },
    { allocate: true, mode: "separate" as const },
  ];

  for (const c of cases) {
    const stillRefused =
      refusalFor("project_setup", c.mode, { perAssemblyAllocate: c.allocate }) !== null;
    if (stillRefused) continue;

    const baseline = total(c.allocate);
    const elected = total(c.allocate, [{ chargeKey: "project_setup", mode: c.mode }]);
    assert.equal(
      round(elected),
      round(baseline),
      `The refusal on '${c.mode}' at allocate=${c.allocate} was lifted, but the ` +
        `customer's total still moves by ${round(Math.abs(elected - baseline))}. ` +
        `included <-> separate must be revenue-neutral: the charge has to be ` +
        `MOVED between the unit price and its own line, not added to or removed ` +
        `from one side.`,
    );
  }
});

test("TRIPWIRE — if absorbed opens, its reduction must reach the measured margin", () => {
  // Absorbed is the one mode that is SUPPOSED to move money, so
  // revenue-neutrality is the wrong check for it. What must hold instead is
  // that the reduction is visible to the control that governs it — the tier
  // revenue the floor gate and the below-floor fingerprint read.
  const open =
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: false }) === null ||
    refusalFor("tooling", "absorbed", { perAssemblyAllocate: true }) === null;

  assert.equal(
    open,
    false,
    "`absorbed` was opened. Before this test is deleted, prove that the " +
      "reduction reaches the POST-RECOVERY revenue every consumer reads — " +
      "quote rollup, margin, below-floor fingerprint, send gate, customer " +
      "document and frozen matrix alike.",
  );
});
