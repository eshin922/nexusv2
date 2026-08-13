// slice-pricing-surface-redesign Step 5 — ACTION zone components.
//
// Four components, one consumer pattern: each reads from the
// classifier output (QuoteState) per render. No component re-derives
// status, mode, action ranking, projected blended, or anything else
// that flows from `classify(quote, policy)`. The §3 source-of-truth
// rule continues at the type system: every prop here is a QuoteState
// field (or for SuggestionCard, the QuoteInput it passes through
// via state.quote).
//
//   - SendableSummary: sendable mode only; reads state.summary_card
//     (NEW component per CD designer notes §2.3 — only net-new
//     component in the slice)
//   - ActionCard: generic ranked-action shell; reads one Action
//     object; handles 7 ActionKind variants + disabled state
//   - SuggestionCard: suggestion-led mode; reads the recommended
//     Action's projected_blended_after_apply (classifier-owned;
//     SuggestionCard reads, never computes) + the raw
//     state.quote.suggestions for surgical lift / global lift
//     preview detail
//   - AcceptRiskBanner: blocked + !policy.allow_accept_risk;
//     discoverability per round-2 disposition
//
// Per-mode composition lives in the page composer (Step 7); these
// components don't read state.mode to decide rendering — they only
// render when the page composer decides to mount them.
//
// Canonical CSS register: `.psr-*` (Path B-default; r-psr-pricing.css).
// JSX class names match CD prototype's pricing_surface.jsx 1:1.
//
// All apply paths placeholder until Step 7 wires recompute pipeline
// + server actions. CTAs render as plain buttons; on-click is
// supplied via props by the page composer.

import type { Action, QuoteState } from "@/lib/pricing-classifier";
import { fmtPct, fmtPct0, fmtQty, fmtUsd } from "./format";

// ──────────────────────────────────────────────────────────────────
// SendableSummary — sendable mode only. NEW component per CD §2.3.
// ──────────────────────────────────────────────────────────────────
//
// Reads state.summary_card (classifier-owned). Renders 4 cells:
// scope (sku/tier count), recommended tier (id + qty), order value
// at recommended tier, blended margin vs target/floor reference.
//
// summary_card is null when mode !== "sendable"; defensive null-check
// matches CD prototype.

export function SendableSummary({ state }: { state: QuoteState }) {
  const sc = state.summary_card;
  if (!sc) return null;
  const recTier = state.tiers.find((t) => t.id === sc.recommended_tier);
  return (
    <div className="psr-summary-card">
      <h3>What you&apos;re sending</h3>
      <div className="psr-summary-grid">
        <div className="psr-summary-cell">
          <span className="lab">Scope</span>
          <span className="val">
            {sc.sku_count}
            <span className="unit">SKUs</span>
          </span>
          <span className="sub">{sc.tier_count} tiers</span>
        </div>
        <div className="psr-summary-cell">
          <span className="lab">Recommended tier</span>
          <span className="val numeric">
            T{sc.recommended_tier} · {fmtQty(recTier?.qty ?? null)}
          </span>
          <span className="sub">order value at this tier</span>
        </div>
        <div className="psr-summary-cell">
          <span className="lab">Order value · T{sc.recommended_tier}</span>
          <span className="val numeric">
            {fmtUsd(sc.recommended_tier_value)}
          </span>
          <span className="sub">across all SKUs</span>
        </div>
        <div className="psr-summary-cell">
          {/*
            SCOPE IS IN THE LABEL. The sibling tile above already reads
            "Order value · T{n}", so naming the tier here follows the card's
            established convention rather than inventing vocabulary — and it is
            what stops this figure and the grid's per-tier `Blended margin` row
            being read as the same aggregation. D-1.
          */}
          <span className="lab">
            Blended margin
            {sc.recommended_tier != null && ` · T${sc.recommended_tier}`}
          </span>
          <span className="val numeric">
            {fmtPct(sc.blended_margin_pct)}%
          </span>
          <span className="sub">
            target {fmtPct0(state.policy.target_margin_pct)}% · floor{" "}
            {fmtPct0(state.policy.floor_margin_pct)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// ActionCard — generic ranked-action shell.
// ──────────────────────────────────────────────────────────────────
//
// Reads one Action from state.actions[]. Classifier marks exactly
// one recommended (in suggestion_led + blocked modes per invariant 2);
// page composer iterates state.actions and mounts the right card
// shell per action kind.
//
// Inert kinds (override_unavailable + calculating_suggestion) render
// the explainer without a CTA button. Other kinds render the kind-
// specific CTA copy.
//
// onActivate handler is supplied by page composer (Step 7); for v1
// the slice ships with placeholder no-op until the recompute
// pipeline + server actions are wired.

const CTA_COPY: Partial<Record<Action["kind"], string>> = {
  preview_pdf: "Preview PDF →",
  apply_surgical: "Apply →",
  apply_global: "Apply →",
  request_override: "Request →",
  tighten_to_target: "Tighten →",
};

const GLYPH: Record<Action["kind"], string> = {
  preview_pdf: "↗",
  apply_surgical: "✦",
  apply_global: "≡",
  request_override: "⌧",
  override_unavailable: "⊘",
  tighten_to_target: "⇣",
  calculating_suggestion: "···",
  // CB Step 9 re-walk BUG-1 — terminal-inert glyph (warn-tone
  // exclamation) marks the structural-failure mode distinct from
  // the in-flight ellipsis of `calculating_suggestion`.
  suggestion_infeasible: "⚠",
  // False-infeasibility fix (2026-07-15, Option B) — guidance-tone
  // glyph (pencil) distinct from `suggestion_infeasible`'s warning
  // exclamation. Signals a solvable state ("manual adjustment
  // required") rather than a structural failure.
  suggestion_manual_only: "✎",
};

export function ActionCard({
  action,
  onActivate,
}: {
  action: Action;
  onActivate?: (kind: Action["kind"]) => void;
}) {
  const cls = [
    "psr-action-card",
    action.primary ? "primary" : "",
    action.recommended ? "recommended" : "",
    action.demoted ? "demoted" : "",
    action.soft ? "soft" : "",
    action.disabled ? "disabled" : "",
    action.kind === "override_unavailable" ? "override-unavailable" : "",
    action.kind === "calculating_suggestion" ? "calculating" : "",
    action.kind === "suggestion_infeasible" ? "infeasible" : "",
    action.kind === "suggestion_manual_only" ? "manual-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const glyph = GLYPH[action.kind] ?? "→";
  // Inert action kinds (no CTA button) — render the explainer only.
  const inert =
    action.kind === "override_unavailable" ||
    action.kind === "calculating_suggestion" ||
    action.kind === "suggestion_infeasible" ||
    action.kind === "suggestion_manual_only";
  const ctaCopy = CTA_COPY[action.kind] ?? "Go →";
  return (
    <div className={cls}>
      <div className="glyph">{glyph}</div>
      <div className="body">
        <div className="head">{action.label}</div>
        {action.sublabel && <div className="sub">{action.sublabel}</div>}
        {action.disabled && action.disabled_reason && (
          <div className="disabled-reason">⚠ {action.disabled_reason}</div>
        )}
      </div>
      {!inert && (
        <button
          type="button"
          className="cta"
          disabled={action.disabled}
          onClick={() => onActivate?.(action.kind)}
        >
          {ctaCopy}
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// SuggestionCard — suggestion-led mode.
// ──────────────────────────────────────────────────────────────────
//
// Reads the recommended Action's projected_blended_after_apply
// (classifier-owned per Edward fix #2; SuggestionCard reads, never
// computes). Renders surgical or global preview detail based on the
// recommended action's kind.
//
// Calculating-suggestion fallback path: when the recommended action
// is kind "calculating_suggestion" (engine race per Edward fix #4),
// render the pending shell with a disabled "Pending" CTA.

export function SuggestionCard({
  state,
  onApply,
}: {
  state: QuoteState;
  onApply?: (kind: "apply_surgical" | "apply_global") => void;
}) {
  // Pull the recommended action from classifier; consume its projection.
  // No re-derivation — the post-apply blended is classifier-owned.
  const rec = state.actions.find((a) => a.recommended);
  if (!rec || rec.kind === "calculating_suggestion") {
    return (
      <div className="psr-suggestion-card calculating">
        <div className="head">
          <div>
            <div className="title">Calculating suggestion…</div>
            <div className="sub">
              The suggestion engine is computing a lift path for this
              quote. The recommended action will appear here in a
              moment; refresh if it doesn&apos;t.
            </div>
          </div>
          <button type="button" className="cta" disabled>
            Pending
          </button>
        </div>
      </div>
    );
  }
  // Post-Step-6 fix batch §3 — infeasible-state consolidation.
  // Previously rendered a "Suggestion unavailable" card here, which
  // duplicated (a) the YourNextMoveBanner (label already says
  // "Suggestion unavailable — math infeasible") and (b) the
  // demoted preview_pdf ActionCard that gives PMs the send-anyway
  // path. Empty recommendation slot → no card (per CA §3: "a card
  // echoing the top message" is exactly what to avoid). Banner
  // now carries the recovery hint via helpText for infeasible
  // mode (see pricing-page-head.tsx).
  //
  // False-infeasibility fix (2026-07-15, Option B) — same empty-slot
  // treatment for the manual-only asymmetry corner. Banner carries
  // the specific SKU + tier + recovery hint; SuggestionCard skips.
  if (
    rec.kind === "suggestion_infeasible" ||
    rec.kind === "suggestion_manual_only"
  ) {
    return null;
  }
  const surgical = state.quote.suggestions?.surgical;
  const global = state.quote.suggestions?.global;
  const projected = rec.projected_blended_after_apply;
  const projectedDelta =
    projected != null && state.blended_margin_pct != null
      ? (projected - state.blended_margin_pct) * 100
      : null;
  if (rec.kind === "apply_surgical" && surgical) {
    const tierBefore = state.tiers.find(
      (t) => t.id === surgical.tier_id,
    )?.min_margin_pct;
    return (
      <div className="psr-suggestion-card">
        <div className="head">
          <div>
            <div className="title">
              Lift Tier {surgical.tier_id} by +
              {(surgical.lift_pct * 100).toFixed(0)}% sell price
            </div>
            <div className="sub">
              Surgical adjustment — only Tier {surgical.tier_id} sell
              price changes. Other tiers stay where they are. Brings
              the worst SKU on Tier {surgical.tier_id} to{" "}
              {fmtPct(surgical.new_margin)}% margin (above target).
            </div>
          </div>
          <button
            type="button"
            className="cta"
            onClick={() => onApply?.("apply_surgical")}
          >
            Apply Surgical →
          </button>
        </div>
        <div className="preview">
          <div className="stat">
            <span className="lab">Tier {surgical.tier_id} margin</span>
            <span className="val">
              {fmtPct(tierBefore)}%{" "}
              <span className="delta">
                → {fmtPct(surgical.new_margin)}%
              </span>
            </span>
          </div>
          <div className="stat">
            <span className="lab">Other tiers</span>
            <span className="val">unchanged</span>
          </div>
          <div className="stat">
            <span className="lab">Blended after apply</span>
            <span className="val">
              {fmtPct(projected)}%{" "}
              {projectedDelta != null && (
                <span className="delta">
                  +{projectedDelta.toFixed(1)}pp
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  }
  if (rec.kind === "apply_global" && global) {
    return (
      <div className="psr-suggestion-card">
        <div className="head">
          <div>
            <div className="title">
              Lift all tiers by +{(global.lift_pct * 100).toFixed(0)}%
              sell price
            </div>
            <div className="sub">
              Global adjustment — proportional lift across all tiers
              preserves the volume curve. Use when multiple tiers are
              below target; surgical would compound the curve and
              likely produce inverted volume incentives.
            </div>
          </div>
          <button
            type="button"
            className="cta"
            onClick={() => onApply?.("apply_global")}
          >
            Apply Global →
          </button>
        </div>
        <div className="preview">
          <div className="stat">
            <span className="lab">All tiers</span>
            <span className="val">
              +{(global.lift_pct * 100).toFixed(0)}% sell price
            </span>
          </div>
          <div className="stat">
            <span className="lab">Curve shape</span>
            <span className="val">preserved</span>
          </div>
          <div className="stat">
            <span className="lab">Blended after apply</span>
            <span className="val">
              {fmtPct(state.blended_margin_pct)}%{" "}
              <span className="delta">
                → {fmtPct(projected ?? global.new_blended)}%
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// AcceptRiskBanner — blocked + !policy.allow_accept_risk.
// ──────────────────────────────────────────────────────────────────
//
// Discoverability per CD round-2 disposition: PMs onboarding to the
// firm need to know the accept-risk path *exists* on accounts that
// allow it. Banner explicit explains the gating; doesn't expose the
// path.
//
// Page composer (Step 7) mounts when state.flags.accept_risk_unavailable
// is true. The classifier sets that flag when (mode === 'blocked' &&
// !policy.allow_accept_risk), so the mount predicate is structurally
// safe.

export function AcceptRiskBanner() {
  return (
    <div className="psr-accept-risk-banner">
      <span className="glyph">⌧</span>
      <span>
        <strong>Accept-risk is unavailable on this quote.</strong> Firm
        policy prohibits below-floor sends on margin-protected accounts.
        Use admin override or apply the recommended lift.
      </span>
    </div>
  );
}
