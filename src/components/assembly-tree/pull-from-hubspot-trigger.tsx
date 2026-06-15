"use client";

import { usePullFromHubSpot } from "./use-pull-from-hubspot";

// slice-hubspot-bidirectional Step 6 — Setup-tree button wiring.
//
// Replaces the inert ↗ Pull from HubSpot button from impl-2 with
// an active trigger that drives the double-pull loop. On click,
// opens a modal overlay (PM interactions with Setup disabled
// while pulling) and iterates pullFromHubSpot calls until both
// passes complete (active products → archived sweep).
//
// slice-library-first-creation-flow Step 5 — refactored to use
// the extracted usePullFromHubSpot hook. State machine + run-loop
// + cursor + totals now live in the hook so LibraryBrowseModal
// can drive its own inline progress band off the same engine
// (per locked Q5 disposition β — inline band over nested
// overlay; avoids three-deep modal stack). This trigger preserves
// its original modal UX for the Setup-tree card-head until Step 6
// retires the standalone affordance.
//
// Pattern 47: file input n/a here (no inputs); button-level
// `disabled={pending}` only used on the trigger button itself,
// which is correct (Pattern 47 rule (e) restricts inputs, not
// buttons).

export function PullFromHubSpotTrigger({
  projectId,
  disabled = false,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const pull = usePullFromHubSpot({ projectId });

  const modalOpen = pull.phase !== "idle";

  function handleClose() {
    if (pull.isPulling) return; // can't close mid-pull
    pull.reset();
  }

  return (
    <>
      <button
        type="button"
        className="a1v2-btn ghost sm"
        onClick={pull.start}
        disabled={disabled || pull.pending || pull.isPulling}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
        title="Pull HubSpot products into the library"
      >
        ↗ Pull from HubSpot
      </button>

      {modalOpen && (
        <div
          className="a1v2-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            // Block backdrop dismissal while pulling — prevents PM
            // from accidentally closing mid-operation.
            if (e.target === e.currentTarget && !pull.isPulling) handleClose();
          }}
        >
          <div
            className="a1v2-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pull-modal-title"
            style={{ maxWidth: 560 }}
          >
            <div className="a1v2-modal-head">
              <h2 id="pull-modal-title">
                {pull.phase === "complete"
                  ? "Pull complete"
                  : pull.phase === "error"
                    ? "Pull paused"
                    : "Pulling from HubSpot…"}
              </h2>
            </div>

            <div className="a1v2-modal-body">
              {/* Phase caption */}
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 12,
                }}
              >
                {pull.phase === "pulling-active" &&
                  "Active products · pass 1 of 2"}
                {pull.phase === "pulling-archived" &&
                  "Archived sweep · pass 2 of 2"}
                {pull.phase === "complete" && "Both passes finished"}
                {pull.phase === "error" &&
                  "Stopped — retry resumes from last batch"}
              </div>

              {/* Running totals — always render once we have data */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 12,
                  padding: "12px 0",
                  borderTop: "1px solid var(--rule)",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <Stat label="Batches" value={pull.totals.batchCount} />
                <Stat label="Added" value={pull.totals.added} />
                <Stat label="Updated" value={pull.totals.updated} />
                <Stat label="Archived" value={pull.totals.archived} />
              </div>

              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                {pull.totals.processed} product
                {pull.totals.processed === 1 ? "" : "s"} processed so far
              </div>

              {/* Latest batch breakdown */}
              {pull.latestBatch && pull.isPulling && (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-4)",
                  }}
                >
                  Batch {pull.totals.batchCount}: {pull.latestBatch.processed}{" "}
                  processed
                  {" · "}+{pull.latestBatch.added} added · ~
                  {pull.latestBatch.updated} updated ·{" "}
                  {pull.latestBatch.archived} archived
                </div>
              )}

              {/* Error message */}
              {pull.phase === "error" && pull.errorMessage && (
                <div
                  role="alert"
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    background: "var(--bad-soft, var(--paper-2))",
                    border: "1px solid var(--bad, var(--rule))",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--bad, var(--ink))",
                  }}
                >
                  {pull.errorMessage}
                </div>
              )}

              {/* Completion summary */}
              {pull.phase === "complete" && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 12px",
                    background: "var(--good-soft, var(--paper-2))",
                    border: "1px solid var(--good, var(--rule))",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "var(--good, var(--ink))",
                  }}
                >
                  ✓ Pulled {pull.totals.processed} HubSpot product
                  {pull.totals.processed === 1 ? "" : "s"} into the
                  library. {pull.totals.added} new · {pull.totals.updated}{" "}
                  updated · {pull.totals.archived} archived.
                </div>
              )}
            </div>

            <div className="a1v2-modal-foot">
              {pull.phase === "error" && (
                <button
                  type="button"
                  className="a1v2-btn primary sm"
                  onClick={pull.retry}
                  disabled={pull.pending}
                >
                  Retry from batch {pull.retryCursor?.batchNumber ?? "?"}
                </button>
              )}
              <button
                type="button"
                className="a1v2-btn ghost"
                onClick={handleClose}
                disabled={pull.isPulling}
              >
                {pull.phase === "complete" ? "Done" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 9.5,
          color: "var(--ink-3)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 500,
          color: "var(--ink)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
