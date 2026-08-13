// Operator-visible approval state for the Pricing surface — PURE PROJECTION.
//
// WHY THIS IS NOT IN `pricing-classifier.ts`. The classifier is a synchronous
// function over commercial inputs: given costs, prices and policy it returns
// what the quote IS. Approval is asynchronous workflow state that lives in two
// other tables and changes when nobody is looking at the page. Folding it in
// would make the classifier own persistence it has no business querying, and
// would couple every pricing verdict to a workflow that can be absent, pending,
// stale or refused.
//
// So this projects workflow state separately, and the surface composes the two.
//
// IT DECIDES NOTHING. `below_floor_authorizations` remains the only thing the
// acceptance gate reads. This says what to SHOW; the gate says what is allowed.

import type { ApprovalRequestStatus } from "./below-floor-approval-request";

export interface ApprovalRequestRow {
  id: string;
  tierId: string;
  quoteVersionNumber: number;
  status: string;
  stateFingerprint: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  deliveryStatus: string;
  authorizationId: string | null;
}

export interface AuthorizationRow {
  id: string;
  tierId: string;
  quoteVersionNumber: number;
  stateFingerprint: string;
  invalidatedAt: Date | null;
}

/**
 * What the operator sees for one tier.
 *
 * `cancelled` and any expiry concept are deliberately absent — neither is
 * implemented, and a UI state for an unreachable transition is a promise the
 * system cannot keep.
 */
export type ApprovalTierState =
  /** No request has been raised. The existing Request action stays eligible. */
  | { kind: "none" }
  /** Raised, undecided. The Request action must NOT remain actionable. */
  | { kind: "pending"; requestId: string; requestedAt: Date; delivered: boolean }
  /** Decided approve AND still valid for the current commercial state. */
  | { kind: "approved"; requestId: string; authorizationId: string; decidedAt: Date | null }
  /** Decided reject. Durable. A new request is permitted. */
  | { kind: "rejected"; requestId: string; reason: string | null; decidedAt: Date | null }
  /**
   * The commercial state moved out from under the request or its approval.
   * Covers a request superseded before decision AND an approval whose
   * fingerprint no longer matches — both leave the operator in the same place:
   * proceed from current economics, raise a fresh request if still needed.
   */
  | { kind: "superseded"; requestId: string | null };

/**
 * Project one tier's state.
 *
 * ORDER MATTERS, and mirrors the acceptance gate's own precedence: scope and
 * staleness are settled before anything else, because a decision that no longer
 * applies should not be shown as an outcome the operator can rely on.
 *
 * CONSISTENCY WITH THE GATE. `approved` is reported only when a live
 * authorization matches THIS version, THIS tier and the CURRENT fingerprint and
 * is not invalidated — the same three conditions `evaluateBelowFloorAuthorization`
 * checks before it reaches independence. The fourth condition, self-approval, is
 * deliberately NOT projected: it depends on who will record acceptance, which is
 * unknown at render time. Showing "approved" here therefore means "a valid
 * authorization exists", never "you personally may proceed" — the gate remains
 * the only thing that answers that.
 */
export function projectApprovalTierState(input: {
  tierId: string;
  quoteVersionNumber: number;
  currentFingerprint: string;
  requests: readonly ApprovalRequestRow[];
  authorizations: readonly AuthorizationRow[];
}): ApprovalTierState {
  const { tierId, quoteVersionNumber, currentFingerprint } = input;

  const inScope = <T extends { tierId: string; quoteVersionNumber: number }>(r: T) =>
    r.tierId === tierId && r.quoteVersionNumber === quoteVersionNumber;

  // 1 · A live, current authorization outranks everything. It is the thing the
  //     gate actually reads.
  const liveAuth = input.authorizations
    .filter(inScope)
    .find((a) => a.invalidatedAt === null && a.stateFingerprint === currentFingerprint);
  if (liveAuth) {
    const req = input.requests
      .filter(inScope)
      .find((r) => r.authorizationId === liveAuth.id);
    return {
      kind: "approved",
      requestId: req?.id ?? liveAuth.id,
      authorizationId: liveAuth.id,
      decidedAt: req?.decidedAt ?? null,
    };
  }

  // 2 · An approval that no longer matches current economics is NOT approval.
  //     Reported as superseded rather than approved, because the gate will
  //     refuse it and the operator needs to know that before acceptance.
  const staleAuth = input.authorizations
    .filter(inScope)
    .find((a) => a.invalidatedAt === null && a.stateFingerprint !== currentFingerprint);

  const requests = input.requests.filter(inScope);
  const pending = requests.find((r) => r.status === "pending");

  if (pending) {
    // A pending request whose fingerprint has already moved is stale in fact,
    // even though nothing has transitioned it yet — the decision path will
    // supersede it on arrival. Say so now rather than showing a live request
    // that cannot succeed.
    if (pending.stateFingerprint !== currentFingerprint) {
      return { kind: "superseded", requestId: pending.id };
    }
    return {
      kind: "pending",
      requestId: pending.id,
      requestedAt: pending.requestedAt,
      delivered: pending.deliveryStatus === "delivered",
    };
  }

  if (staleAuth) return { kind: "superseded", requestId: null };

  // 3 · Most recent terminal decision, by decision time.
  const decided = requests
    .filter((r) => r.status === "rejected" || r.status === "superseded" || r.status === "approved")
    .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];

  if (!decided) return { kind: "none" };

  if (decided.status === "rejected") {
    return {
      kind: "rejected",
      requestId: decided.id,
      reason: decided.decisionReason,
      decidedAt: decided.decidedAt,
    };
  }
  // `approved` reaching here means its authorization is gone or invalidated —
  // treated as superseded, not approved, for the same reason as case 2.
  return { kind: "superseded", requestId: decided.id };
}

/** True when the existing Request action should remain actionable. */
export function mayRequestApproval(state: ApprovalTierState): boolean {
  return state.kind === "none" || state.kind === "rejected" || state.kind === "superseded";
}

export type { ApprovalRequestStatus };
