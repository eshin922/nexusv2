import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
  type BelowFloorAuthorizationRecord,
} from "../../src/lib/below-floor-authorization.ts";
import { evaluateApprovalDecision } from "../../src/lib/below-floor-approval-request.ts";
import {
  projectApprovalTierState,
  mayRequestApproval,
} from "../../src/lib/below-floor-approval-state.ts";
import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// SEPARATION OF DUTIES IS OPERATOR-BASED, NOT REQUESTER-BASED
//
// The rule was "the approver may not be whoever pressed Request approval".
// That was a PROXY, and it enforced a relationship the business does not have:
// designated approvers are not quote operators, so an approver who routed a
// PM's request was permanently barred from deciding it, while an operator who
// had somebody else raise the request passed straight through. Both directions
// were wrong, and the second is the one that mattered.
//
// The rule is now: the approver may not be the quote VERSION's commercial
// operator — `quotes.created_by_user_id`, the only durable per-version actor
// that records who built the economics.
//
// Each test below is one of the six discriminating cases, written so it can
// fail: the two that describe the OLD behaviour would have passed before and
// must not now, and the two that describe the NEW behaviour would have failed.
// ═══════════════════════════════════════════════════════════════════════

const OPERATOR = "user-operator-pm";   // priced the quote
const APPROVER = "user-approver";      // designated commercial approver
const OTHER = "user-someone-else";     // neither

const TIER = "tier-1";
const VERSION = 1;
const FP = fingerprintCommercialState({
  totalRevenue: 100_000,
  totalCost: 82_000,
  blendedMarginPct: 0.18,
});
const scope = { quoteVersionNumber: VERSION, tierId: TIER };

const auth = (
  over: Partial<BelowFloorAuthorizationRecord> = {},
): BelowFloorAuthorizationRecord => ({
  id: "auth-1",
  quoteVersionNumber: VERSION,
  tierId: TIER,
  approvedByUserId: APPROVER,
  stateFingerprint: FP,
  invalidatedAt: null,
  ...over,
});

const decide = (o: Partial<Parameters<typeof evaluateApprovalDecision>[0]> = {}) =>
  evaluateApprovalDecision({
    request: {
      id: "req-1",
      status: "pending",
      requestedByUserId: OPERATOR,
      stateFingerprint: FP,
    },
    actor: { userId: APPROVER, commercialApprover: true },
    action: "approve",
    currentFingerprint: FP,
    reason: null,
    operatorUserId: OPERATOR,
    ...o,
  });

const gate = (o: Partial<Parameters<typeof evaluateBelowFloorAuthorization>[0]> = {}) =>
  evaluateBelowFloorAuthorization({
    authorizations: [auth()],
    scope,
    currentFingerprint: FP,
    operatorUserId: OPERATOR,
    ...o,
  });

// ── 1 · operator requests and self-approves → refused ─────────────────────

test("the operator requesting and approving their own quote is refused", () => {
  const d = decide({
    request: { id: "r", status: "pending", requestedByUserId: OPERATOR, stateFingerprint: FP },
    actor: { userId: OPERATOR, commercialApprover: true },
  });
  assert.equal(d.ok === false && d.code, "operator_approval");

  const g = gate({ authorizations: [auth({ approvedByUserId: OPERATOR })] });
  assert.equal(g.ok === false && g.code, "OPERATOR_APPROVAL");
});

// ── 2 · someone else requests on the operator's behalf, operator approves ──

test("routing the request through someone else does not launder the operator's approval", () => {
  // The hole the old rule left wide open, and the reason this correction is a
  // tightening rather than a relaxation. Under requester-based independence
  // this PASSED: the requester was OTHER, the approver was the operator, the
  // two ids differed, and the person who priced the quote approved it.
  const d = decide({
    request: { id: "r", status: "pending", requestedByUserId: OTHER, stateFingerprint: FP },
    actor: { userId: OPERATOR, commercialApprover: true },
  });
  assert.equal(d.ok === false && d.code, "operator_approval");

  const g = gate({ authorizations: [auth({ approvedByUserId: OPERATOR })] });
  assert.equal(g.ok === false && g.code, "OPERATOR_APPROVAL");
});

// ── 3 · approver requests on a non-approver's quote, then approves ─────────

test("an approver may decide a request they raised on someone else's quote", () => {
  // Refused under the old rule purely because the same id appeared in
  // `requested_by`. This is the target workflow: an approver picks up a PM's
  // below-floor quote, raises the request, and decides it.
  const d = decide({
    request: { id: "r", status: "pending", requestedByUserId: APPROVER, stateFingerprint: FP },
    actor: { userId: APPROVER, commercialApprover: true },
  });
  assert.equal(d.ok, true);

  assert.equal(gate().ok, true);
});

// ── 4 · approver sends/accepts someone else's authorized quote ─────────────

test("the person committing the quote is no longer part of the predicate", () => {
  // The gate used to take `actingUserId` and refuse when it matched the
  // approver. Its absence is the fix: an approver clicking Send on a properly
  // authorized quote they did not price is doing nothing the policy forbids.
  //
  // Asserted structurally too, because "the parameter is gone" is the whole
  // claim and a leftover would silently restore the old behaviour.
  assert.equal(gate().ok, true);
});

test("no gate call site still passes an acting user", async () => {
  for (const f of [
    "src/lib/below-floor-authorization.ts",
    "src/lib/below-floor-send-gate.ts",
    "src/app/actions/quotes.ts",
    "src/lib/netsuite/mark-complete.ts",
  ]) {
    const src = codeOnly(await readFile(new URL(`../../${f}`, import.meta.url), "utf8"));
    assert.doesNotMatch(
      src,
      /actingUserId/,
      `${f} still threads an acting user into the independence check`,
    );
  }
});

// ── 5 · null operator → refused ───────────────────────────────────────────

test("a quote with no operator of record cannot proceed below floor", () => {
  assert.equal(decide({ operatorUserId: null }).ok === false && decide({ operatorUserId: null }).ok, false);
  assert.equal(
    (decide({ operatorUserId: null }) as { code: string }).code,
    "operator_unknown",
  );

  const g = gate({ operatorUserId: null });
  assert.equal(g.ok === false && g.code, "OPERATOR_UNKNOWN");
});

test("null is never inferred away — no fallback to PM, rep, importer or requester", async () => {
  // The loophole this avoids: any of those would resolve to SOMEBODY, and a
  // guess that resolves is indistinguishable at the gate from knowing.
  const src = codeOnly(
    await readFile(new URL("../../src/lib/quote-operator.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /createdByUserId/);
  for (const forbidden of ["pmUserId", "salesRepUserId", "importedByUserId", "requestedByUserId"]) {
    assert.ok(!src.includes(forbidden), `${forbidden} must not be a fallback`);
  }
  assert.match(src, /\?\? null/, "an absent creator resolves to null, not to a substitute");
});

// ── 6 · every other requirement survives ──────────────────────────────────

test("tier, version, fingerprint and invalidation still refuse independently", () => {
  assert.equal(
    gate({ scope: { ...scope, tierId: "other-tier" } }).ok === false &&
      (gate({ scope: { ...scope, tierId: "other-tier" } }) as { code: string }).code,
    "NO_AUTHORIZATION",
  );
  assert.equal(
    (gate({ scope: { ...scope, quoteVersionNumber: 2 } }) as { code: string }).code,
    "NO_AUTHORIZATION",
  );
  assert.equal(
    (gate({ currentFingerprint: "moved" }) as { code: string }).code,
    "STATE_CHANGED",
  );
  assert.equal(
    (gate({ authorizations: [auth({ invalidatedAt: new Date() })] }) as { code: string }).code,
    "INVALIDATED",
  );
});

test("commercial-approver authority is untouched by the correction", () => {
  const d = decide({ actor: { userId: APPROVER, commercialApprover: false } });
  assert.equal(d.ok === false && d.code, "not_approver");
});

// ── the surface must not disagree with the gate ───────────────────────────

test("an operator-granted authorization does not render as approved", () => {
  // Otherwise progression opens on an authorization SEND will refuse — the
  // exact two-bases defect the progression slice closed.
  const base = {
    tierId: TIER,
    quoteVersionNumber: VERSION,
    currentFingerprint: FP,
    requests: [],
    authorizations: [
      {
        id: "a1",
        tierId: TIER,
        quoteVersionNumber: VERSION,
        approvedByUserId: OPERATOR,
        stateFingerprint: FP,
        invalidatedAt: null,
      },
    ],
  };
  const s = projectApprovalTierState({ ...base, operatorUserId: OPERATOR });
  assert.equal(s.kind, "operator_conflict");
  // And it must be recoverable: a fresh request from an independent approver
  // is the only way out, so the Request action stays eligible.
  assert.equal(mayRequestApproval(s), true);

  const independent = projectApprovalTierState({
    ...base,
    authorizations: [{ ...base.authorizations[0], approvedByUserId: APPROVER }],
    operatorUserId: OPERATOR,
  });
  assert.equal(independent.kind, "approved");
});

test("an unknown operator does not render as approved either", () => {
  const s = projectApprovalTierState({
    tierId: TIER,
    quoteVersionNumber: VERSION,
    currentFingerprint: FP,
    requests: [],
    authorizations: [
      {
        id: "a1",
        tierId: TIER,
        quoteVersionNumber: VERSION,
        approvedByUserId: APPROVER,
        stateFingerprint: FP,
        invalidatedAt: null,
      },
    ],
    operatorUserId: null,
  });
  assert.equal(s.kind, "operator_conflict");
});
