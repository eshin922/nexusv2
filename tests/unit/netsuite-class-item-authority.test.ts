// V1 CLASS CONTRACT (2026-08-12): NetSuite owns Sales Order line Class through
// the Item record. Nexus must not send `class`.
//
// Class is still required business/accounting data. What this removes is an
// invalid competing authority. Nexus was emitting the raw HubSpot
// `business_segment` enum id as the NetSuite `class` — unrelated taxonomies:
//
//   segment 3 "DPS Packaging"  → not a class; NetSuite rejected the CREATE
//   segment 1 "Product 360°"   → collides with class 1 "Primary"; silently
//                                misattributed every order it touched
//
// The reference proof is SO2698: created by Nexus transmitting no class, its
// lines came back correctly classed from the Item record.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSalesOrderPayload,
  type SalesOrderPayloadInput,
} from "../../src/lib/netsuite/sales-orders.ts";

const base: SalesOrderPayloadInput = {
  netsuiteCustomerId: "72173",
  subsidiaryId: "2",
  orderStatusCode: "B",
  taxCodeId: null,
  paymentTermsText: "Net 30",
  hubspotDealId: "58332160883",
  hubspotDealName: "Nemah",
  businessSegmentId: null,
  clientPo: null,
  lines: [
    { netsuiteItemId: "1024", sku: "10064-GNX-Box", description: "Box", quantity: 1000, rate: 6, unitCost: null },
    { netsuiteItemId: "66476", sku: "DPS-BOTTLE-0001", description: "Bottle", quantity: 1000, rate: 4, unitCost: null },
  ],
};

const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

test("1 · HubSpot segment 1 cannot emit class:1 / Primary", () => {
  // The dangerous half. HubSpot 1 = "Product 360°" collided numerically with
  // NetSuite class 1 = "Primary", so these orders PASSED while being wrong —
  // a misattribution that reconciles perfectly and surfaces at close.
  const payload = buildSalesOrderPayload({ ...base, businessSegmentId: "1" });
  assert.equal(has(payload, "class"), false);
});

test("2 · HubSpot segment 3 cannot emit invalid class:3", () => {
  // The visible half — the exact CREATE rejection that halted the Case B walk:
  // "Invalid Field Value 3 for the following field: class."
  const payload = buildSalesOrderPayload({ ...base, businessSegmentId: "3" });
  assert.equal(has(payload, "class"), false);
});

test("3 · no ordinary item line carries a Nexus-supplied class", () => {
  const payload = buildSalesOrderPayload({ ...base, businessSegmentId: "3" });
  const lines = (payload.item as { items: Array<Record<string, unknown>> }).items;
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(has(line, "class"), false);
    assert.equal(has(line, "cseg_dps_bus_seg"), false);
  }
  // NetSuite defaults each line's class from the Item record: 1024 →
  // 10 Secondary, 66476 → 1 Primary. Sending nothing is what makes that happen.
});

test("4 · no class is emitted for ANY segment value, including absent", () => {
  for (const seg of ["1", "3", "42", "9999", "", null, undefined]) {
    const payload = buildSalesOrderPayload({
      ...base,
      businessSegmentId: seg as string | null,
    });
    assert.equal(has(payload, "class"), false, `segment=${String(seg)}`);
  }
  // No fallback either. The 62 Items without a Class are an Accounting
  // Item-master matter; Nexus must not invent one.
});

test("5 · every other payload field is unchanged by the removal", () => {
  const withSeg = buildSalesOrderPayload({ ...base, businessSegmentId: "3" });
  const withoutSeg = buildSalesOrderPayload({ ...base, businessSegmentId: null });
  const { cseg_dps_bus_seg: _c, ...restWith } = withSeg;

  assert.deepEqual(restWith, withoutSeg, "only cseg differs on segment presence");
  for (const k of ["entity", "subsidiary", "orderStatus", "memo", "custbody_dps_deal_id", "item"]) {
    assert.equal(has(withSeg, k), true, k);
  }
  assert.equal(
    (withSeg.item as { items: unknown[] }).items.length,
    2,
    "lines survive intact",
  );
});

test("6 · cseg_dps_bus_seg is a SEPARATE dimension and is deliberately untouched", () => {
  // Business Segment is not Class. Settling Class does not establish that this
  // projection is valid — it is fed the same raw enum id and was rejected in
  // the same CREATE. Under separate review; asserted here so that any change
  // to it is a deliberate act with its own evidence, not a side effect.
  const payload = buildSalesOrderPayload({ ...base, businessSegmentId: "3" });
  assert.deepEqual(payload.cseg_dps_bus_seg, { id: "3" });
});

test("7 · the source states the contract and does not reintroduce class", () => {
  const src = readFileSync("src/lib/netsuite/sales-orders.ts", "utf8");
  assert.doesNotMatch(src, /body\.class\s*=/, "no class assignment may return");
  assert.match(src, /NetSuite owns Sales Order line Class through the Item record/);
  // The false comment that let this ship is gone.
  assert.doesNotMatch(src, /NetSuite class id \(resolved via BS resolver/);
});

test("8 · FALSIFICATION — the prior emission is reconstructed and shown absent", () => {
  // What shipped, and what it produced for each reachable segment value.
  const prior = (seg: string | null): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (seg) { body.class = { id: seg }; body.cseg_dps_bus_seg = { id: seg }; }
    return body;
  };
  assert.deepEqual(prior("1").class, { id: "1" }, "segment 1 emitted class 1");
  assert.deepEqual(prior("3").class, { id: "3" }, "segment 3 emitted class 3");

  for (const seg of ["1", "3"]) {
    assert.equal(
      has(buildSalesOrderPayload({ ...base, businessSegmentId: seg }), "class"),
      false,
    );
  }
});
