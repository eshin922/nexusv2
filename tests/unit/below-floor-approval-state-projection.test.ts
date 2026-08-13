/**
 * Operator approval-state projection.
 *
 * The property under test: **the surface must never show a state the
 * acceptance gate would contradict.** Showing "approved" for an authorization
 * the gate will refuse is worse than showing nothing — it tells an operator to
 * proceed into a refusal.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  mayRequestApproval,
  projectApprovalTierState,
  type ApprovalRequestRow,
  type AuthorizationRow,
} from "../../src/lib/below-floor-approval-state.ts";

const TIER = "tier-1";
const V = 1;
const FP = "rev:5550.00|cost:2775.00|margin:0.500000";
const MOVED = "rev:9000.00|cost:2775.00|margin:0.691667";
const T0 = new Date("2026-08-13T10:00:00Z");
const T1 = new Date("2026-08-13T11:00:00Z");

const req = (o: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow => ({
  id: "req-1", tierId: TIER, quoteVersionNumber: V, status: "pending",
  stateFingerprint: FP, requestedAt: T0, decidedAt: null, decisionReason: null,
  deliveryStatus: "delivered", authorizationId: null, ...o,
});
const auth = (o: Partial<AuthorizationRow> = {}): AuthorizationRow => ({
  id: "auth-1", tierId: TIER, quoteVersionNumber: V, stateFingerprint: FP,
  invalidatedAt: null, ...o,
});
const project = (requests: ApprovalRequestRow[], authorizations: AuthorizationRow[], fp = FP) =>
  projectApprovalTierState({ tierId: TIER, quoteVersionNumber: V, currentFingerprint: fp, requests, authorizations });

// ── the five reachable states ─────────────────────────────────────────────

test("no request → none, and the Request action stays eligible", () => {
  const s = project([], []);
  assert.deepEqual(s, { kind: "none" });
  assert.equal(mayRequestApproval(s), true);
});

test("pending → pending, and the Request action is NO LONGER actionable", () => {
  const s = project([req()], []);
  assert.equal(s.kind, "pending");
  assert.equal(mayRequestApproval(s), false, "must not keep offering Request while one is open");
});

test("pending carries delivery state without letting it imply authority", () => {
  assert.equal(project([req({ deliveryStatus: "failed" })], []).kind, "pending");
  const s = project([req({ deliveryStatus: "failed" })], []);
  assert.equal(s.kind === "pending" && s.delivered, false);
  // Still pending, still not requestable, and no authorization anywhere.
  assert.equal(mayRequestApproval(s), false);
});

test("approved + live authorization at current fingerprint → approved", () => {
  const s = project([req({ status: "approved", decidedAt: T1, authorizationId: "auth-1" })], [auth()]);
  assert.equal(s.kind, "approved");
  assert.equal(s.kind === "approved" && s.authorizationId, "auth-1");
  assert.equal(mayRequestApproval(s), false);
});

test("rejected → rejected, durable, and a NEW request is permitted", () => {
  const s = project([req({ status: "rejected", decidedAt: T1, decisionReason: "Margin too thin." })], []);
  assert.equal(s.kind, "rejected");
  assert.equal(s.kind === "rejected" && s.reason, "Margin too thin.");
  assert.equal(mayRequestApproval(s), true, "rejection must not be a dead end");
});

test("superseded → superseded, and a new request is permitted", () => {
  const s = project([req({ status: "superseded" })], []);
  assert.equal(s.kind, "superseded");
  assert.equal(mayRequestApproval(s), true);
});

// ── consistency with the acceptance gate ──────────────────────────────────

test("GATE CONSISTENCY — an authorization whose economics moved is NOT shown as approved", () => {
  // The gate refuses on fingerprint mismatch. Showing "approved" here would
  // walk the operator into that refusal.
  const s = project([req({ status: "approved", decidedAt: T1, authorizationId: "auth-1" })], [auth()], MOVED);
  assert.notEqual(s.kind, "approved");
  assert.equal(s.kind, "superseded");
  assert.equal(mayRequestApproval(s), true, "operator must be able to re-request");
});

test("GATE CONSISTENCY — an invalidated authorization is not approved", () => {
  const s = project(
    [req({ status: "approved", decidedAt: T1, authorizationId: "auth-1" })],
    [auth({ invalidatedAt: T1 })],
  );
  assert.notEqual(s.kind, "approved");
});

test("GATE CONSISTENCY — scope is respected: another tier's approval does not leak", () => {
  const s = project([], [auth({ tierId: "tier-OTHER" })]);
  assert.deepEqual(s, { kind: "none" });
});

test("GATE CONSISTENCY — a prior version's approval does not carry forward", () => {
  const s = project([], [auth({ quoteVersionNumber: 0 })]);
  assert.deepEqual(s, { kind: "none" });
});

test("a pending request whose economics already moved reports superseded, not pending", () => {
  // Nothing has transitioned it yet, but the decision path will supersede it on
  // arrival. Showing it as live would offer an outcome that cannot happen.
  const s = project([req()], [], MOVED);
  assert.equal(s.kind, "superseded");
});

// ── unimplemented paths are not projected ─────────────────────────────────

test("no cancellation or expiry state is ever produced", () => {
  const kinds = new Set<string>();
  for (const status of ["pending", "approved", "rejected", "superseded", "cancelled"]) {
    kinds.add(project([req({ status, decidedAt: T1 })], []).kind);
  }
  assert.equal(kinds.has("cancelled"), false, "cancellation is not implemented; do not render it");
  assert.equal(kinds.has("expired"), false, "expiry is not implemented; do not render it");
});

test("an unknown status degrades to none rather than inventing a state", () => {
  assert.deepEqual(project([req({ status: "cancelled" })], []), { kind: "none" });
});

test("the most recent terminal decision wins", () => {
  const s = project(
    [
      req({ id: "old", status: "rejected", decidedAt: T0, decisionReason: "first" }),
      req({ id: "new", status: "rejected", decidedAt: T1, decisionReason: "second" }),
    ],
    [],
  );
  assert.equal(s.kind === "rejected" && s.reason, "second");
});
