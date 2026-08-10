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

/**
 * Names a tier for a per-tier adjustment chip. Same fail-closed contract as
 * `CellLabeller`: an unresolved tier shows its raw id rather than a blank.
 */
export type TierLabeller = (tierId: string) => string;

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
export function describeChange(
  change: StagedChange,
  label: CellLabeller,
  tierLabel: TierLabeller,
): string {
  switch (change.kind) {
    case "lift":
      return `Lift ${label(change.key)} by ${fmtPct(change.pct)}`;
    case "lift-removed":
      return `Remove lift on ${label(change.key)}`;
    case "override":
      return `Set ${label(change.key)} to ${fmtUsd(change.value)}`;
    case "override-removed":
      return `Remove direct price on ${label(change.key)}`;
    case "tier-adj":
      // Named for the tier, because that is the scope of what it moves: every
      // price on that tier and no price on any other. `from: null` is a tier
      // that had no adjustment of its own and was following the quote-wide
      // one, which is a different starting point from "was at 0%" and reads
      // differently to the operator about to commit it.
      return change.from === null
        ? `Adjust ${tierLabel(change.key)} to ${fmtPct(change.to)}`
        : `Adjust ${tierLabel(change.key)} ${fmtPct(change.from)} → ${fmtPct(change.to)}`;
    case "tier-adj-removed":
      return `Remove ${tierLabel(change.key)} adjustment (${fmtPct(change.from)})`;
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

/**
 * Why a control is unavailable, in words, or null when it is available.
 *
 * Pattern 47(f): every disabled operator control must say why. A greyed button
 * with no explanation is the failure that rule exists to stop — an operator
 * finding Apply dead after filling in a form, with nothing on screen accounting
 * for it.
 */
function unavailableBecause(
  committable: boolean,
  pending: boolean,
  verb: string,
): string | null {
  if (!committable) return "This quote is no longer a draft, so pricing cannot be changed.";
  if (pending) return `${verb}…`;
  return null;
}

export function StagingBar({
  label,
  tierLabel,
}: {
  label: CellLabeller;
  tierLabel: TierLabeller;
}) {
  const {
    changes,
    isStaged,
    appliedCount,
    unstage,
    reset,
    apply,
    toBaseline,
    applyPending,
    baselinePending,
    commitError,
    committable,
  } = usePricingStaging();

  // Rendered by both bars. A refusal has to be visible wherever the act that
  // was refused was offered.
  const error = commitError ? (
    <span className="v" role="alert" style={{ color: "var(--bad)" }}>
      {commitError}
    </span>
  ) : null;

  if (isStaged) {
    const applyBlocked = unavailableBecause(committable, applyPending, "Applying");
    return (
      <div className="r12-staging">
        <div className="left">
          <span className="k">Staged · not yet applied</span>
          <span className="v">
            Nothing is written until you apply. Leaving the page discards these.
          </span>
          {error}
          <div className="chips">
            {changes.map((change) => (
              <span className="r12-chip" key={chipKey(change)}>
                {describeChange(change, label, tierLabel)}
                <button
                  type="button"
                  onClick={() => unstage(change)}
                  title="Discard this change"
                  aria-label={`Discard: ${describeChange(change, label, tierLabel)}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="acts">
          {/*
            Reset is local and discards nothing that was written, so it stays
            available while an Apply is in flight — its own pending state is the
            only thing entitled to disable it, and it has none.
          */}
          <button className="btn ghost sm" type="button" onClick={reset}>
            Reset all
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={apply}
            disabled={applyBlocked !== null}
            title={applyBlocked ?? undefined}
          >
            {applyPending
              ? "Applying…"
              : `Apply ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    );
  }

  if (appliedCount > 0) {
    const baselineBlocked = unavailableBecause(committable, baselinePending, "Removing");
    return (
      <div className="r12-staging applied">
        <div className="left">
          <span className="k">Applied</span>
          <span className="v">
            {appliedCount} pricing adjustment
            {appliedCount === 1 ? "" : "s"} in effect on this quote. Each is an
            additive layer over a computed base that has not moved — remove them
            and the quote returns exactly to where it started.
          </span>
          {error}
        </div>
        <div className="acts">
          {/*
            One control, one act. H6 requires the return to be EXACT — not
            close, the same float — and it can be, because removing a layer is
            not an operation on the base.
          */}
          <button
            className="btn ghost sm"
            type="button"
            onClick={toBaseline}
            disabled={baselineBlocked !== null}
            title={baselineBlocked ?? undefined}
          >
            {baselinePending ? "Removing…" : "Return to computed baseline"}
          </button>
        </div>
      </div>
    );
  }

  // A refusal must outlive the bar that produced it. Returning to baseline
  // empties the applied set, so a failure there would otherwise vanish with the
  // bar and read as success.
  if (commitError) {
    return (
      <div className="r12-staging">
        <div className="left">
          <span className="k">Not applied</span>
          {error}
        </div>
      </div>
    );
  }

  // Nothing staged, nothing applied. The bar's absence is the statement.
  return null;
}
