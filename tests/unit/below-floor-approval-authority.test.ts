import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
  mayAuthorizeBelowFloor,
  type BelowFloorAuthorizationRecord,
} from "../../src/lib/below-floor-authorization.ts";
import { evaluateApprovalDecision } from "../../src/lib/below-floor-approval-request.ts";
import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// AUTHORITY IS THE WHOLE CONTROL
//
// Governing policy, 2026-08-22: Nexus does not enforce self-approval or
// operator independence for below-floor approvals. Misuse is handled
// organisationally. A user holding `commercial_approver` may approve any
// below-floor request, including one they raised and one on a quote they
// priced.
//
// Two rules were REMOVED rather than relaxed — approver≠requester, and later
// approver≠operator — because a half-enforced separation of duties is worse
// than none: it blocks legitimate work while providing no guarantee anyone can
// rely on.
//
// These tests are written to fail if either rule returns. The first two would
// have FAILED under both previous models, which is what makes them evidence
// rather than restatement.
// ═══════════════════════════════════════════════════════════════════════

const APPROVER = "user-approver";
const SOMEONE_ELSE = "user-someone-else";
const TIER = "tier-1";
const VERSION = 1;
const FP = fingerprintCommercialState({
  totalRevenue: 100_000,
  totalCost: 82_000,
  blendedMarginPct: 0.18,
});
const scope = { quoteVersionNumber: VERSION, tierId: TIER };

const auth = (
  o: Partial<BelowFloorAuthorizationRecord> = {},
): BelowFloorAuthorizationRecord => ({
  id: "auth-1",
  quoteVersionNumber: VERSION,
  tierId: TIER,
  approvedByUserId: APPROVER,
  stateFingerprint: FP,
  invalidatedAt: null,
  ...o,
});

const decide = (o: Partial<Parameters<typeof evaluateApprovalDecision>[0]> = {}) =>
  evaluateApprovalDecision({
    request: {
      id: "req-1",
      status: "pending",
      requestedByUserId: SOMEONE_ELSE,
      stateFingerprint: FP,
    },
    actor: { userId: APPROVER, commercialApprover: true },
    action: "approve",
    currentFingerprint: FP,
    reason: null,
    ...o,
  });

const gate = (o: Partial<Parameters<typeof evaluateBelowFloorAuthorization>[0]> = {}) =>
  evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: FP,
    ...o,
  });

// ── what the policy now permits ───────────────────────────────────────────

test("an approver may approve a request they raised themselves", () => {
  const v = decide({
    request: {
      id: "req-1",
      status: "pending",
      requestedByUserId: APPROVER, // the same person deciding
      stateFingerprint: FP,
    },
  });
  assert.equal(v.ok, true);
});

test("an approver may authorize a quote they priced themselves", () => {
  // The gate no longer knows who authored the quote — there is no operator
  // parameter to supply — so an authorization by any approver is honoured.
  assert.equal(gate().ok, true);
  assert.equal(gate({ authorizations: [auth({ approvedByUserId: APPROVER })] }).ok, true);
});

test("a lone approver is now a workable estate", () => {
  // Previously the documented and deliberate outcome was that an estate with
  // one approver could not sell below floor at all. That is no longer true, and
  // it is asserted so the change is visible rather than implied.
  const v = decide({
    request: { id: "r", status: "pending", requestedByUserId: APPROVER, stateFingerprint: FP },
    actor: { userId: APPROVER, commercialApprover: true },
  });
  assert.equal(v.ok, true);
  assert.equal(gate({ authorizations: [auth({ approvedByUserId: APPROVER })] }).ok, true);
});

// ── what still refuses ────────────────────────────────────────────────────

test("a non-approver still cannot decide, whatever else they are", () => {
  for (const action of ["approve", "reject"] as const) {
    const v = decide({
      actor: { userId: APPROVER, commercialApprover: false },
      action,
      reason: "x",
    });
    assert.equal(v.ok === false && v.code, "not_approver", action);
  }
});

test("authority is the flag, never the role", () => {
  assert.equal(mayAuthorizeBelowFloor({ id: "u", commercialApprover: false, role: "admin" }), false);
  assert.equal(mayAuthorizeBelowFloor({ id: "u", commercialApprover: true, role: "read_only" }), true);
});

test("the wrong tier or version is not an authorization at all", () => {
  assert.equal(
    (gate({ scope: { ...scope, tierId: "other-tier" } }) as { code: string }).code,
    "NO_AUTHORIZATION",
  );
  assert.equal(
    (gate({ scope: { ...scope, quoteVersionNumber: VERSION + 1 } }) as { code: string }).code,
    "NO_AUTHORIZATION",
  );
});

test("a moved fingerprint invalidates the approval", () => {
  // The binding the firm actually relies on: an approval is granted against
  // specific economics, and those economics moving withdraws it.
  assert.equal((gate({ currentFingerprint: "moved" }) as { code: string }).code, "STATE_CHANGED");

  const moved = fingerprintCommercialState({
    totalRevenue: 100_001,
    totalCost: 82_000,
    blendedMarginPct: 0.18,
  });
  assert.notEqual(moved, FP, "a one-dollar revenue change must move the fingerprint");
  assert.equal((gate({ currentFingerprint: moved }) as { code: string }).code, "STATE_CHANGED");
});

test("an invalidated authorization refuses, and says so distinctly", () => {
  assert.equal(
    (gate({ authorizations: [auth({ invalidatedAt: new Date() })] }) as { code: string }).code,
    "INVALIDATED",
  );
});

test("a stale request cannot be decided", () => {
  assert.equal(
    (decide({ currentFingerprint: "moved" }) as { code: string }).code,
    "superseded",
  );
});

test("a settled request cannot be re-decided", () => {
  for (const status of ["approved", "rejected", "superseded"]) {
    const v = decide({
      request: { id: "r", status, requestedByUserId: SOMEONE_ELSE, stateFingerprint: FP },
    });
    assert.equal(v.ok === false && v.code, "already_decided", status);
  }
});

test("rejection still requires a reason", () => {
  assert.equal(
    (decide({ action: "reject", reason: "  " }) as { code: string }).code,
    "reason_required",
  );
});

// ── the removed rules must stay removed ───────────────────────────────────

test("no independence check survives anywhere in the authorization path", async () => {
  // Structural, because a partial reintroduction is the failure mode: one call
  // site quietly re-adding a comparison would block legitimate approvals while
  // every other path allowed them, and the inconsistency would read as a bug in
  // whichever surface happened to surface it.
  for (const f of [
    "src/lib/below-floor-authorization.ts",
    "src/lib/below-floor-approval-request.ts",
    "src/lib/below-floor-approval-state.ts",
    "src/lib/below-floor-approval-loader.ts",
    "src/lib/below-floor-send-gate.ts",
    "src/lib/pricing-progression.ts",
    "src/app/actions/below-floor-approval-request.ts",
    "src/lib/netsuite/mark-complete.ts",
  ]) {
    const src = codeOnly(await readFile(new URL(`../../${f}`, import.meta.url), "utf8"));
    for (const gone of [
      "actingUserId",
      "operatorUserId",
      "SELF_APPROVAL",
      "self_approval",
      "OPERATOR_APPROVAL",
      "OPERATOR_UNKNOWN",
      "operator_conflict",
    ]) {
      assert.ok(!src.includes(gone), `${f} still references ${gone}`);
    }
  }
});

test("the refusal set is exactly the three scope conditions", async () => {
  const src = codeOnly(
    await readFile(new URL("../../src/lib/below-floor-authorization.ts", import.meta.url), "utf8"),
  );
  const block = src.slice(src.indexOf("export type BelowFloorBlockCode"));
  const codes = Array.from(
    block.slice(0, block.indexOf(";")).matchAll(/"([A-Z_]+)"/g),
    (m) => m[1],
  );
  assert.deepEqual(codes.sort(), ["INVALIDATED", "NO_AUTHORIZATION", "STATE_CHANGED"]);
});

test("the requester is recorded but never read for authority", async () => {
  const src = codeOnly(
    await readFile(new URL("../../src/lib/below-floor-approval-request.ts", import.meta.url), "utf8"),
  );
  // Still on the record — provenance is not the same as authority.
  assert.match(src, /requestedByUserId: string;/);
  // But not compared against the actor anywhere.
  assert.doesNotMatch(src, /actor\.userId === [^\n]*requestedByUserId/);
  assert.doesNotMatch(src, /requestedByUserId === [^\n]*actor\.userId/);
});

// ── the copy must not describe a control that was removed ─────────────────

test("no operator-facing copy claims an independence rule", async () => {
  // The rendered page said "have an authorized commercial approver OTHER THAN
  // YOU approve it" for a day after independence was removed — in two places,
  // because the banner restated the verdict. Copy describing a control the
  // system does not enforce is worse than none: an operator plans around it,
  // and nothing fails to tell them otherwise.
  //
  // Swept over the surfaces an operator actually reads, not the whole tree:
  // the governed modules explain the REMOVAL in their comments, which is
  // exactly the history worth keeping.
  const surfaces = [
    "src/lib/pricing-progression.ts",
    "src/components/pricing/pricing-page-head.tsx",
    "src/components/pricing-surface/verdict-bar.tsx",
    "src/components/pricing-surface/approval-state-card.tsx",
    "src/components/pricing-surface/request-override-modal.tsx",
  ];
  const claims = [
    /other than you/i,
    /cannot be decided by the person who raised/i,
    /someone other than the approver/i,
    /you priced this quote/i,
    /independent(ly)? approv/i,
  ];
  for (const f of surfaces) {
    const src = codeOnly(await readFile(new URL(`../../${f}`, import.meta.url), "utf8"));
    for (const claim of claims) {
      assert.doesNotMatch(src, claim, `${f} still promises an independence rule`);
    }
  }
});
