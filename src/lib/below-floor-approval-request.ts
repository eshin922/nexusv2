// Below-floor approval REQUEST lifecycle — PURE RULES.
//
// Free of `server-only`, the database and the network, mirroring the
// attempt-lifecycle{,-rules} split, so "may this callback decide?" and "is this
// request still live?" are testable without either.
//
// THE BOUNDARY THIS MODULE DEFENDS. A request is not an authorization. It
// records who asked and what came back; only `below_floor_authorizations`
// satisfies the Send/Accept gates, and those gates are unchanged. Nothing here
// may become a second place where authority is decided.

export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "superseded"
  | "cancelled";

/** Orthogonal to status. A delivery state must never imply authorization. */
export type ApprovalDeliveryStatus = "pending" | "delivered" | "failed";

export const TERMINAL_STATUSES: readonly ApprovalRequestStatus[] = [
  "approved",
  "rejected",
  "superseded",
  "cancelled",
];

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface ApprovalRequestRecord {
  id: string;
  status: string;
  requestedByUserId: string;
  stateFingerprint: string;
}

export interface DecidingActor {
  userId: string;
  commercialApprover: boolean;
}

export type DecisionAction = "approve" | "reject";

export type DecisionVerdict =
  | { ok: true }
  | {
      ok: false;
      /** `already_decided` is a NO-OP, not an error — see `isNoOp`. */
      code:
        | "already_decided"
        | "superseded"
        | "not_approver"
        | "self_approval"
        | "reason_required";
      message: string;
    };

/**
 * A refusal that must not be surfaced as a failure.
 *
 * A duplicate Slack delivery, a retry and a double-click all arrive as a
 * decision against an already-terminal request. That is the system working, so
 * the caller re-syncs the Slack message to the durable disposition and changes
 * nothing — it does not tell the reviewer they did something wrong.
 */
export function isNoOp(verdict: DecisionVerdict): boolean {
  return verdict.ok === false && verdict.code === "already_decided";
}

/**
 * May this actor take this decision on this request, right now?
 *
 * ORDER OF REFUSAL IS DELIBERATE, and matches `evaluateBelowFloorAuthorization`:
 *
 *  1. already decided  — before anything else, because a settled request raises
 *     no question of authority or staleness; asking those first would report a
 *     permission problem for a request nobody can act on anyway.
 *  2. superseded       — a decision that cannot apply is not one anyone can be
 *     accused of self-approving. Naming self-approval on stale economics sends
 *     the operator to find a second person when they need a fresh request.
 *  3. authority        — the governed permission, never the role.
 *  4. self-approval    — requester ≠ reviewer.
 *  5. reason           — required on reject.
 *
 * Authority is NOT re-implemented here: callers pass the value read from the
 * database at decision time via `mayAuthorizeBelowFloor`.
 */
export function evaluateApprovalDecision(input: {
  request: ApprovalRequestRecord;
  actor: DecidingActor;
  action: DecisionAction;
  currentFingerprint: string;
  reason: string | null;
}): DecisionVerdict {
  const { request, actor, action, currentFingerprint, reason } = input;

  if (isTerminal(request.status)) {
    return {
      ok: false,
      code: "already_decided",
      message: `This request is already ${request.status}.`,
    };
  }

  if (request.stateFingerprint !== currentFingerprint) {
    return {
      ok: false,
      code: "superseded",
      message:
        "The quote's commercial state has changed since this request was raised. It can no longer be decided; a new request is required.",
    };
  }

  if (!actor.commercialApprover) {
    return {
      ok: false,
      code: "not_approver",
      message:
        "Commercial Approver authority is required. Administrator access does not confer it.",
    };
  }

  if (actor.userId === request.requestedByUserId) {
    return {
      ok: false,
      code: "self_approval",
      message: "A below-floor request cannot be decided by the person who raised it.",
    };
  }

  if (action === "reject" && (reason ?? "").trim() === "") {
    return {
      ok: false,
      code: "reason_required",
      message: "A reason is required to reject a below-floor request.",
    };
  }

  return { ok: true };
}

/**
 * The status a live request takes when its economics have moved.
 *
 * Superseding is a TRANSITION of the request, not merely a downstream gate
 * refusal. The Slack surface must stop presenting an obsolete request as
 * actionable; leaving it live and relying on Send to catch it later means a
 * reviewer can approve something that was never approvable.
 */
export function supersedeIfStale(input: {
  status: string;
  stateFingerprint: string;
  currentFingerprint: string;
}): { supersede: boolean } {
  return {
    supersede:
      input.status === "pending" &&
      input.stateFingerprint !== input.currentFingerprint,
  };
}

// ---------- Slack ↔ Nexus identity ----------

export interface SlackIdentityInput {
  /** Nexus user already bound to this Slack id, if any. */
  boundUser: { id: string; slackUserId: string | null } | null;
  /** Nexus user matching the Slack account's verified email, if any. */
  emailUser: { id: string; slackUserId: string | null } | null;
}

export type SlackIdentityResolution =
  | { ok: true; userId: string; bindNow: boolean }
  | {
      ok: false;
      code: "unmapped" | "binding_conflict" | "already_bound_elsewhere";
      message: string;
    };

/**
 * Resolve a Slack actor to a governed Nexus user. BINDING FIRST.
 *
 * Once bound, the binding decides and email is not consulted. An email change
 * is precisely the event that should STOP an automated remap, not trigger one —
 * silently following a changed address is how a Slack account inherits an
 * approver identity nobody granted it.
 *
 * Rebinding is an administrative act. Every disagreement fails closed.
 */
export function resolveSlackIdentity(
  input: SlackIdentityInput,
): SlackIdentityResolution {
  const { boundUser, emailUser } = input;

  if (boundUser) {
    // Bound wins outright. A disagreement is only reportable when the email
    // resolves to somebody — an unresolvable email is not evidence of anything.
    if (emailUser && emailUser.id !== boundUser.id) {
      return {
        ok: false,
        code: "binding_conflict",
        message:
          "This Slack account is bound to a different Nexus user than its email now resolves to. An administrator must reconcile the binding; it will not be remapped automatically.",
      };
    }
    return { ok: true, userId: boundUser.id, bindNow: false };
  }

  if (!emailUser) {
    return {
      ok: false,
      code: "unmapped",
      message:
        "This Slack account is not mapped to a Nexus user. Slack identity alone cannot authorize a below-floor decision.",
    };
  }

  if (emailUser.slackUserId) {
    // The Nexus user already answers to a DIFFERENT Slack account.
    return {
      ok: false,
      code: "already_bound_elsewhere",
      message:
        "The Nexus user for this email is already bound to a different Slack account. An administrator must reconcile the binding.",
    };
  }

  return { ok: true, userId: emailUser.id, bindNow: true };
}
