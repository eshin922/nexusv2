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
  });
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.authorizationId, "auth-1");
});

// ───────────────────────────────────────────────── 4 · no self-approval

test("4 · any approver's authorization is honoured, including their own quote's", () => {
  // REPLACES the independence tests (4, 4a, 4b, 4c, 5). Policy 2026-08-22:
  // Nexus enforces authority, scope and freshness; who approved is not part of
  // the question, and misuse is handled organisationally.
  //
  // Kept as one test rather than deleted outright, because the removal is the
  // notable thing and a silent gap would read as an oversight.
  assert.equal(
    evaluateBelowFloorAuthorization({
      authorizations: [auth({ approvedByUserId: APPROVER })],
      scope,
      currentFingerprint: FINGERPRINT,
    }).ok,
    true,
  );
});

// ─────────────────────────────────── 7 · material change invalidates

test("7 · a material commercial change invalidates the authorization", () => {
  const priceMoved = fingerprintCommercialState({ ...STATE, totalRevenue: 101_000 });
  const v = evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: priceMoved,
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
    evaluateBelowFloorAuthorization({ authorizations: [], scope, currentFingerprint: FINGERPRINT }),
    evaluateBelowFloorAuthorization({ authorizations: [auth({ invalidatedAt: new Date() })], scope, currentFingerprint: FINGERPRINT }),
    evaluateBelowFloorAuthorization({ authorizations: [auth()], scope, currentFingerprint: "different" }),
  ]) {
    assert.equal(v.ok, false);
    if (v.ok === false) codes.add(v.code);
  }
  assert.equal(codes.size, 3, "two refusals share a code");
});
