"use server";

import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { assertCanCreateLeaves } from "@/lib/spec-permission-guard";
import { pullProductsBatch } from "@/lib/hubspot-pull";
import { revalidatePath } from "next/cache";

// slice-hubspot-bidirectional — `pullFromHubSpot` server action.
//
// Thin wrapper around `pullProductsBatch` (src/lib/hubspot-pull.ts)
// that the Setup-tree button (Step 6) calls in a loop. One action
// invocation = one batch (≤100 products). Client iterates with the
// returned `nextAfter` cursor and runs the double-pull
// (active products then archived sweep).
//
// Permission: gated by `assertCanCreateLeaves` (Path B per
// Architect Gate 5) — same gate as `createLeaf`. Admin implicit-
// passes. Library leaves are globally scoped; pull writes
// project-agnostic rows but the projectId is captured on the
// `hubspot_pull_batch` audit row as the surface-of-origin
// (which project's Setup tree triggered the pull).
//
// Returns the batch summary for client-side progress UI:
//   - processed: number of HubSpot products visited this batch
//   - added / updated / archivedCount: per-batch deltas
//   - nextAfter: pagination cursor (null = pass complete)
//   - rootAuditId: the `hubspot_pull_batch` audit row id, useful
//     for cross-referencing audit-log queries from the UI

export type PullFromHubSpotInput = {
  projectId: string;
  after?: string;
  batchNumber: number;
  includeArchived: boolean;
};

export type PullFromHubSpotResult = {
  processed: number;
  added: number;
  updated: number;
  archivedCount: number;
  nextAfter: string | null;
  rootAuditId: string;
  timings: {
    hubspotMs: number;
    lookupMs: number;
    databaseMs: number;
    revalidationMs: number;
    totalMs: number;
  };
};

export async function pullFromHubSpot(
  input: PullFromHubSpotInput,
): Promise<ActionResult<PullFromHubSpotResult>> {
  return runAction(async () => {
    const actionStartedAt = performance.now();
    const { projectId, after, batchNumber, includeArchived } = input;
    if (!projectId)
      throw new ActionGuardError(ERR.VALIDATION, "projectId required");
    if (typeof batchNumber !== "number" || batchNumber < 1)
      throw new ActionGuardError(ERR.VALIDATION, "batchNumber required (>= 1)");

    const user = await assertCanCreateLeaves();

    let result;
    try {
      result = await pullProductsBatch({
        userId: user.id,
        projectId,
        after,
        batchNumber,
        includeArchived,
      });
    } catch (error) {
      console.error("hubspot_product_refresh_batch_failed", {
        projectId,
        batchNumber,
        includeArchived,
        error: error instanceof Error ? error.message : "Unknown refresh failure",
      });
      throw new ActionGuardError(
        ERR.HUBSPOT,
        "Product refresh failed. No changes were saved for this batch; retry resumes from the same batch.",
      );
    }

    // Revalidate library-list surfaces so pulled rows surface in
    // the library browse modal + assembly tree dropdowns. Setup
    // tree itself doesn't render the global library directly
    // (assemblies + attached leaves only), but library browse
    // modal lives at the Setup-page level and benefits from the
    // revalidation.
    const revalidationStartedAt = performance.now();
    revalidatePath("/projects/[id]/quotes/[quoteId]/setup", "page");
    const revalidationMs = Math.round(performance.now() - revalidationStartedAt);

    return {
      ...result,
      timings: {
        ...result.timings,
        revalidationMs,
        totalMs: Math.round(performance.now() - actionStartedAt),
      },
    };
  });
}
