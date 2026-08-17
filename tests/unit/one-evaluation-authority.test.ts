/**
 * Phase 3 · H2 — the banner and the grid cannot disagree.
 *
 * THE SPECIFICATION ASKS FOR A FUNCTION THAT SHOULD NOT BE WRITTEN.
 *
 * Phase 3 §9 says *"both read `evaluateCells()`"*, and F1 of the node-tree
 * specification already recorded that no such function exists here. What does
 * exist is `classify()`, lifted to `PricingClassifierProvider` during the
 * redesign for precisely this reason — the head had grown a parallel predicate
 * chain and the two surfaces disagreed on a zero-cost quote.
 *
 * Writing `evaluateCells()` alongside it would have created a second authority
 * to satisfy a requirement that exists to prevent one. So the requirement is
 * met by absorption: `classify()` now carries everything R12's `ev` carried,
 * and every partition a surface reads is a slice of one `cells` array.
 *
 * WHY THE ASSERTIONS ARE ABOUT IDENTITY, NOT EQUALITY.
 *
 * "Both partitions contain equal cells" would also pass if two computations
 * ran and happened to agree — which is the state this whole gate exists to
 * remove, and the state that agrees right up until it doesn't. So the checks
 * are `includes`, on object identity: the same cell object, filtered, never
 * rebuilt.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  type QuoteInput,
  type QuotePolicyInput,
} from "../../src/lib/pricing-classifier.ts";
import { liftToClear } from "../../src/lib/pricing-suggestions.ts";

const POLICY: QuotePolicyInput = {
  target_margin_pct: 0.35,
  floor_margin_pct: 0.25,
  allow_override: true,
  allow_accept_risk: true,
};

/** One SKU, three tiers, margins supplied per tier. */
function quote(
  cells: Array<{
    margin: number | null;
    sell?: number;
    cost?: number;
    lift?: number | null;
    override?: boolean;
  }>,
): QuoteInput {
  return {
    skus: [
      {
        id: "sku-1",
        name: "Glass bottle 30ml amber",
        cells: Object.fromEntries(
          cells.map((c, i) => [
            i + 1,
            {
              margin_pct: c.margin,
              sell_unit: c.sell ?? 10,
              cost_unit: c.cost ?? 7,
              lift_applied_pct: c.lift ?? null,
              override_applied: c.override === true,
            },
          ]),
        ),
      },
    ],
    tiers: cells.map((_, i) => ({ id: i + 1, qty: 1000 * (i + 1) })),
    // Both required, and both irrelevant to what this file asserts — the
    // partitions are drawn from cells regardless. Supplied explicitly rather
    // than cast away, because a cast here would have hidden the same omission.
    blended_margin_pct: null,
    recommended_tier_id: null,
    suggestions: {},
  };
}

// ------------------------------------------------ partitions are slices

test("every partition is a slice of one cells array, by identity", () => {
  const st = classify(
    quote([{ margin: 0.1 }, { margin: 0.31 }, { margin: 0.5 }]),
    POLICY,
  );
  for (const part of [st.below_floor, st.below_target, st.outstanding]) {
    for (const c of part) {
      assert.ok(
        st.cells.includes(c),
        "a partition built by recomputation rather than by filtering is a " +
          "second evaluation, even when it agrees",
      );
    }
  }
});

test("the verdict follows the same evaluation", () => {
  const st = classify(
    quote([{ margin: 0.1 }, { margin: 0.4 }, { margin: 0.5 }]),
    POLICY,
  );
  assert.equal(st.below_floor.length, 1);
  assert.equal(st.mode, "blocked");
  // The disagreement this forecloses: a grid showing a breach beside a banner
  // saying the quote is fine.
  assert.notEqual(st.mode, "sendable");
});

// ------------------------------------------- outstanding vs below floor

test("a below-floor cell with a lift applied is no longer outstanding", () => {
  // The distinction R12 draws and the reason `outstanding` exists separately.
  // Counting every below-floor cell would keep the page red after the operator
  // had already dealt with it.
  const st = classify(quote([{ margin: 0.1, lift: 0.2 }]), POLICY);
  assert.equal(st.below_floor.length, 1, "still breaches the floor as priced");
  assert.equal(st.outstanding.length, 0, "but it has been addressed");
});

test("outstanding is a strict subset of below_floor", () => {
  const st = classify(
    quote([{ margin: 0.1 }, { margin: 0.05, lift: 0.3 }, { margin: 0.5 }]),
    POLICY,
  );
  assert.equal(st.below_floor.length, 2);
  assert.equal(st.outstanding.length, 1);
  for (const c of st.outstanding) assert.ok(st.below_floor.includes(c));
});

// ------------------------------------------------------------- the offer

test("the offer is the minimum lift that clears the floor, and clears it", () => {
  // sell 10, cost 7 → margin 30%, below a 35% target but above a 25% floor.
  // Drop the sell so it breaches: cost 9 against sell 10 is 10%.
  const st = classify(quote([{ margin: 0.1, sell: 10, cost: 9 }]), POLICY);
  const cell = st.cells[0];
  assert.notEqual(cell.lift_offer_pct, null);
  const lifted = 10 * (1 + cell.lift_offer_pct!);
  const marginAfter = (lifted - 9) / lifted;
  assert.ok(
    Math.abs(marginAfter - POLICY.floor_margin_pct) < 1e-9,
    `lands at the floor, got ${marginAfter}`,
  );
});

test("the offer is parameterised, so Phase 4 reuses it rather than forking it", () => {
  // The same algebra against a different threshold. A version hard-coded to
  // the floor would have to be copied to serve an approver target — which is
  // how two implementations of one equation begin.
  const toFloor = liftToClear(10, 9, 0.25)!;
  const toTarget = liftToClear(10, 9, 0.35)!;
  assert.ok(toTarget > toFloor, "a higher threshold needs a bigger lift");
  for (const [t, lift] of [[0.25, toFloor], [0.35, toTarget]] as const) {
    const lifted = 10 * (1 + lift);
    const reached = (lifted - 9) / lifted;
    // P-Lift-1 · CLEARS the threshold, not lands exactly on it. The offer is
    // ceiled to the 4dp the lift column stores, because an exact solve that
    // rounds DOWN on the way to the database cannot reach the threshold it was
    // calculated to reach — which is how "Lift to floor" left a cell at 24.9975%
    // against a 25% floor and still red.
    assert.ok(reached >= t, `lift must reach ${t}, reached ${reached}`);
    // And it must not overshoot by more than that one storage tick, or the
    // "smallest lift that clears" contract has quietly become "some lift".
    assert.ok(
      reached - t < 1e-4,
      `lift overshot ${t} by ${reached - t} — more than one 4dp tick`,
    );
  }
});

test("a cell already clear of the threshold is offered nothing", () => {
  // The algebra yields a negative number here, which is arithmetically honest
  // and operationally wrong — it reads as an instruction to cut the price.
  assert.equal(liftToClear(10, 5, 0.25), null);
  const st = classify(quote([{ margin: 0.5, sell: 10, cost: 5 }]), POLICY);
  assert.equal(st.cells[0].lift_offer_pct, null);
  assert.equal(st.cells[0].actionable, false);
});

test("degenerate inputs offer nothing rather than a number nobody can act on", () => {
  assert.equal(liftToClear(null, 9, 0.25), null, "no sell");
  assert.equal(liftToClear(10, null, 0.25), null, "no cost");
  assert.equal(liftToClear(0, 9, 0.25), null, "nothing to lift");
  assert.equal(liftToClear(10, 9, 1), null, "a 100% margin needs infinite revenue");
  assert.equal(liftToClear(10, 9, 0), null);
});

// ------------------------------------------------------- override blocks

test("an overridden below-floor cell reports the lift as blocked", () => {
  // Phase 3 §1: reject, do not overrule. The grid needs to distinguish "no
  // lift is needed" from "a lift is needed and refused" — they look identical
  // if only the offer is carried.
  const st = classify(
    quote([{ margin: 0.1, sell: 10, cost: 9, override: true }]),
    POLICY,
  );
  const cell = st.cells[0];
  assert.equal(cell.lift_blocked, true);
  assert.notEqual(cell.lift_offer_pct, null, "the offer still stands, it is just refused");
  assert.equal(cell.actionable, true, "there IS something to do — remove the override");
});

// ------------------------------------------------------ missing data

test("a cell with no margin is offered nothing and is not outstanding", () => {
  const st = classify(quote([{ margin: null }]), POLICY);
  assert.equal(st.cells[0].missing, true);
  assert.equal(st.cells[0].lift_offer_pct, null);
  assert.equal(st.outstanding.length, 0);
  assert.equal(st.below_floor.length, 0, "unknown is not a breach");
});
