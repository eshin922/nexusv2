import assert from "node:assert/strict";
import test from "node:test";

import { computeShipmentContribution } from "../../src/lib/costing.ts";

test("a freight subcategory contributes freight, duty, and tariff exactly once", () => {
  const shipment = {
    tierUnits: 25_000,
    freightAmount: 6_000,
    freightMarkupPct: 0.2,
    dutyAmount: 500,
    dutyMarkupPct: 0.2,
    tariffAmount: 1_500,
    tariffMarkupPct: 0.2,
  };

  const oneMember = computeShipmentContribution(shipment);
  const threeMembers = computeShipmentContribution(shipment);

  assert.deepEqual(threeMembers, oneMember);
  assert.equal(oneMember.freightCostPerUnit, 0.24);
  assert.equal(oneMember.dutyCostPerUnit, 0.02);
  assert.equal(oneMember.tariffCostPerUnit, 0.06);
  assert.equal(oneMember.totalCostPerUnit, 0.32);
  assert.equal(oneMember.totalBillablePerUnit, 0.384);
});

test("shipment contribution has no membership or allocation operand", () => {
  const source = computeShipmentContribution.toString();

  assert.doesNotMatch(source, /member|allocation|share|weight|cbm/i);
});
