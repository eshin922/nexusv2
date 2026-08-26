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
  /**
   * The governed blended margin for this tier — `(Σ revenue − Σ cost) / Σ
   * revenue` — forwarded from the engine, never computed here.
   *
   * BV-010 settles what "blended margin" names, and this is it. The classifier
   * used to derive its own: an unweighted arithmetic mean of the per-cell
   * margin PERCENTAGES. A mean of ratios is not a ratio of sums — it weighted a
   * $0.20 label the same as a $4.90 bottle — and it disagreed with the governed
   * quantity on 18 of 37 measurable tiers by up to 2.29pp while rendering under
   * the label "BLENDED".
   *
   * Optional so a caller that has no engine rollup for a tier passes nothing
   * rather than a stand-in. Absent means unknown, and unknown renders as such.
   */
  blended_margin_pct?: number | null;
  /**
   * The verdict on THAT margin, also the engine's.
   *
   * Distinct from `TierRollup.status`, which bands the WORST cell and is the
   * Per-tier table's compliance signal. Both are wanted, and they are not
   * interchangeable: the Cost Stack states a blended quantity and must carry
   * the blended verdict, or it tints a blend with a single cell's judgement.
   */
  blended_status?: CellStatus;
  /**
   * Why there is no blended margin, when there is none. Mirrors the per-cell
   * field exactly — a band is a region of the number line, and neither
   * no-margin state is a number.
   */
  blended_no_margin_reason?: NoMarginReason | null;
}

export interface QuoteCellInput {
  margin_pct?: number | null;
  sell_unit?: number | null;
  /**
   * The client target IN FORCE FOR THIS TIER — already resolved
   * `tier ?? common` by the adapter, and supplied per cell rather than per row.
   *
   * The headroom below is computed against this and the engine's competitive
   * verdict is computed against the same resolved value, so the two cannot
   * disagree. They could, and did, while one was per-cell and the other was a
   * row-level collapse.
   */
  client_target_unit?: number | null;
  /**
   * The graph key of the node that answers for `sell_unit`, as the ENGINE
   * chose it. Forwarded, never constructed — which node is the cell root
   * depends on whether an override or a lift is in force, and a consumer
   * reconstructing that would be a second copy of the engine's precedence.
   */
  sell_node_key?: string | null;
  cost_unit?: number | null;
  /**
   * Governed recovery embedded in `sell_unit`, per unit.
   *
   * A unit-price charge is added AFTER the pricing ladder, so no lever
   * multiplies it (Edward, 2026-08-26 — recovery placement is value-invariant).
   * The lift solver needs it, because `required / sell - 1` assumes the lift
   * moves the whole cell and lands short by `recovery x lift` when it does not.
   *
   * Absent or null means "none", which is the pre-repair behaviour exactly.
   */
  recovery_unit?: number | null;
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
  /**
   * The engine's competitive verdict for this cell, forwarded by the adapter.
   *
   * `computeCompetitiveStatus(sell, clientTarget)` already owns this question.
   * The classifier used to answer it again with `sellUnit > clientTarget` —
   * correct, and a second authority on a commercial classification. Same shape
   * as the `isMissing` heuristic that preceded it, and removed for the same
   * reason.
   */
  competitive_status?: CompetitiveStatus | null;
  missing?: boolean;
}

export interface QuoteSkuInput {
  id: string;
  name: string;
  /**
   * The SKU code, for the grid's sub-label — display only.
   *
   * Optional because it is display identity, not commercial identity: a rollup
   * without one renders no sub-label rather than a blank line, and nothing that
   * decides a price reads it.
   */
  code?: string | null;
  // No row-level `client_target_unit`. It used to live here, collapsed from
  // per-(unit, tier) persistence to "the first non-null found while iterating
  // tiers" — so a quote whose client named different prices at different tiers
  // had every cell's headroom measured against whichever tier happened to come
  // first. The target is per CELL now; see `QuoteCellInput.client_target_unit`.
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
  // per-cell sell price override, request approval).
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

/**
 * Where a cell's price sits against what the customer said they wanted.
 *
 * A SEPARATE AXIS from margin status, and deliberately so. The firm's floor
 * and target are policy — breaching the floor blocks a send. A client target
 * is a benchmark someone stated in a negotiation: a price above it is a
 * commercial risk, not a policy breach, and it must never colour a compliance
 * cell or reach the sendable verdict.
 *
 * `null` when no benchmark is set, which is most cells.
 */
export type CompetitiveStatus = "COMPETITIVE" | "OVER_CLIENT_TARGET";

/**
 * What a cell offers an operator, as ONE value.
 *
 * The R12 prototype selects its four panel bodies with a chain of truthiness
 * checks, and the order of that chain is load-bearing without saying so. Two of
 * its conditions co-occur routinely — a cell can carry an applied lift and
 * still be below floor, so an offer exists alongside it — and one combination
 * is a contradiction the chain silently absorbs.
 *
 * So the states below are **exclusive by construction**, not by ordering. Every
 * member excludes the others on a predicate, and a component switching on this
 * cannot pick a different answer by reading the flags in a different sequence.
 *
 * This is a PARTITION of decisions already made, not a new one. Eligibility is
 * `lift_offer_pct` (the solver's), blocking is `lift_blocked`, an override's
 * existence is `override_applied`. Nothing here decides any of them.
 */
export type CellActionState =
  /** An override exists and a lift is offered: the lift is refused, not applied. */
  | "blocked_by_override"
  /** An override exists and no lift is offered. */
  | "direct_price_set"
  /** A lift is in effect. An offer may also exist — the cell can still be short. */
  | "lift_applied"
  /** A lift is offered and nothing stands in its way. */
  | "lift_available"
  /** Nothing to act on. */
  | "none"
  /**
   * The data contradicts itself. Rendered loudly rather than resolved.
   *
   * Reachable when a cell carries BOTH an override and an applied lift. The
   * engine's override supersedes the computed chain entirely, so the lift is
   * inert — it exists, it is not refused, and it changes nothing. Choosing
   * either state would hide that; `conflict` says it out loud.
   */
  | "conflict";

export interface Cell {
  sku_id: string;
  sku_name: string;
  tier_id: number;
  tier_qty: number;
  margin_pct: number | null;
  sell_unit: number | null;
  /** See `QuoteCellInput.sell_node_key`. Null when nothing answers for it. */
  sell_node_key: string | null;
  cost_unit: number | null;
  /** Governed recovery embedded in `sell_unit`, per unit. Mirrors the input. */
  recovery_unit: number | null;
  cost_stack: CostStackBuckets | null;
  client_target_unit: number | null;
  client_target_delta: number | null;
  /** The engine's verdict, forwarded. Null when no benchmark is set. */
  competitive_status: CompetitiveStatus | null;
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
  /**
   * Whether the cell can be OPENED. Not whether it needs anything.
   *
   * Distinct from `actionable`, deliberately and permanently. `actionable` is
   * the commercial remediation signal — a lift is offered, applied, or blocked
   * — and it must keep meaning exactly that. It was doing a second job as the
   * click gate, and the consequence was that on a fully compliant quote every
   * one of 27 cells was inert: no trace, and no way to set a negotiated price
   * on a healthy cell, which is an ordinary commercial act.
   *
   * Widening `actionable` to fix that would have made "this cell needs
   * attention" mean "this cell exists", and the banner and grid both read it.
   * So selection got its own field instead.
   *
   * A cell with no price is not selectable: there is nothing to trace and
   * nothing to replace. Whether an UNPRICED cell should be openable in order to
   * set its first price is a real workflow question and an open one — it is not
   * assumed here.
   */
  selectable: boolean;
  /** The single state a cell-scoped affordance switches on. See `CellActionState`. */
  action_state: CellActionState;
  /** Names the contradiction when `action_state` is `conflict`; null otherwise. */
  action_conflict: string | null;
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
  /** The engine's, carried through. See `QuoteTierInput.blended_margin_pct`. */
  blended_margin_pct: number | null;
  /**
   * The WORST cell's band, which is the Per-tier table's compliance verdict.
   *
   * Kept worst-based deliberately. That section owns worst-SKU compliance —
   * it says so in its own subtitle and carries a labelled WORST MARGIN column
   * — so its status pill verdicts the worst cell. The blended verdict is
   * `blended_status`, and the Cost Stack uses that one.
   */
  status: CellStatus;
  /** The band of `blended_margin_pct`. `unknown` when there is no margin. */
  blended_status: CellStatus;
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

/**
 * The exclusive partition. Four real states, one empty, one contradiction.
 *
 * Read the predicates as a set rather than a sequence: every branch below
 * disagrees with every other on at least one term, so reordering them cannot
 * change the answer. That is the property the prototype's truthiness chain did
 * not have.
 */
function cellActionState(
  overrideApplied: boolean,
  liftApplied: number | null,
  liftOffer: number | null,
): { action_state: CellActionState; action_conflict: string | null } {
  // An override supersedes the computed chain, so a lift underneath it is
  // inert: not refused, not applied to anything, silently doing nothing. It
  // should have been rejected at write time. Surface it instead of picking a
  // state that hides one of the two facts.
  if (overrideApplied && liftApplied !== null) {
    return {
      action_state: "conflict",
      action_conflict:
        "This cell carries both a direct price and an applied lift. The direct " +
        "price replaces the computed chain, so the lift changes nothing — it is " +
        "neither in effect nor refused. Resolve the data before acting on it.",
    };
  }
  if (overrideApplied) {
    return {
      // `lift_blocked` is exactly `liftOffer !== null && overrideApplied`, so
      // the two branches here split on the offer and cannot both hold.
      action_state: liftOffer !== null ? "blocked_by_override" : "direct_price_set",
      action_conflict: null,
    };
  }
  if (liftApplied !== null) {
    // An offer may coexist — a lifted cell can still be below floor, and the
    // grid shows what would clear it. Applied is the state; the offer is
    // supplementary, which is why this is a term and not a precedence rule.
    return { action_state: "lift_applied", action_conflict: null };
  }
  if (liftOffer !== null) {
    return { action_state: "lift_available", action_conflict: null };
  }
  return { action_state: "none", action_conflict: null };
}

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
      // The recovery inside this cell is not liftable, so the solve is against
      // the product portion. Passing it is what keeps the button's promise the
      // same as the button's act — the OD-023 failure was exactly this gap.
      const recoveryUnit = cellRaw.recovery_unit ?? 0;
      const liftOffer =
        status === "below_floor"
          ? liftToClear(sellUnit, costUnit, policy.floor_margin_pct, recoveryUnit)
          : null;
      const clientTarget = cellRaw.client_target_unit ?? null;
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
        sell_node_key: cellRaw.sell_node_key ?? null,
        cost_unit: cellRaw.cost_unit ?? null,
        recovery_unit: cellRaw.recovery_unit ?? null,
        cost_stack: cellRaw.cost_stack ?? null,
        client_target_unit: clientTarget,
        client_target_delta: clientTargetDelta,
        competitive_status: cellRaw.competitive_status ?? null,
        // Read from the engine's verdict, not recomputed from the numbers.
        // `sellUnit > clientTarget` gave the same answer; it was still a
        // second place the question got decided, and the two would have
        // diverged the moment either grew a tolerance.
        over_client_target: cellRaw.competitive_status === "OVER_CLIENT_TARGET",
        missing,
        status,
        no_margin_reason: margin === null ? (cellRaw.no_margin_reason ?? "unpriced") : null,
        override_applied: overrideApplied,
        lift_offer_pct: liftOffer,
        lift_applied_pct: liftApplied,
        lift_blocked: liftOffer !== null && overrideApplied,
        outstanding: status === "below_floor" && liftApplied === null,
        // A priced cell. `sell_unit` is null exactly when the margin is, so
        // this is "the engine produced a price for this cell" and nothing more.
        selectable: sellUnit !== null,
        ...cellActionState(overrideApplied, liftApplied, liftOffer),
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
    // The mean of these margins used to be computed here and called "blended".
    // It is gone rather than renamed: BV-010 settles that the blended margin is
    // (Σ revenue − Σ cost) / Σ revenue, the engine owns it, and a second
    // quantity kept under a different label would be a future consumer's
    // mistake waiting to be made. If a mean of cell margins ever has a business
    // purpose, it needs its own contract — not a survival slot here.
    const blendedMargin = t.blended_margin_pct ?? null;
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
      // Forwarded, and `unknown` when the caller supplied none — the same
      // posture the per-cell path takes. A blend with no margin is not a band,
      // and defaulting it to one would put a verdict on a quantity that does
      // not exist. Which of the two no-margin states it is travels in
      // `blended_no_margin_reason`.
      blended_status: t.blended_status ?? "unknown",
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
        // Named for the tier the SUGGESTION targets, not for every tier below
        // floor. It used to list all of them — "lift T1, T2, T3, T4 above
        // floor" — while the action moved one, which P3-016's runtime
        // observation caught: four tiers named, one adjusted, blocked count
        // 4 → 3. A surgical lift is surgical, and the CTA has to say so.
        label: `Apply Surgical · lift ${labelTiers(new Set([sugg.surgical.tier_id]))} above floor`,
        sublabel:
          "Stages a per-tier adjustment · review and apply below",
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
          "Engine couldn't compute a viable lift path (zero-revenue tiers, missing cost data, or required adjustment exceeds the ±999% field range). Enter pricing on the Costs surface, or request approval.",
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
        // RENAMED, not re-scoped. "Admin override" named the wrong authority:
        // BV-005 keeps approval independent of role, and admin confers none of
        // it. The kind stays `request_override` because it is a concept
        // reference — the workflow, the tables and the audit actions are all
        // named for it, and renaming those would rewrite history to fix copy.
        label: "Request approval",
        sublabel:
          "Routes to an authorized commercial approver · quote waits for their decision",
        recommended: false,
        primary: false,
      });
    } else {
      actions.push({
        kind: "override_unavailable",
        label: "Below-floor approval unavailable on this account",
        sublabel:
          "Firm policy prohibits below-floor approvals. Lifting above the floor is the only send path.",
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
        label: `Apply Surgical · lift ${labelTiers(new Set([sugg.surgical.tier_id]))} to target`,
        sublabel:
          "Stages an adjustment on that tier only · other tiers unchanged",
        recommended: true,
        primary: true,
        projected_blended_after_apply: projectBlended("apply_surgical"),
      });
    } else if (!surgicalWins && sugg.global) {
      actions.push({
        kind: "apply_global",
        label: "Apply Global · lift all tiers proportionally",
        sublabel: `Stages an adjustment on every tier · ${tiersBelowTarget.size} below target, surgical would compound`,
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

  // ── 8. Summary card — composition, not status, and therefore not gated ──
  //
  // R12 §8a: everything above and including *Your next move* is preserved in
  // EVERY state, "What you're sending" among it. The prototype shows the tiles
  // beside a NOT SENDABLE verdict, which is exactly when a PM most wants to
  // know what they are looking at — scope, recommended tier, order value.
  //
  // It used to be gated on `mode === "sendable"`, and the gate said something
  // the card does not: these four numbers describe the quote's COMPOSITION and
  // are true whatever the verdict. Withholding them while blocked answered
  // "may I send this" twice and "what is this" not at all.
  //
  // Null only when there is genuinely nothing to describe.
  const summaryCard: SummaryCard | null =
    quote.skus.length === 0 || quote.tiers.length === 0
      ? null
      : {
          sku_count: quote.skus.length,
          tier_count: quote.tiers.length,
          recommended_tier: quote.recommended_tier_id,
          recommended_tier_value: computeRecommendedTierValue(
            quote.recommended_tier_id,
            tierRoll,
            cells,
          ),
          /**
           * D-1 · THE RECOMMENDED TIER'S margin, not the cross-tier aggregate.
           *
           * This read `quote.blended_margin_pct`, which the engine computes by
           * summing revenue and cost across EVERY tier and dividing
           * (`costing.ts:3339`). Arithmetically valid, and not a quantity that
           * describes anything: tiers are mutually exclusive quantity breaks,
           * a customer buys at one, so the sum prices a transaction that
           * cannot occur. On the walkthrough quote it read 54.8% — inflated by
           * a PM override on a tier the customer may never choose — against a
           * recommended tier of 80.1%.
           *
           * The Design Authority defines no cross-tier margin anywhere. Its
           * tile is `pctS(rec.margin)` where `rec = rollups[ri]` and `ri` is
           * the recommended tier (`pricing-page.jsx:266-267, 309`), and every
           * sibling tile in this card is already recommended-tier-scoped:
           * Recommended tier, Order value · T{n}, across all SKUs. The card is
           * "What you're sending", and what is sent is the quote at one tier.
           *
           * No new arithmetic: the per-tier blend is the engine's, already
           * carried on `TierRollup` and already rendered by the grid.
           */
          blended_margin_pct: recommendedTierMargin(
            quote.recommended_tier_id,
            tierRoll,
          ),
        };

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

/**
 * The recommended tier's governed blended margin. D-1.
 *
 * Null when no tier is recommended, or when the recommended tier has no margin
 * — the same fail-closed posture as `computeRecommendedTierValue` beside it.
 * Substituting the cross-tier aggregate as a fallback is exactly the defect
 * this replaces, so there is deliberately no fallback.
 */
function recommendedTierMargin(
  recommendedTierId: number | null,
  tierRoll: TierRollup[],
): number | null {
  if (recommendedTierId == null) return null;
  return tierRoll.find((t) => t.id === recommendedTierId)?.blended_margin_pct ?? null;
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
// three paths (Costs adjustment, per-cell override, approval); the
// per-cell override UI wire is a v1-post-Slice-11 slice (data model +
// write path already shipped; UI wire deferred). Approval is NOT a
// path here and never was: this action fires precisely when the tier's
// BLEND is above floor, and `requestBelowFloorApproval` refuses a
// request on a tier that is not below the floor. Naming it would send
// the operator after a permission the workflow would decline to
// consider. The remaining copy:
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
