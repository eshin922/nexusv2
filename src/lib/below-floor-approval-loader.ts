// Server-side read for the Pricing surface's approval state.
//
// Deliberately its OWN loader rather than a field on the costing bundle: the
// bundle is the commercial computation, and approval is workflow state that
// changes independently of it. Keeping them separate is what lets the classifier
// stay a pure function of commercial inputs.
//
// READ ONLY. Nothing here decides, writes or authorizes.

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { belowFloorApprovalRequests, belowFloorAuthorizations } from "@/db/schema";
import {
  projectApprovalTierState,
  type ApprovalTierState,
} from "./below-floor-approval-state";
import { loadQuoteOperator } from "./quote-operator";

export interface ApprovalStateByTier {
  /** tierId → operator-visible state. Absent tier ⇒ `{ kind: "none" }`. */
  states: Record<string, ApprovalTierState>;
}

/**
 * Project approval state for every tier of one quote version.
 *
 * `fingerprintByTier` must come from the SAME costing read the page renders, or
 * the projection could call an approval current against economics the operator
 * is not looking at.
 */
export async function loadApprovalStateByTier(args: {
  quoteId: string;
  quoteVersionNumber: number;
  fingerprintByTier: ReadonlyMap<string, string>;
}): Promise<ApprovalStateByTier> {
  // The operator of record, read through the one reader the gates use.
  const operatorUserId = await loadQuoteOperator(args.quoteId);

  const [requests, authorizations] = await Promise.all([
    db
      .select({
        id: belowFloorApprovalRequests.id,
        tierId: belowFloorApprovalRequests.tierId,
        quoteVersionNumber: belowFloorApprovalRequests.quoteVersionNumber,
        status: belowFloorApprovalRequests.status,
        stateFingerprint: belowFloorApprovalRequests.stateFingerprint,
        requestedAt: belowFloorApprovalRequests.requestedAt,
        decidedAt: belowFloorApprovalRequests.decidedAt,
        decisionReason: belowFloorApprovalRequests.decisionReason,
        deliveryStatus: belowFloorApprovalRequests.deliveryStatus,
        authorizationId: belowFloorApprovalRequests.authorizationId,
      })
      .from(belowFloorApprovalRequests)
      .where(eq(belowFloorApprovalRequests.quoteId, args.quoteId)),
    db
      .select({
        id: belowFloorAuthorizations.id,
        tierId: belowFloorAuthorizations.tierId,
        quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
        approvedByUserId: belowFloorAuthorizations.approvedByUserId,
        stateFingerprint: belowFloorAuthorizations.stateFingerprint,
        invalidatedAt: belowFloorAuthorizations.invalidatedAt,
      })
      .from(belowFloorAuthorizations)
      .where(eq(belowFloorAuthorizations.quoteId, args.quoteId)),
  ]);

  const states: Record<string, ApprovalTierState> = {};
  for (const [tierId, currentFingerprint] of args.fingerprintByTier) {
    states[tierId] = projectApprovalTierState({
      tierId,
      quoteVersionNumber: args.quoteVersionNumber,
      currentFingerprint,
      requests,
      authorizations,
      operatorUserId,
    });
  }
  return { states };
}
