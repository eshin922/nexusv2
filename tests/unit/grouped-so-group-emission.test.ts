// Grouped-SO push — Step 2: deterministic Item Group creation/reuse and
// Group-line emission.
//
// Design: docs/validation/od-004-item-group-capability-matrix.md
//
// Step 2 stops BEFORE member-rate patching. The intended end state is
// deliberately incomplete:
//
//   Group SO payload -> NetSuite expands members from Item Base Price ($0.00)
//   -> awaiting_rates
//
// Step 1's lifecycle is what makes that intermediate state safe to introduce.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adaptPlannedGroup,
  assertIdentityMatchesPlan,
  GroupAdapterError,
  verifyReusedGroupMembership,
} from "../../src/lib/netsuite/grouping-plan-adapter.ts";
import {
  buildSalesOrderPayload,
  type SalesOrderPayloadInput,
} from "../../src/lib/netsuite/sales-orders.ts";

const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
const itemGroups = readFileSync("src/lib/netsuite/item-groups.ts", "utf8");
const adapter = readFileSync("src/lib/netsuite/grouping-plan-adapter.ts", "utf8");

const HASH_A = "6b601641ff73b53c6e8e31066a7e7f0ccbf0d46fc9f6b41132bf25dc6b929a0b";
const HASH_B = "01df6311686e7875a38b7042e2f95087dd1af194237dcf5c46b3b9c004826656";

// The real Case B plan shape: Group A = Box@6 + Bottle@4 ($10,000);
// Group B = Bottle@2 ($2,000). The Bottle is SHARED across both groups at
// different rates — the property that makes a wrong-member wrap detectable.
const groupA = {
  assemblyId: "asm-a",
  assemblySku: "OD004-CASEB-A",
  assemblyName: "Case B A",
  compositionHash: HASH_A,
  externalId: `nxs-grp-${HASH_A}`,
  members: [
    { sku: "10064-GNX-Box", netsuiteItemId: "1024", quantity: 1000, qtyPerParent: 1, rate: 6, unitCost: null, amount: 6000 },
    { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, qtyPerParent: 1, rate: 4, unitCost: null, amount: 4000 },
  ],
  expectedAmount: 10000,
  turnkeyUnitPrice: 10,
};
const groupB = {
  assemblyId: "asm-b",
  assemblySku: "OD004-CASEB-B",
  assemblyName: "Case B B",
  compositionHash: HASH_B,
  externalId: `nxs-grp-${HASH_B}`,
  members: [
    { sku: "DPS-BOTTLE-0001", netsuiteItemId: "66476", quantity: 1000, qtyPerParent: 1, rate: 2, unitCost: null, amount: 2000 },
  ],
  expectedAmount: 2000,
  turnkeyUnitPrice: 2,
};

const ctx = {
  subsidiaryId: "2",
  customerNetsuiteId: "72173",
  customerDisplay: "72173",
  dealName: "Nemah",
  hubspotDealId: "58332160883",
  quoteId: "q-1",
  userId: "u-1",
};

const header: Omit<SalesOrderPayloadInput, "lines" | "groupLines"> = {
  netsuiteCustomerId: "72173",
  subsidiaryId: "2",
  orderStatusCode: "B",
  taxCodeId: null,
  paymentTermsText: "Net 30",
  hubspotDealId: "58332160883",
  hubspotDealName: "Nemah",
  projectServiceS: "Primary Packaging",
  projectSourceId: "2",
  projectCategory: "Primary",
  businessSegmentId: "3",
  clientPo: null,
  invoiceDateEst: "2026-09-01",
};

const flatLines = [
  { netsuiteItemId: "1024", sku: "10064-GNX-Box", description: "Box", quantity: 1000, rate: 6, unitCost: null },
  { netsuiteItemId: "66476", sku: "DPS-BOTTLE-0001", description: "Bottle", quantity: 1000, rate: 4, unitCost: null },
  { netsuiteItemId: "66476", sku: "DPS-BOTTLE-0001", description: "Bottle", quantity: 1000, rate: 2, unitCost: null },
];

const items = (p: Record<string, unknown>) =>
  (p.item as { items: Array<Record<string, unknown>> }).items;
const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

test("1 · itemized emits the existing flat lines, unchanged", () => {
  const payload = buildSalesOrderPayload({ ...header, lines: flatLines });
  const lines = items(payload);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.rate), [6, 4, 2]);
  assert.deepEqual(lines.map((l) => l.quantity), [1000, 1000, 1000]);
  assert.equal(lines[0].custcol_dps_sku, "10064-GNX-Box");
});

test("2 · turnkey_only emits Group lines INSTEAD of flat members", () => {
  const payload = buildSalesOrderPayload({
    ...header,
    lines: [],
    groupLines: [
      { netsuiteItemId: "90001", sku: "OD004-CASEB-A-G", quantity: 1000 },
      { netsuiteItemId: "90002", sku: "OD004-CASEB-B-G", quantity: 1000 },
    ],
  });
  const lines = items(payload);
  assert.equal(lines.length, 2, "one line per governed group");
  assert.deepEqual(lines[0].item, { id: "90001" });
  assert.deepEqual(lines[1].item, { id: "90002" });
  // BARE: no rate on the group header (Probe 7a — it is ignored), no amount,
  // no per-line custom columns.
  for (const l of lines) {
    assert.equal(has(l, "rate"), false, "group header carries no rate");
    assert.equal(has(l, "amount"), false);
    assert.equal(has(l, "custcol_dps_sku"), false);
    assert.equal(l.quantity, 1000);
  }
});

test("3 · a group's OWN members can never be emitted alongside it", () => {
  // Probe 7a: NetSuite expands the group AND honours the explicit members,
  // duplicating them and doubling the total — at 204, with no error.
  //
  // The rule is MEMBERSHIP, not co-occurrence. P1 (SO2713) measured a group
  // beside a flat line for an item in no group and found no duplication, so
  // refusing co-occurrence outright would forbid the safe case along with the
  // unsafe one — and did, by forcing `lines: []` and silently dropping Direct
  // Products from turnkey quotes.
  assert.throws(
    () =>
      buildSalesOrderPayload({
        ...header,
        lines: flatLines, // 1024 + 66476 — both members of the group below
        groupLines: [{ netsuiteItemId: "90001", sku: "A-G", quantity: 1000 }],
        groupMemberItemIds: ["1024", "66476"],
      }),
    /refusing to emit a flat line for an item the Item Group already expands/,
  );
});

test("3b · a flat line for an item in NO group is emitted alongside the group", () => {
  const payload = buildSalesOrderPayload({
    ...header,
    lines: [
      {
        netsuiteItemId: "71529",
        sku: "BA146400",
        description: "Direct",
        quantity: 7,
        rate: 1.11,
        unitCost: 0.5,
      },
    ],
    groupLines: [{ netsuiteItemId: "90001", sku: "A-G", quantity: 1000 }],
    groupMemberItemIds: ["1024", "66476"],
  });
  const rows = items(payload);
  assert.equal(rows.length, 2);
  // Group header first, bare; then the Direct line, fully populated.
  assert.deepEqual(rows[0].item, { id: "90001" });
  assert.equal(has(rows[0], "rate"), false);
  assert.deepEqual(rows[1].item, { id: "71529" });
  assert.equal(rows[1].rate, 1.11);
  assert.deepEqual(rows[1].costEstimateType, { id: "CUSTOM" });
  assert.equal(rows[1].costEstimateRate, 0.5);
});

test("3c · flat lines beside groups without a declared member set are refused", () => {
  // Membership cannot be checked, so the safe case cannot be distinguished from
  // the doubling one. Refuse rather than assume no collision.
  assert.throws(
    () =>
      buildSalesOrderPayload({
        ...header,
        lines: flatLines,
        groupLines: [{ netsuiteItemId: "90001", sku: "A-G", quantity: 1000 }],
      }),
    /membership cannot be checked/,
  );
});

test("4 · plan identity is REUSED, never recomputed", () => {
  const adapted = adaptPlannedGroup(groupA, ctx);
  assert.equal(adapted.expectedCompositionHash, HASH_A);
  assert.equal(adapted.expectedExternalId, `nxs-grp-${HASH_A}`);
  // The adapter must not import or call the hash function itself.
  assert.doesNotMatch(adapter, /computeCompositionHash|externalIdForHash/);
  // And a divergence between plan and primitive is loud, not absorbed.
  assert.throws(
    () =>
      assertIdentityMatchesPlan(adapted, {
        compositionHash: "deadbeef",
        netsuiteExternalId: `nxs-grp-${HASH_A}`,
      }),
    /Two deterministic identities have diverged/,
  );
});

test("5 · Group A / Group B asymmetric membership maps correctly", () => {
  const a = adaptPlannedGroup(groupA, ctx);
  const b = adaptPlannedGroup(groupB, ctx);
  assert.deepEqual(
    a.members.map((m) => [m.netsuiteItemId, m.quantity]),
    [["1024", 1], ["66476", 1]],
  );
  assert.deepEqual(
    b.members.map((m) => [m.netsuiteItemId, m.quantity]),
    [["66476", 1]],
  );
  assert.notEqual(a.expectedExternalId, b.expectedExternalId);
});

test("6 · a SKU shared across two groups stays distinct BY GROUP", () => {
  // DPS-BOTTLE-0001 is in both groups, at $4 in A and $2 in B. The two groups
  // must remain separately identified — this is what makes a wrong-member wrap
  // detectable despite an unchanged $12,000 total.
  const a = adaptPlannedGroup(groupA, ctx);
  const b = adaptPlannedGroup(groupB, ctx);
  const bottleInA = a.members.find((m) => m.netsuiteItemId === "66476");
  const bottleInB = b.members.find((m) => m.netsuiteItemId === "66476");
  assert.ok(bottleInA && bottleInB, "present in both");
  assert.notEqual(a.expectedCompositionHash, b.expectedCompositionHash);
  // A's membership must not validate against B's actual composition.
  assert.equal(
    verifyReusedGroupMembership(a, [{ netsuiteItemId: "66476", quantity: 1 }]).matches,
    false,
  );
});

test("7 · Group subsidiary comes from governed SO authority, not a constant", () => {
  const adapted = adaptPlannedGroup(groupA, { ...ctx, subsidiaryId: "77" });
  assert.equal(adapted.subsidiaryId, "77", "whatever authority supplies");
  // markComplete sources it from the SAME firm_settings value as the SO
  // header — the group context and the header both read
  // `firm.netsuiteSubsidiaryId`, so they cannot diverge.
  const occurrences = markComplete.match(/subsidiaryId: firm\.netsuiteSubsidiaryId/g) ?? [];
  assert.equal(occurrences.length, 2, "SO header and Item Group share one authority");
  const groupCtxBlock = markComplete.slice(
    markComplete.indexOf("const groupCtx = {"),
    markComplete.indexOf("const emittedGroupLines"),
  );
  assert.match(groupCtxBlock, /subsidiaryId: firm\.netsuiteSubsidiaryId/);
  // The Case B fixture's subsidiary is not baked into the adapter or primitive.
  assert.doesNotMatch(adapter, /subsidiaryId\s*[:=]\s*["']2["']/);
  assert.doesNotMatch(itemGroups, /subsidiary:\s*\{\s*id:\s*["']2["']/);
});

test("8 · missing subsidiary fails BEFORE Sales Order CREATE", () => {
  // Reproduces the provider error observed live on the manual Group A save:
  // "members' subsidiaries must be contained by the Group's subsidiaries."
  // It must now be impossible to reach NetSuite without one.
  assert.throws(
    () => adaptPlannedGroup(groupA, { ...ctx, subsidiaryId: "" }),
    (e: unknown) =>
      e instanceof GroupAdapterError &&
      /No subsidiary available for Item Group/.test(e.message),
  );
  // And the primitive transmits it, so the group can actually accept members.
  // COLLECTION shape, not a reference — proven on the disposable probe:
  // `{ id }` is rejected INVALID_VALUE on itemGroup, because item records are
  // multi-subsidiary under OneWorld. The Sales Order header's `{ id }` and
  // this are NOT interchangeable.
  assert.match(itemGroups, /subsidiary: \{ items: \[\{ id: input\.subsidiaryId \}\] \}/);
  assert.match(itemGroups, /subsidiaryId: string;/);
});

test("9 · an existing deterministic Group is reused, not recreated", () => {
  // The primitive's three layers: local cache -> SuiteQL by externalId ->
  // REST create. Reuse outcomes are 'cache_hit' / 'external_id_hit'.
  assert.match(itemGroups, /Layer 2: SuiteQL by externalId/);
  assert.match(itemGroups, /outcome: "cache_hit"|"cache_hit"/);
  // Reuse is decided by the primitive, not by a caller-side branch. The
  // definition read-back is unconditional now, so a reused group and a freshly
  // created one are verified identically before either reaches an order — but
  // the outcome is still carried into the refusal message and the audit record.
  assert.match(markComplete, /outcome: resolved\.outcome/);
});

test("10 · an absent deterministic Group invokes REST Item Group CREATE", () => {
  assert.match(itemGroups, /recordType: "itemGroup"/);
  assert.match(markComplete, /await findOrCreateItemGroup\(adapted\)/);
});

test("11 · a created Group carries the PLANNED nxs-grp-* external id", () => {
  const adapted = adaptPlannedGroup(groupA, ctx);
  assert.equal(adapted.expectedExternalId, `nxs-grp-${HASH_A}`);
  assert.match(itemGroups, /externalId,/, "transmitted on create");
  // markComplete proves the returned identity is the planned one.
  assert.match(markComplete, /assertIdentityMatchesPlan\(adapted, resolved\)/);
});

test("12 · a reused Group's membership MUST match the frozen plan", () => {
  const a = adaptPlannedGroup(groupA, ctx);
  const correct = [
    { netsuiteItemId: "1024", quantity: 1 },
    { netsuiteItemId: "66476", quantity: 1 },
  ];
  assert.equal(verifyReusedGroupMembership(a, correct).matches, true);
  // markComplete reads actual membership before emitting a reused group.
  assert.match(markComplete, /await readItemGroupMembers\(resolved\.netsuiteInternalId\)/);
  assert.match(itemGroups, /export async function readItemGroupMembers/);
});

test("13 · stale Group — right external id, WRONG members — fails closed", () => {
  // An administrator can change members after Nexus created the group, and the
  // external id does not change with them. Emitting it would produce an order
  // that reconciles on identity while shipping wrong contents.
  const a = adaptPlannedGroup(groupA, ctx);

  const missing = verifyReusedGroupMembership(a, [{ netsuiteItemId: "1024", quantity: 1 }]);
  assert.equal(missing.matches, false);
  assert.match(missing.problems.join("|"), /missing member 66476/);

  const extra = verifyReusedGroupMembership(a, [
    ...[
      { netsuiteItemId: "1024", quantity: 1000 },
      { netsuiteItemId: "66476", quantity: 1000 },
    ],
    { netsuiteItemId: "99999", quantity: 5 },
  ]);
  assert.equal(extra.matches, false);
  assert.match(extra.problems.join("|"), /unexpected member 99999/);

  const wrongQty = verifyReusedGroupMembership(a, [
    { netsuiteItemId: "1024", quantity: 1000 },
    { netsuiteItemId: "66476", quantity: 1 },
  ]);
  assert.equal(wrongQty.matches, false);
  // 1,000 is precisely the value the OLD defective adapter wrote into the
  // definition. A group still holding it is stale and must be refused.
  assert.match(wrongQty.problems.join("|"), /quantity 1000 does not match planned 1/);

  const dup = verifyReusedGroupMembership(a, [
    { netsuiteItemId: "1024", quantity: 1 },
    { netsuiteItemId: "66476", quantity: 1 },
    { netsuiteItemId: "66476", quantity: 1 },
  ]);
  assert.equal(dup.matches, false, "a duplicated member is divergence, not something to sum away");

  // And the caller refuses rather than rewriting shared master data.
  assert.match(markComplete, /does not match the frozen /);
  assert.match(markComplete, /rather than rewriting shared NetSuite master data/);
});

test("14 · no Nexus class is reintroduced by the group path", () => {
  const payload = buildSalesOrderPayload({
    ...header,
    lines: [],
    groupLines: [{ netsuiteItemId: "90001", sku: "A-G", quantity: 1000 }],
  });
  assert.equal(has(payload, "class"), false);
  for (const l of items(payload)) assert.equal(has(l, "class"), false);
});

test("15 · every unrelated SO header field is identical between flat and group", () => {
  const flat = buildSalesOrderPayload({ ...header, lines: flatLines });
  const grouped = buildSalesOrderPayload({
    ...header,
    lines: [],
    groupLines: [{ netsuiteItemId: "90001", sku: "A-G", quantity: 1000 }],
  });
  const { item: _f, ...flatHeader } = flat;
  const { item: _g, ...groupedHeader } = grouped;
  assert.deepEqual(groupedHeader, flatHeader, "only the item collection differs");
  // The certified header fields specifically.
  assert.deepEqual(grouped.cseg_dps_bus_seg, { id: "3" });
  assert.equal(grouped.custbody_dps_payment_terms_text, "Net 30");
  assert.deepEqual(grouped.entity, { id: "72173" });
  assert.equal(grouped.custbody_dps_project_service_s, "Primary Packaging");
  assert.deepEqual(grouped.custbody_dps_project_source, { id: "2" });
});

test("16 · member-rate PATCH is reached only THROUGH the convergence executor", () => {
  // SUPERSEDED BY STEP 3, inverted rather than deleted so the record shows the
  // contract changed and when. At Step 2 this asserted markComplete contained
  // no `patchSalesOrderLine` at all, which was correct then: Step 2 had to
  // leave the order at awaiting_rates with members at their Item Base Price.
  //
  // Step 3 wires convergence. What must remain true is narrower but more
  // useful: markComplete never patches a line directly — every PATCH goes
  // through runRateConvergence, which re-reads the order, refuses on
  // structural blockers, and targets each member by ITS OWN provider address.
  assert.match(markComplete, /runRateConvergence\(\{/);
  const direct = markComplete.match(/await patchSalesOrderLine\(/g) ?? [];
  assert.equal(direct.length, 0, "no direct awaited PATCH outside the executor");
  // It is passed as the executor's provider dependency, not called inline.
  assert.match(
    markComplete,
    /patchLine: \(id: string, address: number, patch: \{ rate: number \}\) =>\s*patchSalesOrderLine\(id, address, patch\)/,
  );
});

test("17 · a plan group without a deterministic identity is refused", () => {
  assert.throws(
    () =>
      adaptPlannedGroup(
        { ...groupA, compositionHash: null, externalId: null, notDerivableReason: "zero qty" },
        ctx,
      ),
    /carries no deterministic identity[\s\S]*zero qty/,
  );
  assert.match(markComplete, /grouping plan carries no deterministic identity/i);
});

test("18 · FALSIFICATION — old flat-turnkey shape, and the duplication shape", () => {
  // (a) What turnkey_only used to emit: three flat member lines, no group.
  const oldShape = buildSalesOrderPayload({ ...header, lines: flatLines });
  assert.equal(items(oldShape).length, 3);
  assert.equal(
    items(oldShape).every((l) => has(l, "rate")),
    true,
    "the old shape priced members directly",
  );

  // (b) The Probe 7a duplication shape — group AND members — now unbuildable.
  assert.throws(() =>
    buildSalesOrderPayload({
      ...header,
      lines: flatLines,
      groupLines: [
        { netsuiteItemId: "90001", sku: "A-G", quantity: 1000 },
        { netsuiteItemId: "90002", sku: "B-G", quantity: 1000 },
      ],
    }),
  );

  // (c) The new shape: two group lines, zero priced member lines.
  const grouped = buildSalesOrderPayload({
    ...header,
    lines: [],
    groupLines: [
      { netsuiteItemId: "90001", sku: "OD004-CASEB-A-G", quantity: 1000 },
      { netsuiteItemId: "90002", sku: "OD004-CASEB-B-G", quantity: 1000 },
    ],
  });
  assert.equal(items(grouped).length, 2);
  assert.equal(items(grouped).some((l) => has(l, "rate")), false);
});
