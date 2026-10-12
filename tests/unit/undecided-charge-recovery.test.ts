import assert from "node:assert/strict";
import test from "node:test";
import { undecidedCostedChargeCount } from "../../src/lib/pricing-cost-base.ts";

test("counts each costed charge once across tiers until recovery is elected", () => {
  const charges = [
    { chargeInstanceId: "setup", cost: 1450 },
    { chargeInstanceId: "setup", cost: 1450 },
    { chargeInstanceId: "tooling", cost: 825 },
    { chargeInstanceId: "unpriced", cost: 0 },
  ];
  assert.equal(undecidedCostedChargeCount({ componentCharges: charges, chargeElections: [] }), 2);
  assert.equal(
    undecidedCostedChargeCount({ componentCharges: charges, chargeElections: [{ chargeInstanceId: "setup" }] }),
    1,
  );
  assert.equal(
    undecidedCostedChargeCount({ componentCharges: charges, chargeElections: [
      { chargeInstanceId: "setup" },
      { chargeInstanceId: "tooling" },
    ] }),
    0,
  );
});
