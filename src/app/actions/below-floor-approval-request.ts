"use server";

/**
 * The below-floor approval REQUEST lifecycle.
 *
 * A request authorizes nothing. `below_floor_authorizations` remains the only
 * thing the Send/Accept gates read, and those gates are unchanged; an approved
 * request PRODUCES an authorization row, and everything else produces none.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  belowFloorApprovalRequests,
  quoteTiers,
  quotes,
  users,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { authorizeBelowFloorAsUser } from "@/app/actions/below-floor-authorization";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { fingerprintCommercialState } from "@/lib/below-floor-authorization";
import {
  evaluateApprovalDecision,
  isNoOp,
  type DecisionAction,
} from "@/lib/below-floor-approval-request";

/** Current commercial state for one tier, from the governed engine. */
async function readTierState(quoteId: string, tierId: string) {
  const bundle = await getCostingBundle(quoteId);
  if (!bundle.ok) {
    throw new ActionGuardError(ERR.VALIDATION, "Could not read the quote's costing.");
  }
  const rollup = bundle.data.costing.quoteRollup.find((r) => r.tierId === tierId);
  if (!rollup) {
    throw new ActionGuardError(ERR.VALIDATION, "No costing rollup for this tier.");
  }
  return {
    rollup,
    floorPct: bundle.data.costing.firmSettings.floorMarginPct,
    fingerprint: fingerprintCommercialState({
      totalRevenue: rollup.totalRevenue,
      totalCost: rollup.totalCost,
      blendedMarginPct: rollup.blendedMarginPct,
    }),
  };
}

export interface RequestBelowFloorApprovalInput {
  quoteId: string;
  tierId: string;
  justification: string;
}

/**
 * Raise a request. Session-bound: Clerk establishes the requester.
 *
 * Delivery is attempted but never gates creation — a request that Slack refused
 * is still a governed record, and the operator can see it failed and contact
 * the approver directly. Delivery failure must never become authorization, and
 * it equally must never lose the request.
 */
export async function requestBelowFloorApproval(
  input: RequestBelowFloorApprovalInput,
): Promise<ActionResult<{ requestId: string; delivered: boolean }>> {
  return runAction(async () => {
    const actor = await ensureUser();

    const justification = input.justification?.trim() ?? "";
    if (justification === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "A justification is required to request a below-floor approval.",
      );
    }

    const [quote] = await db
      .select({ id: quotes.id, versionNumber: quotes.versionNumber })
      .from(quotes)
      .where(eq(quotes.id, input.quoteId))
      .limit(1);
    if (!quote) throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found.");

    const [tier] = await db
      .select({ id: quoteTiers.id, label: quoteTiers.label })
      .from(quoteTiers)
      .where(and(eq(quoteTiers.id, input.tierId), eq(quoteTiers.quoteId, quote.id)))
      .limit(1);
    if (!tier) throw new ActionGuardError(ERR.NOT_FOUND, "Tier not found on this quote.");

    const state = await readTierState(quote.id, tier.id);

    // Same refusal the authorization makes: a request on a compliant tier is a
    // permission nobody needs, waiting for the price to drop.
    if (state.rollup.blendedMarginStatus !== "BELOW_FLOOR") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `${tier.label} is not below the margin floor; no approval is needed.`,
      );
    }

    let requestId: string;
    try {
      const [row] = await db
        .insert(belowFloorApprovalRequests)
        .values({
          quoteId: quote.id,
          quoteVersionNumber: quote.versionNumber,
          tierId: tier.id,
          requestedByUserId: actor.id,
          justification,
          stateFingerprint: state.fingerprint,
          marginAtRequest: String(state.rollup.blendedMarginPct ?? 0),
          floorAtRequest: String(state.floorPct),
          status: "pending",
        })
        .returning({ id: belowFloorApprovalRequests.id });
      requestId = row.id;
    } catch {
      // The partial unique index refused a second live request for this scope.
      throw new ActionGuardError(
        ERR.VALIDATION,
        `${tier.label} already has an open below-floor approval request.`,
      );
    }

    await writeAuditEntry({
      userId: actor.id,
      entityType: "quote",
      entityId: quote.id,
      action: "below_floor_approval_requested",
      summary: `Below-floor approval requested for ${tier.label}`,
      diffJson: {
        request_id: requestId,
        tier_id: tier.id,
        tier_label: tier.label,
        quote_version_number: quote.versionNumber,
        margin_at_request: state.rollup.blendedMarginPct,
        floor_at_request: state.floorPct,
        state_fingerprint: state.fingerprint,
        justification,
      },
    });

    // Delivery is deliberately OUTSIDE the governed record's success.
    const delivered = await deliverRequestToSlack(requestId).catch(() => false);
    return { requestId, delivered };
  });
}

/**
 * Post the request to the governed Slack channel.
 *
 * Returns false — never throws to the caller — when Slack is unconfigured or
 * refuses. The request stays `pending` with `delivery_status='failed'`, which
 * authorizes nothing.
 */
async function deliverRequestToSlack(requestId: string): Promise<boolean> {
  const { deliverBelowFloorRequest } = await import("@/lib/slack/deliver-approval");
  return deliverBelowFloorRequest(requestId);
}

export interface DecideBelowFloorApprovalInput {
  requestId: string;
  action: DecisionAction;
  reason: string | null;
  /**
   * An ALREADY-AUTHENTICATED governed identity. For Slack that means a verified
   * signature and a durable `users.slack_user_id` binding, established at the
   * route boundary. Never a caller-nominated id.
   */
  actorUserId: string;
}

export type DecideOutcome =
  | { kind: "decided"; status: "approved" | "rejected"; authorizationId: string | null }
  | { kind: "superseded" }
  | { kind: "noop"; status: string }
  | { kind: "refused"; code: string; message: string };

/**
 * Approve or reject. Idempotent by REQUEST IDENTITY AND STATUS.
 *
 * ORDER IS LOAD-BEARING: the decision is CLAIMED with a conditional update
 * before any authorization is written. A retry that loses the claim affects
 * zero rows and therefore never reaches the authorization insert.
 *
 * The reverse order — authorize, then claim — would let a duplicate callback
 * write a second authorization and only afterwards discover it had lost, and a
 * stray authorization is precisely what satisfies the Send gate. Claiming first
 * makes the failure mode "an approved request whose authorization is missing",
 * which is fail-closed: the gate reads authorizations, so Send stays blocked.
 */
export async function decideBelowFloorApproval(
  input: DecideBelowFloorApprovalInput,
): Promise<DecideOutcome> {
  const [request] = await db
    .select()
    .from(belowFloorApprovalRequests)
    .where(eq(belowFloorApprovalRequests.id, input.requestId))
    .limit(1);
  if (!request) {
    return { kind: "refused", code: "not_found", message: "Approval request not found." };
  }

  const [actor] = await db
    .select({ id: users.id, commercialApprover: users.commercialApprover })
    .from(users)
    .where(eq(users.id, input.actorUserId))
    .limit(1);
  if (!actor) {
    return { kind: "refused", code: "unmapped", message: "Deciding user not found." };
  }

  const state = await readTierState(request.quoteId, request.tierId);

  const verdict = evaluateApprovalDecision({
    request: {
      id: request.id,
      status: request.status,
      requestedByUserId: request.requestedByUserId,
      stateFingerprint: request.stateFingerprint,
    },
    actor: { userId: actor.id, commercialApprover: actor.commercialApprover },
    action: input.action,
    currentFingerprint: state.fingerprint,
    reason: input.reason,
  });

  if (!verdict.ok) {
    if (isNoOp(verdict)) return { kind: "noop", status: request.status };

    if (verdict.code === "superseded") {
      // A TRANSITION, not merely a refusal. The Slack surface must stop
      // presenting an obsolete request as live; leaving it pending and relying
      // on the Send gate to catch it later lets a reviewer approve something
      // that was never approvable.
      await db
        .update(belowFloorApprovalRequests)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(belowFloorApprovalRequests.id, request.id),
            eq(belowFloorApprovalRequests.status, "pending"),
          ),
        );
      await writeAuditEntry({
        userId: actor.id,
        entityType: "quote",
        entityId: request.quoteId,
        action: "below_floor_approval_superseded",
        summary: "Below-floor approval request superseded by a commercial change",
        diffJson: {
          request_id: request.id,
          fingerprint_at_request: request.stateFingerprint,
          fingerprint_now: state.fingerprint,
        },
      });
      return { kind: "superseded" };
    }
    return { kind: "refused", code: verdict.code, message: verdict.message };
  }

  const decidedAt = new Date();
  const nextStatus = input.action === "approve" ? "approved" : "rejected";

  // CLAIM. Zero rows ⇒ someone or something already decided this.
  const claimed = await db
    .update(belowFloorApprovalRequests)
    .set({
      status: nextStatus,
      decidedByUserId: actor.id,
      decidedAt,
      decisionReason: input.reason?.trim() || null,
      updatedAt: decidedAt,
    })
    .where(
      and(
        eq(belowFloorApprovalRequests.id, request.id),
        eq(belowFloorApprovalRequests.status, "pending"),
      ),
    )
    .returning({ id: belowFloorApprovalRequests.id });

  if (claimed.length === 0) {
    const [fresh] = await db
      .select({ status: belowFloorApprovalRequests.status })
      .from(belowFloorApprovalRequests)
      .where(eq(belowFloorApprovalRequests.id, request.id))
      .limit(1);
    return { kind: "noop", status: fresh?.status ?? "unknown" };
  }

  let authorizationId: string | null = null;
  if (input.action === "approve") {
    // The governed decision, through the shared Track A core. Authority is
    // re-read from the database inside it — this call site does not confer it.
    const result = await authorizeBelowFloorAsUser({
      quoteId: request.quoteId,
      tierId: request.tierId,
      // A reason is mandatory on the authorization. When the approver adds no
      // note, the record states plainly that they endorsed the requester's
      // stated justification rather than inventing a rationale for them.
      reason:
        input.reason?.trim() ||
        `Approved via Slack — endorsing the requester's justification: ${request.justification}`,
      actorUserId: actor.id,
    });
    authorizationId = result.authorizationId;
    await db
      .update(belowFloorApprovalRequests)
      .set({ authorizationId, updatedAt: new Date() })
      .where(eq(belowFloorApprovalRequests.id, request.id));
  }

  await writeAuditEntry({
    userId: actor.id,
    entityType: "quote",
    entityId: request.quoteId,
    action:
      input.action === "approve"
        ? "below_floor_approval_approved"
        : "below_floor_approval_rejected",
    summary: `Below-floor approval request ${nextStatus}`,
    diffJson: {
      request_id: request.id,
      authorization_id: authorizationId,
      decided_by_user_id: actor.id,
      decision_reason: input.reason?.trim() || null,
      state_fingerprint: request.stateFingerprint,
      source: "slack",
    },
  });

  return { kind: "decided", status: nextStatus, authorizationId };
}
