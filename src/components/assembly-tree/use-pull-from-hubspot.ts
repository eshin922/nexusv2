"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pullFromHubSpot } from "@/app/actions/hubspot-pull";

// slice-library-first-creation-flow Step 5 — controlled pull engine.
//
// Hook extracted from PullFromHubSpotTrigger so two consumers can
// drive their own UI off the same state machine:
//   1. PullFromHubSpotTrigger (legacy Setup-tree card-head modal —
//      removed in Step 6 when card-head simplifies to single CTA)
//   2. LibraryBrowseModal (Step 5 inline progress band in header,
//      avoiding three-deep modal stack per locked Q5 disposition β)
//
// Each call site holds its own hook instance + state. The hook
// owns the double-pull loop (active products → archived sweep),
// running totals, latest-batch breakdown, retry cursor, error
// surface, and router.refresh on completion.

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

  const isPulling =
    phase === "pulling-active" || phase === "pulling-archived";

  function reset() {
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
        if (!includeArchived) {
          includeArchived = true;
          after = undefined;
          batchNumber = batchNumber + 1;
          continue;
        }
        setPhase("complete");
        router.refresh();
        onComplete?.();
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
