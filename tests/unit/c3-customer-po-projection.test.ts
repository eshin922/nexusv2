// C.3 V1 repair — the customer PO reaches the field Accounting named.
//
// NetSuite technician disposition (2026-08-11):
//   "Customer PO should be otherRefNum. custbody_dps_client_po is the custom
//    field used to get the data from HubSpot."
//
// Estate evidence agrees: otherRefNum 684/699 populated, custbody_dps_client_po
// 0/699, and Epicuren's cached client_po `13969` is exactly SO2646's
// otherRefNum. Nexus already captured the governed value and wrote it to the
// dead field — so this is a redirect of a wired path, not new capture.
//
// The custom-field write is PRESERVED. Whether it is still required as a
// staging field for the HubSpot synchronization path is not determinable from
// this side; unresolved ownership is authority to add, not to remove.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSalesOrderPayload,
  type SalesOrderPayloadInput,
} from "../../src/lib/netsuite/sales-orders.ts";

const base: SalesOrderPayloadInput = {
  netsuiteCustomerId: "customer-101",
  subsidiaryId: "subsidiary-2",
  orderStatusCode: "B",
  paymentTermsText: "Net 30",
  hubspotDealId: "deal-1",
  hubspotDealName: "C.3",
  clientPo: null,
  lines: [
    {
      netsuiteItemId: "item-1",
      sku: "SKU-1",
      description: "leaf",
      quantity: 10,
      rate: 1.5,
      unitCost: null,
    },
  ],
};

const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

test("1 · a populated client_po emits the identical value to otherRefNum", () => {
  // Epicuren's real cached value, and the real otherRefNum on SO2646.
  const payload = buildSalesOrderPayload({ ...base, clientPo: "13969" });
  assert.equal(payload.otherRefNum, "13969");
});

test("2 · a null client_po does not fabricate a PO", () => {
  for (const absent of [null, undefined, ""]) {
    const payload = buildSalesOrderPayload({
      ...base,
      clientPo: absent as string | null,
    });
    assert.equal(has(payload, "otherRefNum"), false, `${String(absent)}`);
    assert.equal(has(payload, "custbody_dps_client_po"), false);
  }
  // Nemah — the Case B fixture — has a null client_po. This is the assertion
  // that the C.3 repair leaves that payload and its read-back untouched.
});

test("3 · the governed PO value is transmitted verbatim — no formatting", () => {
  // Legacy otherRefNum values are heterogeneous by nature: bare numerics,
  // prefixed, and free text. Any normalisation would corrupt a customer's own
  // reference, which is the one thing this field exists to carry.
  for (const po of ["13969", "6321", "PO1005", "PO14441", " 0042 ", "a/b-1"]) {
    const payload = buildSalesOrderPayload({ ...base, clientPo: po });
    assert.equal(payload.otherRefNum, po);
    assert.equal(payload.custbody_dps_client_po, po);
  }
});

test("4 · both PO fields carry the same value — the custom field is preserved", () => {
  const payload = buildSalesOrderPayload({ ...base, clientPo: "PO1005" });
  assert.equal(payload.custbody_dps_client_po, payload.otherRefNum);
  // Preserved deliberately. Removing it on 0/699 population would be reasoning
  // from operator behaviour to integration ownership — two different claims.
});

test("5 · no unrelated SO payload field changed", () => {
  const before = buildSalesOrderPayload(base);
  const after = buildSalesOrderPayload({ ...base, clientPo: "13969" });
  const { otherRefNum: _o, custbody_dps_client_po: _c, ...rest } = after;

  assert.deepEqual(rest, before, "the PO is purely additive to the payload");
  // And nothing was silently dropped in the edit: the fields a Sales Order
  // cannot be created without are still emitted.
  for (const k of ["entity", "subsidiary", "orderStatus", "custbody_dps_deal_id", "item"]) {
    assert.equal(has(after, k), true, k);
  }
});

test("6 · the governed source is hubspot_deals_cache.client_po at both call sites", () => {
  // The repair is only real if the redirect sits downstream of the governed
  // source. Assert the wiring rather than trusting the payload shape alone.
  const markComplete = readFileSync("src/lib/netsuite/mark-complete.ts", "utf8");
  const wired = markComplete.match(/clientPo: \w+\.clientPo/g) ?? [];
  assert.equal(wired.length, 2, "plan preview and completion both pass it");

  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.match(schema, /clientPo: text\("client_po"\)/);
});

test("7 · FALSIFICATION — otherRefNum was never emitted before this repair", () => {
  // What shipped: the value was captured, carried the whole way, and written
  // only to the field 0 of 699 Sales Orders use. Stated explicitly so the
  // defect is legible rather than implied by its absence.
  const priorBehaviour = (po: string | null): Record<string, unknown> => {
    const body: Record<string, unknown> = {};
    if (po) body.custbody_dps_client_po = po;
    return body;
  };

  assert.equal(has(priorBehaviour("13969"), "otherRefNum"), false);
  assert.equal(
    buildSalesOrderPayload({ ...base, clientPo: "13969" }).otherRefNum,
    "13969",
  );
});
