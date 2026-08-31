import assert from "node:assert/strict";
import test from "node:test";

import {
  constructCommercial,
  mergeConstructed,
  emptyConstructed,
} from "../../src/lib/commercial-recovery/construct.ts";

// ═══════════════════════════════════════════════════════════════════════
// COST RECOGNITION DOES NOT DEPEND ON RECOVERY PLACEMENT.
//
// A component-owned charge with a cost for tier T is money DPS is paying at
// tier T. Recovery placement answers only how — or whether — that cost is
// recovered from the customer. It must never answer whether the cost exists.
//
// It did. `unplaced` had no cost bucket at all, so an unplaced charge's cost
// reached `totalChargeCost` and stopped: no consumer of tier cost could see
// it. Measured on the production fixture that surfaced this, moving a stored
// charge from $2.00 to $20.00 moved the tier's governed cost by exactly
// nothing, while persistence, identity, revalidation and rendering were all
// correct.
//
// `absorbed` had a bucket and no consumer, which is the same defect one step
// later — and the policy layer already knew: it refuses the treatment, saying
// it "would also drop the charge's cost as well as its revenue" and that it
// "opens once an absorbed charge's cost is retained". That refusal stays in
// place; only its stated prerequisite is now satisfied.
// ═══════════════════════════════════════════════════════════════════════

const COST = 100;
const RECOVERY = 140;

type Charge = {
  chargeKey: string;
  ownerKind: "component";
  ownerRef: string;
  chargeInstanceId: string;
  cost: number;
  recoverableSell: number;
  sourceColumn: string;
};

function charge(over: Partial<Charge> = {}): Charge {
  return {
    chargeKey: "print_plates",
    ownerKind: "component",
    ownerRef: "leaf-1",
    chargeInstanceId: "inst-1",
    cost: COST,
    recoverableSell: RECOVERY,
    sourceColumn: "quote_charge_instance_tiers:inst-1",
    ...over,
  };
}

const election = (instanceId: string, mode: "included" | "separate") => ({
  chargeKey: "print_plates",
  mode,
  chargeInstanceId: instanceId,
});

const build = (charges: Charge[], elections: unknown[] = [], qty = 1000) =>
  constructCommercial(charges as never, elections as never, null, qty);

/**
 * What tier-total cost recognises.
 *
 * `unitPriceCost*` reaches the tier through the per-unit build-up
 * (`costing.ts:2548`, `:3295`); the other three join as their own tier
 * operands (`costing.ts:4982` onward). Stated here as ONE expression so a
 * proof about "recognised" cannot quietly mean a different set than the engine
 * consumes.
 */
const recognised = (s: {
  unitPriceCostLegacy: number;
  unitPriceCostElected: number;
  separateLineCost: number;
  absorbedCost: number;
  unplacedCost: number;
}) =>
  s.unitPriceCostLegacy +
  s.unitPriceCostElected +
  s.separateLineCost +
  s.absorbedCost +
  s.unplacedCost;

// ── THE MATRIX ───────────────────────────────────────────────────────────

test("every reachable placement recognises the cost exactly once", () => {
  const cases = [
    { name: "unplaced", elections: [] as unknown[], placement: "unplaced" },
    { name: "included", elections: [election("inst-1", "included")], placement: "unit_price" },
    { name: "separate", elections: [election("inst-1", "separate")], placement: "separate_line" },
  ];

  for (const c of cases) {
    const s = build([charge()], c.elections);
    assert.equal(s.charges[0].placement, c.placement, `${c.name}: placement`);

    // NOT ZERO — the defect.
    assert.notEqual(recognised(s), 0, `${c.name}: recognises no cost at all`);
    // NOT DOUBLE — the risk in the obvious repair.
    assert.notEqual(recognised(s), COST * 2, `${c.name}: recognises the cost twice`);
    // EXACTLY ONCE.
    assert.equal(recognised(s), COST, `${c.name}: must recognise exactly ${COST}`);
    assert.equal(s.totalChargeCost, COST, `${c.name}: total`);
  }
});

test("revenue moves with placement while cost does not", () => {
  const unplaced = build([charge()]);
  const included = build([charge()], [election("inst-1", "included")]);
  const separate = build([charge()], [election("inst-1", "separate")]);

  // Unresolved is NULL, never zero: zero would assert the customer pays
  // nothing for this charge, which is a commercial claim nobody has made.
  //
  // It is carried by the TOTAL and by the charge, not by the per-placement
  // buckets. An empty bucket legitimately sums to 0 — "no charge is billed on
  // a separate line" is true and knowable — while "what this charge recovers"
  // is genuinely undecided. Asserting null on the buckets confused the two,
  // and the suite said so.
  assert.equal(unplaced.totalChargeRevenue, null, "the total is unknown");
  assert.equal(unplaced.charges[0].revenueContribution, null, "the charge is undecided");
  assert.equal(unplaced.unitPriceRecovery, 0, "and no bucket claims it");
  assert.equal(unplaced.separateLineRecovery, 0);

  assert.equal(included.unitPriceRecovery, RECOVERY);
  assert.equal(included.separateLineRecovery, 0);

  assert.equal(separate.separateLineRecovery, RECOVERY);
  assert.equal(separate.unitPriceRecovery, 0);

  // And the cost is the same number in all three.
  for (const s of [unplaced, included, separate]) assert.equal(recognised(s), COST);
});

test("an unplaced charge contributes cost but no revenue anywhere", () => {
  const s = build([charge()]);
  assert.equal(s.unplacedCost, COST, "the cost has a bucket");
  assert.equal(s.unitPriceCost, 0, "not in unit price");
  assert.equal(s.separateLineCost, 0, "not on a separate line");
  assert.equal(s.absorbedCost, 0, "not absorbed");
  assert.equal(s.charges[0].revenueContribution, null, "recovery stays unresolved");
});

// ── THE PARTITION ────────────────────────────────────────────────────────

test("the five cost buckets partition the total exactly, in every case", () => {
  const sets: Array<[string, ReturnType<typeof build>]> = [
    ["empty", emptyConstructed()],
    ["unplaced", build([charge()])],
    ["included", build([charge()], [election("inst-1", "included")])],
    ["separate", build([charge()], [election("inst-1", "separate")])],
    [
      "mixed siblings",
      build(
        [charge(), charge({ chargeInstanceId: "inst-2" })],
        [election("inst-1", "included")],
      ),
    ],
  ];
  for (const [name, s] of sets) {
    assert.equal(
      Math.round(recognised(s) * 100),
      Math.round(s.totalChargeCost * 100),
      `${name}: buckets must reconstruct the total`,
    );
  }
});

test("the partition assertion can actually fire", () => {
  // A control that cannot report a failure proves nothing. `totalsOf` throws
  // when the buckets do not reconstruct the total; this reaches it through the
  // one input that can: a placement with no bucket would leave a cost behind.
  // Since every placement now HAS a bucket, the assertion is reached by
  // constructing a state whose charges carry a placement the buckets do not
  // cover — which is exactly what `unplaced` was before this repair.
  assert.throws(
    () =>
      mergeConstructed([
        {
          ...build([charge()]),
          // A charge the buckets cannot see: same shape, unknown placement.
          charges: [{ ...build([charge()]).charges[0], placement: "nowhere" as never }],
        },
      ]),
    /partition is not exhaustive/,
    "a cost in no bucket must be refused, not silently dropped",
  );
});

// ── TRANSITIONS ──────────────────────────────────────────────────────────

test("placing an unplaced charge moves the cost between buckets, not the total", () => {
  const before = build([charge()]);
  const after = build([charge()], [election("inst-1", "separate")]);

  assert.equal(before.unplacedCost, COST);
  assert.equal(after.unplacedCost, 0);
  assert.equal(after.separateLineCost, COST);
  assert.equal(recognised(before), recognised(after), "total recognised cost is unchanged");
  // Only the recovery location moved.
  assert.equal(before.totalChargeRevenue, null);
  assert.equal(after.totalChargeRevenue, RECOVERY);
});

test("clearing an election returns the cost to unplaced without erasing it", () => {
  const placed = build([charge()], [election("inst-1", "included")]);
  const cleared = build([charge()], []);

  assert.equal(placed.unitPriceCostElected, COST);
  assert.equal(cleared.unplacedCost, COST);
  assert.equal(recognised(cleared), COST, "clearing must not delete the cost");
  assert.equal(cleared.totalChargeRevenue, null, "but the recovery becomes unresolved again");
});

test("moving between included and separate leaves cost untouched", () => {
  const inc = build([charge()], [election("inst-1", "included")]);
  const sep = build([charge()], [election("inst-1", "separate")]);
  assert.equal(recognised(inc), recognised(sep));
  assert.notEqual(inc.unitPriceRecovery, sep.unitPriceRecovery);
});

// ── INDEPENDENCE ─────────────────────────────────────────────────────────

test("two instances of the SAME charge type are placed independently", () => {
  const s = build(
    [charge({ chargeInstanceId: "inst-1" }), charge({ chargeInstanceId: "inst-2" })],
    [election("inst-1", "separate")],
  );
  // The capability OD-032 exists for: one set of print plates billed, another
  // still undecided. A type-grained election would have placed both.
  assert.equal(s.separateLineCost, COST);
  assert.equal(s.unplacedCost, COST);
  assert.equal(recognised(s), COST * 2, "both costs recognised, once each");
});

test("two different owners stay independent", () => {
  const a = build([charge({ ownerRef: "leaf-A", chargeInstanceId: "a" })]);
  const b = build([charge({ ownerRef: "leaf-B", chargeInstanceId: "b" })]);
  const both = mergeConstructed([a, b]);
  assert.equal(both.unplacedCost, COST * 2);
  assert.equal(recognised(both), COST * 2);
  // And placing one does not move the other.
  const aPlaced = build(
    [charge({ ownerRef: "leaf-A", chargeInstanceId: "a" })],
    [{ chargeKey: "print_plates", mode: "separate", chargeInstanceId: "a" }],
  );
  const mixed = mergeConstructed([aPlaced, b]);
  assert.equal(mixed.separateLineCost, COST);
  assert.equal(mixed.unplacedCost, COST);
  assert.equal(recognised(mixed), COST * 2);
});

test("a per-tier cost change moves only that tier", () => {
  // Four tiers, each its own construction — which is how the engine builds
  // them. Changing one must leave the other three identical.
  const tiers = [1000, 2500, 6000, 15000];
  const baseline = tiers.map((qty) => build([charge()], [], qty));
  const changed = tiers.map((qty, i) =>
    build([charge({ cost: i === 1 ? 120 : COST })], [], qty),
  );

  changed.forEach((s, i) => {
    if (i === 1) {
      assert.equal(recognised(s), 120, "the edited tier moves");
      assert.equal(recognised(s) - recognised(baseline[i]), 20, "by exactly the delta");
    } else {
      assert.equal(recognised(s), recognised(baseline[i]), `tier ${i} must not move`);
    }
  });
});

// ── THE ECONOMIC CONSEQUENCE ─────────────────────────────────────────────

test("margin moves by the cost change, independently recomputed", () => {
  // The point of the repair is not that a bucket changed. It is that the
  // quote's economics changed. Margin is recomputed here from revenue and cost
  // directly rather than read from the engine, so this proves the consequence
  // rather than restating an intermediate.
  const REVENUE = 10000;
  const GOODS_COST = 6000;

  const margin = (totalCost: number) => (REVENUE - totalCost) / REVENUE;

  const before = build([charge({ cost: 2 })]);
  const after = build([charge({ cost: 20 })]);

  const costBefore = GOODS_COST + recognised(before);
  const costAfter = GOODS_COST + recognised(after);

  assert.equal(costAfter - costBefore, 18, "an $18 cost increase is recognised");
  assert.ok(margin(costAfter) < margin(costBefore), "and margin falls");
  assert.equal(
    Number((margin(costBefore) - margin(costAfter)).toFixed(6)),
    Number((18 / REVENUE).toFixed(6)),
    "by exactly the amount the cost moved, over revenue",
  );

  // Against the pre-repair behaviour this assertion is the whole finding:
  // both margins were identical, because the cost was recognised as zero
  // either way.
});

test("Absorbed stays refused — only its prerequisite is satisfied", () => {
  // The policy refusal says absorbing "would also drop the charge's cost as
  // well as its revenue" and "opens once an absorbed charge's cost is
  // retained". The cost is now retained. Opening the treatment is a separate
  // commercial disposition, and this asserts the repair did NOT take it.
  assert.throws(
    () =>
      build([charge()], [
        { chargeKey: "print_plates", mode: "absorbed", chargeInstanceId: "inst-1" },
      ]),
    /Absorbing is not a placement/,
  );
});

test("an absorbed charge WOULD be recognised at cost, once the mode opens", () => {
  // Constructed directly rather than through an election, because the election
  // path is still refused. This proves the arithmetic the refusal is waiting
  // on is in place: cost retained, revenue zero.
  const s = mergeConstructed([
    {
      ...emptyConstructed(),
      charges: [
        {
          ...build([charge()]).charges[0],
          placement: "absorbed" as never,
          revenueContribution: 0,
          separateInvoiceAmount: 0,
        },
      ],
    },
  ]);
  assert.equal(s.absorbedCost, COST, "cost retained");
  assert.equal(recognised(s), COST, "recognised exactly once");
  assert.equal(s.totalChargeRevenue, 0, "and recovers nothing");
});
