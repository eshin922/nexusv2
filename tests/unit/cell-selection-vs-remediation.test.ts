/**
 * Selecting a cell and remediating one are different questions.
 *
 * They were the same flag. `actionable` is the commercial remediation signal —
 * a lift is offered, applied, or blocked — and the grid was also using it as
 * the click gate. On a fully compliant quote that produced:
 *
 *     cells 27   actionable 0   inert 27
 *
 * Nothing could be opened. No trace from a cell, and no way to set a negotiated
 * price on a healthy cell — which is an ordinary commercial act, not a
 * correction.
 *
 * The fix is a second field, not a wider first one. Broadening `actionable`
 * would have made "this cell needs attention" mean "this cell exists", and both
 * the banner and the grid read it to decide what is wrong with a quote.
 *
 * These tests pin the separation from both sides: a compliant cell is
 * selectable and repriceable while offering no lift and carrying no
 * remediation status; a breaching cell keeps every remediation signal it had.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  type QuoteInput,
  type QuotePolicyInput,
} from "../../src/lib/pricing-classifier.ts";

const POLICY: QuotePolicyInput = {
  target_margin_pct: 0.35,
  floor_margin_pct: 0.25,
  allow_override: true,
  allow_accept_risk: true,
};

/** One SKU, one tier, margin chosen by the caller. */
function quoteAt(marginPct: number | null, sellUnit: number | null): QuoteInput {
  return {
    skus: [
      {
        id: "sku-1",
        name: "Leaf",
        cells: {
          1: {
            margin_pct: marginPct,
            sell_unit: sellUnit,
            // Cost DERIVED from the stated margin, not a fixed ratio. A
            // constant 0.6 made every cell 40% by sell/cost while claiming
            // otherwise in `margin_pct` — so the status said below-floor and
            // the solver, which reads sell and cost, saw nothing to fix and
            // offered no lift. The fixture disagreed with itself.
            cost_unit:
              sellUnit === null || marginPct === null
                ? null
                : sellUnit * (1 - marginPct),
          },
        },
      },
    ],
    tiers: [{ id: 1, qty: 10_000 }],
    blended_margin_pct: marginPct,
    recommended_tier_id: 1,
  };
}

const compliant = classify(quoteAt(0.42, 5), POLICY).cells[0];
const breaching = classify(quoteAt(0.18, 5), POLICY).cells[0];
const unpriced = classify(quoteAt(null, null), POLICY).cells[0];

// ── the compliant cell ────────────────────────────────────────────────────

test("a fully compliant cell is selectable", () => {
  assert.equal(compliant.selectable, true);
});

test("and offers no lift, because nothing is wrong with it", () => {
  assert.equal(compliant.lift_offer_pct, null);
  assert.equal(compliant.lift_applied_pct, null);
  assert.equal(compliant.lift_blocked, false);
});

test("and carries no remediation status", () => {
  // The thing that must NOT have been achieved by widening `actionable`.
  assert.equal(compliant.actionable, false);
  assert.equal(compliant.outstanding, false);
  assert.equal(compliant.status, "above_target");
});

test("and its panel state invites a direct price rather than a correction", () => {
  // `none` is the branch that renders "needs no correction" plus the
  // direct-price affordance. Direct pricing is available independently of lift
  // eligibility — that is the whole separation, expressed where a component
  // reads it.
  assert.equal(compliant.action_state, "none");
  assert.equal(compliant.action_conflict, null);
});

test("selectable is not merely actionable spelled differently", () => {
  // If these ever agree on every input, the split has been undone.
  assert.notEqual(compliant.selectable, compliant.actionable);
});

// ── the breaching cell keeps everything it had ────────────────────────────

test("a below-floor cell is still selectable AND still actionable", () => {
  assert.equal(breaching.selectable, true);
  assert.equal(breaching.actionable, true);
  assert.equal(breaching.status, "below_floor");
  assert.equal(breaching.outstanding, true);
  assert.ok(
    breaching.lift_offer_pct !== null && breaching.lift_offer_pct > 0,
    "the solver still offers a lift",
  );
  assert.equal(breaching.action_state, "lift_available");
});

// ── the unpriced cell ─────────────────────────────────────────────────────

test("a cell with no price is not selectable", () => {
  // Nothing to trace and nothing to replace. Whether it should be openable in
  // order to set a FIRST price is a real workflow question, deliberately not
  // answered here — asserted so that answering it later is a visible decision.
  assert.equal(unpriced.selectable, false);
  assert.equal(unpriced.margin_pct, null);
  assert.equal(unpriced.actionable, false);
  assert.equal(unpriced.action_state, "none");
});

test("and no remediation verdict is fabricated for it", () => {
  assert.equal(unpriced.status, "unknown");
  assert.equal(unpriced.no_margin_reason, "unpriced");
  assert.equal(unpriced.outstanding, false);
});
