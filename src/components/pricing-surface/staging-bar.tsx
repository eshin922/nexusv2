"use client";

// Phase 3 · the staging bar.
//
// Canonical source: `app/r12/pricing-page.jsx` — the `.r12-staging` block and
// its `.applied` variant.
//
// Two bars, never both, and the distinction is the operator's whole mental
// model of the page:
//
//   STAGED   — changes exist and nothing is written. Chips, Reset, Apply.
//   APPLIED  — nothing pending, but levers are in effect. One control back to
//              the computed baseline.
//
// Neither renders when there is nothing to say. §3: deltas disappear on Apply
// and their absence is the signal that nothing is pending; the bar follows the
// same rule, and for the same reason. A permanently-present bar reading "0
// changes" would make the page look like it always has something outstanding.
//
// ── WHAT THIS COMPONENT DOES NOT DECIDE ───────────────────────────────────
//
// It does not decide whether anything is staged — `isStaged` is a difference
// computed in the staging model, and H3 is the record of what happens when
// that becomes a flag a component can get wrong.
//
// It does not describe a change beyond naming it. What a staged lift will DO
// is a commercial outcome, and outcomes come from the engine's preview run.
// The chip says "Lift GLW-50 · T2 by 7.7%" — an action, not a result.

import { usePricingStaging } from "./pricing-staging-context";
import type { StagedChange } from "@/lib/pricing-staging";

/**
 * How a cell key reads to a person.
 *
 * The key is `{quote_leaf_id}::{tier_id}` — two UUIDs, which name nothing to
 * an operator. Labels are resolved by the caller, which has the SKU and tier
 * names; this component does not go looking for them, because a component that
 * resolves identity is a component that can resolve it wrongly.
 *
 * Falls back to the raw key rather than to a blank. An unlabelled chip is
 * ugly; an unlabelled chip that says nothing at all is a change the operator
 * cannot see they are about to commit.
 */
export type CellLabeller = (cellKey: string) => string;

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * One line per pending change, in the operator's words.
 *
 * Removals get their own phrasing rather than being implied by absence. "Remove
 * the lift on GLW-50 · T2" is a thing someone chose to do and may want to take
 * back before committing — see the staging model, where a removal is its own
 * change kind for exactly this reason.
 */
export function describeChange(change: StagedChange, label: CellLabeller): string {
  switch (change.kind) {
    case "lift":
      return `Lift ${label(change.key)} by ${fmtPct(change.pct)}`;
    case "lift-removed":
      return `Remove lift on ${label(change.key)}`;
    case "override":
      return `Set ${label(change.key)} to ${fmtUsd(change.value)}`;
    case "override-removed":
      return `Remove direct price on ${label(change.key)}`;
    case "adj":
      // Both endpoints. "Global adjustment 12%" does not say whether that is a
      // rise or a cut, and the operator is about to commit it.
      return `Global adjustment ${fmtPct(change.from)} → ${fmtPct(change.to)}`;
  }
}

/** A stable identity per chip, so React does not reuse one row's dismiss for another. */
function chipKey(change: StagedChange): string {
  return change.kind === "adj" ? "adj" : `${change.kind}:${change.key}`;
}

export function StagingBar({ label }: { label: CellLabeller }) {
  const { changes, isStaged, appliedCount, unstage, reset, apply, toBaseline } =
    usePricingStaging();

  if (isStaged) {
    return (
      <div className="r12-staging">
        <div className="left">
          <span className="k">Staged · not yet applied</span>
          <span className="v">
            Nothing is written until you apply. Leaving the page discards these.
          </span>
          <div className="chips">
            {changes.map((change) => (
              <span className="r12-chip" key={chipKey(change)}>
                {describeChange(change, label)}
                <button
                  type="button"
                  onClick={() => unstage(change)}
                  title="Discard this change"
                  aria-label={`Discard: ${describeChange(change, label)}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="acts">
          <button className="btn ghost sm" type="button" onClick={reset}>
            Reset all
          </button>
          <button className="btn primary" type="button" onClick={apply}>
            Apply {changes.length} change{changes.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    );
  }

  if (appliedCount > 0) {
    return (
      <div className="r12-staging applied">
        <div className="left">
          <span className="k">Applied</span>
          <span className="v">
            {appliedCount} pricing adjustment
            {appliedCount === 1 ? "" : "s"} in effect. Each is an additive layer
            over a computed base that has not moved — remove them and the quote
            returns exactly to where it started.
          </span>
        </div>
        <div className="acts">
          {/*
            One control, one act. H6 requires the return to be EXACT — not
            close, the same float — and it can be, because removing a layer is
            not an operation on the base.
          */}
          <button className="btn ghost sm" type="button" onClick={toBaseline}>
            Return to computed baseline
          </button>
        </div>
      </div>
    );
  }

  // Nothing staged, nothing applied. The bar's absence is the statement.
  return null;
}
