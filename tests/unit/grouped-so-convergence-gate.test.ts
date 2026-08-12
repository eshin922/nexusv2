// Grouped-SO push — Step 3: structural read-back, rate convergence, gate.
//
// Mocked provider shapes throughout. SO2701 is not touched and no live
// grouped CREATE is performed.
//
// The Case B shape is used deliberately: DPS-BOTTLE-0001 appears in BOTH
// groups at DIFFERENT negotiated rates ($4 in A, $2 in B). Swapping those two
// lines preserves the $12,000 total exactly, so any check that reconciles on
// totals alone passes a wrong order. That repeated Bottle is the falsification
// instrument for most of what follows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateSuccessGate,
  matchGroupMembership,
  normalizeStructure,
  planRateConvergence,
  type ObservedLine,
} from "../../src/lib/netsuite/so-structure.ts";

const soStructure = readFileSync("src/lib/netsuite/so-structure.ts", "utf8");

const TIER = 1000;
const ACCEPTED_TOTAL = 12000;

const planA = {
  assemblyId: "a", assemblySku: "OD004-CASEB-A", assemblyName: "A",
  compositionHash: "hA", externalId: "nxs-grp-hA",
  members: [
    { sku: "10064-GNX-Box", netsuiteItemId: "1024", quantity: 1000, rate: 6, amount: 6000 },
    { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, rate: 4, amount: 4000 },
  ],
  expectedAmount: 10000, turnkeyUnitPrice: 10,
} as never as import("../../src/lib/netsuite/grouping-plan.ts").PlannedGroup;

const planB = {
  assemblyId: "b", assemblySku: "OD004-CASEB-B", assemblyName: "B",
  compositionHash: "hB", externalId: "nxs-grp-hB",
  members: [
    { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, rate: 2, amount: 2000 },
  ],
  expectedAmount: 2000, turnkeyUnitPrice: 2,
} as never as import("../../src/lib/netsuite/grouping-plan.ts").PlannedGroup;

const PLAN = [planA, planB];

const line = (o: Partial<ObservedLine>): ObservedLine => ({
  kind: "member", netsuiteItemId: null, quantity: null, rate: null,
  amount: null, patchAddress: null, ...o,
});

/** Provider shape after a bare-group CREATE: members expanded at $0.00. */
const freshlyExpanded = (): ObservedLine[] => [
  line({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
  line({ netsuiteItemId: "1024", quantity: 1000, rate: 0, amount: 0, classId: "10", patchAddress: 2 }),
  line({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, classId: "1", patchAddress: 3 }),
  line({ kind: "endGroup", amount: 0, patchAddress: 4 }),
  line({ kind: "group", netsuiteItemId: "90002", quantity: TIER, patchAddress: 5 }),
  line({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, classId: "1", patchAddress: 6 }),
  line({ kind: "endGroup", amount: 0, patchAddress: 7 }),
  line({ kind: "system", quantity: -1, rate: 0, amount: 0, patchAddress: 8 }),
];

/** Fully converged: every member at its planned rate. */
const converged = (): ObservedLine[] => [
  line({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
  line({ netsuiteItemId: "1024", quantity: 1000, rate: 6, amount: 6000, classId: "10", patchAddress: 2 }),
  line({ netsuiteItemId: "66476", quantity: 1000, rate: 4, amount: 4000, classId: "1", patchAddress: 3 }),
  line({ kind: "endGroup", amount: 10000, patchAddress: 4 }),
  line({ kind: "group", netsuiteItemId: "90002", quantity: TIER, patchAddress: 5 }),
  line({ netsuiteItemId: "66476", quantity: 1000, rate: 2, amount: 2000, classId: "1", patchAddress: 6 }),
  line({ kind: "endGroup", amount: 2000, patchAddress: 7 }),
  line({ kind: "system", quantity: -1, rate: 0, amount: 0, patchAddress: 8 }),
];

const header = { customerId: "72173", hubspotDealId: "58332160883", businessSegmentId: "3", termsId: "2" };
const expectHeader = { customerId: "72173", hubspotDealId: "58332160883", businessSegmentId: "3", termsPresent: true };
const CLASSES = new Map([["1024", "10"], ["66476", "1"]]);

const gate = (lines: ObservedLine[], over: Partial<Parameters<typeof evaluateSuccessGate>[0]> = {}) =>
  evaluateSuccessGate({
    plannedGroups: PLAN, structure: normalizeStructure(lines), tierQty: TIER,
    acceptedTotal: ACCEPTED_TOTAL, header, expectHeader,
    expectedClassByItemId: CLASSES, ...over,
  });

// ── structural normalization ─────────────────────────────────────────────

test("1 · folds a flat line list into Group → members → EndGroup", () => {
  const s = normalizeStructure(converged());
  assert.equal(s.groups.length, 2);
  assert.equal(s.groups[0].members.length, 2);
  assert.equal(s.groups[1].members.length, 1);
  assert.equal(s.groups[0].endGroupAmount, 10000);
  assert.equal(s.groups[1].endGroupAmount, 2000);
  assert.equal(s.ungroupedMembers.length, 0);
  assert.equal(s.systemLines.length, 1, "tax line partitioned out, not a member");
});

test("2 · an unterminated group is recorded, not silently merged", () => {
  const s = normalizeStructure([
    line({ kind: "group", netsuiteItemId: "90001", quantity: TIER }),
    line({ netsuiteItemId: "1024", quantity: 1000, rate: 6 }),
    line({ kind: "group", netsuiteItemId: "90002", quantity: TIER }),
    line({ netsuiteItemId: "66476", quantity: 1000, rate: 2 }),
    line({ kind: "endGroup", amount: 2000 }),
  ]);
  assert.equal(s.groups.length, 2);
  assert.equal(s.groups[0].unterminated, true);
  assert.equal(s.groups[1].unterminated, false);
});

test("3 · GROUP QUANTITY SEMANTICS — group qty 1000 × member qty 1 → member qty 1000", () => {
  // Asserted against the OBSERVED expansion, not derived arithmetically and
  // not assumed from the manual UI probe (which used group quantity 1 and saw
  // members expand at 1).
  const s = normalizeStructure(converged());
  assert.equal(s.groups[0].headerQuantity, 1000, "group header carries the tier quantity");
  for (const m of s.groups[0].members) assert.equal(m.quantity, 1000);
  assert.equal(s.groups[1].members[0].quantity, 1000);
  // And a group header at the wrong quantity is caught.
  const wrong = normalizeStructure(converged());
  wrong.groups[0].headerQuantity = 1;
  const problems = matchGroupMembership(planA, wrong.groups[0], TIER);
  assert.match(problems.map((p) => p.problem).join("|"), /group header quantity 1 ≠ tier quantity 1000/);
});

// ── membership matching ──────────────────────────────────────────────────

test("4 · the repeated Bottle defeats SKU-only matching — swap is REJECTED", () => {
  // Correct membership, but A's Bottle patched to B's rate and vice versa.
  // Group A: 6000 + 2000 = 8000. Group B: 4000. Total STILL 12,000.
  const swapped = converged();
  swapped[2] = line({ netsuiteItemId: "66476", quantity: 1000, rate: 2, amount: 2000, classId: "1", patchAddress: 3 });
  swapped[3] = line({ kind: "endGroup", amount: 8000, patchAddress: 4 });
  swapped[5] = line({ netsuiteItemId: "66476", quantity: 1000, rate: 4, amount: 4000, classId: "1", patchAddress: 6 });
  swapped[6] = line({ kind: "endGroup", amount: 4000, patchAddress: 7 });

  const totals = 8000 + 4000;
  assert.equal(totals, ACCEPTED_TOTAL, "the swap reconciles on total");

  const r = gate(swapped);
  assert.equal(r.pass, false, "and is still rejected");
  assert.match(r.failures.join("|"), /rate 2 ≠ planned 4/);
  assert.match(r.failures.join("|"), /group amount 8000 ≠ expected 10000/);
});

test("5 · duplicate, missing and extra members are each rejected", () => {
  const dup = converged();
  dup.splice(3, 0, line({ netsuiteItemId: "66476", quantity: 1000, rate: 4, amount: 4000, patchAddress: 99 }));
  assert.match(gate(dup).failures.join("|"), /duplicate member 66476/);

  const missing = converged().filter((_, i) => i !== 2);
  assert.match(gate(missing).failures.join("|"), /missing member 66476/);

  const extra = converged();
  extra.splice(3, 0, line({ netsuiteItemId: "99999", quantity: 5, rate: 1, amount: 5, patchAddress: 98 }));
  assert.match(gate(extra).failures.join("|"), /unexpected member 99999/);
});

// ── convergence planning ─────────────────────────────────────────────────

test("6 · first invocation plans $0.00 → negotiated for every member", () => {
  const plan = planRateConvergence(PLAN, normalizeStructure(freshlyExpanded()), TIER);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.alreadyCorrect, 0);
  assert.deepEqual(
    plan.patches.map((p) => [p.netsuiteItemId, p.address, p.desiredRate]),
    [["1024", 2, 6], ["66476", 3, 4], ["66476", 6, 2]],
  );
  // The two Bottles are separately addressed at their OWN group's rate.
  const bottles = plan.patches.filter((p) => p.netsuiteItemId === "66476");
  assert.deepEqual(bottles.map((b) => b.desiredRate), [4, 2]);
  assert.notEqual(bottles[0].address, bottles[1].address);
});

test("7 · a fully-correct order performs NO commercial mutation", () => {
  const plan = planRateConvergence(PLAN, normalizeStructure(converged()), TIER);
  assert.deepEqual(plan.patches, [], "zero patches");
  assert.equal(plan.alreadyCorrect, 3);
  assert.deepEqual(plan.blockers, []);
});

test("8 · a PARTIALLY converged order patches only what remains", () => {
  // Crash after the first two PATCHes: Box and A-Bottle correct, B-Bottle not.
  const partial = converged();
  partial[5] = line({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, classId: "1", patchAddress: 6 });
  partial[6] = line({ kind: "endGroup", amount: 0, patchAddress: 7 });

  const plan = planRateConvergence(PLAN, normalizeStructure(partial), TIER);
  assert.equal(plan.alreadyCorrect, 2);
  assert.deepEqual(
    plan.patches.map((p) => [p.netsuiteItemId, p.address, p.desiredRate]),
    [["66476", 6, 2]],
    "only the remaining member",
  );
});

test("9 · desired rates come ONLY from the plan, never from the order", () => {
  // An order carrying plausible-but-wrong rates must still be driven to the
  // planned values, not accepted as self-describing.
  const wrong = converged();
  wrong[1] = line({ netsuiteItemId: "1024", quantity: 1000, rate: 5.5, amount: 5500, classId: "10", patchAddress: 2 });
  const plan = planRateConvergence(PLAN, normalizeStructure(wrong), TIER);
  assert.deepEqual(plan.patches.map((p) => p.desiredRate), [6]);
  assert.equal(plan.patches[0].observedRate, 5.5);
});

test("10 · planning REFUSES when the read-back supplied no provider address", () => {
  // A wrong index is worse than a failed PATCH: it succeeds against the wrong
  // line and yields a commercially wrong but valid order. So an absent address
  // must never be replaced by a derived one.
  const noAddr = freshlyExpanded().map((l) =>
    l.kind === "member" ? { ...l, patchAddress: null } : l,
  );
  const plan = planRateConvergence(PLAN, normalizeStructure(noAddr), TIER);
  assert.equal(plan.patches.length, 0);
  assert.equal(plan.blockers.length, 3);
  assert.match(plan.blockers.join("|"), /refusing to derive one/);
});

test("11 · planning REFUSES to patch into a wrong-membership structure", () => {
  // Patching a wrong-membership order would make it reconcile on totals while
  // shipping the wrong contents.
  const extra = freshlyExpanded();
  extra.splice(3, 0, line({ netsuiteItemId: "99999", quantity: 5, rate: 0, patchAddress: 97 }));
  const plan = planRateConvergence(PLAN, normalizeStructure(extra), TIER);
  assert.match(plan.blockers.join("|"), /unexpected member 99999/);
  assert.equal(plan.patches.length, 0);
});

test("12 · line indices are never persisted — addresses come from the read-back", () => {
  // The address is an input on ObservedLine, produced by the read-back, and
  // planning re-derives the patch set from a fresh structure every call.
  assert.match(soStructure, /Opaque — never derived/);
  assert.match(soStructure, /THE LINE-ADDRESS BOUNDARY/);
  // Same structure, addresses reordered by the provider → plan follows the
  // NEW addresses rather than any remembered value.
  const reordered = freshlyExpanded().map((l) =>
    l.patchAddress === null ? l : { ...l, patchAddress: l.patchAddress + 100 },
  );
  const plan = planRateConvergence(PLAN, normalizeStructure(reordered), TIER);
  assert.deepEqual(plan.patches.map((p) => p.address), [102, 103, 106]);
});

// ── success gate ─────────────────────────────────────────────────────────

test("13 · the gate PASSES only on a fully converged, correct order", () => {
  const r = gate(converged());
  assert.deepEqual(r.failures, []);
  assert.equal(r.pass, true);
});

test("14 · a member still at $0.00 fails the gate", () => {
  const r = gate(freshlyExpanded());
  assert.equal(r.pass, false);
  assert.match(r.failures.join("|"), /is \$0\.00 — the un-priced expansion state/);
});

test("15 · a wrong GROUP amount fails even when the overall total is right", () => {
  // A's EndGroup understates by 1000, B's overstates by 1000. Σ = 12,000.
  const skewed = converged();
  skewed[3] = line({ kind: "endGroup", amount: 9000, patchAddress: 4 });
  skewed[6] = line({ kind: "endGroup", amount: 3000, patchAddress: 7 });
  const r = gate(skewed);
  assert.equal(r.pass, false);
  assert.match(r.failures.join("|"), /group amount 9000 ≠ expected 10000/);
  assert.match(r.failures.join("|"), /group amount 3000 ≠ expected 2000/);
  assert.doesNotMatch(r.failures.join("|"), /Σ group amounts/, "the total itself reconciles");
});

test("16 · header equality is NOT sufficient when membership or rates fail", () => {
  const r = gate(freshlyExpanded());
  assert.equal(r.pass, false);
  // Header is perfect in this fixture — the failures are all commercial.
  assert.doesNotMatch(r.failures.join("|"), /customer|HubSpot deal|Business Segment|Terms/);
  assert.ok(r.failures.length > 0);
});

test("17 · header divergences are reported IN ADDITION to commercial ones", () => {
  const r = gate(converged(), {
    header: { customerId: "999", hubspotDealId: "58332160883", businessSegmentId: "1", termsId: null },
  });
  assert.equal(r.pass, false);
  assert.match(r.failures.join("|"), /customer 999 ≠ 72173/);
  assert.match(r.failures.join("|"), /Business Segment 1 ≠ 3/);
  assert.match(r.failures.join("|"), /Terms absent/);
});

test("18 · Item-derived Class must be preserved on members", () => {
  const wrongClass = converged();
  wrongClass[1] = line({ netsuiteItemId: "1024", quantity: 1000, rate: 6, amount: 6000, classId: "1", patchAddress: 2 });
  const r = gate(wrongClass);
  assert.equal(r.pass, false);
  assert.match(r.failures.join("|"), /class 1 ≠ Item-derived 10/);
});

test("19 · Σ group amounts must equal the accepted total", () => {
  const r = gate(converged(), { acceptedTotal: 13000 });
  assert.equal(r.pass, false);
  assert.match(r.failures.join("|"), /Σ group amounts 12000 ≠ accepted total 13000/);
});

test("20 · FALSIFICATION — crash-after-zero and crash-after-some both converge", () => {
  // Crash after zero PATCHes: the plan is the full set, unchanged from a
  // first invocation.
  const zero = planRateConvergence(PLAN, normalizeStructure(freshlyExpanded()), TIER);
  assert.equal(zero.patches.length, 3);

  // Crash after some: only the remainder, and re-running after completion is
  // a no-op. Convergence, not replay.
  const some = converged();
  some[5] = line({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, patchAddress: 6 });
  some[6] = line({ kind: "endGroup", amount: 0, patchAddress: 7 });
  assert.equal(planRateConvergence(PLAN, normalizeStructure(some), TIER).patches.length, 1);
  assert.equal(planRateConvergence(PLAN, normalizeStructure(converged()), TIER).patches.length, 0);

  // And a verification failure can never be reported as success.
  assert.equal(gate(freshlyExpanded()).pass, false);
  assert.equal(gate(some).pass, false);
});
