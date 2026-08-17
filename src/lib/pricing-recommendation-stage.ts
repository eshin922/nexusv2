/**
 * What a pricing recommendation stages — decided here, not in the component.
 *
 * TWO DEFECTS THIS RESOLVES, both found on the same operator walk.
 *
 * 1 · NO-OP COMPOSITIONS MATERIALIZED OVERRIDES. A recommendation composed a
 *     tier rate against the rate already in effect and staged the result
 *     unconditionally. When the two matched — which is exactly the state right
 *     after a global Apply clears tier rates — it staged `0`, and Apply wrote
 *     four explicit `0.0000` tier rows for a change nobody made. Precedence is
 *     `tier ?? global` and zero is not null, so those rows then suppressed the
 *     global entirely: the operator set 300%, and the adjustment displayed $0.
 *
 * 2 · A GLOBAL RECOMMENDATION FANNED OUT INTO PER-TIER ROWS. Accepting a
 *     quote-wide suggestion wrote one `tier_price_adj_pct` per tier, which is
 *     the two-competing-authorities problem the governing disposition removed.
 *     Global authority lives at `quotes.global_price_adj_pct`; tier authority
 *     exists only for an explicitly tier-scoped decision.
 *
 * ZERO IS NOT NULL, AND IS NOT REDEFINED HERE. An operator-authored tier 0% is
 * a real lever — it suppresses the quote-wide adjustment for that tier — and it
 * stays persisted and in force. What is refused is MANUFACTURING one from a
 * recommendation that proposed no economic change.
 */

import { composePricingAdjustment } from "./pricing-adjustment";

export type RecommendationStage =
  | { kind: "global"; adjPct: number }
  | { kind: "tier"; tierId: string; adjPct: number }
  | { kind: "none" };

/**
 * Equality at STORAGE precision.
 *
 * `composePricingAdjustment` rounds to four decimals, which is the column's
 * scale, so two rates that agree there are the same rate as far as the quote is
 * concerned. Comparing raw floats would let a lift of 1e-18 write a row.
 */
function samePct(a: number, b: number): boolean {
  return Math.abs(a - b) < 5e-5;
}

/**
 * A quote-wide recommendation moves the QUOTE-WIDE lever.
 *
 * It composes against the current global rather than against any tier, because
 * that is the authority it is a recommendation about.
 */
export function planGlobalRecommendation(
  currentGlobalAdj: number,
  liftPct: number,
): RecommendationStage {
  const next = composePricingAdjustment(currentGlobalAdj, liftPct);
  if (samePct(next, currentGlobalAdj)) return { kind: "none" };
  return { kind: "global", adjPct: next };
}

/**
 * A surgical recommendation is the one case that legitimately creates a tier
 * exception — it is explicitly about a single tier.
 *
 * It still composes against that tier's EFFECTIVE rate, so a tier inheriting
 * the global is lifted from where it actually stands rather than from zero.
 */
export function planSurgicalRecommendation(
  tierId: string,
  effectiveAdj: number,
  liftPct: number,
): RecommendationStage {
  const next = composePricingAdjustment(effectiveAdj, liftPct);
  if (samePct(next, effectiveAdj)) return { kind: "none" };
  return { kind: "tier", tierId, adjPct: next };
}
