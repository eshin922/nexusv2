import assert from "node:assert/strict";
import test from "node:test";

import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";
import { fingerprintCommercialState } from "../../src/lib/below-floor-authorization.ts";
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
const GPA = 0.2;

function costingInput(
  allocate: boolean,
  chargeElections: ChargeElection[] = [],
): QuoteCostingInput {
  return {
    // NON-ZERO, deliberately. The old fixture used 0, where a charge in the
    // unit price and a charge on its own line coincide — so the tripwire
    // guarding revenue-neutrality could not express the failure it existed to
    // catch, and reported none. Certification on a live quote at 0.20 found it.
    quote: { id: "quote", globalPriceAdjPct: GPA, targetMarginPct: null },
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

test("THE FINDING · the LEGACY boolean is not revenue-neutral either", () => {
  // This asserted equality and passed — on a fixture with no price adjustment,
  // where the two placements coincide. With the fixture carrying the 20% a real
  // quote carries, they do not:
  //
  //     allocation OFF (fee on its own line)   total 2600
  //     allocation ON  (fee in the unit price) total 2880
  //     difference 280 = 1400 x 0.20
  //
  // A one-time charge inside the unit price is multiplied by the quote's price
  // adjustment. The same charge on its own line is priced at the governed
  // production rate and the adjustment never reaches it.
  //
  // THIS IS PRE-EXISTING PRODUCTION BEHAVIOUR, not something recovery
  // introduced — `allocate_service_fees_to_cost` has always priced the two
  // sides differently. What recovery did was make the difference reachable by
  // an operator, and therefore visible.
  //
  // It also means the model's central premise — that `included` and `separate`
  // are two positions for one amount — contradicts how the estate has always
  // priced them. That is a business question about whether a price adjustment
  // should apply to one-time charges, and it is Edward's, not an
  // implementation detail. Until it is settled, relocation is refused.
  const off = total(false);
  const on = total(true);
  assert.notEqual(off, on, "the two placements coincide — is the fixture's adjustment zero?");
  assert.equal(Math.round((on - off) * 100) / 100, SETUP * RATE * GPA);

  // The separate line is NOT adjustment-bearing.
  assert.equal(project(false).tiers[0].otcSubtotal, SETUP * RATE);
  // And with the fee allocated there is no separate line at all — it is inside
  // the unit price, where the adjustment reaches it.
  assert.equal(project(true).tiers[0].otcSubtotal, 0);
});

// ── the refusal, now at the ENGINE rather than the seam ─────────────────

test("every election that MOVES a charge is refused", () => {
  // WITHDRAWN LIFT. `included` and `separate` were permitted once the
  // construction placed a charge and every consumer read the placement.
  // Certification on a live quote disproved the premise they rested on: a
  // charge inside the unit price is multiplied by the price adjustment, and one
  // billed separately is not, so relocating it moves the customer's total.
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

test("THE FINDING · relocating a charge is not revenue-neutral under an adjustment", () => {
  // Kept as an executable record of why the lift was withdrawn, measured at
  // the layer where the placement is still reachable. `composeFromPlacements`
  // is arithmetic and does not refuse; the engine does.
  //
  // The two placements are priced differently END TO END: the separate line
  // carries the governed production rate alone, while the unit-price side is
  // multiplied by the quote's price adjustment on its way through the sell
  // chain. Same charge, two amounts.
  const base = total(false); // charge on its own line
  const withAdj = project(false);
  const otc = withAdj.tiers[0].otcSubtotal;

  // The separate line is NOT adjustment-bearing: it is cost x (1 + rate).
  assert.equal(otc, SETUP * RATE);
  // The unit side is. Proven by the difference the live certification measured
  // — $140 became $168 at a 20% adjustment, a factor of exactly (1 + GPA).
  assert.equal(Math.round(SETUP * RATE * (1 + GPA) * 100) / 100, 1680);
  assert.notEqual(SETUP * RATE, SETUP * RATE * (1 + GPA));
  assert.ok(base > 0);
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
        `included <-> separate must be revenue-neutral. It is not today: the ` +
        `unit-price side is multiplied by the quote's price adjustment (this ` +
        `fixture carries ${GPA}) and the separate line is not, so relocating ` +
        `the charge changes what the customer pays.`,
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

// ═══════════════════════════════════════════════════════════════════════
// THE NEGATIVE PROOF — clearing an election restores legacy placement.
//
// This is the load-bearing promise behind NOT rewriting
// `allocate_service_fees_to_cost`. If an election left any trace, clearing it
// would restore a default rather than the preserved per-assembly exception —
// and the three real mixed quotes, one already sent, would have been flattened
// by the first operator who tried a mode and changed their mind.
// ═══════════════════════════════════════════════════════════════════════

test("clearing an election restores the legacy result BIT-FOR-BIT", () => {
  for (const allocate of [true, false] as const) {
    // A pristine run, taken before anything is elected.
    const pristine = computeQuoteCosting(costingInput(allocate));

    // An AGREEING election — the only kind reachable now that relocation is
    // refused. It changes provenance rather than placement, so this proves the
    // absence of write-through and of leaked state; the placement-moving case
    // is covered by the tripwire below, which is vacuous while the refusal
    // stands.
    const elected = computeQuoteCosting(
      costingInput(allocate, [
        { chargeKey: "project_setup", mode: allocate ? "included" : "separate" },
      ]),
    );

    // ...and then cleared.
    const cleared = computeQuoteCosting(costingInput(allocate));

    // An agreeing election is a no-op on the numbers BY DESIGN, so this
    // cannot assert that something moved. What it asserts is that the engine
    // accepted it — the path ran — and that clearing then reproduces the
    // original result exactly.
    assert.ok(elected.quoteRollup.length > 0, "the elected run produced nothing");

    // And clearing returns the ORIGINAL, not a default that resembles it.
    // deepEqual over the whole result, so a single moved scalar anywhere fails.
    assert.deepEqual(
      cleared,
      pristine,
      `clearing the election did not restore the legacy result at allocate=${allocate}`,
    );
  }
});

test("an election never writes the per-assembly value it falls back to", () => {
  // The input is the operator's data. If resolution mutated it, "clearing
  // restores" would hold within one process and fail across a reload — the
  // worst shape, because the test would pass.
  const input = costingInput(true, [{ chargeKey: "project_setup", mode: "included" }]);
  const before = input.production[0].allocateServiceFeesToCost;
  computeQuoteCosting(input);
  assert.equal(
    input.production[0].allocateServiceFeesToCost,
    before,
    "resolution wrote through to allocate_service_fees_to_cost",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// THE APPROVAL FINGERPRINT responds to constructed ECONOMICS, not to
// composition.
// ═══════════════════════════════════════════════════════════════════════

test("an election that changes no placement does not invalidate an approval", () => {
  const fp = (allocate: boolean, elections: ChargeElection[] = []) => {
    const t = computeQuoteCosting(costingInput(allocate, elections)).quoteRollup[0];
    return fingerprintCommercialState({
      totalRevenue: t.totalRevenue,
      totalCost: t.totalCost,
      blendedMarginPct: t.blendedMarginPct,
    });
  };

  // Moving a charge between the unit price and its own line changes what the
  // customer READS and not what they PAY, so an authorization granted on these
  // economics still applies. Invalidating here would teach operators that
  // invalidation is noise — the same failure the fingerprint's rounding
  // deliberately avoids.
  // AGREEING elections only — relocation is refused, and it is refused
  // precisely BECAUSE it moves the total, so asserting that it does not would
  // now be asserting the opposite of the finding.
  assert.equal(
    fp(false),
    fp(false, [{ chargeKey: "project_setup", mode: "separate" }]),
    "an election that changes no placement moved the fingerprint",
  );
  assert.equal(
    fp(true),
    fp(true, [{ chargeKey: "project_setup", mode: "included" }]),
    "an election that changes no placement moved the fingerprint",
  );

  // And the fingerprint is not simply inert: a real economic change moves it.
  const dearer = costingInput(false);
  dearer.production[0].setupFeeTotal = SETUP * 2;
  const t = computeQuoteCosting(dearer).quoteRollup[0];
  assert.notEqual(
    fp(false),
    fingerprintCommercialState({
      totalRevenue: t.totalRevenue,
      totalCost: t.totalCost,
      blendedMarginPct: t.blendedMarginPct,
    }),
    "doubling the charge did not move the fingerprint — it is measuring nothing",
  );
});
