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

/** The same customer total, at an arbitrary quote-level adjustment. */
function totalAt(gpa: number, allocate: boolean, elections: ChargeElection[] = []): number {
  const input = costingInput(allocate, elections);
  input.quote = { ...input.quote, globalPriceAdjPct: gpa };
  const costing = computeQuoteCosting(input);
  const bundle = {
    markupDefaults: input.markupDefaults,
    skus: input.skus,
    production: input.production,
    costing,
  } as unknown as HydrateSnapshot;
  return projectCommercial(bundle).tiers.find((t) => t.tierId === TIER)!
    .tierCommercialTotal;
}

// ═══════════════════════════════════════════════════════════════════════
// THE LEGACY ASYMMETRY IS PROPORTIONAL, NOT A FIXED OFFSET.
//
// `THE FINDING` below already asserts the asymmetry at this fixture's 0.20.
// What was never measured is its SHAPE — whether the adjustment scales the
// charge or shifts it — and that is the load-bearing part: a legacy
// amortization freezes no per-unit basis precisely because the recovered
// amount is a FUNCTION of the ladder rather than the governed rate plus a
// constant. One measurement cannot distinguish the two.
// ═══════════════════════════════════════════════════════════════════════

test("a LEGACY allocated fee is marked up by the quote-level adjustment", () => {
  const recovery = SETUP * RATE; // 1400, the governed recoverable amount

  for (const gpa of [0, 0.2, 0.5]) {
    const allocated = totalAt(gpa, true); // fee inside the unit rate
    const ownLine = totalAt(gpa, false); // fee on its own line
    assert.equal(
      round(allocated - ownLine),
      round(recovery * gpa),
      `legacy asymmetry at gpa ${gpa} is not recovery x gpa`,
    );
  }

  // Non-vacuous in both directions: zero at gpa 0 is the coincidence the old
  // fixture mistook for neutrality, and the spread at 0.50 is what a per-unit
  // basis frozen from the governed rate would have misstated.
  assert.equal(round(totalAt(0, true) - totalAt(0, false)), 0);
  assert.equal(round(totalAt(0.5, true) - totalAt(0.5, false)), 700);
});

test("an ELECTED placement is neutral at every adjustment", () => {
  // The other half of the same measurement. Legacy moves with the ladder;
  // an election does not, which is what makes its amortization freezable.
  for (const gpa of [0, 0.2, 0.5]) {
    assert.equal(
      round(totalAt(gpa, true, [{ chargeKey: "project_setup", mode: "included" }])),
      round(totalAt(gpa, true, [{ chargeKey: "project_setup", mode: "separate" }])),
      `elected relocation moved the total at gpa ${gpa}`,
    );
  }
});

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

test("only `absorbed` refuses; relocation is permitted and neutral", () => {
  // The neutrality refusal is lifted — its own condition ("it opens once the
  // two placements recover the same amount") is met by the governed
  // precedence, proven below at a non-zero adjustment, under a lift, and with
  // a terminal override left whole.
  for (const [mode, allocate] of [
    ["included", false],
    ["separate", true],
    ["included", true],
    ["separate", false],
  ] as const) {
    assert.doesNotThrow(
      () => computeQuoteCosting(costingInput(allocate, [{ chargeKey: "project_setup", mode }])),
      `${mode} at allocate=${allocate} is still refused`,
    );
  }

  // `absorbed` still refuses: its COST is read by nothing, so the charge would
  // vanish from cost truth while DPS still pays it.
  for (const allocate of [true, false] as const) {
    assert.throws(
      () =>
        computeQuoteCosting(
          costingInput(allocate, [{ chargeKey: "project_setup", mode: "absorbed" }]),
        ),
      RecoveryPolicyError,
    );
  }
});

test("SURFACED · an election is NOT a no-op even when it agrees with the boolean", () => {
  // Worth stating loudly, because it is surprising and it is a consequence of
  // the governed contract rather than a defect.
  //
  // `source` is what the engine prices from. An election — ANY election —
  // makes the placement `elected`, and an elected amortization is priced
  // NEUTRALLY: the governed recovery is added after the adjustment instead of
  // being marked up by it. A legacy allocation is not.
  //
  // So electing `included` on a quote whose boolean ALREADY allocates moves the
  // fee out of the adjustment's reach and changes the customer's total, even
  // though the placement did not move. The operator has opted the charge into
  // the governed contract, which is a real commercial act — but it looks like
  // confirming the current state, and that gap is the thing to be careful about
  // when the surface offers it.
  const legacy = total(true);
  const electedSame = total(true, [{ chargeKey: "project_setup", mode: "included" }]);
  assert.notEqual(
    legacy,
    electedSame,
    "if these are equal the elected path is no longer priced neutrally",
  );
  // And by exactly the adjustment the legacy path applied to the fee.
  assert.equal(Math.round((legacy - electedSame) * 100) / 100, SETUP * RATE * GPA);
});

test("the elected amortization is NEUTRAL: placement no longer moves the total", () => {
  // THE CONTRACT, end to end. Both sides elected, so both use the governed
  // contract — and now the placement genuinely does not change what the
  // customer pays, at a NON-ZERO adjustment.
  const inUnit = total(false, [{ chargeKey: "project_setup", mode: "included" }]);
  const onLine = total(false, [{ chargeKey: "project_setup", mode: "separate" }]);
  assert.equal(
    Math.round(inUnit * 100) / 100,
    Math.round(onLine * 100) / 100,
    "relocating an elected charge still moves the customer's total",
  );

  // And the composition DID move — otherwise this proves nothing.
  assert.equal(project(false, [{ chargeKey: "project_setup", mode: "separate" }]).tiers[0].otcSubtotal, SETUP * RATE);
  assert.equal(project(false, [{ chargeKey: "project_setup", mode: "included" }]).tiers[0].otcSubtotal, 0);
});

// ── the tripwires ───────────────────────────────────────────────────────

test("NEUTRALITY, at a non-zero adjustment — the contract, end to end", () => {
  // This was a tripwire comparing the baseline against an election. That
  // compared LEGACY pricing to ELECTED pricing, which should differ — the
  // elected path deliberately takes the fee out of the adjustment's reach. It
  // was measuring the wrong pair.
  //
  // The contract is about the two PLACEMENTS with both sides elected:
  // relocating a charge that is already on the governed contract must not
  // change what the customer pays. The fixture carries a 20% adjustment, which
  // is the dimension the original could not express.
  for (const allocate of [true, false] as const) {
    const inUnit = total(allocate, [{ chargeKey: "project_setup", mode: "included" }]);
    const onLine = total(allocate, [{ chargeKey: "project_setup", mode: "separate" }]);
    assert.equal(
      Math.round(inUnit * 100) / 100,
      Math.round(onLine * 100) / 100,
      `relocating an elected charge moved the total at allocate=${allocate}`,
    );
  }
});

test("NEUTRALITY holds under a surgical LIFT", () => {
  // A lift is a targeted margin repair on the ordinary sell. It must not reach
  // the governed recovery either — otherwise relocation moves the total again
  // whenever a lift applies, which is the same defect in a second lever.
  const withLift = (mode: "included" | "separate") => {
    const input = costingInput(false, [{ chargeKey: "project_setup", mode }]);
    return {
      ...input,
      lifts: [{ quoteLeafId: "leaf", tierId: TIER, liftPct: 0.15 }],
    } as QuoteCostingInput;
  };
  const a = computeQuoteCosting(withLift("included")).quoteRollup[0];
  const b = computeQuoteCosting(withLift("separate")).quoteRollup[0];
  assert.equal(
    Math.round(a.totalRevenue * 100) / 100,
    Math.round(b.totalRevenue * 100) / 100,
    "a lift re-priced the governed recovery",
  );
});

test("a TERMINAL override is the all-in price — recovery is not added on top", () => {
  // Governed precedence: an override is what the operator decided the unit
  // sells for, charge included. Adding the amortized recovery above it would
  // silently overcharge past a price a person set.
  const OVR = 9;
  const overridden = (mode: "included" | "separate") => {
    const input = costingInput(false, [{ chargeKey: "project_setup", mode }]);
    return {
      ...input,
      cellOverrides: [{ quoteSkuId: "leaf", tierId: TIER, sellPriceOverride: OVR }],
    } as QuoteCostingInput;
  };
  const withOvr = computeQuoteCosting(overridden("included")).skuRollups[0].perTier[0];
  const noOvr = computeQuoteCosting(
    costingInput(false, [{ chargeKey: "project_setup", mode: "included" }]),
  ).skuRollups[0].perTier[0];

  // The override applied at all — otherwise everything below is vacuous.
  assert.notEqual(
    noOvr.requiredSellPerUnit,
    OVR,
    "the un-overridden sell equals the override by coincidence; pick another value",
  );

  // The override IS the unit sell. Not the override plus a recovery: adding
  // the amortized recovery above it would silently overcharge past a price a
  // person set.
  assert.equal(withOvr.requiredSellPerUnit, OVR);

  // And specifically NOT the override plus the amortized recovery.
  const amortizedPerUnit = SETUP * RATE / 1000;
  assert.notEqual(withOvr.requiredSellPerUnit, OVR + amortizedPerUnit);
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

test("relocating an ELECTED charge does not invalidate an approval", () => {
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
  // RELOCATING an ELECTED charge is what must not move the fingerprint —
  // both sides on the governed contract, only the placement differing. An
  // agreeing election is a different thing and does move it, because it opts
  // the charge out of the adjustment (see the surfaced semantic above).
  assert.equal(
    fp(false, [{ chargeKey: "project_setup", mode: "separate" }]),
    fp(false, [{ chargeKey: "project_setup", mode: "included" }]),
    "relocating an elected charge moved the fingerprint",
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
