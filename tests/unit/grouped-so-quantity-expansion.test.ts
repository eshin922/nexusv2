/**
 * The Item Group quantity contract, and the SO2703 defect that established it.
 *
 * NetSuite expands a group line as `group-line quantity × member-definition
 * quantity`. The adapter wrote the tier-EXPANDED quantity into the reusable
 * Item Group definition and mark-complete then sent the tier quantity on the
 * line, so the multiplication happened twice. SO2703 shipped members at
 * 1,000,000 units from a 1,000-unit tier of single-item groups, and the
 * verification gate refused it.
 *
 *   Group definition   Box × 1, Bottle × 1     ← reusable master data
 *   Sales Order line   Group × 1,000           ← this order
 *   NetSuite expands   Box × 1,000, Bottle × 1,000
 *
 * The identity consequence is the reason this is not a one-line arithmetic
 * fix: an Item Group is SHARED master data, so its composition hash must
 * describe the composition and nothing about the order that happened to
 * create it. Hashing the transaction quantity made the same product mix
 * resolve to a different group for every tier size.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  buildGroupingPlan,
  type PlanLineInput,
} from "../../src/lib/netsuite/grouping-plan.ts";
import { adaptPlannedGroup } from "../../src/lib/netsuite/grouping-plan-adapter.ts";
import {
  matchGroupMembership,
  normalizeStructure,
  planRateConvergence,
  evaluateSuccessGate,
  type ObservedLine,
} from "../../src/lib/netsuite/so-structure.ts";
import {
  failureStatusFor,
  ownsSnapshot,
} from "../../src/lib/netsuite/attempt-lifecycle-rules.ts";

const CUSTOMER = "11377";
const TIER = 1000;

const ctx = {
  customerNetsuiteId: CUSTOMER,
  subsidiaryId: "2",
  customerDisplay: "Roman Health Ventures, Inc",
  dealName: "Ro - GLP-1 Epson Proofs",
  hubspotDealId: "55307858178",
  quoteId: "q-1",
  userId: "u-1",
};

/** The certification fixture: A = Box + Bottle @ $10k, B = Bottle @ $2k. */
function certLines(tierQty = TIER): PlanLineInput[] {
  const l = (
    assemblyId: string,
    sku: string,
    nsId: string,
    rate: number,
    qtyPerParent = 1,
  ): PlanLineInput => ({
    assemblyId,
    assemblySku: `OD004-CERT-${assemblyId}`,
    assemblyName: `OD004 Cert Group ${assemblyId}`,
    sku,
    netsuiteItemId: nsId,
    quantity: tierQty * qtyPerParent,
    qtyPerParent,
    rate,
  });
  return [
    l("A", "10064-GNX-Box", "1024", 6),
    l("A", "DPS-BOTTLE-0001", "66476", 4),
    l("B", "DPS-BOTTLE-0001", "66476", 2),
  ];
}

const planFor = (tierQty = TIER, lines = certLines(tierQty)) =>
  buildGroupingPlan({
    detailLevel: "turnkey_only",
    customerNetsuiteId: CUSTOMER,
    tierQty,
    lines,
  });

// ── 1-3 · the contract itself ──────────────────────────────────────────────

test("1 · the Item Group DEFINITION carries the per-group multiplier, not the tier-expanded quantity", () => {
  const plan = planFor();
  const a = adaptPlannedGroup(plan.groups[0], ctx);

  assert.deepEqual(
    a.members.map((m) => [m.netsuiteItemId, m.quantity]),
    [["1024", 1], ["66476", 1]],
    "one Box and one Bottle per group",
  );
  // Stated as its own assertion because 1,000 is the specific wrong value that
  // reached NetSuite, not merely "some number other than 1".
  for (const m of a.members) {
    assert.notEqual(m.quantity, TIER, "the tier quantity must never reach the definition");
  }
  // The hash sees the definition, so it must carry the same figures.
  assert.deepEqual(
    a.hashInput.members.map((m) => m.quantity),
    [1, 1],
  );
});

test("2 · the Sales Order group LINE carries the tier quantity", () => {
  const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const emission = markComplete.slice(
    markComplete.indexOf("emittedGroupLines.push("),
  );
  assert.match(
    emission.slice(0, 200),
    /quantity: groupingPlan\.tierQty/,
    "the group line quantity is the tier quantity, sourced from the frozen plan",
  );
});

test("3 · provider expansion is therefore expected at line × definition", () => {
  const plan = planFor();
  // What NetSuite produces from `group × 1000` over `member × 1`.
  const expanded = normalizeStructure([
    obs({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
    obs({ netsuiteItemId: "1024", quantity: 1000, rate: 0, amount: 0, patchAddress: 2 }),
    obs({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, patchAddress: 3 }),
    obs({ kind: "endGroup", amount: 0, patchAddress: 4 }),
  ]);
  assert.deepEqual(
    matchGroupMembership(plan.groups[0], expanded.groups[0], TIER),
    [],
    "1,000 expanded members satisfy a 1-per-group definition at a 1,000 tier",
  );
});

// ── 4-6 · identity describes the composition, not the order ────────────────

test("4 · identity CHANGES when the per-parent composition changes", () => {
  const one = planFor();
  // Two Bottles per group — a genuinely different reusable composition.
  const twoBottles = certLines().map((l) =>
    l.assemblyId === "A" && l.netsuiteItemId === "66476"
      ? { ...l, qtyPerParent: 2, quantity: TIER * 2 }
      : l,
  );
  const two = planFor(TIER, twoBottles);

  assert.ok(one.groups[0].compositionHash);
  assert.notEqual(
    one.groups[0].compositionHash,
    two.groups[0].compositionHash,
    "a different composition is a different reusable group",
  );
});

test("5 · identity does NOT change merely because a bigger tier buys more copies", () => {
  const small = planFor(1000);
  const large = planFor(5000);

  assert.equal(
    small.groups[0].compositionHash,
    large.groups[0].compositionHash,
    "tier size is a property of the order, not of the group",
  );
  // …while the commercial figures do scale, so this is not identity collapse.
  assert.equal(small.groups[0].expectedAmount, 10000);
  assert.equal(large.groups[0].expectedAmount, 50000);
});

test("6 · two tiers of the same composition resolve to ONE reusable Item Group", () => {
  const ids = [500, 1000, 25000].map(
    (q) => adaptPlannedGroup(planFor(q).groups[0], ctx).expectedExternalId,
  );
  assert.equal(new Set(ids).size, 1, `expected one identity, got ${JSON.stringify(ids)}`);
  assert.match(String(ids[0]), /^nxs-grp-[0-9a-f]{64}$/);
});

// ── 7 · the old behaviour, falsified ───────────────────────────────────────

test("7 · the 1,000 × 1,000 → 1,000,000 expansion is falsified", () => {
  const plan = planFor();
  const a = adaptPlannedGroup(plan.groups[0], ctx);

  // The defect, stated arithmetically: whatever the definition holds gets
  // multiplied by the group-line quantity. With the old value it produced the
  // quantity SO2703 actually shipped.
  const wouldExpandTo = (definitionQty: number) => definitionQty * TIER;
  assert.equal(wouldExpandTo(TIER), 1_000_000, "the defect, reproduced");
  assert.equal(wouldExpandTo(a.members[0].quantity), 1000, "the repair");

  // And a group still holding the old definition is refused as stale rather
  // than emitted — 1,000,000 can no longer reach a Sales Order by this path.
  const million = normalizeStructure([
    obs({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
    obs({ netsuiteItemId: "1024", quantity: 1_000_000, rate: 0, amount: 0, patchAddress: 2 }),
    obs({ netsuiteItemId: "66476", quantity: 1_000_000, rate: 0, amount: 0, patchAddress: 3 }),
    obs({ kind: "endGroup", amount: 0, patchAddress: 4 }),
  ]);
  const problems = matchGroupMembership(plan.groups[0], million.groups[0], TIER);
  assert.ok(problems.length > 0, "the SO2703 shape must not validate");
  assert.match(problems.map((p) => p.problem).join("|"), /quantity 1000000 ≠ planned 1000/);
});

// ── 8-10 · the gate that caught it stays intact ────────────────────────────

test("8 · a structural mismatch still prevents EVERY rate patch", () => {
  const plan = planFor();
  // Group A mis-expanded; Group B perfectly sound.
  const mixed = normalizeStructure([
    obs({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
    obs({ netsuiteItemId: "1024", quantity: 1_000_000, rate: 0, amount: 0, patchAddress: 2 }),
    obs({ netsuiteItemId: "66476", quantity: 1_000_000, rate: 0, amount: 0, patchAddress: 3 }),
    obs({ kind: "endGroup", amount: 0, patchAddress: 4 }),
    obs({ kind: "group", netsuiteItemId: "90002", quantity: TIER, patchAddress: 5 }),
    obs({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, patchAddress: 6 }),
    obs({ kind: "endGroup", amount: 0, patchAddress: 7 }),
  ]);

  const convergence = planRateConvergence(plan.groups, mixed, TIER);

  assert.ok(convergence.blockers.length > 0);
  assert.equal(
    convergence.patches.length,
    0,
    "the sound sibling is not patched either — a partly-correct order is the " +
      "worst outcome, because its total can still look right",
  );
});

test("9 · a verification failure cannot report the push as succeeded", () => {
  const plan = planFor();
  // Rates never applied: exactly the SO2703 end state.
  const unpriced = normalizeStructure([
    obs({ kind: "group", netsuiteItemId: "90001", quantity: TIER, patchAddress: 1 }),
    obs({ netsuiteItemId: "1024", quantity: 1000, rate: 0, amount: 0, patchAddress: 2 }),
    obs({ netsuiteItemId: "66476", quantity: 1000, rate: 0, amount: 0, patchAddress: 3 }),
    obs({ kind: "endGroup", amount: 0, patchAddress: 4 }),
  ]);
  const gate = evaluateSuccessGate({
    plannedGroups: [plan.groups[0]],
    structure: unpriced,
    tierQty: TIER,
    acceptedTotal: 10000,
    header: { customerId: CUSTOMER, hubspotDealId: ctx.hubspotDealId, businessSegmentId: null, termsId: "2" },
    expectHeader: { customerId: CUSTOMER, hubspotDealId: ctx.hubspotDealId, businessSegmentId: null, termsPresent: true },
  });
  assert.equal(gate.pass, false);
  assert.ok(gate.failures.length > 0);

  // markComplete only reports success behind that gate: the refusal is raised
  // upstream of the `succeeded` write, so a failing gate cannot fall through
  // to it.
  const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const refusal = markComplete.indexOf("commercially complete. ${convergence.gate.failures");
  const succeededWrite = markComplete.indexOf('status: "succeeded"');
  assert.ok(refusal > -1, "the gate refusal must exist");
  assert.ok(succeededWrite > -1, "the succeeded write must exist");
  assert.ok(
    refusal < succeededWrite,
    "the gate refusal must precede the succeeded write, not follow it",
  );
});

test("10 · a verification failure with an SO id is held, never released", () => {
  const attempt = { status: "awaiting_rates", netsuiteSoId: "361341" };

  // The 0065 release predicate frees only `failed + validation`, so a
  // verification failure keeps owning its snapshot and no second attempt row
  // — and therefore no second CREATE — can be elected.
  assert.equal(
    ownsSnapshot({ status: "awaiting_rates", errorClass: "verification" }),
    true,
    "a verification failure is never released",
  );

  // With an SO id present the attempt cannot even reach `failed`, so
  // `verification` can never satisfy the release predicate.
  assert.equal(failureStatusFor(attempt).status, "awaiting_rates");
  assert.notEqual(failureStatusFor(attempt).status, "failed");

  // Falsification: the predicate itself is unchanged and still releases the
  // pre-CREATE validation case, which has no SO id.
  assert.equal(
    ownsSnapshot({ status: "failed", errorClass: "validation" }),
    false,
    "pre-CREATE validation failures remain releasable — the rule was not broadened",
  );

  // And the gate-refusal path records `verification`, not `unknown`.
  const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const withoutComments = markComplete.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(withoutComments, /errorClass: err\?\.className \?\? "verification"/);
});

test("11 · CREATED group definitions are read back and verified before SO CREATE", () => {
  const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const stripped = markComplete
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // The read-back must NOT sit behind a reused-only branch. SO2703's groups
  // were freshly created, so a `outcome !== "created"` guard skipped them
  // entirely and the wrong definitions reached the Sales Order unchecked.
  assert.doesNotMatch(
    stripped,
    /if\s*\(\s*resolved\.outcome\s*!==\s*"created"\s*\)/,
    "verification must not be conditional on reuse",
  );
  assert.match(stripped, /readItemGroupMembers\(resolved\.netsuiteInternalId\)/);
  assert.match(stripped, /verifyReusedGroupMembership\(adapted, actualMembers\)/);

  // And it must precede the group line emission, which is what puts the group
  // on the order.
  const check = stripped.indexOf("verifyReusedGroupMembership(adapted, actualMembers)");
  const emit = stripped.indexOf("emittedGroupLines.push(");
  assert.ok(check > -1 && emit > -1);
  assert.ok(check < emit, "the definition is verified before the group is emitted");

  // The master quantities are recorded as evidence under their real name.
  assert.match(stripped, /qtyPerParent: m\.quantity/);
  assert.match(stripped, /item_group_definitions: itemGroupDefinitions/);
});

function obs(o: Partial<ObservedLine>): ObservedLine {
  return {
    kind: "member",
    netsuiteItemId: null,
    quantity: null,
    rate: null,
    amount: null,
    patchAddress: null,
    ...o,
  } as ObservedLine;
}
