"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pullFromHubSpot } from "@/app/actions/hubspot-pull";

// slice-library-first-creation-flow Step 5 — controlled pull engine.
//
// Hook owns the full double-pull loop (active products → archived
// sweep) + running totals + latest-batch breakdown + retry cursor +
// error surface + router.refresh on completion.
//
// Active consumer (v1):
//   - LibraryBrowseModal (Step 5 inline progress band in modal
//     header — locked Q5 disposition β; avoids the three-deep
//     modal stack a nested overlay would create)
//
// Originally extracted from PullFromHubSpotTrigger (deleted in
// Step 6 when the Setup card-head consolidated to a single
// + Add component → CTA). Hook shape preserved as a stable
// API surface for any future flow that needs Pull progress
// state without re-implementing the loop.

export type PullPhase =
  | "idle"
  | "pulling-active"
  | "pulling-archived"
  | "complete"
  | "error";

export type PullTotals = {
  processed: number;
  added: number;
  updated: number;
  archived: number;
  batchCount: number;
};

export type PullLatestBatch = {
  processed: number;
  added: number;
  updated: number;
  archived: number;
};

export type PullRetryCursor = {
  after?: string;
  batchNumber: number;
  includeArchived: boolean;
};

export type PullController = {
  phase: PullPhase;
  totals: PullTotals;
  latestBatch: PullLatestBatch | null;
  errorMessage: string | null;
  retryCursor: PullRetryCursor | null;
  isPulling: boolean;
  pending: boolean;
  start: () => void;
  retry: () => void;
  reset: () => void;
};

const ZERO_TOTALS: PullTotals = {
  processed: 0,
  added: 0,
  updated: 0,
  archived: 0,
  batchCount: 0,
};

export function usePullFromHubSpot(opts: {
  projectId: string;
  // Optional hook called after the pull completes successfully
  // (router.refresh fires regardless; this is for consumer-specific
  // side effects like refreshing the library browse rows).
  onComplete?: () => void;
}): PullController {
  const { projectId, onComplete } = opts;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<PullPhase>("idle");
  const [totals, setTotals] = useState<PullTotals>(ZERO_TOTALS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<PullRetryCursor | null>(null);
  const [latestBatch, setLatestBatch] = useState<PullLatestBatch | null>(null);
  const pullInFlightRef = useRef(false);

  const isPulling =
    phase === "pulling-active" || phase === "pulling-archived";

  function reset() {
    pullInFlightRef.current = false;
    setPhase("idle");
    setTotals(ZERO_TOTALS);
    setErrorMessage(null);
    setRetryCursor(null);
    setLatestBatch(null);
  }

  async function runPullLoop(start: PullRetryCursor, runningTotals: PullTotals) {
    // Local copies so React batched-state updates don't trip the
    // loop iteration logic.
    let after: string | undefined = start.after;
    let batchNumber = start.batchNumber;
    let includeArchived = start.includeArchived;
    let acc = runningTotals;

    while (true) {
      setPhase(includeArchived ? "pulling-archived" : "pulling-active");
      const requestStartedAt = performance.now();
      const result = await pullFromHubSpot({
        projectId,
        after,
        batchNumber,
        includeArchived,
      });

      if (!result.ok) {
        setErrorMessage(result.error.message);
        setRetryCursor({ after, batchNumber, includeArchived });
        setPhase("error");
        pullInFlightRef.current = false;
        return;
      }

      const r = result.data;
      console.info("hubspot_product_refresh_client_batch", {
        batchNumber,
        includeArchived,
        clientRoundTripMs: Math.round(performance.now() - requestStartedAt),
        serverTimings: r.timings,
      });
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
        if (!includeArchived) {
          includeArchived = true;
          after = undefined;
          batchNumber = batchNumber + 1;
          continue;
        }
        setPhase("complete");
        pullInFlightRef.current = false;
        router.refresh();
        onComplete?.();
        return;
      }

      after = r.nextAfter;
      batchNumber = batchNumber + 1;
    }
  }

  function handleStart() {
    if (pullInFlightRef.current) return;
    const clickedAt = performance.now();
    console.info("hubspot_product_refresh_click", { atMs: Math.round(clickedAt) });
    reset();
    pullInFlightRef.current = true;
    // PVS-020: publish pending feedback in the click event itself. State set
    // inside startTransition can be deferred until the first server action
    // yields, which made the refresh appear inert during its slowest interval.
    setPhase("pulling-active");
    requestAnimationFrame(() => {
      console.info("hubspot_product_refresh_first_visible_feedback", {
        elapsedMs: Math.round(performance.now() - clickedAt),
      });
    });
    startTransition(() => {
      void runPullLoop(
        { after: undefined, batchNumber: 1, includeArchived: false },
        ZERO_TOTALS,
      );
    });
  }

  function handleRetry() {
    if (!retryCursor || pullInFlightRef.current) return;
    pullInFlightRef.current = true;
    setErrorMessage(null);
    setPhase(
      retryCursor.includeArchived ? "pulling-archived" : "pulling-active",
    );
    startTransition(() => {
      void runPullLoop(retryCursor, totals);
    });
  }

  return {
    phase,
    totals,
    latestBatch,
    errorMessage,
    retryCursor,
    isPulling,
    pending,
    start: handleStart,
    retry: handleRetry,
    reset,
  };
}
