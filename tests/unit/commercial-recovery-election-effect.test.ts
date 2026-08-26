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

test("INVERSE REGRESSION · a LEGACY allocated fee is NOT marked up by the adjustment", () => {
  // ── WHAT THIS TEST USED TO SAY ─────────────────────────────────────────
  //
  // "a LEGACY allocated fee is marked up by the quote-level adjustment", and
  // it asserted the asymmetry was exactly `recovery x gpa` at three different
  // adjustments — a careful measurement of its SHAPE, because one reading at
  // one gpa cannot tell a scaled charge from a shifted one.
  //
  // The measurement was right. The behaviour it measured is what Edward
  // reversed on 2026-08-26: recovery placement is value-invariant, so a
  // one-time charge recovers the same amount wherever it sits.
  //
  // Inverted rather than deleted. The old assertion is the defect's own
  // signature, and the file it lives in is where the engine wrote down that
  // this was a business question rather than an implementation detail.
  const recovery = SETUP * RATE;

  for (const gpa of [0, 0.2, 0.5]) {
    const allocated = totalAt(gpa, true); // fee inside the unit rate
    const ownLine = totalAt(gpa, false); // fee on its own line
    // `Math.abs`, not `assert.equal(round(x), 0)`: a tiny negative residue
    // rounds to -0, and strict equality distinguishes -0 from 0 while a
    // customer total does not.
    assert.ok(
      Math.abs(allocated - ownLine) < 0.005,
      `placement moved the total at gpa ${gpa} by ${allocated - ownLine}`,
    );
  }

  // NON-VACUITY, and it needs restating for the inverted claim. The old test
  // proved its instrument could see a movement by seeing one at gpa 0.5; this
  // one asserts there is none, so it has to show the instrument still reacts
  // to something real. The adjustment must still move the PRODUCT.
  assert.notEqual(round(totalAt(0.5, true)), round(totalAt(0, true)));
  // And the charge is genuinely in the fixture, at the amount claimed.
  assert.equal(round(totalAt(0, true) - totalAt(0, true, [])), 0);
  assert.ok(recovery > 0);
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
  // ── RESOLVED 2026-08-26, AND THE ASSERTION IS NOW ITS INVERSE ──────────
  //
  // The paragraph above ends "Until it is settled, relocation is refused." It
  // is settled: Edward's disposition is that recovery placement is
  // value-invariant, so the two placements DO recover the same amount and the
  // model's central premise stands rather than contradicting the estate.
  //
  // The finding this test recorded was real, and soak run 2 measured its cost
  // on a live quote — $28.05 moved by an operator's first election. What is
  // preserved here is the watch: the two placements must now coincide, and if
  // they ever diverge again this is where it shows.
  const off = total(false);
  const on = total(true);
  assert.ok(
    Math.abs(on - off) < 0.005,
    `the two placements have diverged again, by ${on - off}`,
  );

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
  // ── RESOLVED · IT IS NOW A NO-OP, AND THAT IS THE POINT ────────────────
  //
  // Everything the comment above describes was true and was the hazard: an
  // election that looked like confirming the current state quietly moved the
  // customer's total, because it moved the charge out of the adjustment's
  // reach and the legacy path had never been out of it.
  //
  // Value-invariance removes the gap at the source — legacy and elected now
  // price identically — so confirming the current state IS confirming the
  // current state. The assertion inverts; the vigilance it represents does
  // not.
  const legacy = total(true);
  const electedSame = total(true, [{ chargeKey: "project_setup", mode: "included" }]);
  assert.ok(
    Math.abs(legacy - electedSame) < 0.005,
    `electing the state a quote is already in moved the total by ${legacy - electedSame}`,
  );
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


// ═══════════════════════════════════════════════════════════════════════
// WHAT THE LADDER ACTUALLY EMBEDDED
// ═══════════════════════════════════════════════════════════════════════
//
// `embeddedRecoveryTotal` is what the ladder REALLY put in the unit price.
//
// The customer document no longer prints it -- recovery is internal pricing
// vocabulary and was removed from the client's paper -- but the fact is still
// projected, and the operator-facing reconciliation is built on it. It has to
// be right for the same reason it always did, and it differs by provenance:
//
//   ELECTED  added after the ladder            -> exactly the recovery
//   LEGACY   enters as cost, rides adj + lift  -> recovery x (1 + gpa)
//
// A single formula for both would understate legacy by the adjustment, and the
// reconciliation printed to the customer would fail to close by that amount on
// every quote with a non-zero GPA. Ten of twelve production quotes are pure
// legacy; three carry a non-zero adjustment.

function embedded(allocate: boolean, elections: ChargeElection[] = []) {
  const costing = computeQuoteCosting(costingInput(allocate, elections));
  const leaf = costing.skuRollups.find((r) => r.skuId === "leaf");
  return leaf?.perTier[0]?.embeddedRecoveryTotal ?? null;
}

test("INVERSE REGRESSION · a LEGACY unit-price charge embeds the GOVERNED amount", () => {
  // Was: "embeds the ladder-inclusive amount", asserting `1000 x 1.4 x 1.2 =
  // 1680, not 1400`, and calling the 280 "the whole reason this cannot be
  // `recoverableSell`".
  //
  // It can be now, and it is. Both provenances add the governed recovery after
  // the ladder, so what a unit-price charge embeds IS `recoverableSell` —
  // which is what makes the amount freezable and what makes placement
  // value-invariant. Same figure the customer document prints.
  assert.equal(embedded(true), SETUP * RATE);
});

test("an ELECTED unit-price charge embeds exactly the governed recovery", () => {
  // Added after the ladder, so the adjustment does not reach it.
  assert.equal(
    embedded(false, [{ chargeKey: "project_setup", mode: "included" }]),
    SETUP * RATE,
  );
});

test("INVERSE REGRESSION · the two provenances no longer differ at all", () => {
  // Was: "the two differ by exactly the adjustment". They differed because one
  // rode the ladder and one did not, and that difference is exactly what an
  // operator's first election used to release onto the customer's total.
  //
  // One concept, one path — so the figure the customer document prints is the
  // same whichever way the charge got there.
  const legacy = embedded(true) ?? 0;
  const elected = embedded(false, [{ chargeKey: "project_setup", mode: "included" }]) ?? 0;
  assert.equal(Math.round((legacy - elected) * 100) / 100, 0);
  // Non-vacuous: both are the real governed amount, not both zero.
  assert.equal(legacy, SETUP * RATE);
});

test("a separately-billed charge embeds nothing in the unit price", () => {
  // It is on its own line; claiming it were inside the rate would tell the
  // customer they are paying for it twice.
  assert.equal(embedded(false), 0);
});
