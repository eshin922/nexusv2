/**
 * The Cost Stack's reconciliation, as a pure predicate.
 *
 * P3-017. The stack renders a price LADDER — one column per tier, read top to
 * bottom from what the sections cost to what the customer is quoted, with every
 * lever that moved it in between — and states at its foot that each column adds
 * up:
 *
 *     sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell
 *
 * WHICH IS ONLY WORTH ASSERTING IF IT CAN FAIL, and that property does not live
 * here. It lives in how the five quantities are PRODUCED. Obtained by
 * subtracting one published level from the next, the identity telescopes —
 *
 *     before + (a − before) + (l − a) + (sell − l) === sell
 *
 * — and holds for any four numbers. Blending does not rescue it either, since
 * blending is linear over a shared weight vector and `blend(a − b)` is exactly
 * `blend(a) − blend(b)`. So the engine multiplies each lever by its OWN rate
 * before blending, and `tests/unit/p3-017-tier-ladder-authority.test.ts` pins
 * that. This module is the drift detector sitting on top of it.
 *
 * Separate from the component that renders the strip so it can be run against a
 * DELIBERATELY CORRUPTED fixture. A `filter` inside JSX can be asserted about
 * only by mounting the component with a broken graph, which is a heavier and
 * less direct way to ask the same question.
 */

/**
 * Representation tolerance, and nothing commercial.
 *
 * The blend sums weighted per-cell values, so exact equality would report
 * healthy quotes as failures. A hundredth of a cent is eight orders of
 * magnitude above this.
 */
export const RECONCILIATION_EPSILON = 1e-9;

/** The five governed quantities the reconciliation reads. */
export interface ReconcilableTier {
  sellBefore: number;
  adjDelta: number;
  liftDelta: number;
  overrideDelta: number;
  sell: number;
}

/**
 * The tiers that do NOT reconcile. Empty is the healthy answer.
 *
 * Generic over the row so callers can pass their own richer shape and get their
 * own objects back — the strip needs to know WHICH columns failed, not merely
 * how many.
 */
export function tiersFailingReconciliation<T extends ReconcilableTier>(
  rows: readonly T[],
): T[] {
  return rows.filter(
    (q) =>
      Math.abs(
        q.sellBefore + q.adjDelta + q.liftDelta + q.overrideDelta - q.sell,
      ) > RECONCILIATION_EPSILON,
  );
}
