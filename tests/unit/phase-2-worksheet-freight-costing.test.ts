import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";

test("selected worksheet shipment replaces legacy freight and contributes once", () => {
  const input: QuoteCostingInput = {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [{ id: "anchor", canonicalQuoteLeafId: "ql", parentSkuId: null, qtyPerParent: null, skuRole: "leaf", skuLabel: "SKU", productName: "Product", sortOrder: 0, retailBenchmark: null }],
    tiers: [{ id: "tier", label: "100", qty: 100, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [], production: [],
    freightLegGroups: [{ id: "legacy-group", label: "Legacy", displayOrder: 0 }],
    freightLegs: [{ id: "legacy-leg", legGroupId: "legacy-group", direction: "outbound", label: null, origin: null, destination: null, crossesInternationalBorder: false, treatment: "bundled", mode: null, carrier: null, incoterm: null, cargoReadyDate: null, vesselEtd: null, vesselEta: null, actualDeliveryDate: null, dutyMarkupPct: 0, tariffMarkupPct: 0, customs: {}, displayOrder: 0 }],
    freightLegTiers: [{ freightLegId: "legacy-leg", tierId: "tier", totalFreight: 100, unitsInShipment: null }],
    freightShipmentBreaks: [{ freightSubcategoryId: "shipment", memberSkuId: "anchor", memberCount: 1, tierId: "tier", tierUnits: 100, treatment: "bundled", freightAmount: 600, freightMarkupPct: 0.2, dutyAmount: 100, dutyMarkupPct: 0.2, tariffAmount: 200, tariffMarkupPct: 0.2 }],
    cellOverrides: [], cellTargets: [],
  };

  const result = computeQuoteCosting(input).skuRollups[0].perTier[0];
  assert.equal(result.totalLandedFreightBeforeMarkup, 9);
  assert.ok(Math.abs(result.totalLandedFreightWithMarkup - 10.8) < 1e-12);
  assert.equal(result.freightLegs.length, 0);
});

test("loader reaches only the selected destination and maps one assembly anchor", async () => {
  const source = await readFile(new URL("../../src/app/actions/costing.ts", import.meta.url), "utf8");
  assert.match(source, /eq\(freightDestinations\.id, freightSubcategories\.selectedDestinationId\)/);
  // V1 FREIGHT DISTRIBUTION POLICY (2026-08-15) · there is no anchor to map.
  //
  // This asserted "one anchor per assembly" and that the loader must NOT read
  // `freightSubcategoryItems`. Both encoded the rule that has just been
  // replaced: a shipment's freight went to one leaf chosen from the shipment's
  // ASSEMBLY, a set that is not the shipment. The prohibition on reading
  // membership is what forced that substitution.
  //
  // The loader now emits one break PER MEMBER, read from the governed
  // membership table, so the assertions invert.
  assert.doesNotMatch(
    source,
    /anchorByAssembly/,
    "assembly-derived anchor selection must be gone, not merely unused",
  );
  assert.match(source, /membersBySubcategory/);
  assert.match(
    source,
    /\.from\(freightSubcategoryItems\)/,
    "the loader must read the governed membership boundary",
  );
  // And every emitted break must carry the count it was divided by, or the
  // engine cannot state the split.
  assert.match(source, /memberCount: members\.length/);
});
