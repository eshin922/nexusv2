/**
 * Track A · the nine proofs required of the 1c below-floor override.
 *
 * Edward's disposition, 2026-08-10: V1 may permit below-floor acceptance, but
 * only through an explicit governed override — no request lifecycle, no Slack,
 * no quorum, self-approval prohibited, and no fallback when no independent
 * approver exists.
 *
 * CONTROLLED TEST IDENTITIES, NOT OPERATOR EVIDENCE. These prove the control
 * behaves as specified. They are explicitly NOT the post-SSO exercise with two
 * distinct staff identities that Track A needs before it can be called closed —
 * production currently holds three user rows that are all the same person, so
 * that exercise is not stageable yet by anyone.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
  mayAuthorizeBelowFloor,
  type BelowFloorAuthorizationRecord,
} from "../../src/lib/below-floor-authorization.ts";

const PM = "user-pm"; // the quote version's commercial operator
const APPROVER = "user-approver";
const OTHER_APPROVER = "user-approver-2";
const TIER = "tier-2";
const VERSION = 1;

const STATE = { totalRevenue: 100_000, totalCost: 82_000, blendedMarginPct: 0.18 };
const FINGERPRINT = fingerprintCommercialState(STATE);

function auth(over: Partial<BelowFloorAuthorizationRecord> = {}): BelowFloorAuthorizationRecord {
  return {
    id: "auth-1",
    quoteVersionNumber: VERSION,
    tierId: TIER,
    approvedByUserId: APPROVER,
    stateFingerprint: FINGERPRINT,
    invalidatedAt: null,
    ...over,
  };
}

const scope = { quoteVersionNumber: VERSION, tierId: TIER };

// ─────────────────────────────────────────────── 1 · blocked with nothing

test("1 · below-floor acceptance is blocked when no authorization exists", () => {
  const v = evaluateBelowFloorAuthorization({
    authorizations: [],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: PM,
  });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "NO_AUTHORIZATION");
});

// ────────────────────────────────────── 2 · authority is not admin status

test("2 · an unauthorized actor cannot authorize, and ADMIN ALONE DOES NOT", () => {
  assert.equal(mayAuthorizeBelowFloor({ id: PM, commercialApprover: false }), false);
  // The one that matters: BV-005 forbids authority being hardcoded to admin,
  // and the cheapest way for that to erode is a helper that has `role` in hand.
  assert.equal(
    mayAuthorizeBelowFloor({ id: "user-admin", commercialApprover: false, role: "admin" }),
    false,
    "admin status conferred approval authority",
  );
  assert.equal(
    mayAuthorizeBelowFloor({ id: APPROVER, commercialApprover: true, role: "read_only" }),
    true,
    "the governed permission was not sufficient on its own",
  );
});

// ──────────────────────────────── 3 · an approver may authorize another's

test("3 · an authorized approver can authorize a quote another actor accepts", () => {
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: PM,
  });
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.authorizationId, "auth-1");
});

// ───────────────────────────────────────────────── 4 · no self-approval

test("4 · the quote's OPERATOR cannot authorize their own pricing", () => {
  // The separation of duties, corrected 2026-08-22: measured against whoever
  // built the economics, not against whoever is acting. `APPROVER` is the
  // operator in this case, so their own authorization cannot clear it.
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth({ approvedByUserId: APPROVER })],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: APPROVER,
  });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "OPERATOR_APPROVAL");
});

test("4a · an approver may act on a quote they authorized but did not price", () => {
  // REMOVED RULE, asserted so it stays removed. The gate used to refuse when
  // the approver was also the person clicking Send or Accept, which barred an
  // approver from committing someone else's properly authorized quote. No
  // policy asks for that, and it made the verdict depend on who held the mouse.
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth({ approvedByUserId: APPROVER })],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: PM,
  });
  assert.equal(v.ok, true);
});

test("4c · no operator of record refuses, whoever approved", () => {
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth({ approvedByUserId: OTHER_APPROVER })],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: null,
  });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "OPERATOR_UNKNOWN");
});

test("4b · an independent authorization alongside a self one still passes", () => {
  // One approver cannot clear their own way; a second, genuinely independent
  // decision can. No quorum — one independent authorization is sufficient.
  const v = evaluateBelowFloorAuthorization({
    authorizations: [
      auth({ id: "self", approvedByUserId: APPROVER }),
      auth({ id: "independent", approvedByUserId: OTHER_APPROVER }),
    ],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: APPROVER,
  });
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.authorizationId, "independent");
});

// ───────────────────────────────────────────── 5 · no fallback, ever

test("5 · the absence of any other approver creates NO fallback", () => {
  // The estate this ships into has exactly one human. The correct outcome is
  // that below-floor acceptance is unreachable — not that the rule relaxes
  // because it cannot currently be satisfied.
  const soleApproverActs = evaluateBelowFloorAuthorization({
    authorizations: [auth({ approvedByUserId: APPROVER })],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: APPROVER,
  });
  assert.equal(soleApproverActs.ok, false, "a lone approver cleared their own way");

  const nobodyAtAll = evaluateBelowFloorAuthorization({
    authorizations: [],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: APPROVER,
  });
  assert.equal(nobodyAtAll.ok, false, "an empty approver set resolved permissively");
});

// ─────────────────────────────────── 7 · material change invalidates

test("7 · a material commercial change invalidates the authorization", () => {
  const priceMoved = fingerprintCommercialState({ ...STATE, totalRevenue: 101_000 });
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: priceMoved,
    operatorUserId: PM,
  });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "STATE_CHANGED");
});

test("7b · cost movement invalidates too — revenue is not the only lever", () => {
  const costMoved = fingerprintCommercialState({ ...STATE, totalCost: 83_000 });
  assert.notEqual(costMoved, FINGERPRINT);
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: costMoved,
    operatorUserId: PM,
  });
  assert.equal(v.ok === false && v.code, "STATE_CHANGED");
});

test("7c · float noise is NOT a material change", () => {
  // Invalidating on the tenth decimal would teach operators that invalidation
  // is noise, which is how a real invalidation comes to be ignored.
  assert.equal(
    fingerprintCommercialState({ ...STATE, totalRevenue: 100_000.0000001 }),
    FINGERPRINT,
  );
});

test("7d · an explicitly invalidated decision is refused as invalidated", () => {
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth({ invalidatedAt: new Date() })],
    scope,
    currentFingerprint: FINGERPRINT,
    operatorUserId: PM,
  });
  assert.equal(v.ok === false && v.code, "INVALIDATED");
});

// ─────────────────────────── 8 · scope — version and tier are binding

test("8 · acceptance succeeds ONLY while a valid, in-scope authorization exists", () => {
  const record = auth();

  // A different tier is not covered.
  assert.equal(
    evaluateBelowFloorAuthorization({
      authorizations: [record],
      scope: { quoteVersionNumber: VERSION, tierId: "tier-3" },
      currentFingerprint: FINGERPRINT,
      operatorUserId: PM,
    }).ok,
    false,
    "an authorization for one tier covered another",
  );

  // A revision is not covered — BV-005: one quote, one version, one tier.
  assert.equal(
    evaluateBelowFloorAuthorization({
      authorizations: [record],
      scope: { quoteVersionNumber: VERSION + 1, tierId: TIER },
      currentFingerprint: FINGERPRINT,
      operatorUserId: PM,
    }).ok,
    false,
    "an authorization survived a revision",
  );

  // And the case that must pass, so the three above are not passing vacuously.
  assert.equal(
    evaluateBelowFloorAuthorization({
      authorizations: [record],
      scope,
      currentFingerprint: FINGERPRINT,
      operatorUserId: PM,
    }).ok,
    true,
  );
});

test("every refusal names its cause distinctly", () => {
  // The operator's next action differs per cause — find another approver, ask
  // for a fresh decision, or re-authorize after a price change. A single
  // "blocked" would collapse three different instructions into one.
  const codes = new Set<string>();
  for (const v of [
    evaluateBelowFloorAuthorization({ authorizations: [], scope, currentFingerprint: FINGERPRINT, operatorUserId: PM }),
    evaluateBelowFloorAuthorization({ authorizations: [auth({ invalidatedAt: new Date() })], scope, currentFingerprint: FINGERPRINT, operatorUserId: PM }),
    evaluateBelowFloorAuthorization({ authorizations: [auth()], scope, currentFingerprint: "different", operatorUserId: PM }),
    evaluateBelowFloorAuthorization({ authorizations: [auth()], scope, currentFingerprint: FINGERPRINT, operatorUserId: APPROVER }),
    evaluateBelowFloorAuthorization({ authorizations: [auth()], scope, currentFingerprint: FINGERPRINT, operatorUserId: null }),
  ]) {
    assert.equal(v.ok, false);
    if (v.ok === false) codes.add(v.code);
  }
  assert.equal(codes.size, 5, "two refusals share a code");
});
