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

/** Only what authority depends on — nothing else about the user is relevant. */
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
  | "SELF_APPROVAL";

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
 * Is there a valid, independent authorization for this actor to proceed?
 *
 * `actingUserId` is the user performing the GATED ACTION — recording acceptance,
 * or completing. That is what "self-approval" is measured against: not who
 * drafted the quote, which the system knows only indirectly, but who is about
 * to commit the below-floor outcome. The person who authorised it may not also
 * be the person who acts on it.
 *
 * Order of refusal is deliberate. Scope and invalidation come first because a
 * decision that does not apply is not a decision anyone can be accused of
 * self-approving; naming self-approval on a stale record would tell an operator
 * to find a second person when what they actually need is a fresh decision.
 */
export function evaluateBelowFloorAuthorization(input: {
  authorizations: readonly BelowFloorAuthorizationRecord[];
  scope: AuthorizationScope;
  currentFingerprint: string;
  actingUserId: string;
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
        "This tier is below the firm's margin floor. A Commercial Approver other than you must authorize it before acceptance can be recorded.",
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

  // INDEPENDENCE. Checked here rather than at authorization time because the
  // acting user is not known then — an approver may legitimately authorize a
  // deal that someone else goes on to accept.
  //
  // NO FALLBACK. There is deliberately no branch that relaxes this when no
  // other approver exists: an estate with one approver is an estate that cannot
  // sell below floor, which is the correct outcome and not an edge case to
  // route around.
  const independent = matching.filter((a) => a.approvedByUserId !== input.actingUserId);
  if (independent.length === 0) {
    return {
      ok: false,
      code: "SELF_APPROVAL",
      message:
        "You authorized this below-floor tier yourself. A different Commercial Approver must authorize it before you can record acceptance.",
    };
  }

  return { ok: true, authorizationId: independent[0].id };
}
