"use client";

import { useState } from "react";
import Link from "next/link";

import type { ApprovalTierState } from "@/lib/below-floor-approval-state";
import { usePricingClassifier } from "./pricing-classifier-context";
import { usePricingProgression } from "./pricing-progression-context";
import { liftTargets, liftUnreachable } from "./lift-batch";
import { fmtPct } from "./format";

/**
 * The state of the quote, stated ONCE, with the two ways out when there is
 * something to do.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────
 *
 * The page used to state one below-floor condition in five places above the
 * grid — sub-copy, next-move banner, StateLine, StateCallout/StateCard, and the
 * ranked action cards — and the certification run caught two of them
 * CONTRADICTING each other: "Continue to Quote" above "CANNOT SEND" on the same
 * authorized quote. Repetition is not merely wasteful; each restatement is
 * another chance to disagree, and an operator reading two answers learns to
 * trust neither.
 *
 * One bar, one verdict, sourced from `evaluateProgression` — the same predicate
 * the SEND gate predicts.
 *
 * ── PATHS RENDER ONLY WHEN BLOCKED ───────────────────────────────────────
 *
 * And there are exactly two, because there are exactly two: move the price, or
 * obtain an approval to keep it. When progression is allowed the whole
 * intervention collapses and `Continue to Quote` is the only prominent control
 * — reassurance that persists after it stops being needed is just noise between
 * the operator and the grid.
 */

export function VerdictBar({
  projectId,
  quoteId,
  resolveCell,
  onStageLift,
  onRequestApproval,
  onEditCellByCell,
  approvalState,
  requestTierLabel,
  editable,
  tierLabels,
}: {
  projectId: string;
  quoteId: string;
  resolveCell?: (skuId: string, tierId: number) => unknown;
  /** The governed staging path. This component never mutates pricing itself. */
  onStageLift: (ref: unknown, pct: number) => void;
  onRequestApproval: () => void;
  onEditCellByCell: () => void;
  approvalState: ApprovalTierState;
  requestTierLabel: string | null;
  editable: boolean;
  /**
   * Numeric tier id to label. Supplied rather than read from the classifier,
   * which speaks numeric ids and carries no label — a component inventing one
   * would name a tier that matches nothing on screen.
   */
  tierLabels: ReadonlyMap<number, string>;
}) {
  const { state } = usePricingClassifier();
  const progression = usePricingProgression();
  const [showWhy, setShowWhy] = useState(false);

  const allowed = progression.allowed;
  const targets = liftTargets(state, resolveCell);
  const unreachable = liftUnreachable(state, resolveCell);
  const floorPct = state.policy.floor_margin_pct;

  // ── the verdict, in one sentence ────────────────────────────────────────
  const belowTargetTiers = state.tiers.filter((t) => t.status === "below_target").length;

  const headline = allowed
    ? progression.authorizedTiers.length > 0
      ? "Send the quote — approved below floor"
      : "Send the quote"
    : progression.code === "DATA_INCOMPLETE"
      ? "Finish the cost inputs before this can be checked"
      : `Clear ${outstandingCount(state)} below the ${fmtPct(floorPct)}% floor`;

  const reason = allowed
    ? progression.authorizedTiers.length > 0
      ? `${progression.authorizedTiers.map((t) => t.label).join(", ")} ${progression.authorizedTiers.length === 1 ? "carries" : "carry"} an approval · valid while the economics are unchanged`
      : belowTargetTiers > 0
        ? `All priced cells at or above floor · ${belowTargetTiers} tier${belowTargetTiers === 1 ? "" : "s"} below target, which is advisory`
        : "All priced cells at or above floor"
    : progression.message;

  const tone = allowed ? "ok" : progression.code === "DATA_INCOMPLETE" ? "pending" : "breach";

  return (
    <section className={`r13-verdict ${tone}`} aria-live="polite">
      <div className="r13-verdict-head">
        <span className="dot" aria-hidden />
        <div className="r13-verdict-copy">
          <h2>{headline}</h2>
          <p>{reason}</p>
        </div>

        {allowed ? (
          <div className="r13-verdict-go">
            <span className="tierline">{tierLine(state, tierLabels)}</span>
            <Link
              className="btn primary"
              href={`/projects/${projectId}/quotes/${quoteId}/quote?tab=preview`}
            >
              Continue to Quote
            </Link>
          </div>
        ) : (
          <button
            type="button"
            className="r13-why"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
          >
            {showWhy ? "Hide detail" : "Why?"}
          </button>
        )}
      </div>

      {/* TWO PATHS, and only when there is something to resolve. */}
      {!allowed && progression.code === "BELOW_FLOOR_UNAUTHORIZED" && (
        <div className="r13-paths">
          <div className="r13-path">
            <span className="eyebrow">Path 1 · fix the price</span>
            <h3>Adjust pricing</h3>
            <p>
              {targets.length > 0
                ? `Lift ${targets.length} cell${targets.length === 1 ? "" : "s"} to the ${fmtPct(floorPct)}% floor, or open a cell to change its inputs. Cost amounts stay owned by Costs.`
                : "No cell can be lifted automatically — open a cell to set its price directly. Cost amounts stay owned by Costs."}
              {unreachable.length > 0 && (
                <>
                  {" "}
                  <span className="r13-note">
                    {unreachable.length} cell{unreachable.length === 1 ? " has" : "s have"} a
                    price set directly and will not move with a lift.
                  </span>
                </>
              )}
            </p>
            <div className="r13-path-actions">
              {targets.length > 0 && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={!editable}
                  onClick={() => {
                    // The GOVERNED path: the same `stageLift` every other lift
                    // uses, with the solver's own figure. Nothing is written —
                    // these land in the working set and wait for Apply.
                    for (const t of targets) onStageLift(t.ref, t.pct);
                  }}
                >
                  Lift all {targets.length} to floor
                </button>
              )}
              <button type="button" className="btn" onClick={onEditCellByCell}>
                Edit cell by cell
              </button>
            </div>
          </div>

          <div className="r13-path">
            <span className="eyebrow">Path 2 · keep the price</span>
            <h3>Request approval</h3>
            <p>
              Routes to an authorized commercial approver
              {requestTierLabel ? ` for ${requestTierLabel}` : ""}. The quote waits
              — nothing sends until it clears.
            </p>
            <div className="r13-path-actions">
              <ApprovalAction
                state={approvalState}
                onRequest={onRequestApproval}
                enabled={editable && requestTierLabel !== null}
              />
            </div>
          </div>
        </div>
      )}

      {/* Progressive disclosure. Collapsed by default — the grid below is where
          per-cell arithmetic belongs, and duplicating it here would push the
          grid further down for a detail most operators do not open. */}
      {!allowed && showWhy && (
        <div className="r13-why-detail">
          <div className="r13-why-head">
            Why · floor {`${fmtPct(floorPct)}%`} · target {`${fmtPct(state.policy.target_margin_pct)}%`}
          </div>
          {state.cells
            .filter((c) => c.outstanding)
            .slice(0, 8)
            .map((c) => (
              <div className="r13-why-row" key={`${c.sku_id}:${c.tier_id}`}>
                <span className="cell">
                  {c.sku_name} · {tierLabels.get(c.tier_id) ?? `Tier ${c.tier_id}`}
                </span>
                <span className="margin">
                  {c.margin_pct === null ? "—" : `${fmtPct(c.margin_pct)}%`}
                </span>
                <span className="gap">
                  {c.margin_pct === null
                    ? "no margin yet"
                    : `needs ${`${fmtPct(floorPct - c.margin_pct)}pp`}`}
                </span>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/**
 * One control whose LABEL is the workflow state.
 *
 * A separate "approval pending" card below the fold made the operator hold two
 * things in their head — a button offering to request, and a notice saying one
 * was already open. The button says which it is.
 */
function ApprovalAction({
  state,
  onRequest,
  enabled,
}: {
  state: ApprovalTierState;
  onRequest: () => void;
  enabled: boolean;
}) {
  if (state.kind === "pending") {
    return (
      <button type="button" className="btn" disabled title="A decision is already pending.">
        Requested — awaiting a decision
      </button>
    );
  }
  if (state.kind === "rejected") {
    return (
      <>
        <button type="button" className="btn primary" disabled={!enabled} onClick={onRequest}>
          Request approval again
        </button>
        {state.reason && <span className="r13-note">Declined: {state.reason}</span>}
      </>
    );
  }
  if (state.kind === "superseded") {
    return (
      <>
        <button type="button" className="btn primary" disabled={!enabled} onClick={onRequest}>
          Request approval
        </button>
        <span className="r13-note">
          The previous request no longer matches the current numbers.
        </span>
      </>
    );
  }
  return (
    <button type="button" className="btn primary" disabled={!enabled} onClick={onRequest}>
      Request approval
    </button>
  );
}

function outstandingCount(state: ReturnType<typeof usePricingClassifier>["state"]): string {
  const n = state.cells.filter((c) => c.outstanding).length;
  return `${n} cell${n === 1 ? "" : "s"}`;
}

function tierLine(
  state: ReturnType<typeof usePricingClassifier>["state"],
  tierLabels: ReadonlyMap<number, string>,
): string {
  const rec = state.summary_card?.recommended_tier ?? null;
  if (rec == null) return "no recommended tier set";
  return `quoting ${tierLabels.get(rec) ?? `Tier ${rec}`}`;
}
