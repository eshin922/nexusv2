/**
 * Gate 1B — synthetic coverage for the three behaviours no production data
 * reaches.
 *
 * The S-7 preservation baseline covers 24 quotes and is byte-exact, but the
 * database contains ZERO rows for two of the ten node kinds and never reaches
 * the last rung of the markup resolution ladder:
 *
 *   assembly_leaf_overrides                        0 rows  ->  `override`
 *   assembly_production_inputs.customer_ships_raws 0 rows  ->  `flagged-out`
 *   FALLBACK_MARKUP                                never reached
 *
 * That third one was found the hard way: perturbing `FALLBACK_MARKUP` by 1e-8
 * changed nothing and the preservation check passed. The check was measuring
 * correctly; the coverage was the gap. A perturbation that changes no observable
 * output is the definition of an untested path.
 *
 * So "preserve existing behaviour" for these three means preserving behaviour
 * nothing has ever exercised. These tests make that behaviour observable BEFORE
 * the node graph is emitted, so the graph inherits a contract rather than an
 * assumption.
 *
 * The engine is a pure function over `QuoteCostingInput`, so none of this needs
 * a database — which also keeps it clear of OD-012.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const TIER = "tier-1";
const LEAF = "leaf-1";

/** Minimal single-leaf, single-tier quote. Freight absent by design: these
 *  three behaviours live in packaging, production and sell resolution. */
function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.32, Manufacturing: 0.32, Other: 0.3 },
    skus: [
      {
        id: LEAF,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "SKU-1",
        productName: "Test leaf",
        sortOrder: 0,
        retailBenchmark: null,
      },
    ],
    tiers: [{ id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
    ...over,
  };
}

function pkg(over: Partial<CostingPackagingInput> = {}): CostingPackagingInput {
  return {
    quoteSkuId: LEAF,
    tierId: TIER,
    lineGroupId: "line-1",
    unitCost: 1,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
    ...over,
  };
}

function prod(over: Partial<CostingProductionInput> = {}): CostingProductionInput {
  return {
    quoteSkuId: LEAF,
    tierId: TIER,
    customerShipsRaws: false,
    allocateServiceFeesToCost: true,
    fillingBlendingCost: 0,
    cmAssemblyTotal: 0,
    setupFeeTotal: 0,
    toolingArtworkTotal: 0,
    toolingTotal: 0,
    artworkTotal: 0,
    rdTotal: 0,
    otherServiceTotal: 0,
    bulkRawCost: null,
    actualUnitsProduced: null,
    ...over,
  };
}

const cell = (r: ReturnType<typeof computeQuoteCosting>) => r.skuRollups[0].perTier[0];

// ---------------------------------------------------------------- override

test("override · replaces the computed sell entirely, and the computed value survives", () => {
  const base = cell(computeQuoteCosting(input({ packaging: [pkg({ unitCost: 2 })] })));
  assert.equal(base.sellSource, "computed");
  assert.equal(base.requiredSellPerUnit, base.computedSellPerUnit);

  const r = cell(
    computeQuoteCosting(
      input({
        packaging: [pkg({ unitCost: 2 })],
        cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }],
      }),
    ),
  );

  assert.equal(r.sellSource, "cell_override", "override must be reported, not inferred");
  assert.equal(r.requiredSellPerUnit, 9.5, "the override IS the sell");

  // R10 §1: the override is not an arithmetic node, and the superseded chain
  // stays visible. `computedSellPerUnit` is what the trace shows below the
  // dashed rule as "what the chain would have produced".
  assert.equal(
    r.computedSellPerUnit,
    base.computedSellPerUnit,
    "the superseded computation must be preserved, not overwritten",
  );
  assert.notEqual(r.requiredSellPerUnit, r.computedSellPerUnit);

  // Everything downstream reads the override, never the computed value.
  assert.equal(r.revenue, 9.5 * 1000);
  assert.equal(r.marginPct, (9.5 - r.contributionCostPerUnit) / 9.5);
});

test("override · bypasses the price adjustment rather than stacking with it", () => {
  const withAdj = input({
    quote: { id: "q-1", globalPriceAdjPct: 0.25, targetMarginPct: null },
    packaging: [pkg({ unitCost: 2 })],
    cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }],
  });
  const r = cell(computeQuoteCosting(withAdj));
  // Not 9.5 × 1.25. An override is a person stating a price; an adjustment
  // applied on top would silently overturn the number they typed.
  assert.equal(r.requiredSellPerUnit, 9.5);
});

test("override · zero is a real override, not an absent one", () => {
  const r = cell(
    computeQuoteCosting(
      input({
        packaging: [pkg({ unitCost: 2 })],
        cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 0 }],
      }),
    ),
  );
  // Guards the `??` vs `!== null` distinction: `cellOverride ?? computed`
  // treats 0 correctly, `cellOverride || computed` would not. A PM setting a
  // price to zero must not silently get the computed price instead.
  assert.equal(r.sellSource, "cell_override");
  assert.equal(r.requiredSellPerUnit, 0);
});

// ------------------------------------------------------------- flagged-out

test("flagged-out · customer-shipped raws contribute zero, and it is not merely a zero cost", () => {
  const shipped = cell(
    computeQuoteCosting(
      input({ production: [prod({ customerShipsRaws: true, bulkRawCost: 5000 })] }),
    ),
  );
  const notShipped = cell(
    computeQuoteCosting(
      input({ production: [prod({ customerShipsRaws: false, bulkRawCost: 5000 })] }),
    ),
  );

  assert.equal(shipped.rawCostPerUnit, 0, "excluded input contributes nothing");
  assert.equal(shipped.rawMarkupSumPerUnit, 0, "and carries no markup either");

  // The distinction the `flagged-out` kind exists to make: this is not "raw
  // cost happened to be zero". The input has a value of 5000; a decision
  // excluded it. Without the flag both cases look identical downstream.
  assert.equal(notShipped.rawCostPerUnit, 5000 / 1000);
  assert.ok(notShipped.rawCostPerUnit > 0);
  assert.ok(
    notShipped.contributionCostPerUnit > shipped.contributionCostPerUnit,
    "excluding the input must change the cost it would otherwise have added",
  );
});

test("flagged-out · a genuinely absent bulk raw cost is indistinguishable in value from an excluded one", () => {
  const absent = cell(computeQuoteCosting(input({ production: [prod({ bulkRawCost: null })] })));
  const excluded = cell(
    computeQuoteCosting(
      input({ production: [prod({ customerShipsRaws: true, bulkRawCost: 5000 })] }),
    ),
  );
  // Both are 0.00. This is precisely why the reason must be carried as node
  // metadata rather than inferred from the value — the scalar cannot tell a
  // reader which of the two happened.
  assert.equal(absent.rawCostPerUnit, 0);
  assert.equal(excluded.rawCostPerUnit, 0);
});

// ------------------------------------------------- markup resolution ladder

test("markup ladder · rung 1, an explicit line markup wins over every default", () => {
  const r = cell(
    computeQuoteCosting(
      input({ packaging: [pkg({ unitCost: 10, markupPct: 0.5, category: "Primary" })] }),
    ),
  );
  assert.equal(r.packagingCostPerUnit, 10);
  assert.equal(r.packagingMarkupSumPerUnit, 15, "10 × 1.5 — the line's own markup");
});

test("markup ladder · rung 2, the category default when no line markup is set", () => {
  const r = cell(
    computeQuoteCosting(
      input({
        markupDefaults: { Primary: 0.4, Other: 0.3 },
        packaging: [pkg({ unitCost: 10, markupPct: null, category: "Primary" })],
      }),
    ),
  );
  assert.equal(r.packagingMarkupSumPerUnit, 14, "10 × 1.4 — the Primary default");
});

test("markup ladder · rung 3, the Other default when the category has none", () => {
  const r = cell(
    computeQuoteCosting(
      input({
        markupDefaults: { Other: 0.3 },
        packaging: [pkg({ unitCost: 10, markupPct: null, category: "Shrink" })],
      }),
    ),
  );
  assert.equal(r.packagingMarkupSumPerUnit, 13, "10 × 1.3 — fell through to Other");
});

test("markup ladder · rung 4, the hardcoded fallback when even Other is absent", () => {
  // THE RUNG NO PRODUCTION DATA REACHES. Every packaging line in the database
  // resolves at rung 1 or 2, which is why perturbing FALLBACK_MARKUP changed
  // no observable output. Pinned here so the constant cannot drift unnoticed.
  const r = cell(
    computeQuoteCosting(
      input({
        markupDefaults: {},
        packaging: [pkg({ unitCost: 10, markupPct: null, category: "Shrink" })],
      }),
    ),
  );
  assert.equal(r.packagingMarkupSumPerUnit, 13, "10 × 1.3 — FALLBACK_MARKUP is 0.30");
});

test("markup ladder · a null category falls straight to Other, not to the fallback", () => {
  const r = cell(
    computeQuoteCosting(
      input({
        markupDefaults: { Other: 0.45 },
        packaging: [pkg({ unitCost: 10, markupPct: null, category: null })],
      }),
    ),
  );
  assert.equal(r.packagingMarkupSumPerUnit, 14.5, "10 × 1.45 — Other, not 0.30");
});

test("markup ladder · a zero line markup is a decision, not an absent one", () => {
  const r = cell(
    computeQuoteCosting(
      input({
        markupDefaults: { Primary: 0.4, Other: 0.3 },
        packaging: [pkg({ unitCost: 10, markupPct: 0, category: "Primary" })],
      }),
    ),
  );
  // Rung 1 with a value of zero must win over rung 2. Resolving on truthiness
  // rather than nullity would silently apply a 40% markup to a line a PM
  // deliberately set to zero.
  assert.equal(r.packagingMarkupSumPerUnit, 10, "10 × 1.0 — the explicit zero holds");
});
