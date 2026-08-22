import type { Cell, QuoteState } from "@/lib/pricing-classifier";

/**
 * Which below-floor cells a bulk lift can actually correct.
 *
 * ── WHY THIS IS SHARED RATHER THAN COMPUTED TWICE ────────────────────────
 *
 * The compliance grid's per-tier "Lift all N to floor" already carried this
 * set, with three exclusions that each exist because of a specific defect:
 *
 *   - no `lift_offer_pct`  — the solver declined to name a correction, and
 *                            bulk-staging a number it refused to give would be
 *                            inventing one
 *   - `lift_blocked`       — a direct price is terminal, so the correction was
 *                            never available. Counting these made the button
 *                            promise "Lift all 2" and stage one; the COUNT was
 *                            the thing that was wrong
 *   - unresolvable ref     — no staging identity, so nothing to stage against
 *
 * The decision panel needs the same set across every tier. Recomputing it there
 * would be two definitions of "what this button will do", and the failure mode
 * is silent: the two would agree until one was edited, and then a button would
 * promise a count it does not deliver.
 *
 * So the button's promise and the button's act are computed once, here, and
 * both surfaces read it.
 */

export interface LiftTarget {
  cell: Cell;
  /** The staging identity `stageLift` writes against. */
  ref: NonNullable<ReturnType<ResolveCell>>;
  /** The solver's own figure. Never a figure this module chose. */
  pct: number;
}

type ResolveCell = (skuId: string, tierId: number) => unknown;

export function liftTargets(
  state: QuoteState,
  resolveCell: ResolveCell | undefined,
  /** Restrict to one tier. Omit for the whole quote. */
  tierId?: number,
): LiftTarget[] {
  const out: LiftTarget[] = [];
  for (const c of state.cells) {
    if (tierId !== undefined && c.tier_id !== tierId) continue;
    if (!c.outstanding) continue;
    if (c.lift_offer_pct === null || c.lift_blocked) continue;
    const ref = resolveCell?.(c.sku_id, c.tier_id);
    if (ref == null) continue;
    out.push({ cell: c, ref: ref as LiftTarget["ref"], pct: c.lift_offer_pct });
  }
  return out;
}

/**
 * Below-floor cells a lift cannot reach — a direct price already sets them.
 *
 * Surfaced beside the count rather than folded into it, because a panel that
 * offers to clear 3 of 5 and says only "3" leaves an operator watching the tier
 * stay red with nothing on screen accounting for the difference.
 */
export function liftUnreachable(
  state: QuoteState,
  resolveCell: ResolveCell | undefined,
  tierId?: number,
): Cell[] {
  return state.cells.filter(
    (c) =>
      (tierId === undefined || c.tier_id === tierId) &&
      c.outstanding &&
      c.lift_blocked &&
      resolveCell?.(c.sku_id, c.tier_id) != null,
  );
}
