import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";

function input(markup: number): QuoteCostingInput {
  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null, freightMarkupPct: markup },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [{
      id: "leaf", canonicalQuoteLeafId: "ql", parentSkuId: null,
      qtyPerParent: null, skuRole: "leaf", skuLabel: "SKU", productName: "Product",
      sortOrder: 0, retailBenchmark: null,
    }],
    tiers: [{ id: "tier", label: "100", qty: 100, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [], production: [],
    freightLegGroups: [{ id: "group", label: "Route", displayOrder: 0 }],
    freightLegs: [{
      id: "leg", legGroupId: "group", direction: "outbound", label: "Ocean",
      origin: null, destination: null, crossesInternationalBorder: false,
      treatment: "bundled", mode: "ocean_fcl", carrier: null, incoterm: null,
      cargoReadyDate: null, vesselEtd: null, vesselEta: null,
      actualDeliveryDate: null, dutyMarkupPct: 0,
      tariffMarkupPct: 0, customs: {}, displayOrder: 0,
    }],
    freightLegTiers: [{ freightLegId: "leg", tierId: "tier", totalFreight: null, unitsInShipment: null }],
    freightComponentTierCosts: [{ freightLegId: "leg", quoteLeafId: "ql", tierId: "tier", actualFreightCost: 100 }],
    cellOverrides: [], cellTargets: [],
  };
}

test("Quote freight markup moves every billable value without changing actual cost", () => {
  const beforeInput = input(0.1);
  const afterInput = structuredClone(beforeInput);
  afterInput.quote.freightMarkupPct = 0.25;

  const before = computeQuoteCosting(beforeInput).skuRollups[0].perTier[0];
  const after = computeQuoteCosting(afterInput).skuRollups[0].perTier[0];

  assert.deepEqual(afterInput.freightComponentTierCosts, beforeInput.freightComponentTierCosts);
  assert.equal(before.freightLegs[0].containerFreightPerUnit, 1);
  assert.equal(after.freightLegs[0].containerFreightPerUnit, 1);
  assert.equal(before.freightLegs[0].containerFreightWithMarkupPerUnit, 1.1);
  assert.equal(after.freightLegs[0].containerFreightWithMarkupPerUnit, 1.25);
  assert.equal(before.freightLegs[0].freightMarkupPct, 0.1);
  assert.equal(after.freightLegs[0].freightMarkupPct, 0.25);
});
