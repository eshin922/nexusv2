import assert from "node:assert/strict";
import test from "node:test";
import { orderCustomerItemGroupRows, summarizeCustomerItemGroups } from "../../src/lib/customer-item-group-order.ts";

test("customer rows retain every priced line while keeping each Item Group contiguous", () => {
  const groupA = { id: "a", name: "Gummy kit", sku: "KIT-A" };
  const groupB = { id: "b", name: "Carton kit", sku: "KIT-B" };
  const rows = [
    { id: "a-1", itemGroup: groupA, amount: 10 },
    { id: "direct", itemGroup: null, amount: 7 },
    { id: "b-1", itemGroup: groupB, amount: 13 },
    { id: "a-2", itemGroup: groupA, amount: 5 },
    { id: "a-own", itemGroup: groupA, amount: 3 },
  ];
  const ordered = orderCustomerItemGroupRows(rows);
  assert.deepEqual(ordered.map((row) => row.id), ["a-1", "a-2", "a-own", "direct", "b-1"]);
  assert.equal(ordered.reduce((total, row) => total + row.amount, 0), 38);
  assert.equal(new Set(ordered).size, rows.length);
});

test("group totals sum member amounts once and use the group's own ordered quantity", () => {
  const group = { id: "g" };
  const rows = [
    { itemGroup: group, tierLineTotals: [20, 100] },
    { itemGroup: null, tierLineTotals: [20, 100] },
    { itemGroup: group, tierLineTotals: [20, 100] },
  ];
  const summaries = summarizeCustomerItemGroups(rows, new Map([["g", [100, 500]]]));
  assert.deepEqual(summaries.get("g"), [
    { unitPrice: 0.4, lineTotal: 40 },
    { unitPrice: 0.4, lineTotal: 200 },
  ]);
  assert.equal(rows.reduce((total, row) => total + row.tierLineTotals[0], 0), 60);
});

test("an unpriced member makes the group subtotal quote on request", () => {
  const rows = [
    { itemGroup: { id: "g" }, tierLineTotals: [20, 100] },
    { itemGroup: { id: "g" }, tierLineTotals: [null, 100] },
  ];
  assert.deepEqual(summarizeCustomerItemGroups(rows, new Map([["g", [100, 500]]])).get("g"), [
    { unitPrice: null, lineTotal: null },
    { unitPrice: 0.4, lineTotal: 200 },
  ]);
});
