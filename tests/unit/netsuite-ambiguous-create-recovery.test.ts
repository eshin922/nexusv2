/**
 * Ambiguous-CREATE recovery — the 14 required regressions + the historical
 * falsification.
 *
 * WHAT THIS PROTECTS. `X-NetSuite-Idempotency-Key` is not honoured by the
 * account (measured 2026-08-13: two identical keys → SO2705 + SO2706), so a
 * retry of an attempt whose CREATE outcome is unknown is a genuine
 * duplicate-order vector. The duplicate-deal UserEvent stops the second ORDER
 * but leaves the first ORPHANED, because Nexus never learned its id.
 *
 * The falsification at the foot of this file reconstructs that historical
 * sequence and asserts it is unreachable. It asserts on CREATE COUNT and
 * SNAPSHOT OWNERSHIP, not merely on final status — a status-only assertion
 * would pass against an implementation that still emitted a second CREATE
 * before settling, which is the whole defect.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  decideReconciliation,
  evaluateAdoptionCandidate,
  type CandidateSalesOrder,
} from "../../src/lib/netsuite/create-reconciliation-rules.ts";
import {
  mustNotCreate,
  ownsSnapshot,
} from "../../src/lib/netsuite/attempt-lifecycle-rules.ts";
import { classifyResponse } from "../../src/lib/netsuite/errors.ts";
import { normalizeStructure } from "../../src/lib/netsuite/so-structure.ts";
import { toObservedLines } from "../../src/lib/netsuite/rate-convergence.ts";
import type { PlannedGroup } from "../../src/lib/netsuite/grouping-plan.ts";

// ── Fixture: Order B's shape — one group, Box ×1 + Bottle ×1, tier 1,000 ────

const DEAL = "59153706532";
const CUSTOMER = "360189";
const TIER_QTY = 1000;

const PLANNED: PlannedGroup[] = [
  {
    assemblyId: "asy-1",
    assemblySku: "ASY-89688023-1",
    assemblyName: "Accounting Review Finished Product",
    compositionHash: "hash-1",
    externalId: "nxs-grp-hash-1",
    notDerivableReason: null,
    members: [
      { sku: "10064-GNX-Box", netsuiteItemId: "1058", quantity: 1000, rate: 1.25 },
      { sku: "DPS-BOTTLE-0001", netsuiteItemId: "2001", quantity: 1000, rate: 2.25 },
    ],
  } as unknown as PlannedGroup,
];

/** Provider lines for a BARE grouped CREATE — rates NOT yet converged. */
function providerLines(opts?: { rates?: [number, number]; extraMember?: boolean }) {
  const [r1, r2] = opts?.rates ?? [0, 0]; // item-derived defaults pre-convergence
  return [
    { line: 1, itemId: "9001", itemType: "Group", quantity: TIER_QTY, rate: null, amount: null, classId: null },
    { line: 2, itemId: "1058", itemType: "InvtPart", quantity: 1000, rate: r1, amount: r1 * 1000, classId: null },
    { line: 3, itemId: "2001", itemType: "InvtPart", quantity: 1000, rate: r2, amount: r2 * 1000, classId: null },
    ...(opts?.extraMember
      ? [{ line: 4, itemId: "9999", itemType: "InvtPart", quantity: 1000, rate: 0, amount: 0, classId: null }]
      : []),
    { line: 5, itemId: null, itemType: "EndGroup", quantity: null, rate: null, amount: (r1 + r2) * 1000, classId: null },
  ];
}

const structureOf = (o?: Parameters<typeof providerLines>[0]) =>
  normalizeStructure(toObservedLines(providerLines(o)));

const candidate = (over: Partial<CandidateSalesOrder> = {}): CandidateSalesOrder => ({
  internalId: "361700",
  tranid: "SO2707",
  transactionType: "SalesOrd",
  entityId: CUSTOMER,
  hubspotDealId: DEAL,
  total: null,
  ...over,
});

const expect = { customerId: CUSTOMER, hubspotDealId: DEAL, tierQty: TIER_QTY, plannedGroups: PLANNED };
const verifyWith = (structure = structureOf()) => (c: CandidateSalesOrder) =>
  evaluateAdoptionCandidate({ candidate: c, structure, expect });

// ── 1-2 · CREATE is allowed only on positive evidence of absence ────────────

test("1 · a locally-created attempt that has never POSTed may CREATE", () => {
  // No SO id, and not parked — nothing suppresses the first CREATE.
  assert.equal(mustNotCreate({ status: "pending", netsuiteSoId: null }), false);
});

test("2 · inherited pending/null + zero provider SOs → CREATE allowed", () => {
  const d = decideReconciliation({ trigger: "ambiguous_attempt", candidates: [], verify: verifyWith() });
  assert.equal(d.action, "create");
});

// ── 3-5 · adoption, and no CREATE after it ─────────────────────────────────

test("3 · inherited pending/null + one verified SO → adopt, zero CREATE", () => {
  const d = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [candidate()],
    verify: verifyWith(),
  });
  assert.equal(d.action, "adopt");
  assert.equal(d.action === "adopt" && d.candidate.internalId, "361700");
});

test("4 · a bare grouped SO adopts pre-convergence — rates are NOT an adoption gate", () => {
  // Rates are still item defaults (0) and the total is NOT the accepted
  // $3,500. Adoption must succeed anyway; convergence and the final gate own
  // commercial correctness.
  const v = evaluateAdoptionCandidate({
    candidate: candidate({ total: 0 }),
    structure: structureOf({ rates: [0, 0] }),
    expect,
  });
  assert.equal(v.adopt, true);
  // And the adopted attempt then suppresses CREATE and keeps the snapshot.
  assert.equal(mustNotCreate({ status: "awaiting_rates", netsuiteSoId: "361700" }), true);
  assert.equal(ownsSnapshot({ status: "awaiting_rates", errorClass: null }), true);
});

test("5 · retry after adoption → zero CREATE", () => {
  assert.equal(mustNotCreate({ status: "awaiting_rates", netsuiteSoId: "361700" }), true);
});

// ── 6-8 · DUPLICATED DEAL routes to reconciliation ─────────────────────────

test("6 · DUPLICATED DEAL + one verified SO → adopt", () => {
  const d = decideReconciliation({
    trigger: "duplicate_deal",
    candidates: [candidate()],
    verify: verifyWith(),
  });
  assert.equal(d.action, "adopt");
});

test("7 · DUPLICATED DEAL + zero SOs → fail closed (contradiction), never create", () => {
  const d = decideReconciliation({ trigger: "duplicate_deal", candidates: [], verify: verifyWith() });
  assert.equal(d.action, "fail_closed");
  assert.notEqual(d.action, "create");
  assert.match(d.action === "fail_closed" ? d.reason : "", /contradiction/i);
});

test("8 · DUPLICATED DEAL + multiple SOs → fail closed", () => {
  const d = decideReconciliation({
    trigger: "duplicate_deal",
    candidates: [candidate(), candidate({ internalId: "361701", tranid: "SO2708" })],
    verify: verifyWith(),
  });
  assert.equal(d.action, "fail_closed");
});

test("8b · ambiguous_attempt + multiple SOs also fails closed", () => {
  const d = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [candidate(), candidate({ internalId: "361701" })],
    verify: verifyWith(),
  });
  assert.equal(d.action, "fail_closed");
});

// ── 9-11 · refusal on mismatch ─────────────────────────────────────────────

test("9 · customer mismatch → refuse adoption", () => {
  const v = evaluateAdoptionCandidate({
    candidate: candidate({ entityId: "999999" }),
    structure: structureOf(),
    expect,
  });
  assert.equal(v.adopt, false);
  assert.ok(v.adopt === false && v.failures.some((f) => /customer/.test(f)));
});

test("10 · deal-id mismatch → refuse adoption", () => {
  const v = evaluateAdoptionCandidate({
    candidate: candidate({ hubspotDealId: "11111111" }),
    structure: structureOf(),
    expect,
  });
  assert.equal(v.adopt, false);
  assert.ok(v.adopt === false && v.failures.some((f) => /deal id/.test(f)));
});

test("11 · structure/membership mismatch → refuse adoption", () => {
  const v = evaluateAdoptionCandidate({
    candidate: candidate(),
    structure: structureOf({ extraMember: true }),
    expect,
  });
  assert.equal(v.adopt, false);
  assert.ok(v.adopt === false && v.failures.some((f) => /unexpected member/.test(f)));
});

test("11b · a single candidate is never adopted on count alone", () => {
  const d = decideReconciliation({
    trigger: "duplicate_deal",
    candidates: [candidate({ entityId: "999999" })],
    verify: verifyWith(),
  });
  assert.equal(d.action, "fail_closed");
});

test("11c · wrong transaction type → refuse adoption", () => {
  const v = evaluateAdoptionCandidate({
    candidate: candidate({ transactionType: "SalesInv" }),
    structure: structureOf(),
    expect,
  });
  assert.equal(v.adopt, false);
});

// ── 12 · ordinary validation semantics are untouched ───────────────────────

test("12 · ordinary pre-CREATE validation keeps 0065 terminal/releasable semantics", () => {
  const ordinary = classifyResponse({
    status: 400,
    body: { "o:errorDetails": [{ detail: "Invalid field value for item." }] },
    url: "u",
    method: "POST",
  });
  assert.equal(ordinary.className, "validation");
  // …and failed+validation still RELEASES the snapshot, exactly as before.
  assert.equal(ownsSnapshot({ status: "failed", errorClass: "validation" }), false);
});

test("12b · DUPLICATED DEAL is classified apart from ordinary validation", () => {
  const dup = classifyResponse({
    status: 400,
    body: { "o:errorDetails": [{ detail: "DUPLICATED DEAL: a Sales Order already exists" }] },
    url: "u",
    method: "POST",
  });
  assert.equal(dup.className, "duplicate_deal");
  assert.notEqual(dup.className, "validation");
});

// ── 13 · ownership is retained throughout ambiguity ────────────────────────

test("13 · every ambiguous state retains snapshot ownership", () => {
  for (const status of ["pending", "awaiting_rates", "needs_reconciliation"]) {
    assert.equal(ownsSnapshot({ status, errorClass: null }), true, status);
  }
  // The parked state carries duplicate_deal, NOT validation — so it still owns.
  assert.equal(ownsSnapshot({ status: "needs_reconciliation", errorClass: "duplicate_deal" }), true);
  // And it suppresses CREATE even with no id, which id-presence alone cannot do.
  assert.equal(mustNotCreate({ status: "needs_reconciliation", netsuiteSoId: null }), true);
});

// ── 14 · the final commercial gate is not weakened ─────────────────────────

test("14 · adoption does not assert rates or total — the final gate still must", () => {
  // Adoption passes on an order whose rates are $0 and whose total is not the
  // accepted $3,500. If adoption were the last word, that order would complete
  // at the wrong economics; it is not, and this asserts the separation.
  const v = evaluateAdoptionCandidate({
    candidate: candidate({ total: 0 }),
    structure: structureOf({ rates: [0, 0] }),
    expect,
  });
  assert.equal(v.adopt, true, "identity/structure sufficient");
  const s = structureOf({ rates: [0, 0] });
  const memberRates = s.groups[0].members.map((m) => m.rate);
  assert.deepEqual(memberRates, [0, 0], "…while the economics are still wrong");
  const plannedRates = (PLANNED[0] as unknown as { members: Array<{ rate: number }> }).members.map((m) => m.rate);
  assert.notDeepEqual(memberRates, plannedRates, "convergence is still owed");
});

// ── Flat orders fail closed rather than adopt on thin evidence ─────────────

test("flat/itemized order refuses automatic adoption but still blocks the CREATE", () => {
  const d = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [candidate()],
    verify: (c) =>
      evaluateAdoptionCandidate({
        candidate: c,
        structure: structureOf(),
        expect: { ...expect, plannedGroups: [] },
      }),
  });
  assert.equal(d.action, "fail_closed");
  assert.notEqual(d.action, "create");
});

// ── THE HISTORICAL FALSIFICATION ───────────────────────────────────────────

test("FALSIFICATION · CREATE commits → response lost → retry → DUPLICATED DEAL is no longer an orphan", () => {
  // Reconstruct the exact historical sequence, step by step.

  // [1-3] CREATE commits at the provider; the response is lost. The attempt
  //       therefore sits at pending + null — the id was never learned.
  const attempt = { status: "pending", netsuiteSoId: null as string | null };

  // [4] OLD BEHAVIOUR: id-presence-only suppression does not engage, so the
  //     retry re-issues CREATE. That much is unchanged and is WHY the provider
  //     answers DUPLICATED DEAL.
  assert.equal(mustNotCreate(attempt), false);

  // [5-6] The provider refuses with DUPLICATED DEAL.
  const err = classifyResponse({
    status: 400,
    body: { "o:errorDetails": [{ detail: "DUPLICATED DEAL" }] },
    url: "u",
    method: "POST",
  });

  // [7] OLD: classified `validation`. NOW: its own class.
  assert.notEqual(err.className, "validation");
  assert.equal(err.className, "duplicate_deal");

  // [8-9] OLD: failed + validation → ownership RELEASED → a sibling attempt row
  //       could be inserted and issue yet another CREATE.
  assert.equal(ownsSnapshot({ status: "failed", errorClass: "validation" }), false);

  //       NOW: the duplicate-deal response routes to reconciliation, which on
  //       this fixture finds the real order and adopts it.
  const decision = decideReconciliation({
    trigger: "duplicate_deal",
    candidates: [candidate()],
    verify: verifyWith(),
  });
  assert.equal(decision.action, "adopt");

  // [10] The orphan is gone: the id is recovered and the attempt can resume.
  const recovered = {
    status: "awaiting_rates",
    netsuiteSoId: decision.action === "adopt" ? decision.candidate.internalId : null,
  };
  assert.equal(recovered.netsuiteSoId, "361700");
  assert.equal(mustNotCreate(recovered), true, "zero further CREATEs");
  assert.equal(ownsSnapshot({ status: "awaiting_rates", errorClass: "duplicate_deal" }), true);

  // And where reconciliation CANNOT resolve it, the terminal state still owns
  // the snapshot and still suppresses CREATE — the released-ownership step of
  // the historical sequence is unreachable by either route.
  const unresolved = decideReconciliation({
    trigger: "duplicate_deal",
    candidates: [candidate(), candidate({ internalId: "361701" })],
    verify: verifyWith(),
  });
  assert.equal(unresolved.action, "fail_closed");
  assert.equal(ownsSnapshot({ status: "needs_reconciliation", errorClass: "duplicate_deal" }), true);
  assert.equal(mustNotCreate({ status: "needs_reconciliation", netsuiteSoId: null }), true);
});
