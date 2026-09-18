import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { buildCostingInput, costingInputFromSnapshot, makeCostingStore, type HydrateSnapshot } from "../../src/lib/costing-store.ts";
import { costBaseFingerprint } from "../../src/lib/pricing-cost-base.ts";
import { detectStale } from "../../src/lib/pricing-stale-guard.ts";

function fixture(mode?: "included" | "separate", grouped = false): HydrateSnapshot {
  const tiers = [100, 500, 1000, 5000].map((qty, i) => ({
    id: `tier-${i}`, label: `${qty}`, qty, sortOrder: i, tierPriceAdjPct: null,
  }));
  const input: QuoteCostingInput = {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null, freightMarkupPct: .17 },
    firmSettings: { targetMarginPct: .35, floorMarginPct: .25 },
    markupDefaults: { Other: 0, Tooling: .2, Production: .4 },
    skus: [{ id: "leaf", canonicalQuoteLeafId: "owner", skuRole: "leaf", parentSkuId: grouped ? "group" : null,
      qtyPerParent: grouped ? 2 : null, skuLabel: "SKU", productName: "Product", sortOrder: 0, retailBenchmark: null },
      ...(grouped ? [{ id: "group", skuRole: "assembly" as const, parentSkuId: null, qtyPerParent: null,
        skuLabel: "GROUP", productName: "Group", sortOrder: 0, retailBenchmark: null }] : [])],
    tiers,
    packaging: tiers.map((t) => ({ quoteSkuId: "leaf", tierId: t.id, lineGroupId: "row", unitCost: 2,
      qtyPerSellableUnit: 1, category: "Other", markupPct: 0 })),
    production: [], assemblyProduction: [], freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    freightComponentTierCosts: [], freightShipmentBreaks: [], cellOverrides: [], cellTargets: [], lifts: [],
    // Deliberately unequal: a tier copy or quantity multiplication cannot pass.
    componentCharges: tiers.map((t, i) => ({ chargeInstanceId: "fee", tierId: t.id,
      chargeKey: "print_plates", ownerRef: "owner", cost: 100 + i * 25 })),
    chargeElections: mode ? [{ chargeKey: "print_plates", chargeInstanceId: "fee", mode }] : [],
  };
  return {
    revision: 1, quoteId: "quote", projectId: "project", globalPriceAdjPct: 0,
    targetMarginPct: null, freightMarkupPct: .17,
    firmSettings: input.firmSettings, markupDefaults: input.markupDefaults, skus: input.skus, tiers,
    packaging: input.packaging.map((p, i) => ({ ...p, rowId: `row-${i}`, pricingVendorHubspotCompanyId: null,
      pricingVendorNameSnapshot: null, legacySupplier: null })),
    production: [], assemblyProduction: [], componentCharges: [...input.componentCharges!],
    chargeElections: [...input.chargeElections!], componentChargeMeta: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [], freightCustomerArrangesMeta: [],
    freightComponentTierCosts: [], freightShipmentBreaks: [], cellOverrides: [], cellTargets: [], lifts: [],
    otherServiceItems: [], persistedWarnings: [], costing: computeQuoteCosting(input),
  };
}

for (const grouped of [false, true]) {
  for (const mode of [undefined, "included", "separate"] as const) {
    test(`${grouped ? "group member" : "standalone"} ${mode ?? "unelected"}: all four tiers survive adapters and optimistic edits`, () => {
      const s = fixture(mode, grouped);
      const store = makeCostingStore(s);
      assert.deepEqual(computeQuoteCosting(costingInputFromSnapshot(s)), s.costing);
      assert.deepEqual(computeQuoteCosting(buildCostingInput(store.getState())), s.costing);
      assert.equal(buildCostingInput(store.getState()).quote.freightMarkupPct, .17);
      for (const [i, t] of s.costing.quoteRollup.entries()) {
        assert.equal(t.totalCost, s.tiers[i].qty! * 2 * (grouped ? 2 : 1) + 100 + i * 25);
      }
      store.getState().updatePackagingCell("row-0", { unitCost: 3 });
      const expected = costingInputFromSnapshot(s);
      expected.packaging = expected.packaging.map((p, i) => i === 0 ? { ...p, unitCost: 3 } : p);
      assert.deepEqual(store.getState().costing, computeQuoteCosting(expected));
      store.getState().updateGlobalAdj(.1);
      expected.quote = { ...expected.quote, globalPriceAdjPct: .1 };
      assert.deepEqual(store.getState().costing, computeQuoteCosting(expected));
    });
  }
}

test("fee edit/refetch updates both adapters and rejects the staged economic basis; stale refetch cannot undo it", () => {
  const s = fixture("included");
  const store = makeCostingStore(s);
  const previewFingerprint = costBaseFingerprint(buildCostingInput(store.getState()));
  const next = structuredClone(s);
  next.revision = 2;
  next.componentCharges[0].cost = 800;
  next.freightMarkupPct = .23;
  next.costing = computeQuoteCosting(costingInputFromSnapshot(next));
  store.getState().reconcile(next);
  store.getState().reconcile(s);
  const actual = buildCostingInput(store.getState());
  assert.deepEqual(computeQuoteCosting(actual), next.costing);
  assert.equal(actual.componentCharges[0].cost, 800);
  assert.equal(actual.quote.freightMarkupPct, .23);
  assert.deepEqual(detectStale({ baseline: null, persisted: { globalAdj: "0", tierAdj: [], lifts: [], overrides: [] }, previewFingerprint,
    currentFingerprint: costBaseFingerprint(actual) }), { stale: true, kind: "economic_basis" });
  // A full hydrate (e.g. navigation) also carries charge removal, not stale fees.
  const cleared = { ...next, revision: 3, componentCharges: [], chargeElections: [] };
  cleared.costing = computeQuoteCosting(costingInputFromSnapshot(cleared));
  store.getState().hydrate(cleared);
  assert.deepEqual(computeQuoteCosting(buildCostingInput(store.getState())), cleared.costing);
});

test("charge changes alone invalidate Pricing, including election, owner, identity and tier", () => {
  const base = costingInputFromSnapshot(fixture());
  const before = costBaseFingerprint(base);
  const mutations: ((x: QuoteCostingInput) => void)[] = [
    x => { x.componentCharges = x.componentCharges!.map((c, i) => i === 0 ? { ...c, cost: 101 } : c); },
    x => { x.componentCharges = x.componentCharges!.slice(1); },
    x => { x.componentCharges = x.componentCharges!.map(c => ({ ...c, ownerRef: "another" })); },
    x => { x.componentCharges = x.componentCharges!.map(c => ({ ...c, chargeKey: "tooling" })); },
    x => { x.componentCharges = x.componentCharges!.map(c => ({ ...c, tierId: "another" })); },
    x => { x.chargeElections = [{ chargeInstanceId: "fee", chargeKey: "print_plates", mode: "separate" }]; },
  ];
  for (const mutate of mutations) {
    const next = structuredClone(base); mutate(next);
    assert.deepEqual(detectStale({ baseline: null, persisted: { globalAdj: "0", tierAdj: [], lifts: [], overrides: [] }, previewFingerprint: before,
      currentFingerprint: costBaseFingerprint(next) }), { stale: true, kind: "economic_basis" });
  }
  const reordered = structuredClone(base);
  reordered.componentCharges = [...reordered.componentCharges].reverse();
  assert.equal(costBaseFingerprint(reordered), before);
});

test("group production and inherited-zero distinctions are economic inputs", () => {
  const base = costingInputFromSnapshot(fixture());
  base.assemblyProduction = [{ assemblyId: "group", tierId: "tier-0", allocateServiceFeesToCost: true,
    fillingBlendingCost: 1, cmAssemblyTotal: 2, setupFeeTotal: 3, toolingArtworkTotal: 4, toolingTotal: 5,
    artworkTotal: 6, rdTotal: 7, testingMicrosTotal: 8, otherServiceTotal: 9, bulkRawCost: 10, actualUnitsProduced: null }];
  const next = structuredClone(base);
  next.assemblyProduction[0].testingMicrosTotal = 100;
  assert.notEqual(costBaseFingerprint(base), costBaseFingerprint(next));
  next.assemblyProduction = base.assemblyProduction;
  next.packaging[0].markupPct = null;
  assert.notEqual(costBaseFingerprint(base), costBaseFingerprint(next), "inherit is not an explicit 0% override");
  const operational = structuredClone(base);
  operational.assemblyProduction[0].actualUnitsProduced = 123;
  assert.equal(costBaseFingerprint(base), costBaseFingerprint(operational), "actual output does not reprice quoted units");
});
