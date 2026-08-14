// Two defects from the 2026-08-13 SO2707 incident.
//
// WHAT HAPPENED. A certification quote on the Root deal reached Complete. The
// deal already carried SO2707 from a sibling quote. Candidates are matched on
// `custbody_dps_deal_id`, so exactly one candidate was found, adopted, and rate
// convergence rewrote its member rates (1.25 → 0.5365, 2.25 → 1.8705), taking a
// completed order's total from 3500 to 2407. The run then failed its own gate
// because that gate summed only Item Group amounts against the full accepted
// total, which a mixed order can never satisfy.
//
// Both are guarded here: ownership before adoption, and a gate that checks the
// whole accepted structure rather than the grouped half of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideReconciliation } from "../../src/lib/netsuite/create-reconciliation-rules.ts";
import {
  evaluateSuccessGate,
  normalizeStructure,
  planRateConvergence,
  type ObservedLine,
} from "../../src/lib/netsuite/so-structure.ts";

// ───────────────────────────── ownership veto ─────────────────────────────

const SO2707 = {
  internalId: "361542",
  tranid: "SO2707",
  transactionType: "SalesOrd" as const,
  entityId: "360189",
  hubspotDealId: "59153706532",
  total: 3500,
};

test("an order owned by another quote is never adopted — the SO2707 case", () => {
  const decision = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [SO2707],
    // Deliberately a verifier that WOULD adopt. Ownership must override it:
    // a sibling scenario's order can look structurally plausible, so
    // verification alone cannot separate the two.
    verify: () => ({ adopt: true, failures: [] }),
    isOwnedByAnotherQuote: (c) => c.internalId === "361542",
  });
  assert.equal(decision.action, "fail_closed");
  assert.match(
    decision.action === "fail_closed" ? decision.reason : "",
    /already owned by a different Nexus quote/,
  );
});

test("ownership is checked BEFORE verification, not after", () => {
  let verifyCalled = false;
  decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [SO2707],
    verify: () => {
      verifyCalled = true;
      return { adopt: false, failures: ["x"] };
    },
    isOwnedByAnotherQuote: () => true,
  });
  // Order matters: if verification ran first, a future refactor could let a
  // verification outcome decide before ownership is consulted.
  assert.equal(verifyCalled, false);
});

test("an unowned candidate still goes through full verification", () => {
  // The repair must not weaken the existing checks — an unowned candidate is
  // adopted only if it verifies, exactly as before.
  const rejected = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [SO2707],
    verify: () => ({ adopt: false, failures: ["structure mismatch"] }),
    isOwnedByAnotherQuote: () => false,
  });
  assert.equal(rejected.action, "fail_closed");

  const adopted = decideReconciliation({
    trigger: "ambiguous_attempt",
    candidates: [SO2707],
    verify: () => ({ adopt: true, failures: [] }),
    isOwnedByAnotherQuote: () => false,
  });
  assert.equal(adopted.action, "adopt");
});

test("multi-candidate and zero-candidate behaviour is unchanged", () => {
  assert.equal(
    decideReconciliation({
      trigger: "ambiguous_attempt",
      candidates: [],
      verify: () => ({ adopt: false, failures: [] }),
      isOwnedByAnotherQuote: () => true,
    }).action,
    "create",
  );
  assert.equal(
    decideReconciliation({
      trigger: "ambiguous_attempt",
      candidates: [SO2707, { ...SO2707, internalId: "9" }],
      verify: () => ({ adopt: true, failures: [] }),
      isOwnedByAnotherQuote: () => false,
    }).action,
    "fail_closed",
  );
});

// ──────────────────────── mixed-order success gate ────────────────────────

const line = (o: Partial<ObservedLine> & { kind: ObservedLine["kind"] }): ObservedLine => ({
  netsuiteItemId: null,
  quantity: null,
  rate: null,
  amount: null,
  patchAddress: null,
  ...o,
});

/** Group(2 members) + one Direct line — the certified mixed shape. */
function mixedLines(opts: { includeDirect: boolean }): ObservedLine[] {
  const rows: ObservedLine[] = [
    line({ kind: "group", netsuiteItemId: "999", quantity: 1000 }),
    line({ kind: "member", netsuiteItemId: "1024", quantity: 1000, rate: 0.537, amount: 537 }),
    line({ kind: "member", netsuiteItemId: "66476", quantity: 1000, rate: 1.871, amount: 1871 }),
    line({ kind: "endGroup", netsuiteItemId: null, amount: 2408 }),
  ];
  if (opts.includeDirect) {
    rows.push(
      line({ kind: "member", netsuiteItemId: "71529", quantity: 1000, rate: 3.668, amount: 3668 }),
    );
  }
  return rows;
}

const plannedGroups = [
  {
    assemblyId: "a",
    assemblySku: "CERT-GRP",
    assemblyName: "Certification Item Group",
    compositionHash: "h",
    externalId: "nxs-grp-h",
    members: [
      { sku: "10064-GNX-Box", netsuiteItemId: "1024", quantity: 1000, qtyPerParent: 1, rate: 0.537, unitCost: 0.37, amount: 537 },
      { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, qtyPerParent: 1, rate: 1.871, unitCost: 1.29, amount: 1871 },
    ],
    expectedAmount: 2408,
    turnkeyUnitPrice: 2.408,
  },
];

const plannedDirectLines = [
  { sku: "BA146400", netsuiteItemId: "71529", quantity: 1000, rate: 3.668, amount: 3668 },
];

const header = {
  customerId: "360189",
  hubspotDealId: "59153706532",
  businessSegmentId: null,
  termsId: "7",
};
const expectHeader = {
  customerId: "360189",
  hubspotDealId: "59153706532",
  businessSegmentId: null,
  termsPresent: true,
};

const ACCEPTED_TOTAL = 6076;

test("a correct mixed order PASSES — groups plus Direct equal the accepted total", () => {
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    plannedDirectLines,
    structure: normalizeStructure(mixedLines({ includeDirect: true })),
    tierQty: 1000,
    acceptedTotal: ACCEPTED_TOTAL,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.deepEqual(gate.failures, []);
  assert.equal(gate.pass, true);
});

// ── THE FALSIFICATION FOR THE OBSERVED DEFECT ──
test("a mixed order MISSING its Direct line fails, though the rest reconciles", () => {
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    plannedDirectLines,
    structure: normalizeStructure(mixedLines({ includeDirect: false })),
    tierQty: 1000,
    // The accepted total the customer agreed to — including the Direct line.
    acceptedTotal: ACCEPTED_TOTAL,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.equal(gate.pass, false);
  // The decisive assertion is PRESENCE, named as such — not a total mismatch
  // that an operator has to decode.
  assert.ok(
    gate.failures.some((f) => /BA146400.*ABSENT/.test(f)),
    `expected an explicit absence failure, got: ${gate.failures.join(" | ")}`,
  );
});

test("the internally-consistent remainder is what makes absence dangerous", () => {
  // Same order, but the accepted total reduced to match only the group. Every
  // group check passes and the arithmetic reconciles — this is exactly the
  // shape a totals-only gate would wave through.
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    plannedDirectLines: [],
    structure: normalizeStructure(mixedLines({ includeDirect: false })),
    tierQty: 1000,
    acceptedTotal: 2408,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.deepEqual(gate.failures, []);
  // So the ONLY thing distinguishing the healthy case from the incident is
  // whether the Direct line was declared as accepted.
});

test("a Direct Product swallowed into a group is reported as misattribution", () => {
  const swallowed: ObservedLine[] = [
    line({ kind: "group", netsuiteItemId: "999", quantity: 1000 }),
    line({ kind: "member", netsuiteItemId: "1024", quantity: 1000, rate: 0.537, amount: 537 }),
    line({ kind: "member", netsuiteItemId: "66476", quantity: 1000, rate: 1.871, amount: 1871 }),
    line({ kind: "member", netsuiteItemId: "71529", quantity: 1000, rate: 3.668, amount: 3668 }),
    line({ kind: "endGroup", netsuiteItemId: null, amount: 6076 }),
  ];
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    plannedDirectLines,
    structure: normalizeStructure(swallowed),
    tierQty: 1000,
    acceptedTotal: ACCEPTED_TOTAL,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.equal(gate.pass, false);
  assert.ok(
    gate.failures.some((f) => /INSIDE an Item Group/.test(f)),
    `expected a misattribution failure, got: ${gate.failures.join(" | ")}`,
  );
});

test("an ungrouped line that was never accepted still fails", () => {
  // The old rule refused EVERY ungrouped line. The new rule refuses the
  // unplanned ones — narrowed, not removed.
  const rogue = [
    ...mixedLines({ includeDirect: true }),
    line({ kind: "member", netsuiteItemId: "88888", quantity: 5, rate: 1, amount: 5 }),
  ];
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    plannedDirectLines,
    structure: normalizeStructure(rogue),
    tierQty: 1000,
    acceptedTotal: ACCEPTED_TOTAL,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.equal(gate.pass, false);
  assert.ok(gate.failures.some((f) => /unexpected ungrouped line/.test(f)));
});

test("a group-only order is unaffected by the repair", () => {
  const gate = evaluateSuccessGate({
    plannedGroups: plannedGroups as never,
    // No Direct lines declared — the pre-existing shape.
    structure: normalizeStructure(mixedLines({ includeDirect: false })),
    tierQty: 1000,
    acceptedTotal: 2408,
    header: header as never,
    expectHeader: expectHeader as never,
  });
  assert.deepEqual(gate.failures, []);
});

// ───────────────── the planner, not just the gate (SO2714) ─────────────────
//
// Repairing `evaluateSuccessGate` alone was insufficient, and the live artifact
// proved it. `planRateConvergence` carried the same "every line is grouped"
// assumption, blocked on the Direct line, and therefore patched NO rates at
// all — leaving both group members at the $0.00 un-priced expansion on SO2714
// while the Direct line was perfectly correct.
//
// The acting half matters more than the reporting half: a wrong report is a
// wrong message, a blocked planner is an unpriced order.

test("the planner patches group members when a PLANNED Direct line is present", () => {
  const plan = planRateConvergence(
    plannedGroups as never,
    normalizeStructure(mixedLines({ includeDirect: true })),
    1000,
    plannedDirectLines,
  );
  assert.deepEqual(plan.blockers, []);
});

test("the planner still blocks on an UNPLANNED ungrouped line", () => {
  // Narrowed, not removed: an ungrouped line nobody accepted must still stop
  // the run rather than be patched around.
  const plan = planRateConvergence(
    plannedGroups as never,
    normalizeStructure(mixedLines({ includeDirect: true })),
    1000,
    [], // the Direct line is NOT declared
  );
  assert.ok(plan.blockers.some((b) => /unplanned item line/.test(b)));
});

test("blocking the planner is what leaves members un-priced", () => {
  // The failure mode as observed: with the Direct line undeclared the planner
  // returns no patches, so every member keeps rate 0 — which the gate then
  // correctly reports as the un-priced expansion state. One missed assumption
  // in the planner produces both symptoms.
  const blocked = planRateConvergence(
    plannedGroups as never,
    normalizeStructure(mixedLines({ includeDirect: true })),
    1000,
    [],
  );
  assert.equal(blocked.patches.length, 0);
});
