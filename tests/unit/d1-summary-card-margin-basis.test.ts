/**
 * D-1 · the "What you're sending" margin is the RECOMMENDED TIER's.
 *
 * WHAT WAS WRONG
 *
 * The tile read `quote.blended_margin_pct` — the engine's cross-tier aggregate,
 * revenue and cost summed across EVERY tier and divided. Arithmetically valid;
 * not a quantity that describes anything. Tiers are mutually exclusive quantity
 * breaks and a customer buys at one, so the sum prices a transaction that cannot
 * occur. It sat in a card whose other three tiles are all recommended-tier
 * scoped, under a label the grid also uses for a per-tier figure.
 *
 * The Design Authority defines no cross-tier margin anywhere. Its tile is
 * `pctS(rec.margin)`, `rec = rollups[ri]`, `ri` the recommended tier.
 *
 * WHY A UNIT TEST AND NOT ONLY A WALK
 *
 * The distinction is arithmetic, so it can be pinned at the classifier where
 * the two candidate values are both in hand — and pinned with a fixture built
 * so the two differ by a wide margin. A browser walk on a quote where they
 * happened to be close would pass against either implementation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { classify, type QuoteInput } from "../../src/lib/pricing-classifier.ts";

const POLICY = {
  target_margin_pct: 0.35,
  floor_margin_pct: 0.25,
  allow_override: true,
  allow_accept_risk: true,
};

/** The cross-tier aggregate the OLD tile rendered. Equal to neither tier. */
const AGGREGATE = 0.55;

/**
 * A quote where the cross-tier aggregate and the recommended tier's margin are
 * FAR APART, by construction.
 *
 * T1 is small and thin at 10%; T2 is recommended, large, and fat at 80%. The
 * supplied aggregate is 0.55 — deliberately equal to NEITHER — so no assertion
 * below can pass by coincidence, and a walk on a quote where the two happened
 * to be close would not have discriminated between the implementations.
 */
function quote(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    skus: [
      {
        id: "a",
        name: "A",
        cells: {
          1: { margin_pct: 0.1, sell_unit: 1, cost_unit: 0.9 },
          2: { margin_pct: 0.8, sell_unit: 5, cost_unit: 1 },
        },
      },
    ],
    tiers: [
      {
        id: 1,
        qty: 1_000,
        blended_margin_pct: 0.1,
        blended_status: "below_floor",
        blended_no_margin_reason: null,
      },
      {
        id: 2,
        qty: 100_000,
        blended_margin_pct: 0.8,
        blended_status: "above_target",
        blended_no_margin_reason: null,
      },
    ],
    blended_margin_pct: AGGREGATE,
    recommended_tier_id: 2,
    ...over,
  };
}

test("the summary card carries the RECOMMENDED tier's margin, not the cross-tier aggregate", () => {
  const state = classify(quote(), POLICY);
  assert.ok(state.summary_card, "no summary card");
  assert.equal(state.summary_card.recommended_tier, 2);

  // THE ASSERTION THAT FAILS AGAINST THE OLD IMPLEMENTATION, which returned
  // `quote.blended_margin_pct` — 0.55 here.
  assert.equal(
    state.summary_card.blended_margin_pct,
    0.8,
    "the card is not reading the recommended tier's margin",
  );
  assert.notEqual(
    state.summary_card.blended_margin_pct,
    AGGREGATE,
    "the card is still reading the cross-tier aggregate",
  );
});

test("the per-tier values the grid renders are untouched", () => {
  const state = classify(quote(), POLICY);
  assert.deepEqual(
    state.tiers.map((t) => t.blended_margin_pct),
    [0.1, 0.8],
    "a per-tier margin moved — the grid must be unaffected by this repair",
  );
  assert.deepEqual(
    state.tiers.map((t) => t.blended_status),
    ["below_floor", "above_target"],
    "a per-tier verdict moved",
  );
});

test("compliance verdicts and corrective actions are untouched", () => {
  const state = classify(quote(), POLICY);
  assert.equal(state.mode, "blocked", "T1 breaches the floor; the quote must be blocked");
  // The verdict is driven by CELLS, not by the card — so the card changing its
  // basis has to leave every one of these exactly where it was.
  assert.equal(state.below_floor.length, 1);
  assert.equal(state.outstanding.length, 1);
  assert.ok(state.actions.length > 0, "corrective actions disappeared");
});

test("moving ONLY the cross-tier aggregate does not move the card", () => {
  const base = classify(quote(), POLICY);
  const moved = classify(quote({ blended_margin_pct: 0.01 }), POLICY);
  assert.equal(
    moved.summary_card?.blended_margin_pct,
    base.summary_card?.blended_margin_pct,
    "the card still tracks the cross-tier aggregate",
  );
  assert.equal(moved.summary_card?.blended_margin_pct, 0.8);
});

test("no recommended tier means no figure — the aggregate is not a fallback", () => {
  // Substituting the cross-tier number when no tier is recommended would
  // reintroduce the defect in the one state nobody looks at.
  const state = classify(quote({ recommended_tier_id: null }), POLICY);
  assert.equal(state.summary_card?.blended_margin_pct, null);
});
