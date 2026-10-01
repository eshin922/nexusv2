import assert from "node:assert/strict";
import test from "node:test";
import { orderCustomerItemGroupRows } from "../../src/lib/customer-item-group-order.ts";

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
