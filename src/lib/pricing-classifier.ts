// slice-pricing-surface-redesign Step 3 — pricing-surface
// classifier · single source of truth.
//
// Every state-bearing surface in the redesign — state line, status
// pill, CTA enablement, action ranking, callouts, row chips,
// summary card, detail-zone rollups — reads from one classifier
// output object per render. No surface computes its own state.
//
// The §1 duplication problem (multiple surfaces reading "47.1%
// blended" from different derivations) was a source-of-truth
// failure; the structural fix is one classifier, one render pass,
// all surfaces consume. Codified per CD designer notes §3.
//
// Pure function: `(quote, policy) → QuoteState`. Same input → same
// output. No I/O, no state, no side effects. This makes it server-
// renderable, memoizable, testable.
//
// Production-side translation of CD prototype `app/pricing_surface/
// classifier.js`. Same algorithm, TypeScript types, production
// `TARGET_TOLERANCE` discipline inherited from `pricing-predicates`
// (Bug #D float-precision fix carries forward — comparators sit
// behind the same predicates).
//
// **Cost-stack rollup (Q6 disposition):** for v1 the classifier
// passes `cell.cost_stack` through verbatim from the input (CD
// shape `{ pkg, prod, frt, dt } | null`). The R6.2 multi-leg +
// customs JSONB rollup to 4 buckets is owned by the costing math
// layer per Q6 — when the math layer surfaces the rolled-up shape
// in `quote.skus[].cells[tier_id].cost_stack`, classifier consumes
// directly; until then, callers supply nullable cost_stack and
// detail-cost-stack components handle the gap. TODO banked for
// the math-layer extension to land in a follow-up commit / slice.

// Relative .ts import — verifier under scripts/verify/ runs via raw
// Node --experimental-strip-types so the `@/` path alias doesn't
// resolve. Production app code (which goes through Next bundler)
// imports this module via `@/lib/pricing-classifier`; that's fine
// either direction. tsconfig `allowImportingTsExtensions: true`
// keeps tsc happy.
import { isBelowTarget, isBelowFloor } from "./pricing-predicates.ts";
import { liftToClear } from "./pricing-suggestions.ts";

// ──────────────────────────────────────────────────────────────────
// Input shapes (caller supplies; classifier consumes read-only)
// ──────────────────────────────────────────────────────────────────

export interface QuotePolicyInput {
  target_margin_pct: number;
  floor_margin_pct: number;
  allow_override: boolean;
  allow_accept_risk: boolean;
}

export interface QuoteTierInput {
  id: number;
  qty: number;
}

export interface QuoteCellInput {
  margin_pct?: number | null;
  sell_unit?: number | null;
  cost_unit?: number | null;
  cost_stack?: CostStackBuckets | null;
  override_applied?: boolean;
  /** A surgical lift staged or applied on this cell. */
  lift_applied_pct?: number | null;
  /**
   * WHY there is no margin, when there is none. Supplied by the adapter from
   * the engine's verdict; never inferred here.
   *
   * `CellStatus` deliberately does not carry this. Its four members partition
   * margins into bands, and neither no-margin state is a band — folding them
   * in would make `unknown` mean two different things and put a certain loss
   * one comparison away from being read as an empty cell.
   */
  no_margin_reason?: NoMarginReason | null;
  missing?: boolean;
}

export interface QuoteSkuInput {
  id: string;
  name: string;
  client_target_unit?: number | null;
  cells: Record<number, QuoteCellInput>;
}

export interface QuoteSuggestionsInput {
  surgical?: {
    tier_id: number;
    lift_pct: number;
    new_margin: number | null;
  };
  global?: {
    lift_pct: number;
    new_blended: number | null;
  };
}

export interface QuoteInput {
  skus: QuoteSkuInput[];
  tiers: QuoteTierInput[];
  blended_margin_pct: number | null;
  recommended_tier_id: number | null;
  suggestions?: QuoteSuggestionsInput;
  // CB Step 9 re-walk BUG-1 disposition: adapter signals when the
  // suggestion engine returned no usable lift path (sync engine
  // returns null due to zero revenue / numeric(5,4) overflow / etc).
  // Classifier emits `suggestion_infeasible` action kind in blocked
  // and suggestion-led modes when this flag is true AND no surgical
  // / global suggestion is supplied. Default false.
  suggestion_infeasible?: boolean;
  // False-infeasibility diagnosis (2026-07-15) — Option B fix.
  // Adapter signals the classifier-engine compliance-basis
  // asymmetry corner: engine returned null because no TIER blend
  // is below target, but a per-CELL margin is below target on a
  // SKU that drags a specific tier. Details struct carries the
  // worst SKU + affected tier labels + worst margin for message
  // formatting. When set (non-null), classifier emits
  // `suggestion_manual_only` action kind (in preference to
  // `suggestion_infeasible`). Null / undefined = no asymmetry.
  suggestion_manual_only?: {
    worst_sku_id: string;
    worst_sku_name: string;
    affected_tier_labels: string[];
    worst_margin_pct: number;
  } | null;
}

// ──────────────────────────────────────────────────────────────────
// Output shapes (QuoteState contract per data-source map §"Classifier
// output contract")
// ──────────────────────────────────────────────────────────────────

export type Mode = "sendable" | "suggestion_led" | "blocked";
export type CellStatus =
  | "above_target"
  | "below_target"
  | "below_floor"
  | "unknown";
// Q8 disposition — provisional is a state-line status modifier on
// the sendable mode, not a 4th mode. Mode enum stays 3-valued;
// state_line.status is 4-valued.
export type StateLineStatus =
  | "sendable"
  | "review"
  | "blocked"
  | "provisional";

export type ActionKind =
  | "preview_pdf"
  | "apply_surgical"
  | "apply_global"
  | "request_override"
  | "override_unavailable"
  | "tighten_to_target"
  | "calculating_suggestion"
  // CB Step 9 re-walk BUG-1 disposition (2026-06-16): when the
  // suggestion engine (rankPricingSuggestions + buildSurgical/
  // buildGlobal) returns no usable option in blocked or
  // suggestion-led mode — typically because tier revenue is 0
  // (fixtures with no sell prices computed yet) or because the
  // math overflows numeric(5,4) bounds — emit `suggestion_infeasible`
  // instead of `calculating_suggestion`. `calculating_suggestion`
  // remains in the enum for a future async engine path; v1 is sync,
  // so any null-suggestion case in v1 is structurally infeasible,
  // not in-flight. Inert kind (no CTA); explainer surfaces the
  // failure mode (typically "no cost/sell data to compute lift
  // path · enter pricing on Costs first" or "math overflow").
  | "suggestion_infeasible"
  // False-infeasibility diagnosis (2026-07-15) — Option B fix.
  //
  // Fires when the engine returns null because no tier ROLLUP is
  // below target, but the classifier's per-CELL basis identifies a
  // below-target cell — the semantic asymmetry between
  // revenue-weighted tier blends and worst-cell compliance. Copy
  // names the worst SKU + affected tier(s) + directs PM to the
  // three recovery paths (adjust cost inputs on Costs, set a
  // per-cell sell price override, request admin override).
  //
  // Distinct from `suggestion_infeasible` (which reserves its copy
  // for the overflow / zero-revenue / missing-data structural
  // cases). Inert kind (no CTA); guidance-only.
  | "suggestion_manual_only";

export interface CostStackBuckets {
  pkg: number;
  prod: number;
  frt: number;
  dt: number;
}

/**
 * Why a cell has no margin.
 *
 * `unpriced` — nothing entered. No commercial judgement.
 * `cost_without_revenue` — cost incurred with nothing priced against it. The
 *   percentage is still undefined, but the economics are not: it is a loss.
 *
 * Carried alongside `status` rather than inside it, because a band is a
 * region of the number line and neither of these is a number.
 */
export type NoMarginReason = "unpriced" | "cost_without_revenue";

export interface Cell {
  sku_id: string;
  sku_name: string;
  tier_id: number;
  tier_qty: number;
  margin_pct: number | null;
  sell_unit: number | null;
  cost_unit: number | null;
  cost_stack: CostStackBuckets | null;
  client_target_unit: number | null;
  client_target_delta: number | null;
  over_client_target: boolean;
  missing: boolean;
  status: CellStatus;
  /** Set exactly when `margin_pct` is null. Null otherwise. */
  no_margin_reason: NoMarginReason | null;
  override_applied: boolean;
  /**
   * The minimum lift that would clear the floor, or null when none is needed
   * or none is possible. Solver output — see `liftToClear`.
   */
  lift_offer_pct: number | null;
  /** A lift already staged or applied on this cell. */
  lift_applied_pct: number | null;
  /**
   * A lift cannot be applied here because someone set this price directly.
   * Phase 3 §1: reject, do not overrule.
   */
  lift_blocked: boolean;
  /**
   * Below floor with nothing done about it yet.
   *
   * NOT the same as `status === "below_floor"`, and the difference is the
   * point: a cell that breaches the floor and already carries a lift has been
   * addressed. Counting it as outstanding would keep the banner red after the
   * operator fixed it — the R12 grid's `outstanding` versus `below_target`
   * split exists for exactly this.
   */
  outstanding: boolean;
  /** Anything the operator could do here: lift needed, lift blocked, or one applied. */
  actionable: boolean;
}

export interface Action {
  kind: ActionKind;
  label: string;
  sublabel: string | null;
  recommended: boolean;
  primary: boolean;
  demoted?: boolean;
  soft?: boolean;
  disabled?: boolean;
  disabled_reason?: string;
  projected_blended_after_apply?: number | null;
}

export interface StateLine {
  lead: string;
  status: StateLineStatus;
  qualifiers: string[];
}

export interface SummaryCard {
  sku_count: number;
  tier_count: number;
  recommended_tier: number | null;
  recommended_tier_value: number | null;
  blended_margin_pct: number | null;
}

export interface QuoteStateFlags {
  over_client_target: boolean;
  over_client_target_count: number;
  data_incomplete: boolean;
  missing_count: number;
  override_applied: boolean;
  accept_risk_unavailable: boolean;
  override_unavailable: boolean;
}

export interface TierRollup extends QuoteTierInput {
  min_margin_pct: number | null;
  blended_margin_pct: number | null;
  status: CellStatus;
  has_override: boolean;
  has_missing: boolean;
}

export interface SkuRollupTierStrip {
  tier_id: number;
  margin_pct: number | null;
  status: CellStatus;
  override_applied: boolean;
}

export interface SkuRollup extends QuoteSkuInput {
  min_margin_pct: number | null;
  status: CellStatus;
  all_tiers: SkuRollupTierStrip[];
  over_client_target: boolean;
}

export interface QuoteState {
  mode: Mode;
  mode_label: string;
  blended_margin_pct: number | null;
  state_line: StateLine;
  summary_card: SummaryCard | null;
  flags: QuoteStateFlags;
  tiers: TierRollup[];
  skus: SkuRollup[];
  cells: Cell[];
  below_floor: Cell[];
  /**
   * Below floor and NOT yet addressed by a lift.
   *
   * The banner's verdict counts these, not `below_floor` — a cell that
   * breaches the floor and already carries a lift has been dealt with, and
   * counting it would keep the page red after the operator fixed it.
   *
   * Both partitions come from the same `cells` array, computed once. That is
   * what makes H2 structural: the banner and the grid cannot disagree because
   * there is nothing for them to disagree between.
   */
  outstanding: Cell[];
  below_target: Cell[];
  over_client_target: Cell[];
  actions: Action[];
  policy: QuotePolicyInput;
  quote: QuoteInput;
}

// ──────────────────────────────────────────────────────────────────
// classify() — pure function, the contract
// ──────────────────────────────────────────────────────────────────

export function classify(
  quote: QuoteInput,
  policy: QuotePolicyInput,
): QuoteState {
  // ── 1. Flatten quote into (sku × tier) cells ───────────────────
  const cells: Cell[] = [];
  for (const sku of quote.skus) {
    for (const tier of quote.tiers) {
      const cellRaw: QuoteCellInput = sku.cells[tier.id] ?? {};
      const margin =
        cellRaw.margin_pct == null ? null : cellRaw.margin_pct;
      const missing = cellRaw.missing === true || margin == null;
      // Per-cell status — classifier-owned, consumed by every
      // surface. §3 source-of-truth rule: no component re-derives.
      // TARGET_TOLERANCE inherited from pricing-predicates (Bug #D).
      const status: CellStatus = missing
        ? "unknown"
        : isBelowFloor(margin as number, policy.floor_margin_pct)
          ? "below_floor"
          : isBelowTarget(margin as number, policy.target_margin_pct)
            ? "below_target"
            : "above_target";
      const sellUnit = cellRaw.sell_unit ?? null;
      const costUnit = cellRaw.cost_unit ?? null;
      // The offer is computed for any below-floor cell, whether or not one is
      // already applied — the grid shows what WOULD clear it, and hiding that
      // once a lift exists removes the only way to see the applied one is
      // enough.
      const overrideApplied = cellRaw.override_applied === true;
      const liftApplied = cellRaw.lift_applied_pct ?? null;
      const liftOffer =
        status === "below_floor"
          ? liftToClear(sellUnit, costUnit, policy.floor_margin_pct)
          : null;
      const clientTarget = sku.client_target_unit ?? null;
      const clientTargetDelta =
        clientTarget != null && sellUnit != null
          ? sellUnit - clientTarget
          : null;
      cells.push({
        sku_id: sku.id,
        sku_name: sku.name,
        tier_id: tier.id,
        tier_qty: tier.qty,
        margin_pct: margin,
        sell_unit: sellUnit,
        cost_unit: cellRaw.cost_unit ?? null,
        cost_stack: cellRaw.cost_stack ?? null,
        client_target_unit: clientTarget,
        client_target_delta: clientTargetDelta,
        over_client_target:
          clientTarget != null && sellUnit != null && sellUnit > clientTarget,
        missing,
        status,
        no_margin_reason: margin === null ? (cellRaw.no_margin_reason ?? "unpriced") : null,
        override_applied: overrideApplied,
        lift_offer_pct: liftOffer,
        lift_applied_pct: liftApplied,
        lift_blocked: liftOffer !== null && overrideApplied,
        outstanding: status === "below_floor" && liftApplied === null,
        actionable:
          liftOffer !== null || liftApplied !== null || (overrideApplied && status === "below_floor"),
      });
    }
  }

  const known = cells.filter((c) => !c.missing);
  const unknown = cells.filter((c) => c.missing);
  const belowFloor = known.filter((c) => c.status === "below_floor");
  const belowTarget = known.filter((c) => c.status === "below_target");
  // Same array, one more partition. Every consumer of "what is wrong here"
  // reads one of these three, and all three are slices of `cells` — which is
  // what makes the single-evaluation guarantee structural rather than a
  // convention two surfaces are asked to honour.
  const outstanding = known.filter((c) => c.outstanding);

  // ── 2. Mode — worst-case classifier ────────────────────────────
  const mode: Mode =
    belowFloor.length > 0
      ? "blocked"
      : belowTarget.length > 0
        ? "suggestion_led"
        : "sendable";

  // ── 3. Over-client-target — flag, not mode ─────────────────────
  const overClientTarget = cells.filter((c) => c.over_client_target);

  // ── 4. Per-tier rollup ─────────────────────────────────────────
  const tierRoll: TierRollup[] = quote.tiers.map((t) => {
    const tierCells = cells.filter((c) => c.tier_id === t.id);
    const tierKnown = tierCells.filter((c) => !c.missing);
    const knownMargins = tierKnown.map((c) => c.margin_pct as number);
    const minMargin = knownMargins.length
      ? Math.min(...knownMargins)
      : null;
    const blendedMargin = knownMargins.length
      ? knownMargins.reduce((s, m) => s + m, 0) / knownMargins.length
      : null;
    const status: CellStatus =
      minMargin == null
        ? "unknown"
        : isBelowFloor(minMargin, policy.floor_margin_pct)
          ? "below_floor"
          : isBelowTarget(minMargin, policy.target_margin_pct)
            ? "below_target"
            : "above_target";
    return {
      ...t,
      min_margin_pct: minMargin,
      blended_margin_pct: blendedMargin,
      status,
      has_override: tierCells.some((c) => c.override_applied),
      has_missing: tierCells.some((c) => c.missing),
    };
  });

  // ── 5. Per-SKU rollup ──────────────────────────────────────────
  const skuRoll: SkuRollup[] = quote.skus.map((sku) => {
    const skuCells = cells.filter((c) => c.sku_id === sku.id);
    const skuKnown = skuCells.filter((c) => !c.missing);
    const knownMargins = skuKnown.map((c) => c.margin_pct as number);
    const minMargin = knownMargins.length
      ? Math.min(...knownMargins)
      : null;
    const allTiers: SkuRollupTierStrip[] = skuCells.map((c) => ({
      tier_id: c.tier_id,
      margin_pct: c.margin_pct,
      status: c.status,
      override_applied: c.override_applied,
    }));
    const status: CellStatus =
      minMargin == null
        ? "unknown"
        : isBelowFloor(minMargin, policy.floor_margin_pct)
          ? "below_floor"
          : isBelowTarget(minMargin, policy.target_margin_pct)
            ? "below_target"
            : "above_target";
    const overTarget = skuCells.some((c) => c.over_client_target);
    return {
      ...sku,
      min_margin_pct: minMargin,
      status,
      all_tiers: allTiers,
      over_client_target: overTarget,
    };
  });

  // ── 6. Action ranking ──────────────────────────────────────────
  // Locked heuristic per designer notes §4.5:
  //   blocked dominates over-client-target — fix the floor first.
  //   suggestion-led: surgical wins when exactly one tier is below;
  //   global wins when 2+ tiers are below (surgical would compound).
  //   over-client-target in sendable = soft "tighten" affordance,
  //   never marked recommended.
  // Exactly one action carries `recommended: true` per render in
  // suggestion-led + blocked modes.
  // Edward fix #4: missing-suggestion guard emits `calculating_suggestion`.
  // Edward fix #5: !policy.allow_override → `override_unavailable` inert.
  const actions: Action[] = [];
  const tiersBelowFloor = new Set(belowFloor.map((c) => c.tier_id));
  const tiersBelowTarget = new Set(belowTarget.map((c) => c.tier_id));
  const sugg = quote.suggestions ?? {};

  const projectBlended = (
    kind: "apply_surgical" | "apply_global",
  ): number | null => {
    if (kind === "apply_surgical" && sugg.surgical) {
      const s = sugg.surgical;
      if (s.new_margin == null) return null;
      const tierKnownMargins = cells
        .filter((c) => c.tier_id === s.tier_id && !c.missing)
        .map((c) => c.margin_pct as number);
      if (tierKnownMargins.length === 0) return null;
      const tierMin = Math.min(...tierKnownMargins);
      const all = cells
        .filter((c) => !c.missing)
        .map((c) =>
          c.tier_id === s.tier_id && c.margin_pct === tierMin
            ? s.new_margin!
            : (c.margin_pct as number),
        );
      return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    }
    if (kind === "apply_global" && sugg.global) {
      return sugg.global.new_blended ?? null;
    }
    return null;
  };

  if (mode === "blocked") {
    if (sugg.surgical) {
      actions.push({
        kind: "apply_surgical",
        label: `Apply Surgical · lift ${labelTiers(tiersBelowFloor)} above floor`,
        sublabel:
          "Recommended adjustment per SKU · re-renders quote in place",
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_surgical"),
      });
    } else if (quote.suggestion_manual_only) {
      actions.push(buildManualOnlyAction(quote.suggestion_manual_only, policy));
    } else if (quote.suggestion_infeasible) {
      actions.push({
        kind: "suggestion_infeasible",
        label: "Suggestion unavailable — math infeasible",
        sublabel:
          "Engine couldn't compute a viable lift path (zero-revenue tiers, missing cost data, or required adjustment exceeds the ±999% field range). Enter pricing on the Costs surface, or use admin override.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    } else {
      actions.push({
        kind: "calculating_suggestion",
        label: "Calculating suggestion…",
        sublabel:
          "Suggestion engine is computing a lift path. Refresh in a moment.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    }
    if (policy.allow_override) {
      actions.push({
        kind: "request_override",
        label: "Request admin override",
        sublabel: "Routes to firm admin · quote sits in waiting state",
        recommended: false,
        primary: false,
      });
    } else {
      actions.push({
        kind: "override_unavailable",
        label: "Admin override unavailable on this account",
        sublabel:
          "Firm policy prohibits below-floor overrides. Surgical lift is the only send path.",
        recommended: false,
        primary: false,
        disabled: true,
      });
    }
  } else if (mode === "suggestion_led") {
    const surgicalWins = tiersBelowTarget.size === 1;
    if (surgicalWins && sugg.surgical) {
      actions.push({
        kind: "apply_surgical",
        label: `Apply Surgical · lift ${labelTiers(tiersBelowTarget)} to target`,
        sublabel: "Adjusts the offending tier only · other tiers unchanged",
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_surgical"),
      });
    } else if (!surgicalWins && sugg.global) {
      actions.push({
        kind: "apply_global",
        label: "Apply Global · lift all tiers proportionally",
        sublabel: `${tiersBelowTarget.size} tiers below target · surgical would compound`,
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_global"),
      });
    } else if (quote.suggestion_manual_only) {
      actions.push(buildManualOnlyAction(quote.suggestion_manual_only, policy));
    } else if (quote.suggestion_infeasible) {
      actions.push({
        kind: "suggestion_infeasible",
        label: "Suggestion unavailable — math infeasible",
        sublabel:
          "Engine couldn't compute a viable lift path (zero-revenue tiers, missing cost data, or required adjustment exceeds the ±999% field range). Enter pricing on the Costs surface to recover.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    } else {
      actions.push({
        kind: "calculating_suggestion",
        label: "Calculating suggestion…",
        sublabel:
          "Suggestion engine is computing a lift path. Refresh in a moment.",
        recommended: true,
        primary: true,
        disabled: true,
      });
    }
    actions.push({
      kind: "preview_pdf",
      label: "Preview quote PDF",
      sublabel: "Send below-target (review risk first)",
      recommended: false,
      primary: false,
      demoted: true,
    });
  } else {
    // sendable
    actions.push({
      kind: "preview_pdf",
      label: "Preview quote PDF",
      sublabel: null,
      recommended: false,
      primary: true,
    });
    if (overClientTarget.length > 0) {
      const countLabel = overClientTarget.length === 1 ? "SKU" : "SKUs";
      actions.push({
        kind: "tighten_to_target",
        label: `Tighten to client benchmark · ${overClientTarget.length} ${countLabel}`,
        sublabel:
          "Pricing above client's stated target — leaving headroom on the table",
        recommended: false,
        primary: false,
        soft: true,
      });
    }
  }

  // Provisional / data-incomplete handling: classifier never silently
  // treats unknown margins as fine. Per designer notes §4.4:
  //   - blocked stays blocked (known floor breach is decisive)
  //   - suggestion_led stays suggestion_led
  //   - sendable becomes provisional — CTA stays visible but inert
  const dataIncomplete = unknown.length > 0;
  if (dataIncomplete && mode === "sendable") {
    actions[0].disabled = true;
    actions[0].disabled_reason = `${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws · margin unknown`;
  }

  // ── 7. State-line copy (one source — never restated) ───────────
  let stateLine: StateLine;
  if (mode === "sendable") {
    const qualifiers: string[] = [];
    if (overClientTarget.length > 0) {
      qualifiers.push(
        `${overClientTarget.length} ${overClientTarget.length === 1 ? "SKU" : "SKUs"} over client target`,
      );
    }
    if (dataIncomplete) {
      qualifiers.push(
        `${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`,
      );
    }
    stateLine = {
      lead: "All tiers above target",
      status: dataIncomplete ? "provisional" : "sendable",
      qualifiers,
    };
  } else if (mode === "suggestion_led") {
    const qualifiers: string[] = [];
    if (dataIncomplete) {
      qualifiers.push(
        `${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`,
      );
    }
    if (overClientTarget.length > 0) {
      qualifiers.push(`${overClientTarget.length} over client target`);
    }
    stateLine = {
      lead: `${tiersBelowTarget.size} ${tiersBelowTarget.size === 1 ? "tier" : "tiers"} below target`,
      status: "review",
      qualifiers,
    };
  } else {
    // Edward fix #3: data_incomplete qualifier surfaces in blocked mode too.
    const qualifiers: string[] = [];
    if (dataIncomplete) {
      qualifiers.push(
        `${unknown.length} ${unknown.length === 1 ? "cell" : "cells"} awaiting raws`,
      );
    }
    if (overClientTarget.length > 0) {
      qualifiers.push("mixed status · per-SKU view in detail");
    }
    if (!policy.allow_override) {
      qualifiers.push("override unavailable · firm policy");
    }
    stateLine = {
      lead: `${tiersBelowFloor.size} ${tiersBelowFloor.size === 1 ? "tier" : "tiers"} below floor`,
      status: "blocked",
      qualifiers,
    };
  }

  // ── 8. Summary card (sendable only — composition, not status) ──
  const summaryCard: SummaryCard | null =
    mode === "sendable"
      ? {
          sku_count: quote.skus.length,
          tier_count: quote.tiers.length,
          recommended_tier: quote.recommended_tier_id,
          recommended_tier_value: computeRecommendedTierValue(
            quote.recommended_tier_id,
            tierRoll,
            cells,
          ),
          blended_margin_pct: quote.blended_margin_pct,
        }
      : null;

  return {
    mode,
    mode_label:
      mode === "sendable"
        ? "Sendable"
        : mode === "suggestion_led"
          ? "Suggestion-led"
          : "Blocked",
    blended_margin_pct: quote.blended_margin_pct,
    state_line: stateLine,
    summary_card: summaryCard,
    flags: {
      over_client_target: overClientTarget.length > 0,
      over_client_target_count: overClientTarget.length,
      data_incomplete: dataIncomplete,
      missing_count: unknown.length,
      override_applied: tierRoll.some((t) => t.has_override),
      // accept_risk_unavailable mirrors policy.allow_accept_risk
      // only when the path becomes a question (blocked mode). Other
      // modes don't surface the accept-risk banner.
      accept_risk_unavailable:
        mode === "blocked" && !policy.allow_accept_risk,
      override_unavailable: mode === "blocked" && !policy.allow_override,
    },
    tiers: tierRoll,
    skus: skuRoll,
    cells,
    below_floor: belowFloor,
    outstanding,
    below_target: belowTarget,
    over_client_target: overClientTarget,
    actions,
    policy,
    quote,
  };
}

function labelTiers(tierSet: Set<number>): string {
  if (tierSet.size === 0) return "—";
  if (tierSet.size === 1) return `Tier ${[...tierSet][0]}`;
  return [...tierSet].map((t) => `T${t}`).join(", ");
}

function computeRecommendedTierValue(
  recommendedTierId: number | null,
  tierRoll: TierRollup[],
  cells: Cell[],
): number | null {
  if (recommendedTierId == null) return null;
  const t = tierRoll.find((x) => x.id === recommendedTierId);
  if (!t) return null;
  const tierCells = cells.filter(
    (c) => c.tier_id === t.id && !c.missing,
  );
  return tierCells.reduce(
    (s, c) => s + (c.sell_unit ?? 0) * t.qty,
    0,
  );
}

// False-infeasibility diagnosis (2026-07-15) — Option B fix helper.
//
// Builds the `suggestion_manual_only` action from adapter-supplied
// details. Copy names the worst SKU + affected tier(s) + margin
// severity (target vs floor).
//
// Copy stopgap (2026-07-15) — recovery-paths phrasing pruned to
// only actions the PM can actually take today. Original draft named
// three paths (Costs adjustment, per-cell override, admin override);
// the per-cell override UI wire is a v1-post-Slice-11 slice (data
// model + write path already shipped; UI wire deferred). Admin-
// override authorization is banked v1.1+. Both promises-without-
// controls dropped. The remaining copy:
//   - suggestion_led (below target): Costs adjustment OR
//     send-below-target-with-risk (the demoted preview_pdf card is
//     always present in suggestion_led; PMs can review + send).
//   - blocked (below floor, rare asymmetry): Costs adjustment only
//     — send path is unavailable at the state-machine level; don't
//     promise it in copy.
// When Part 2 (override UI wire) ships, extend this to name the
// per-cell override path.
function buildManualOnlyAction(
  details: NonNullable<QuoteInput["suggestion_manual_only"]>,
  policy: QuotePolicyInput,
): Action {
  const tiers = details.affected_tier_labels;
  const tierStr =
    tiers.length === 0
      ? "the affected tier"
      : tiers.length === 1
        ? tiers[0]
        : tiers.length === 2
          ? `${tiers[0]} & ${tiers[1]}`
          : `${tiers.slice(0, -1).join(", ")} & ${tiers[tiers.length - 1]}`;
  const marginPct = (details.worst_margin_pct * 100).toFixed(1);
  const belowFloor = isBelowFloor(
    details.worst_margin_pct,
    policy.floor_margin_pct,
  );
  const bandLabel = belowFloor
    ? `floor ${(policy.floor_margin_pct * 100).toFixed(1)}%`
    : `target ${(policy.target_margin_pct * 100).toFixed(1)}%`;
  const tierPlural = tiers.length === 1 ? "tier is" : "tiers are";
  const recoveryPaths = belowFloor
    ? "Adjust cost inputs on the Costs surface to bring the SKU above the floor."
    : "Adjust cost inputs on the Costs surface, or send below-target acknowledging the risk.";
  return {
    kind: "suggestion_manual_only",
    label: `Manual adjustment — ${details.worst_sku_name} on ${tierStr}`,
    sublabel:
      `${tiers.length === 0 ? "The" : tiers.length === 1 ? "This" : "These"} ` +
      `${tierPlural} above target overall, but ${details.worst_sku_name} ` +
      `margin is ${marginPct}% (below ${bandLabel}). ${recoveryPaths}`,
    recommended: true,
    primary: true,
    disabled: true,
  };
}
