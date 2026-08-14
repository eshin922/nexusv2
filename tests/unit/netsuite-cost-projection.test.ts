// Governed product cost → NetSuite Accounting cost basis.
//
// The defect these guard is NOT missing cost data. Nexus always transmitted the
// governed unit cost, but only to `custcol_dps_unit_cost` — a custom column
// NetSuite's standard Unit Cost display and margin basis do not read. With
// `costEstimateRate` unset, NetSuite substitutes the item master's costing
// method, which produced blank on the certified Sales Orders and unrelated
// LASTPURCHPRICE figures elsewhere.
//
// GOVERNING INVARIANT: the same product at the same governed Nexus unit cost
// must reach the same `costEstimateRate` regardless of Direct vs Item Group
// structure, and regardless of freight/customs treatment.

import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { buildSalesOrderPayload } from "../../src/lib/netsuite/sales-orders.ts";
import { planCostProjection } from "../../src/lib/netsuite/cost-projection.ts";

const BASE = {
  netsuiteCustomerId: "11323",
  subsidiaryId: "2",
  orderStatusCode: "B",
  hubspotDealId: "D1",
  hubspotDealName: "Deal",
} as const;

const line = (over: Record<string, unknown> = {}) => ({
  netsuiteItemId: "1024",
  sku: "10064-GNX-Box",
  description: "Box",
  quantity: 1000,
  rate: 1.25,
  unitCost: 0.625,
  ...over,
});

const items = (body: Record<string, unknown>) =>
  (body.item as { items: Record<string, unknown>[] }).items;

// ---------------------------------------------------------------- 1
test("Direct CREATE emits CUSTOM + governed rate", () => {
  const body = buildSalesOrderPayload({ ...BASE, lines: [line()] } as never);
  const l = items(body)[0];
  assert.deepEqual(l.costEstimateType, { id: "CUSTOM" });
  assert.equal(l.costEstimateRate, 0.625);
  // The custom column is RETAINED, not substituted.
  assert.equal(l.custcol_dps_unit_cost, 0.625);
});

// ---------------------------------------------------------------- 2
test("null governed cost preserves NetSuite's default — no zero asserted", () => {
  const body = buildSalesOrderPayload({
    ...BASE,
    lines: [line({ unitCost: null })],
  } as never);
  const l = items(body)[0];
  assert.equal("costEstimateType" in l, false);
  assert.equal("costEstimateRate" in l, false);
  assert.equal("custcol_dps_unit_cost" in l, false);
  // A zero would claim the product is free. Silence claims nothing.
  assert.notEqual(l.costEstimateRate, 0);
});

// ---------------------------------------------------------------- 3
test("derived extended cost is never sent", () => {
  const body = buildSalesOrderPayload({ ...BASE, lines: [line()] } as never);
  // NetSuite derives costEstimate = quantity × costEstimateRate. Sending it
  // would create a second authority for the same number.
  assert.equal("costEstimate" in items(body)[0], false);
});

// ---------------------------------------------------------------- 4
test("sell rate and unit cost stay independent", () => {
  const body = buildSalesOrderPayload({
    ...BASE,
    lines: [
      line({ rate: 7.77, unitCost: 0.625 }),
      line({ rate: 3.33, unitCost: 0.625 }),
    ],
  } as never);
  const [a, b] = items(body);
  assert.notEqual(a.rate, b.rate);
  assert.equal(a.costEstimateRate, b.costEstimateRate);
  assert.equal(a.costEstimateRate, 0.625);
  // The reverse confusion is the dangerous one: cost must never echo rate.
  assert.notEqual(a.costEstimateRate, a.rate);
});

// ---------------------------------------------------------------- 5
test("SO2707/SO2709 freight-treatment invariance", () => {
  // SO2707 quoted the Box at 1.25; SO2709 carried pass-through freight and
  // quoted the SAME Box at 1.90. The governed product cost is 0.625 in both.
  // Sourcing cost from rate — or from any freight-loaded figure — would make
  // the same product appear to cost 3× more on a freight quote.
  const bundled = buildSalesOrderPayload({
    ...BASE,
    lines: [line({ rate: 1.25, unitCost: 0.625 })],
  } as never);
  const passThrough = buildSalesOrderPayload({
    ...BASE,
    lines: [line({ rate: 1.9, unitCost: 0.625 })],
  } as never);
  assert.equal(
    items(bundled)[0].costEstimateRate,
    items(passThrough)[0].costEstimateRate,
  );
  assert.notEqual(items(bundled)[0].rate, items(passThrough)[0].rate);
});

// ---------------------------------------------------------------- 6
test("Item Group member lines are planned for a scalar cost PATCH", () => {
  const plan = planCostProjection({
    lines: [
      { line: 1, itemId: "58837", itemType: "Group", quantity: 250 },
      { line: 2, itemId: "1024", itemType: "InvtPart", quantity: 250 },
      { line: 3, itemId: "66476", itemType: "InvtPart", quantity: 250 },
      { line: 4, itemId: null, itemType: "EndGroup", quantity: null },
    ],
    governed: [
      { netsuiteItemId: "1024", unitCost: 0.625 },
      { netsuiteItemId: "66476", unitCost: 1.125 },
    ],
  });
  assert.deepEqual(
    plan.actions.map((a) => [a.address, a.unitCost]),
    [
      [2, 0.625],
      [3, 1.125],
    ],
  );
});

// ---------------------------------------------------------------- 7
test("Direct vs Item Group parity for the same governed cost", () => {
  const direct = buildSalesOrderPayload({
    ...BASE,
    lines: [line({ unitCost: 0.625 })],
  } as never);
  const grouped = planCostProjection({
    lines: [
      { line: 1, itemId: "58837", itemType: "Group", quantity: 1000 },
      { line: 2, itemId: "1024", itemType: "InvtPart", quantity: 1000 },
    ],
    governed: [{ netsuiteItemId: "1024", unitCost: 0.625 }],
  });
  // Same product, same governed cost, two structures — one projected value.
  assert.equal(items(direct)[0].costEstimateRate, grouped.actions[0].unitCost);
});

// ---------------------------------------------------------------- 8 (negative)
test("group header and EndGroup NEVER receive cost fields", () => {
  const plan = planCostProjection({
    lines: [
      { line: 1, itemId: "58837", itemType: "Group", quantity: 250 },
      { line: 2, itemId: "1024", itemType: "InvtPart", quantity: 250 },
      { line: 5, itemId: null, itemType: "EndGroup", quantity: null },
    ],
    // Deliberately offers a cost for the GROUP item itself. The sandbox probe
    // showed NetSuite accepts cost on a group line and silently discards it —
    // a write that reads like success. It must never be attempted.
    governed: [
      { netsuiteItemId: "58837", unitCost: 9.99 },
      { netsuiteItemId: "1024", unitCost: 0.625 },
    ],
  });
  assert.equal(
    plan.actions.some((a) => a.address === 1 || a.address === 5),
    false,
  );
  assert.deepEqual(
    plan.skipped.filter((s) => s.address === 1 || s.address === 5).map((s) => s.address),
    [1, 5],
  );
});

// ---------------------------------------------------------------- 8b
test("a member with no governed cost is skipped, not zeroed", () => {
  const plan = planCostProjection({
    lines: [{ line: 2, itemId: "1024", itemType: "InvtPart", quantity: 250 }],
    governed: [{ netsuiteItemId: "1024", unitCost: null }],
  });
  assert.equal(plan.actions.length, 0);
  assert.match(plan.skipped[0].reason, /default preserved/);
});

// ────────────── grouped members: BOTH cost columns, one source ──────────────
//
// NetSuite has two distinct columns and they were confused for each other:
//
//   custcol_dps_unit_cost → titled "Unit Cost"  (metadata catalog)
//   costEstimateRate      → titled "Est. Rate"
//
// Accounting's defect was about **Unit Cost**. 20da735 populated Est. Rate on
// grouped members and left Unit Cost blank, so the reported defect survived a
// repair that looked complete. SO2646/SO2698 could not have revealed this —
// both fields held identical values there, so the controls were confounded.
//
// A grouped member does not exist at CREATE, so the scalar PATCH is the only
// place either column can be set for it.

test("the member PATCH writes BOTH cost columns from one governed value", async () => {
  const client = await readFile(
    path.join(import.meta.dirname, "../../src/lib/netsuite/client.ts"),
    "utf8",
  );
  const fn = client
    .split("export async function patchSalesOrderLine")[1]
    .split("export async function")[0];

  // Both columns assigned...
  assert.match(fn, /body\.custcol_dps_unit_cost = patch\.unitCost/);
  assert.match(fn, /body\.costEstimateRate = patch\.unitCost/);
  assert.match(fn, /body\.costEstimateType = \{ id: "CUSTOM" \}/);

  // ...from the SAME argument. Two destinations, one source: a second source
  // could drift, and the two columns would then disagree about one product's
  // cost — which is exactly the state this repair exists to end.
  const unitCostAssignments = [...fn.matchAll(/body\.(\w+) = ([^;]+);/g)]
    .filter(([, key]) => key !== "rate")
    .map(([, , value]) => value.trim());
  for (const v of unitCostAssignments) {
    assert.ok(
      v === "patch.unitCost" || v === '{ id: "CUSTOM" }',
      `cost field assigned from ${v} — must be patch.unitCost, never re-derived`,
    );
  }
});

test("both cost columns are gated by the SAME null guard", async () => {
  const client = await readFile(
    path.join(import.meta.dirname, "../../src/lib/netsuite/client.ts"),
    "utf8",
  );
  const fn = client
    .split("export async function patchSalesOrderLine")[1]
    .split("export async function")[0];
  // One guard, one block. Separate guards could diverge and populate one column
  // while leaving the other blank — the precise shape of the defect being fixed.
  const guard = fn.split("if (patch.unitCost !== undefined)")[1] ?? "";
  assert.match(guard, /custcol_dps_unit_cost/);
  assert.match(guard, /costEstimateRate/);
  assert.equal(fn.split("if (patch.unitCost !== undefined)").length, 2);
});

test("structural Group / EndGroup lines receive NEITHER column", () => {
  const plan = planCostProjection({
    lines: [
      { line: 1, itemId: "58837", itemType: "Group", quantity: 250 },
      { line: 2, itemId: "1024", itemType: "InvtPart", quantity: 250 },
      { line: 3, itemId: null, itemType: "EndGroup", quantity: null },
    ],
    governed: [
      { netsuiteItemId: "58837", unitCost: 9.99 },
      { netsuiteItemId: "1024", unitCost: 0.37 },
    ],
  });
  // Only the member is actionable. Structural lines carry no product and are
  // excluded by type, so neither column can reach them.
  assert.deepEqual(
    plan.actions.map((a) => [a.address, a.unitCost]),
    [[2, 0.37]],
  );
  assert.deepEqual(plan.skipped.map((s) => s.address).sort(), [1, 3]);
});

test("flat/Direct CREATE behaviour is unchanged by the member repair", () => {
  const body = buildSalesOrderPayload({ ...BASE, lines: [line()] } as never);
  const l = items(body)[0];
  // All three, from CREATE, exactly as before — the Direct path never depended
  // on the PATCH and must not start to.
  assert.equal(l.custcol_dps_unit_cost, 0.625);
  assert.deepEqual(l.costEstimateType, { id: "CUSTOM" });
  assert.equal(l.costEstimateRate, 0.625);
});
