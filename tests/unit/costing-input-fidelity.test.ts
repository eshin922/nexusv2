/**
 * A preview begins from the committed input and differs only where staged.
 *
 * That sentence is the contract. It was violated for as long as the client
 * could recompute anything, and nothing could see it.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `QuoteCostingInput` carries five freight fields. `buildCostingInput` copied
 * three. The two it missed —`freightComponentTierCosts` and
 * `freightShipmentBreaks` — are OPTIONAL on the external type, so omitting them
 * compiled cleanly, and the store had no home for them anyway.
 *
 * `freightShipmentBreaks.length > 0` is what makes the worksheet model
 * authoritative. On a worksheet-freight quote the three copied arrays are
 * EMPTY, so every client-side computation dropped all freight and duty/tariff
 * and reported an improved margin.
 *
 * Not preview-only: `recompute` — reached by fourteen store mutators — builds
 * its input the same way, so an ordinary optimistic edit corrupted the
 * COMMITTED costing until the next server reconcile replaced it. Transient,
 * which is why it survived: it flickered rather than persisted.
 *
 * ── WHAT THESE TESTS PIN ──────────────────────────────────────────────────
 *
 * Two structural invariants that hold for any quote, then a worksheet-freight
 * fixture that proves the arithmetic the defect actually moved. The invariants
 * are the durable half — a fixture proves today's data is fine, an invariant
 * proves the next field added to the input cannot go missing the same way.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingFreightShipmentBreak,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import {
  buildCostingInput,
  type HydrateSnapshot,
  type StoredPackagingRow,
} from "../../src/lib/costing-store.ts";

const TIER = "tier-1";
const LEAF = "leaf-1";
const ASSEMBLY = "asy-1";

/**
 * A quote whose freight lives ENTIRELY in the worksheet model.
 *
 * The leg arrays are empty, exactly as they are on the production quote that
 * surfaced this. That is the shape the defect needed: with legs empty and the
 * worksheet dropped, freight does not merely change — it disappears.
 */
const SHIPMENT_BREAK: CostingFreightShipmentBreak = {
  freightSubcategoryId: "sub-1",
  // Worksheet freight is assembly-owned; the adapter resolves one deterministic
  // math-leaf carrier so the leaf-based stack receives the contribution once.
  memberSkuId: LEAF,
  tierId: TIER,
  treatment: "bundled",
  memberCount: 1,
  tierUnits: 10_000,
  freightAmount: 7250,
  freightMarkupPct: 0.2,
  dutyAmount: 750,
  dutyMarkupPct: 0.2,
  tariffAmount: null,
  tariffMarkupPct: 0.2,
};

/**
 * The STORED shape, which is what a snapshot carries — the costing input's
 * packaging row plus the authoring-side fields the engine ignores. Declared
 * once and used for both so the two cannot drift inside the fixture itself.
 */
const PACKAGING: StoredPackagingRow[] = [
  {
    rowId: "row-1",
    quoteSkuId: LEAF,
    tierId: TIER,
    lineGroupId: "lg-1",
    unitCost: 3.9,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
    pricingVendorHubspotCompanyId: null,
    pricingVendorNameSnapshot: null,
    legacySupplier: null,
  },
];

function snapshot(): HydrateSnapshot {
  const input: QuoteCostingInput = {
    quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.3, Primary: 0.45, Secondary: 0.5, Manufacturing: 0.3 },
    skus: [
      {
        id: LEAF,
        parentSkuId: ASSEMBLY,
        qtyPerParent: 1,
        skuRole: "leaf",
        skuLabel: "FX-1",
        productName: "Fixture leaf",
        sortOrder: 0,
        retailBenchmark: null,
        canonicalQuoteLeafId: LEAF,
      },
      {
        id: ASSEMBLY,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "assembly",
        skuLabel: "FX-ASY",
        productName: "Fixture assembly",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [
      { id: TIER, label: "10K", qty: 10_000, sortOrder: 0, tierPriceAdjPct: null },
    ],
    packaging: PACKAGING,
    production: [],
    // EMPTY, deliberately. The worksheet is the authority on this quote.
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightShipmentBreaks: [SHIPMENT_BREAK],
    freightComponentTierCosts: [],
    cellOverrides: [],
    cellTargets: [],
  };

  return {
    revision: 1,
    quoteId: "q-1",
    projectId: "p-1",
    globalPriceAdjPct: 0.1,
    targetMarginPct: null,
    firmSettings: input.firmSettings,
    markupDefaults: input.markupDefaults,
    skus: input.skus,
    tiers: input.tiers,
    packaging: PACKAGING,
    production: input.production,
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightCustomerArrangesMeta: [],
    freightComponentTierCosts: [],
    freightShipmentBreaks: [SHIPMENT_BREAK],
    cellOverrides: [],
    cellTargets: [],
    // No lift on this quote. Explicit rather than absent: the fidelity
    // property here is that the client reconstruction equals the server input
    // KEY FOR KEY, and a key nobody states is a key nobody compares.
    lifts: [],
    costing: computeQuoteCosting(input),
    persistedWarnings: [],
  };
}

/** The store shape `buildCostingInput` reads, assembled from a snapshot. */
function storeState(snap: HydrateSnapshot) {
  return {
    quoteId: snap.quoteId,
    projectId: snap.projectId,
    globalPriceAdjPct: snap.globalPriceAdjPct,
    targetMarginPct: snap.targetMarginPct,
    firmSettings: snap.firmSettings,
    markupDefaults: snap.markupDefaults,
    skus: snap.skus,
    tiers: snap.tiers,
    packaging: snap.packaging,
    production: snap.production,
    freightLegGroups: snap.freightLegGroups,
    freightLegs: snap.freightLegs,
    freightLegTiers: snap.freightLegTiers,
    freightCustomerArrangesMeta: snap.freightCustomerArrangesMeta,
    freightComponentTierCosts: snap.freightComponentTierCosts,
    freightShipmentBreaks: snap.freightShipmentBreaks,
    cellOverrides: snap.cellOverrides,
    cellTargets: snap.cellTargets,
    lifts: snap.lifts,
  } as Parameters<typeof buildCostingInput>[0];
}

const SNAP = snapshot();
const committed = buildCostingInput(storeState(SNAP));

// ── invariant 1 · unchanged parity ────────────────────────────────────────

test("the rebuilt committed input reproduces the server's, field for field", () => {
  // The server computed `SNAP.costing` from its own input. Rebuilding through
  // the client's builder must produce a run that agrees on every commercial
  // scalar — which it cannot do if the builder is missing a governed field.
  const rebuilt = computeQuoteCosting(committed);
  const s = SNAP.costing.quoteRollup[0];
  const c = rebuilt.quoteRollup[0];
  assert.equal(c.totalRevenue, s.totalRevenue);
  assert.equal(c.totalCost, s.totalCost);
  assert.equal(c.blendedMarginPct, s.blendedMarginPct);
  assert.deepEqual(c.costBreakdown, s.costBreakdown);
});

test("the builder supplies every governed field, not only the freight subset", () => {
  // `Required<QuoteCostingInput>` is the compile-time half of this; the runtime
  // half catches a field present but undefined, which the type cannot.
  for (const [key, value] of Object.entries(committed)) {
    assert.notEqual(value, undefined, `${key} is undefined in the built input`);
  }
  // Named explicitly so the two that went missing can never go missing quietly.
  assert.deepEqual(committed.freightShipmentBreaks, [SHIPMENT_BREAK]);
  assert.deepEqual(committed.freightComponentTierCosts, []);
  assert.deepEqual(committed.lifts, []);
});

// ── invariant 2 · staged isolation ────────────────────────────────────────

/** Every top-level key where two inputs differ. */
function differingKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
}

test("a staged lift changes the input at `lifts` and nowhere else", () => {
  const preview: QuoteCostingInput = {
    ...committed,
    lifts: [{ quoteLeafId: LEAF, tierId: TIER, liftPct: 0.05 }],
  };
  assert.deepEqual(differingKeys(committed, preview), ["lifts"]);
});

test("a staged global adjustment changes the input at `quote` and nowhere else", () => {
  const preview: QuoteCostingInput = {
    ...committed,
    quote: { ...committed.quote, globalPriceAdjPct: 0.18 },
  };
  assert.deepEqual(differingKeys(committed, preview), ["quote"]);
});

// ── the arithmetic the defect moved ───────────────────────────────────────

const tier = () => SNAP.costing.quoteRollup[0];

test("the fixture actually carries worksheet freight — otherwise it proves nothing", () => {
  // Guarding the guard. If the fixture ever stopped producing freight, every
  // assertion below would pass while testing nothing, which is how the
  // original defect hid.
  assert.ok(tier().costBreakdown.freightContainer > 0);
  assert.ok(tier().costBreakdown.dutyAndTariff > 0);
  assert.equal(SNAP.freightLegs.length, 0, "legs must be empty — worksheet quote");
});

test("an unchanged client recompute preserves freight, D+T, sell and margin", () => {
  // The ordinary optimistic-edit path: `recompute` builds its input exactly
  // this way. Before the fix, freight and D+T both went to zero here and the
  // margin rose.
  const r = computeQuoteCosting(committed);
  assert.equal(
    r.quoteRollup[0].costBreakdown.freightContainer,
    tier().costBreakdown.freightContainer,
  );
  assert.equal(
    r.quoteRollup[0].costBreakdown.dutyAndTariff,
    tier().costBreakdown.dutyAndTariff,
  );
  assert.equal(r.quoteRollup[0].totalRevenue, tier().totalRevenue);
  assert.equal(r.quoteRollup[0].blendedMarginPct, tier().blendedMarginPct);
});

test("an unchanged preview reproduces the committed result exactly", () => {
  const preview = computeQuoteCosting({ ...committed }, "preview");
  assert.deepEqual(preview.quoteRollup[0].costBreakdown, tier().costBreakdown);
  assert.equal(preview.quoteRollup[0].blendedMarginPct, tier().blendedMarginPct);
});

test("staging a lift leaves freight and D+T untouched", () => {
  const preview = computeQuoteCosting(
    { ...committed, lifts: [{ quoteLeafId: LEAF, tierId: TIER, liftPct: 0.05 }] },
    "preview",
  );
  // A lift is a pricing act. Touching a cost component would mean it had
  // reached somewhere it has no business being.
  assert.equal(
    preview.quoteRollup[0].costBreakdown.freightContainer,
    tier().costBreakdown.freightContainer,
  );
  assert.equal(
    preview.quoteRollup[0].costBreakdown.dutyAndTariff,
    tier().costBreakdown.dutyAndTariff,
  );
  assert.equal(preview.quoteRollup[0].totalCost, tier().totalCost);
});

test("and only the pricing outcome moves, upward", () => {
  const preview = computeQuoteCosting(
    { ...committed, lifts: [{ quoteLeafId: LEAF, tierId: TIER, liftPct: 0.05 }] },
    "preview",
  );
  const before = tier();
  const after = preview.quoteRollup[0];
  assert.ok(
    after.totalRevenue > before.totalRevenue,
    "a lift raises revenue",
  );
  assert.ok(
    (after.blendedMarginPct as number) > (before.blendedMarginPct as number),
    "and margin with it",
  );
  // The direction is the point. Before the fix the margin also rose — by
  // 10.2pp, because freight had vanished. Cost holding still is what makes
  // this rise mean what it says.
  assert.equal(after.totalCost, before.totalCost);
});
