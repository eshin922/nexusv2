/**
 * BV-005 1c — the governed below-floor override, as pure decision logic.
 *
 * Acceptance and completion block below the firm's margin floor. This module is
 * the only thing that can say otherwise, and it says so by rule rather than by
 * exception: every gate calls the same function and gets the same verdict, so
 * "may this proceed" has one answer rather than one per call site.
 *
 * PURE, AND DELIBERATELY SO. No database, no session, no clock. Everything the
 * decision needs arrives as an argument, which is what lets the nine required
 * proofs be unit tests over a function rather than a walk through two surfaces
 * — including the ones the current estate cannot stage, such as an independent
 * approver, because production holds three user rows that are all one person.
 *
 * WHAT IT DOES NOT DO. It does not relax the floor, it does not decide who may
 * approve on any basis other than the governed permission, and it never returns
 * a permissive verdict for the absence of evidence. There is no branch in which
 * "nobody could have approved this" resolves to yes.
 */

/** The scope an authorization is bound to. BV-005: one quote, one version, one tier. */
export interface AuthorizationScope {
  quoteVersionNumber: number;
  tierId: string;
}

/** A decision as stored. Mirrors `below_floor_authorizations`. */
export interface BelowFloorAuthorizationRecord extends AuthorizationScope {
  id: string;
  approvedByUserId: string;
  stateFingerprint: string;
  invalidatedAt: Date | string | null;
}

/**
 * The quote VERSION's commercial operator - `quotes.created_by_user_id`.
 *
 * THE SEPARATION OF DUTIES, corrected 2026-08-22. The rule was previously "the
 * approver may not be the person who pressed Request approval", which was a
 * PROXY for this and enforced the wrong relationship: designated approvers are
 * not quote operators, so an approver who merely routed a PM's request was
 * permanently barred from deciding it, while an operator who had someone else
 * raise the request was not.
 *
 * `created_by_user_id` is used because it is the only durable, per-version
 * actor recording who built THIS version's economics - measured at 79 of 89
 * quotes populated, against 9% for `projects.pm_user_id` (which no UI writes)
 * and 15% for `sales_rep_user_id` (a commercial relationship, not authorship).
 * A revision writes a fresh row, so responsibility follows the version, which
 * is the granularity an authorization is already bound to.
 *
 * `null` is NOT permission. An unidentifiable operator refuses.
 */
export type QuoteOperator = string | null;

/** Only what authority depends on - nothing else about the user is relevant. */
export interface ApproverIdentity {
  id: string;
  commercialApprover: boolean;
  /** Present so the tests can prove it is NOT consulted. */
  role?: string;
}

export type BelowFloorBlockCode =
  | "NO_AUTHORIZATION"
  | "INVALIDATED"
  | "STATE_CHANGED"
  /** The approver is the quote version's commercial operator. */
  | "OPERATOR_APPROVAL"
  /** No operator of record, so independence cannot be established at all. */
  | "OPERATOR_UNKNOWN";

export type BelowFloorVerdict =
  | { ok: true; authorizationId: string }
  | { ok: false; code: BelowFloorBlockCode; message: string };

/**
 * May this user authorize a below-floor quote?
 *
 * The governed permission, and ONLY the governed permission. `role` is accepted
 * in the argument and never read: BV-005 states authority "must not be
 * hardcoded to the `admin` role", and the cheapest way for that to erode is for
 * someone to add `|| user.role === "admin"` to a helper that already has the
 * role in hand. It is in the type so a test can assert the omission.
 */
export function mayAuthorizeBelowFloor(user: ApproverIdentity): boolean {
  return user.commercialApprover === true;
}

/**
 * The material commercial state, fingerprinted.
 *
 * BV-005 requires that material commercial change invalidate an authorization.
 * "Material" is defined ONCE, here, rather than at each gate — two gates
 * deciding separately is how one word comes to mean two things.
 *
 * The terms are the tier's revenue, its cost, and the resulting margin. Revenue
 * and cost between them move under every lever an operator has — price
 * adjustment, surgical lift, PM override, any cost edit — so a change the
 * customer would notice cannot leave this string untouched. Margin is included
 * although it is derivable, because it is the quantity the floor is expressed
 * in and a fingerprint that omitted it would be legible only to a machine.
 *
 * Rounded to the cent and to a hundredth of a basis point. Float noise is not a
 * commercial change, and invalidating an approval because the tenth decimal
 * moved would teach operators that invalidation is noise.
 */
export function fingerprintCommercialState(input: {
  totalRevenue: number;
  totalCost: number;
  blendedMarginPct: number | null;
}): string {
  const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const pct =
    input.blendedMarginPct === null
      ? "null"
      : (Math.round(input.blendedMarginPct * 1e6) / 1e6).toFixed(6);
  return `rev:${money(input.totalRevenue)}|cost:${money(input.totalCost)}|margin:${pct}`;
}

/**
 * Is there a valid, independent authorization for this quote version and tier?
 *
 * Independence is measured against the quote's COMMERCIAL OPERATOR - the person
 * who built the economics - not against whoever happens to be acting.
 *
 * WHY `actingUserId` IS GONE. It used to refuse when the approver was also the
 * person recording acceptance. That barred an approver from committing someone
 * else's properly authorized quote, which no policy asks for, and it made the
 * verdict depend on who was holding the mouse rather than on who owned the
 * pricing. The separation of duties is between AUTHORSHIP and APPROVAL, and
 * nothing about it concerns who commits the result.
 *
 * Order of refusal is deliberate. Scope, invalidation and staleness come first,
 * because a decision that does not apply is not one anyone can be accused of
 * approving for themselves; naming an operator conflict on a stale record would
 * send an operator to find a second person when what they need is a fresh
 * decision.
 *
 * Operator-unknown then precedes the independence test, because with no
 * operator of record the question cannot be answered at all - and an
 * unanswerable separation-of-duties question fails closed.
 */
export function evaluateBelowFloorAuthorization(input: {
  authorizations: readonly BelowFloorAuthorizationRecord[];
  scope: AuthorizationScope;
  currentFingerprint: string;
  /** `quotes.created_by_user_id`. Null refuses; it is never inferred. */
  operatorUserId: QuoteOperator;
}): BelowFloorVerdict {
  const inScope = input.authorizations.filter(
    (a) =>
      a.quoteVersionNumber === input.scope.quoteVersionNumber &&
      a.tierId === input.scope.tierId,
  );

  if (inScope.length === 0) {
    return {
      ok: false,
      code: "NO_AUTHORIZATION",
      message:
        "This tier is below the firm's margin floor. An authorized commercial approver, other than whoever priced this quote, must authorize it first.",
    };
  }

  const live = inScope.filter((a) => a.invalidatedAt === null);
  if (live.length === 0) {
    return {
      ok: false,
      code: "INVALIDATED",
      message:
        "The below-floor authorization for this tier has been invalidated. A new authorization is required.",
    };
  }

  // Any live authorization matching the current state will do; there is no
  // quorum, so one is sufficient and the rest are history.
  const matching = live.filter(
    (a) => a.stateFingerprint === input.currentFingerprint,
  );
  if (matching.length === 0) {
    return {
      ok: false,
      code: "STATE_CHANGED",
      message:
        "The quote's commercial state has changed since it was authorized. The previous authorization no longer applies; a new one is required.",
    };
  }

  // OPERATOR OF RECORD. Absence is not permission: with nobody identified as
  // responsible for this version's economics there is no relationship to be
  // independent OF, and the only safe answer is no.
  if (input.operatorUserId === null) {
    return {
      ok: false,
      code: "OPERATOR_UNKNOWN",
      message:
        "This quote has no recorded commercial operator, so approval independence cannot be established. It cannot proceed below floor.",
    };
  }

  // INDEPENDENCE. The approver may not be the person who built the pricing.
  //
  // NO FALLBACK. There is deliberately no branch relaxing this when the
  // operator is the only approver available: an estate where the person pricing
  // is also the only one who can approve is an estate that cannot sell below
  // floor, which is the correct outcome and not an edge case to route around.
  const independent = matching.filter(
    (a) => a.approvedByUserId !== input.operatorUserId,
  );
  if (independent.length === 0) {
    return {
      ok: false,
      code: "OPERATOR_APPROVAL",
      message:
        "This below-floor tier was authorized by the same person who priced the quote. An independent commercial approver must authorize it.",
    };
  }

  return { ok: true, authorizationId: independent[0].id };
}
