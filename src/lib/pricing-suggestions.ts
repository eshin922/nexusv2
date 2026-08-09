// Pricing reframe v1 — suggestion engine
//
// Computes context-aware suggestions when one or more tiers are below
// the firm target margin. Three options surface:
//
//   - surgical:   lift only the worst below-target tier to target.
//                 Preserves tier ratios on healthy tiers.
//   - global:     uniform lift applied to all tiers, sized to bring
//                 the worst below-target tier to target.
//   - accept_risk: send as-is. Available only when at least one tier
//                  is below target AND the recommended tier is above
//                  target. Permissive default when recommended is
//                  unset (Pushback 3 disposition).
//
// Ranking (Q3 disposition from brief §4.4):
//   - One tier below target           → surgical first
//   - Multiple tiers below target     → global first
//   - Below floor                     → surgical first
//
// Per Slice 9.4b single-concern helper naming convention: each goal
// gets its own helper rather than a generalized `suggestForCellGoal`.
// Math is shared (closed-form revenue lift to hit a margin target);
// operational meaning differs.
//
// **Math.** Margin m = (revenue - cost) / revenue = 1 - cost/revenue.
// To achieve a target margin t given fixed cost C and base revenue R,
// the required total revenue is R' = C / (1 - t). The multiplicative
// lift from current revenue is δ = R'/R - 1 = C/(R*(1-t)) - 1.
//
// **Apply paths (Step 7).** Surgical writes one `quote_tiers.tier_price_adj_pct`
// (single audit row, `diff_json.source = 'pricing_suggestion_surgical'`).
// Global writes N rows under the cascade audit pattern (root row +
// N derived rows via `caused_by_audit_id`, `diff_json.source =
// 'pricing_suggestion_global'`). See brief §4.4.

import type { QuotePerTierRollup } from "@/lib/costing";
import {
  isBelowFloor,
  isBelowTarget,
} from "@/lib/pricing-predicates";

export type SuggestionOption = {
  id: "surgical" | "global" | "accept_risk";
  label: string;
  description: string;
  recommended: boolean;
  // Tier IDs that get adjusted on apply. Empty for accept_risk.
  applyTo: string[];
  // Multiplicative revenue lift (e.g., 0.077 for +7.7%). Zero for
  // accept_risk.
  applyDelta: number;
  // Per-tier preview tiles. null for accept_risk (no preview row).
  preview: SuggestionPreview[] | null;
  // Bug #2 fix (β): pre-check the composed new_adj per affected tier
  // against the numeric(5,4) schema bound (±9.9999). If any affected
  // tier would overflow on apply, disabledReason is populated; UI
  // renders the option disabled with the reason surfaced. null when
  // the option is applicable.
  disabledReason: string | null;
};

export type SuggestionPreview = {
  tierId: string;
  label: string;
  /**
   * Null for a tier with no margin. A lift is multiplicative on revenue, so
   * zero revenue stays zero revenue — the tier does not move, and there is no
   * "after" percentage to show.
   */
  newMarginPct: number | null;
  deltaPp: number;
};

/**
 * A tier whose margin exists, and can therefore be compared to a threshold.
 *
 * The predicates in `pricing-predicates.ts` take `number` deliberately: being
 * below target is a fact about a number. A tier without one is not below
 * target, not above it, and not a candidate for a lift sized to move a margin
 * to a threshold. Callers exclude before asking rather than teaching every
 * predicate to absorb null — the same discipline `bandOf` follows in
 * `actions/firm-settings.ts`.
 */
type AssessedTier = QuotePerTierRollup & { blendedMarginPct: number };

function assessed(t: QuotePerTierRollup): t is AssessedTier {
  return t.blendedMarginPct !== null;
}

export type AcceptRiskGating = {
  available: boolean;
  reason: string | null;
};

export type PricingSuggestions = {
  options: SuggestionOption[];
  ranking: "surgical_first" | "global_first";
  acceptRiskGating: AcceptRiskGating;
};

type RankingInput = {
  rollup: QuotePerTierRollup[];
  recommendedTierId: string | null;
  target: number;
  floor: number;
  // Bug #2 fix (β): effective per-tier adj (tier_price_adj_pct override
  // OR inherited globalPriceAdjPct). Used to pre-check whether a
  // suggestion would compose to an out-of-bounds new_adj. Null map →
  // skip pre-check (legacy callers).
  currentAdjByTier?: Map<string, number>;
  // Quote-level globalPriceAdjPct fallback when a tier has no override.
  // Defaults to 0 when not provided.
  globalAdj?: number;
};

// numeric(5,4) effective range ±9.9999. Small buffer for safety.
const FIELD_BOUND = 9.99;

// Bug #D fix — minimum-delta backstop.
//
// MIN_DELTA_PP: even if the tolerance predicate passes, suggestions
// whose applyDelta produces less than 0.5pp margin movement don't
// surface. Backstop against any threshold-path edge case the
// predicate misses.
//
// TARGET_TOLERANCE (extracted to pricing-predicates.ts in
// commit 2026-05-19 after the same float-precision no-op bug
// surfaced on TierComplianceBlock + BlendedHeadline — three
// surfaces consuming cloned predicates was the signal for shared
// extraction). TARGET_TOLERANCE imported above is the canonical
// value; this comment marks the relationship for future readers.
//
// MIN_DELTA_PP value is a starting point; calibrate up/down if CB
// re-smoke surfaces edge cases on real data.
const MIN_DELTA_PP = 0.5;

function composedNewAdj(
  currentAdj: number,
  applyDelta: number,
): number {
  return (1 + currentAdj) * (1 + applyDelta) - 1;
}

function disabledReasonForOption(
  option: SuggestionOption,
  rollup: QuotePerTierRollup[],
  currentAdjByTier: Map<string, number>,
  globalAdj: number,
): string | null {
  if (option.id === "accept_risk") return null;
  for (const tid of option.applyTo) {
    const currentAdj = currentAdjByTier.get(tid) ?? globalAdj;
    const newAdj = composedNewAdj(currentAdj, option.applyDelta);
    if (Math.abs(newAdj) > FIELD_BOUND) {
      const tier = rollup.find((t) => t.tierId === tid);
      const label = tier?.label ?? tid;
      const pct = (newAdj * 100).toFixed(0);
      return (
        `Cannot reach target — required ${label} adjustment is ${pct}%, ` +
        `exceeds ±999% field range. Cost on ${label} is too high relative ` +
        `to base revenue; adjust cost inputs before applying.`
      );
    }
  }
  return null;
}

// Closed-form lift to bring a tier with (revenue, cost) to target margin.
// Returns null on degenerate inputs (zero revenue, infeasible target).
function liftToTarget(
  revenue: number,
  cost: number,
  target: number,
): number | null {
  if (revenue <= 0) return null;
  if (target <= 0 || target >= 1) return null;
  const requiredRevenue = cost / (1 - target);
  return requiredRevenue / revenue - 1;
}

// Apply a multiplicative revenue lift to a tier and return the new
// margin. Returns null on degenerate inputs.
function projectMargin(
  revenue: number,
  cost: number,
  delta: number,
): number | null {
  const newRevenue = revenue * (1 + delta);
  if (newRevenue <= 0) return null;
  return 1 - cost / newRevenue;
}

// Format a multiplicative lift as a percent point delta vs current.
//
// Zero when either side is absent. That is not a fallback standing in for a
// number — a lift multiplies revenue, so a tier with no revenue has none
// afterwards either. It genuinely does not move.
function deltaPp(
  currentMarginPct: number | null,
  newMarginPct: number | null,
): number {
  if (currentMarginPct === null || newMarginPct === null) return 0;
  return (newMarginPct - currentMarginPct) * 100;
}

// isBelowTarget / isBelowFloor predicates imported from
// pricing-predicates.ts (canonical source as of 2026-05-19).
// TARGET_TOLERANCE is referenced via the predicates' implementation
// + locally for any direct comparison use.

// Identify the worst below-target tier. Returns null when no tier is
// below target.
function worstBelowTarget(
  rollup: QuotePerTierRollup[],
  target: number,
): AssessedTier | null {
  let worst: AssessedTier | null = null;
  for (const t of rollup) {
    // Unassessed tiers are not competing to be the worst. Before the per-tier
    // correction they arrived here as a fabricated 0%, which made an unpriced
    // tier the "worst below target" on any quote that had one — and the lift
    // was then sized to rescue a tier with no revenue to lift.
    if (!assessed(t)) continue;
    if (!isBelowTarget(t.blendedMarginPct, target)) continue;
    if (worst === null || t.blendedMarginPct < worst.blendedMarginPct) {
      worst = t;
    }
  }
  return worst;
}

// Build the surgical option. Lifts one tier (the worst below-target)
// to target; other tiers stay unchanged.
function buildSurgical(
  rollup: QuotePerTierRollup[],
  target: number,
): SuggestionOption | null {
  const worst = worstBelowTarget(rollup, target);
  if (!worst) return null;
  const delta = liftToTarget(worst.totalRevenue, worst.totalCost, target);
  if (delta === null) return null;

  // Bug #D fix backstop — minimum-delta guard. Even if the
  // worst-below-target predicate flagged this tier (e.g., due to a
  // threshold path the tolerance check missed), the suggestion only
  // surfaces if the apply would move margin ≥ MIN_DELTA_PP. Otherwise
  // it's a no-op + audit-log noise + stuck-state. Compute the predicted
  // margin pp delta on the targeted tier (closed-form: same math as
  // projectMargin).
  const newMarginPctCheck = projectMargin(
    worst.totalRevenue,
    worst.totalCost,
    delta,
  );
  if (newMarginPctCheck !== null) {
    const pp = deltaPp(worst.blendedMarginPct, newMarginPctCheck);
    if (Math.abs(pp) < MIN_DELTA_PP) return null;
  }

  const preview: SuggestionPreview[] = rollup.map((t) => {
    if (t.tierId === worst.tierId) {
      const newMargin = projectMargin(t.totalRevenue, t.totalCost, delta);
      const pct = newMargin ?? t.blendedMarginPct;
      return {
        tierId: t.tierId,
        label: t.label,
        newMarginPct: pct,
        deltaPp: deltaPp(t.blendedMarginPct, pct),
      };
    }
    return {
      tierId: t.tierId,
      label: t.label,
      newMarginPct: t.blendedMarginPct,
      deltaPp: 0,
    };
  });

  const liftDisplay = `+${(delta * 100).toFixed(1)}%`;
  return {
    id: "surgical",
    label: `Surgical · ${worst.label} only`,
    description: `Apply ${liftDisplay} to ${worst.label} only · lands ${worst.label} at target`,
    recommended: false, // set by ranker
    applyTo: [worst.tierId],
    applyDelta: delta,
    preview,
    disabledReason: null, // set by ranker
  };
}

// Build the global option. Uniform lift across all tiers, sized so the
// worst below-target tier reaches target.
function buildGlobal(
  rollup: QuotePerTierRollup[],
  target: number,
): SuggestionOption | null {
  const worst = worstBelowTarget(rollup, target);
  if (!worst) return null;
  const delta = liftToTarget(worst.totalRevenue, worst.totalCost, target);
  if (delta === null) return null;

  // Bug #D fix backstop — minimum-delta guard. Same shape as buildSurgical;
  // measure the worst-tier predicted margin movement (worst tier is the
  // anchor for the global lift; if it would move < MIN_DELTA_PP, the
  // entire option is a no-op on the worst tier — suppress).
  const newMarginPctCheck = projectMargin(
    worst.totalRevenue,
    worst.totalCost,
    delta,
  );
  if (newMarginPctCheck !== null) {
    const pp = deltaPp(worst.blendedMarginPct, newMarginPctCheck);
    if (Math.abs(pp) < MIN_DELTA_PP) return null;
  }

  const preview: SuggestionPreview[] = rollup.map((t) => {
    const newMargin = projectMargin(t.totalRevenue, t.totalCost, delta);
    const pct = newMargin ?? t.blendedMarginPct;
    return {
      tierId: t.tierId,
      label: t.label,
      newMarginPct: pct,
      deltaPp: deltaPp(t.blendedMarginPct, pct),
    };
  });

  const liftDisplay = `+${(delta * 100).toFixed(1)}%`;
  return {
    id: "global",
    label: "Global · all tiers",
    description: `Apply ${liftDisplay} globally · preserves tier ratios, lifts ${worst.label} to target`,
    recommended: false, // set by ranker
    applyTo: rollup.map((t) => t.tierId),
    applyDelta: delta,
    preview,
    disabledReason: null, // set by ranker
  };
}

// Accept-risk gating per brief §4.4. Available only when at least one
// tier is below target AND the recommended tier is above target.
// Permissive default when recommended is unset (Pushback 3).
function computeAcceptRiskGating(
  input: RankingInput,
): AcceptRiskGating {
  const { rollup, recommendedTierId, target, floor } = input;
  // Unassessed tiers take part in neither count. They are not below target and
  // not below floor; they have no margin to be below anything.
  const assessable = rollup.filter(assessed);
  const belowTarget = assessable.filter((t) => isBelowTarget(t.blendedMarginPct, target));
  const belowFloor = assessable.filter((t) => isBelowFloor(t.blendedMarginPct, floor));

  if (belowTarget.length === 0) {
    return { available: false, reason: "No tier below target — accept-risk not relevant" };
  }
  if (belowFloor.length > 0) {
    return {
      available: false,
      reason: "Cannot accept risk while a tier is below floor — admin override required",
    };
  }
  if (!recommendedTierId) {
    // Permissive default per Pushback 3 disposition.
    return { available: true, reason: null };
  }
  const recommended = rollup.find((t) => t.tierId === recommendedTierId);
  if (!recommended) {
    // Recommended flag points at a tier not in rollup. Treat as unset.
    return { available: true, reason: null };
  }
  if (!assessed(recommended)) {
    // Not below target — but not above it either. This gate requires an
    // AFFIRMATIVE finding that the recommended tier clears the bar, and
    // "cannot assess" is not that finding. Declining is conservative and
    // stated; treating unassessable as clearance would grant a permission
    // nobody established.
    return {
      available: false,
      reason: `Recommended tier (${recommended.label}) has no revenue, so its margin cannot be assessed — accept-risk requires the recommended tier above target`,
    };
  }
  if (isBelowTarget(recommended.blendedMarginPct, target)) {
    return {
      available: false,
      reason: `Recommended tier (${recommended.label}) is below target — accept-risk requires the recommended tier above target`,
    };
  }
  return { available: true, reason: null };
}

// Top-level entry. Returns null when no suggestions should fire (all
// tiers above target).
export function rankPricingSuggestions(
  input: RankingInput,
): PricingSuggestions | null {
  const { rollup, target, floor, recommendedTierId } = input;
  // Unassessed tiers take part in neither count. They are not below target and
  // not below floor; they have no margin to be below anything.
  const assessable = rollup.filter(assessed);
  const belowTarget = assessable.filter((t) => isBelowTarget(t.blendedMarginPct, target));
  const belowFloor = assessable.filter((t) => isBelowFloor(t.blendedMarginPct, floor));

  if (belowTarget.length === 0 && belowFloor.length === 0) {
    return null;
  }

  // Q3 ranking: one-below or below-floor → surgical first;
  //             multiple-below → global first.
  const anyBelowFloor = belowFloor.length > 0;
  const ranking: PricingSuggestions["ranking"] =
    anyBelowFloor || belowTarget.length === 1
      ? "surgical_first"
      : "global_first";

  const surgical = buildSurgical(rollup, target);
  const global_ = buildGlobal(rollup, target);

  const acceptRiskGating = computeAcceptRiskGating(input);

  // Accept-risk option is built whether or not gating allows it; the
  // engine surfaces an explainer when gated. Same shape as the other
  // options so rendering is uniform.
  const acceptRisk: SuggestionOption = {
    id: "accept_risk",
    label: "Accept risk · send as-is",
    description: acceptRiskGating.available
      ? `Send with ${belowTarget.length} tier${belowTarget.length === 1 ? "" : "s"} below target. Recommended tier above target — risk acceptable.`
      : (acceptRiskGating.reason ?? "Not available"),
    recommended: false,
    applyTo: [],
    applyDelta: 0,
    preview: null,
    disabledReason: null,
  };

  // Build options in ranking order, marking the first as recommended.
  const options: SuggestionOption[] = [];
  if (ranking === "surgical_first") {
    if (surgical) options.push({ ...surgical, recommended: true });
    if (global_) options.push(global_);
  } else {
    if (global_) options.push({ ...global_, recommended: true });
    if (surgical) options.push(surgical);
  }
  options.push(acceptRisk);

  // Bug #2 fix (β): pre-check each non-accept-risk option's composed
  // new_adj against the schema bound. If the apply would exceed
  // numeric(5,4), surface disabledReason so the UI can render the
  // option disabled with the reason — discoverability preserved, not
  // hidden. Only runs when caller passes currentAdjByTier.
  if (input.currentAdjByTier) {
    const globalAdj = input.globalAdj ?? 0;
    const checked: SuggestionOption[] = options.map((opt) => {
      const reason = disabledReasonForOption(
        opt,
        rollup,
        input.currentAdjByTier!,
        globalAdj,
      );
      return reason ? { ...opt, disabledReason: reason } : opt;
    });
    return { options: checked, ranking, acceptRiskGating };
  }

  return { options, ranking, acceptRiskGating };
}
