// slice-pricing-surface-redesign Step 4 — STATE zone components.
//
// Three components, one consumer pattern: each reads from the
// classifier output (QuoteState) per render. No component re-derives
// status, mode, qualifier copy, projected values, or anything else
// that flows from `classify(quote, policy)`. The §3 source-of-truth
// rule is enforced at the type system: every prop here is a
// QuoteState field or a derived view computed by the page composer
// (Step 7) from QuoteState.
//
//   - StateLine: always rendered; status pill + lead + qualifiers
//   - StateCallout: suggestion-led mode only; worst-tier callout +
//     blended/target/floor meta
//   - StateCard: blocked mode only; worst-floor tier callout + gap +
//     affected count + right-rail blended + meta tiles
//
// Per-mode composition lives in the page composer (Step 7); these
// components don't read `state.mode` to decide rendering — they only
// render when the page composer decides to mount them.
//
// Canonical CSS register: `.psr-*` (Path B-default; r-psr-pricing.css).
// JSX class names match CD prototype's pricing_surface.jsx 1:1.

import type { QuoteState } from "@/lib/pricing-classifier";
import { fmtPct, fmtPct0 } from "./format";

// ──────────────────────────────────────────────────────────────────
// StateLine — always rendered. Status pill + lead + qualifiers.
// ──────────────────────────────────────────────────────────────────
//
// `justUpdated` is page-composer state (set true for 30s after a
// mode transition per brief §6 + designer notes §4.6 / §9.2
// pushback 2). When true, renders the persistent "just updated"
// hint per round-2 disposition.

export function StateLine({
  state,
  justUpdated = false,
}: {
  state: QuoteState;
  justUpdated?: boolean;
}) {
  const sl = state.state_line;
  // Pill class mirrors the 4 state-line statuses; falls back to
  // 'review' for forward-compat if a new status string slips through
  // (the verifier asserts the 4-value enum is closed, so this is
  // belt-and-suspenders).
  const pillClass: "sendable" | "review" | "blocked" | "provisional" =
    sl.status === "sendable" ||
    sl.status === "review" ||
    sl.status === "blocked" ||
    sl.status === "provisional"
      ? sl.status
      : "review";
  return (
    <div className="psr-state-line">
      <span className={"pill " + pillClass}>
        <span className="dot" />
        {sl.status}
        {sl.status === "provisional" ? " *" : ""}
      </span>
      <span className="lead">{sl.lead}</span>
      {sl.qualifiers.map((q, i) => (
        <span key={i} className="qualifier">
          {q}
        </span>
      ))}
      {justUpdated && (
        <span
          className="psr-just-updated"
          title="State recomputed after most recent change"
        >
          <span className="glyph">↻</span>
          just updated
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// StateCallout — suggestion-led mode only.
// ──────────────────────────────────────────────────────────────────
//
// Per CD designer notes §2.1: page composer mounts this between
// StateLine and the ACTION zone when `state.mode === 'suggestion_led'`.
// The component itself does NOT gate on mode (single responsibility);
// the page composer's mount predicate is the gate.
//
// Worst-tier surface picks the tier with min margin across the
// below_target + below_floor sets (suggestion-led usually has none
// in below_floor, but the surgical lift target depends on the worst
// tier regardless — keep the union for forward-compat).

export function StateCallout({ state }: { state: QuoteState }) {
  const blended = fmtPct(state.blended_margin_pct);
  const target = fmtPct0(state.policy.target_margin_pct);
  const floor = fmtPct0(state.policy.floor_margin_pct);
  const worstTier = state.tiers
    .filter((t) => t.status === "below_target" || t.status === "below_floor")
    .reduce<typeof state.tiers[number] | null>(
      (a, b) =>
        a == null ||
        (b.min_margin_pct != null &&
          (a.min_margin_pct == null || b.min_margin_pct < a.min_margin_pct))
          ? b
          : a,
      null,
    );
  return (
    <div className="psr-state-callout">
      <div className="glyph">!</div>
      <div className="body">
        <div className="head">
          {worstTier ? (
            <>
              Tier {worstTier.id} at{" "}
              <span className="pct">
                {fmtPct(worstTier.min_margin_pct)}%
              </span>
            </>
          ) : (
            "Below target"
          )}
        </div>
        <div className="sub">
          Blended{" "}
          <strong style={{ color: "var(--ink)" }}>{blended}%</strong> — under
          the {target}% target. Apply the recommended lift below, or preview
          &amp; send acknowledging the risk.
        </div>
      </div>
      <div className="meta">
        Target {target}% · Floor {floor}%
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// StateCard — blocked mode only.
// ──────────────────────────────────────────────────────────────────
//
// Heaviest STATE-zone surface ("page grows with consequence" per CD
// §2 thesis). Page composer mounts when `state.mode === 'blocked'`.
//
// Renders worst-floor tier + gap in pp + affected cell count +
// right-rail blended margin + meta-row tiles (target / floor / over-
// client-target count / override-applied flag).

export function StateCard({ state }: { state: QuoteState }) {
  const blended = fmtPct(state.blended_margin_pct);
  const target = fmtPct0(state.policy.target_margin_pct);
  const floor = fmtPct0(state.policy.floor_margin_pct);
  const worstTier = state.tiers
    .filter((t) => t.status === "below_floor")
    .reduce<typeof state.tiers[number] | null>(
      (a, b) =>
        a == null ||
        (b.min_margin_pct != null &&
          (a.min_margin_pct == null || b.min_margin_pct < a.min_margin_pct))
          ? b
          : a,
      null,
    );
  const gap =
    worstTier && worstTier.min_margin_pct != null
      ? (state.policy.floor_margin_pct - worstTier.min_margin_pct) * 100
      : 0;
  return (
    <div className="psr-state-card">
      <div className="head">
        <div className="seal">!</div>
        <div className="body">
          <span className="pill">
            <span className="dot" />
            Cannot send
          </span>
          <div className="lead">
            {worstTier ? (
              <>
                Tier {worstTier.id} at{" "}
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontStyle: "normal",
                  }}
                >
                  {fmtPct(worstTier.min_margin_pct)}%
                </span>
              </>
            ) : (
              "Below floor"
            )}
          </div>
          <div className="sub">
            {gap.toFixed(1)}pp below the {floor}% floor ·{" "}
            {state.below_floor.length} cell
            {state.below_floor.length === 1 ? "" : "s"} affected. Resolve
            below — admin override or surgical lift.
          </div>
        </div>
        <div className="right">
          <span className="num">
            {blended}
            <span className="pct">%</span>
          </span>
          Blended margin
        </div>
      </div>
      <div className="meta-row">
        <span>Target {target}%</span>
        <span className="sep">·</span>
        <span>Floor {floor}%</span>
        {state.flags.over_client_target && (
          <>
            <span className="sep">·</span>
            <span>
              {state.flags.over_client_target_count} over client target
            </span>
          </>
        )}
        {state.flags.override_applied && (
          <>
            <span className="sep">·</span>
            <span>override applied on one tier</span>
          </>
        )}
      </div>
    </div>
  );
}
