import assert from "node:assert/strict";
import test from "node:test";
import { computeShipmentContribution } from "../../src/lib/costing.ts";
import { activeCustomsChargeRows, selectCustomsMemberCharge } from "../../src/lib/costs/customs-sku-selection.ts";

test("SKU customs totals stay with their SKU while pooled freight is unchanged", () => {
  const quantities = [30_000, 30_000, 5_000];
  const dutyTotals = [3_000, 6_000, 500];
  const tariffTotals = [600, 1_200, 250];
  const rows = quantities.map((quantity, index) => computeShipmentContribution({
    tierUnits: 30_000, memberCount: 3, freightAmount: 9_000, freightMarkupPct: 0,
    dutyAmount: dutyTotals[index], dutyMarkupPct: 0, dutyMemberCount: 1, dutyTierUnits: quantity,
    tariffAmount: tariffTotals[index], tariffMarkupPct: 0, tariffMemberCount: 1, tariffTierUnits: quantity,
  }));
  assert.deepEqual(rows.map((row) => row.freightCostPerUnit), [0.1, 0.1, 0.1]);
  assert.deepEqual(rows.map((row) => row.dutyCostPerUnit), [0.1, 0.2, 0.1]);
  assert.deepEqual(rows.map((row) => row.tariffCostPerUnit), [0.02, 0.04, 0.05]);
  assert.equal(rows.reduce((sum, row, index) => sum + row.dutyCostPerUnit * quantities[index], 0), 9_500);
  assert.equal(rows.reduce((sum, row, index) => sum + row.tariffCostPerUnit * quantities[index], 0), 2_050);
});

test("removed shipment SKUs cannot contribute stale customs totals", () => {
  const rows = [
    { quoteLeafId: null, amount: 1_000, markupPct: 0 },
    { quoteLeafId: "selected", amount: 300, markupPct: 0 },
    { quoteLeafId: "removed", amount: 700, markupPct: 0 },
  ];
  assert.deepEqual(activeCustomsChargeRows(rows, ["selected"]), [rows[1]]);
  assert.deepEqual(activeCustomsChargeRows(rows, ["selected", "new"]), [rows[0]]);
});

test("SKU entries displace pooled customs without leaking one SKU into another", () => {
  const rows = [
    { quoteLeafId: null, amount: 9_500, markupPct: 0 },
    { quoteLeafId: "first", amount: 3_000, markupPct: 0 },
  ];
  assert.deepEqual(selectCustomsMemberCharge(rows, "first", ["first", "second"]), { row: rows[0], perSku: false });
  const complete = [...rows, { quoteLeafId: "second", amount: 6_500, markupPct: 0 }];
  assert.deepEqual(selectCustomsMemberCharge(complete, "first", ["first", "second"]), { row: rows[1], perSku: true });
  assert.deepEqual(selectCustomsMemberCharge(complete, "second", ["first", "second"]), { row: complete[2], perSku: true });
});
