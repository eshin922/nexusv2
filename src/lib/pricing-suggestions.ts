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
};

export type SuggestionPreview = {
  tierId: string;
  label: string;
  newMarginPct: number;
  deltaPp: number;
};

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
};

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
function deltaPp(currentMarginPct: number, newMarginPct: number): number {
  return (newMarginPct - currentMarginPct) * 100;
}

// Identify the worst below-target tier. Returns null when no tier is
// below target.
function worstBelowTarget(
  rollup: QuotePerTierRollup[],
  target: number,
): QuotePerTierRollup | null {
  let worst: QuotePerTierRollup | null = null;
  for (const t of rollup) {
    if (t.blendedMarginPct >= target) continue;
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
  };
}

// Accept-risk gating per brief §4.4. Available only when at least one
// tier is below target AND the recommended tier is above target.
// Permissive default when recommended is unset (Pushback 3).
function computeAcceptRiskGating(
  input: RankingInput,
): AcceptRiskGating {
  const { rollup, recommendedTierId, target, floor } = input;
  const belowTarget = rollup.filter((t) => t.blendedMarginPct < target);
  const belowFloor = rollup.filter((t) => t.blendedMarginPct < floor);

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
  if (recommended.blendedMarginPct < target) {
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
  const belowTarget = rollup.filter((t) => t.blendedMarginPct < target);
  const belowFloor = rollup.filter((t) => t.blendedMarginPct < floor);

  if (belowTarget.length === 0 && belowFloor.length === 0) {
    return null;
  }

  // Q3 ranking: one-below or below-floor → surgical first;
  //             multiple-below → global first.
  const isBelowFloor = belowFloor.length > 0;
  const ranking: PricingSuggestions["ranking"] =
    isBelowFloor || belowTarget.length === 1
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

  return { options, ranking, acceptRiskGating };
}
