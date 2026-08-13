/**
 * Below-floor approval request lifecycle — governance regressions.
 *
 * The invariant this file exists to protect: **a request is not an
 * authorization.** Every path that is not a clean, independent, in-scope
 * approval must leave `below_floor_authorizations` untouched, because that
 * table alone satisfies the Send/Accept gates.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateApprovalDecision,
  isNoOp,
  isTerminal,
  resolveSlackIdentity,
  supersedeIfStale,
  TERMINAL_STATUSES,
} from "../../src/lib/below-floor-approval-request.ts";

const FP = "rev:5550.00|cost:2775.00|margin:0.500000";
const REQUESTER = "user-requester";
const APPROVER = "user-approver";

const request = (over: Partial<Parameters<typeof evaluateApprovalDecision>[0]["request"]> = {}) => ({
  id: "req-1",
  status: "pending",
  requestedByUserId: REQUESTER,
  stateFingerprint: FP,
  ...over,
});

const decide = (over: Partial<Parameters<typeof evaluateApprovalDecision>[0]> = {}) =>
  evaluateApprovalDecision({
    request: request(),
    actor: { userId: APPROVER, commercialApprover: true },
    action: "approve",
    currentFingerprint: FP,
    reason: null,
    ...over,
  });

// ── the happy path, so the refusals below mean something ──────────────────

test("an independent approver may approve an in-scope pending request", () => {
  assert.deepEqual(decide(), { ok: true });
});

test("reject with a reason is permitted", () => {
  assert.deepEqual(decide({ action: "reject", reason: "Margin too thin for this account." }), {
    ok: true,
  });
});

// ── authority and independence ────────────────────────────────────────────

test("a non-commercialApprover cannot decide", () => {
  const v = decide({ actor: { userId: APPROVER, commercialApprover: false } });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "not_approver");
});

test("the requester cannot approve their own request", () => {
  const v = decide({ actor: { userId: REQUESTER, commercialApprover: true } });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "self_approval");
});

test("authority is the governed permission, never the role", () => {
  // `commercialApprover:false` refuses regardless of anything else the actor
  // might be. There is no admin escape hatch to assert against because there is
  // deliberately no admin branch.
  for (const action of ["approve", "reject"] as const) {
    const v = decide({ actor: { userId: APPROVER, commercialApprover: false }, action, reason: "x" });
    assert.equal(v.ok === false && v.code, "not_approver", action);
  }
});

// ── staleness ─────────────────────────────────────────────────────────────

test("a changed commercial fingerprint supersedes rather than decides", () => {
  const v = decide({ currentFingerprint: "rev:9999.00|cost:1.00|margin:0.900000" });
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.code, "superseded");
});

test("staleness is refused BEFORE self-approval, so the operator is told the useful thing", () => {
  // The requester clicking their own stale request must hear "raise a new
  // request", not "find a second person" — the latter sends them to solve a
  // problem that is not the one blocking them.
  const v = decide({
    actor: { userId: REQUESTER, commercialApprover: true },
    currentFingerprint: "rev:1.00|cost:1.00|margin:0.000000",
  });
  assert.equal(v.ok === false && v.code, "superseded");
});

test("supersedeIfStale only fires on a live request", () => {
  assert.equal(supersedeIfStale({ status: "pending", stateFingerprint: FP, currentFingerprint: "x" }).supersede, true);
  assert.equal(supersedeIfStale({ status: "pending", stateFingerprint: FP, currentFingerprint: FP }).supersede, false);
  for (const status of TERMINAL_STATUSES) {
    assert.equal(
      supersedeIfStale({ status, stateFingerprint: FP, currentFingerprint: "x" }).supersede,
      false,
      `${status} must not be re-superseded`,
    );
  }
});

// ── idempotency ───────────────────────────────────────────────────────────

test("a decision against an already-terminal request is a NO-OP, not an error", () => {
  for (const status of TERMINAL_STATUSES) {
    const v = decide({ request: request({ status }) });
    assert.equal(v.ok, false, status);
    assert.equal(v.ok === false && v.code, "already_decided", status);
    assert.equal(isNoOp(v), true, `${status} must be a no-op`);
  }
});

test("a genuine refusal is NOT a no-op", () => {
  assert.equal(isNoOp(decide({ actor: { userId: REQUESTER, commercialApprover: true } })), false);
  assert.equal(isNoOp(decide({ currentFingerprint: "changed" })), false);
});

test("already-decided is checked before everything else", () => {
  // A duplicate callback from an unauthorised user against a settled request
  // reports the settled state — the reviewer is not told they lack permission
  // for a request nobody can act on.
  const v = decide({
    request: request({ status: "approved" }),
    actor: { userId: REQUESTER, commercialApprover: false },
    currentFingerprint: "changed",
  });
  assert.equal(v.ok === false && v.code, "already_decided");
});

test("rejection is terminal and durable — distinct from never having asked", () => {
  assert.equal(isTerminal("rejected"), true);
  assert.equal(isTerminal("pending"), false);
  // The falsification: a rejected request must not be re-decidable, which is
  // what "absence of approval" would allow.
  assert.equal(decide({ request: request({ status: "rejected" }) }).ok, false);
});

// ── reason ────────────────────────────────────────────────────────────────

test("reject requires a reason; whitespace is not a reason", () => {
  for (const reason of [null, "", "   ", "\n\t "]) {
    const v = decide({ action: "reject", reason });
    assert.equal(v.ok === false && v.code, "reason_required", JSON.stringify(reason));
  }
});

test("approve does not require a reason", () => {
  assert.equal(decide({ action: "approve", reason: null }).ok, true);
});

// ── Slack identity: binding first, fail closed ────────────────────────────

const bound = { id: "nexus-A", slackUserId: "U1" };

test("a bound Slack account resolves through the binding, not email", () => {
  const r = resolveSlackIdentity({ boundUser: bound, emailUser: null });
  assert.deepEqual(r, { ok: true, userId: "nexus-A", bindNow: false });
});

test("an unbound account bootstraps by email and binds", () => {
  const r = resolveSlackIdentity({
    boundUser: null,
    emailUser: { id: "nexus-B", slackUserId: null },
  });
  assert.deepEqual(r, { ok: true, userId: "nexus-B", bindNow: true });
});

test("BINDING CONFLICT — a changed email never silently remaps a bound account", () => {
  const r = resolveSlackIdentity({
    boundUser: bound,
    emailUser: { id: "nexus-DIFFERENT", slackUserId: null },
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "binding_conflict");
  // The whole point: it did NOT resolve to either user.
  assert.equal("userId" in r, false);
});

test("a Nexus user already bound to another Slack account fails closed", () => {
  const r = resolveSlackIdentity({
    boundUser: null,
    emailUser: { id: "nexus-C", slackUserId: "U-OTHER" },
  });
  assert.equal(r.ok === false && r.code, "already_bound_elsewhere");
});

test("an unmapped Slack account cannot decide — Slack identity alone is insufficient", () => {
  const r = resolveSlackIdentity({ boundUser: null, emailUser: null });
  assert.equal(r.ok === false && r.code, "unmapped");
});

test("an unresolvable email does not disturb an existing binding", () => {
  // users.info being unavailable is not evidence about identity. A bound
  // account must still resolve, or a Slack outage would revoke approvers.
  assert.deepEqual(resolveSlackIdentity({ boundUser: bound, emailUser: null }), {
    ok: true,
    userId: "nexus-A",
    bindNow: false,
  });
});
