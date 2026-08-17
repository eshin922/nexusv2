import assert from "node:assert/strict";
import test from "node:test";

import { computeShipmentContribution } from "../../src/lib/costing.ts";

test("a freight subcategory contributes freight, duty, and tariff exactly once", () => {
  const shipment = {
    memberCount: 1,
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

test("the only allocation operand is the member COUNT — never a weight", () => {
  // This asserted that the contribution had no allocation operand at all. The
  // V1 freight distribution policy (2026-08-15) gives it exactly one: a
  // shipment's freight is borne equally by the products in it, so the member
  // count divides.
  //
  // What must still be absent is a WEIGHTED allocator. Equal split was chosen
  // because no governed member-level weight exists — `freight_subcategory_items`
  // carries none, and the only `cbm` column is the whole shipment's at a tier.
  // A cbm/weight/cost-share term appearing here would mean an allocator had
  // been introduced from data that is not governed or not complete, which is
  // the specific thing the policy defers until it is.
  const source = computeShipmentContribution.toString();
  assert.match(source, /memberCount/, "the equal split must be visible here");
  assert.doesNotMatch(
    source,
    /cbm|weight|costShare|valueShare/i,
    "no weighted allocator until the underlying data is governed and complete",
  );
});
