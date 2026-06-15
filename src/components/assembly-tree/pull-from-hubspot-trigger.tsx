"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pullFromHubSpot } from "@/app/actions/hubspot-pull";

// slice-hubspot-bidirectional Step 6 — Setup-tree button wiring.
//
// Replaces the inert ↗ Pull from HubSpot button from impl-2 with
// an active trigger that drives the double-pull loop. On click,
// opens a modal overlay (PM interactions with Setup disabled
// while pulling) and iterates pullFromHubSpot calls until both
// passes complete (active products → archived sweep).
//
// Progress UI mirrors the Step 5 batch summary: per-batch
// processed/added/updated/archived; running totals across the
// whole operation. No estimated total denominator (HubSpot's
// list endpoint doesn't return a cheap product count).
//
// Error handling: any batch failure surfaces the HubSpot error
// inline + offers Retry. Retry resumes from the last successful
// `nextAfter` cursor so partial pulls don't restart from scratch.
//
// Pattern 47: file input n/a here (no inputs); button-level
// `disabled={pending}` only used on the trigger button itself,
// which is correct (Pattern 47 rule (e) restricts inputs, not
// buttons).

type Phase =
  | "idle"
  | "pulling-active"
  | "pulling-archived"
  | "complete"
  | "error";

type Totals = {
  processed: number;
  added: number;
  updated: number;
  archived: number;
  batchCount: number;
};

type RetryCursor = {
  after?: string;
  batchNumber: number;
  includeArchived: boolean;
};

const ZERO_TOTALS: Totals = {
  processed: 0,
  added: 0,
  updated: 0,
  archived: 0,
  batchCount: 0,
};

export function PullFromHubSpotTrigger({
  projectId,
  disabled = false,
}: {
  projectId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const [totals, setTotals] = useState<Totals>(ZERO_TOTALS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<RetryCursor | null>(null);
  const [latestBatch, setLatestBatch] = useState<{
    processed: number;
    added: number;
    updated: number;
    archived: number;
  } | null>(null);

  const isPulling = phase === "pulling-active" || phase === "pulling-archived";
  const modalOpen = phase !== "idle";

  function reset() {
    setPhase("idle");
    setTotals(ZERO_TOTALS);
    setErrorMessage(null);
    setRetryCursor(null);
    setLatestBatch(null);
  }

  async function runPullLoop(start: RetryCursor, runningTotals: Totals) {
    // Local copies so React batched-state updates don't trip the
    // loop iteration logic.
    let after: string | undefined = start.after;
    let batchNumber = start.batchNumber;
    let includeArchived = start.includeArchived;
    let acc = runningTotals;

    while (true) {
      setPhase(includeArchived ? "pulling-archived" : "pulling-active");
      const result = await pullFromHubSpot({
        projectId,
        after,
        batchNumber,
        includeArchived,
      });

      if (!result.ok) {
        // Save cursor for retry; preserve totals accumulated so far.
        setErrorMessage(result.error.message);
        setRetryCursor({ after, batchNumber, includeArchived });
        setPhase("error");
        return;
      }

      const r = result.data;
      acc = {
        processed: acc.processed + r.processed,
        added: acc.added + r.added,
        updated: acc.updated + r.updated,
        archived: acc.archived + r.archivedCount,
        batchCount: acc.batchCount + 1,
      };
      setTotals(acc);
      setLatestBatch({
        processed: r.processed,
        added: r.added,
        updated: r.updated,
        archived: r.archivedCount,
      });

      if (r.nextAfter === null) {
        // Current pass complete. Switch to archived sweep if we
        // just finished active; else we're done.
        if (!includeArchived) {
          includeArchived = true;
          after = undefined;
          batchNumber = batchNumber + 1;
          continue;
        }
        setPhase("complete");
        router.refresh(); // pulled rows surface in library browse
        return;
      }

      after = r.nextAfter;
      batchNumber = batchNumber + 1;
    }
  }

  function handleStart() {
    reset();
    startTransition(() => {
      void runPullLoop(
        { after: undefined, batchNumber: 1, includeArchived: false },
        ZERO_TOTALS,
      );
    });
  }

  function handleRetry() {
    if (!retryCursor) return;
    setErrorMessage(null);
    setPhase(retryCursor.includeArchived ? "pulling-archived" : "pulling-active");
    startTransition(() => {
      void runPullLoop(retryCursor, totals);
    });
  }

  function handleClose() {
    if (isPulling) return; // can't close mid-pull
    reset();
  }

  return (
    <>
      <button
        type="button"
        className="a1v2-btn ghost sm"
        onClick={handleStart}
        disabled={disabled || pending || isPulling}
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
            if (e.target === e.currentTarget && !isPulling) handleClose();
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
                {phase === "complete"
                  ? "Pull complete"
                  : phase === "error"
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
                {phase === "pulling-active" && "Active products · pass 1 of 2"}
                {phase === "pulling-archived" && "Archived sweep · pass 2 of 2"}
                {phase === "complete" && "Both passes finished"}
                {phase === "error" && "Stopped — retry resumes from last batch"}
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
                <Stat label="Batches" value={totals.batchCount} />
                <Stat label="Added" value={totals.added} />
                <Stat label="Updated" value={totals.updated} />
                <Stat label="Archived" value={totals.archived} />
              </div>

              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: "var(--ink-2)",
                }}
              >
                {totals.processed} product
                {totals.processed === 1 ? "" : "s"} processed so far
              </div>

              {/* Latest batch breakdown */}
              {latestBatch && isPulling && (
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-4)",
                  }}
                >
                  Batch {totals.batchCount}: {latestBatch.processed} processed
                  {" · "}+{latestBatch.added} added · ~{latestBatch.updated}{" "}
                  updated · {latestBatch.archived} archived
                </div>
              )}

              {/* Error message */}
              {phase === "error" && errorMessage && (
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
                  {errorMessage}
                </div>
              )}

              {/* Completion summary */}
              {phase === "complete" && (
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
                  ✓ Pulled {totals.processed} HubSpot product
                  {totals.processed === 1 ? "" : "s"} into the library.{" "}
                  {totals.added} new · {totals.updated} updated ·{" "}
                  {totals.archived} archived.
                </div>
              )}
            </div>

            <div className="a1v2-modal-foot">
              {phase === "error" && (
                <button
                  type="button"
                  className="a1v2-btn primary sm"
                  onClick={handleRetry}
                  disabled={pending}
                >
                  Retry from batch {retryCursor?.batchNumber ?? "?"}
                </button>
              )}
              <button
                type="button"
                className="a1v2-btn ghost"
                onClick={handleClose}
                disabled={isPulling}
              >
                {phase === "complete" ? "Done" : "Close"}
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
