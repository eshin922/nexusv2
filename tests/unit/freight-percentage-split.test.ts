import assert from "node:assert/strict";
import test from "node:test";
import { splitShipmentQuantities } from "../../src/lib/freight-percentage-split.ts";

test("one percentage splits every option and preserves exact whole-unit totals", () => {
  const [first, second] = splitShipmentQuantities([{ id: "small", qty: 101 }, { id: "large", qty: 501 }], 50);
  assert.deepEqual(first.quantities.map((row) => row.units), [51, 251]);
  assert.deepEqual(second.quantities.map((row) => row.units), [50, 250]);
  first.quantities.forEach((row, index) => assert.equal(row.units + second.quantities[index].units, row.total));
});
test("unequal percentages apply across both options", () => {
  const [first, second] = splitShipmentQuantities([{ id: "a", qty: 100 }, { id: "b", qty: 500 }], 30);
  assert.deepEqual(first.quantities.map((row) => row.units), [30, 150]);
  assert.deepEqual(second.quantities.map((row) => row.units), [70, 350]);
});
test("invalid or zero-unit splits are refused", () => {
  for (const percentage of [0, 100, NaN, -20, 50.001]) assert.throws(() => splitShipmentQuantities([{ id: "a", qty: 100 }], percentage));
  assert.throws(() => splitShipmentQuantities([{ id: "a", qty: 1 }], 50));
  assert.throws(() => splitShipmentQuantities([{ id: "a", qty: 10 }], 1));
});
