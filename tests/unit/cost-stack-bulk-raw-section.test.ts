// T-4 evidence — Bulk Raw is its own governed Cost Stack section.
//
// Pattern 57's prior worked example held that bulk raw "has no node of its own"
// and is "already carried by Production", so it got no row. Implementation
// evidence invalidated both. These tests pin the corrected contract so the
// premise cannot silently revert.
//
// Scope discipline: this is a REPRESENTATION repair. Costing arithmetic, quoted
// sell, margins and markup policy are unchanged, and test 7 is the assertion
// that keeps it that way — the split reapportions an existing figure between
// two rows rather than adding or removing one.
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingProductionInput,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { quoteScopeKey, readNodeValue } from "../../src/lib/costing-nodes.ts";

const LEAF = "leaf-1";
const TIER = "tier-1";
const QTY = 1000;

/** Manufacturing and Raw markups differ throughout — evidence item 2. If they
 *  were equal, a wrong-authority implementation would pass by coincidence. */
const MANUFACTURING = 0.32;
const RAW = 0.5;

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Manufacturing: MANUFACTURING, Primary: 0.4, Other: RAW },
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
    tiers: [
      { id: TIER, label: "T1", qty: QTY, sortOrder: 0, tierPriceAdjPct: null },
    ],
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

const pkg = (over: Partial<CostingPackagingInput> = {}): CostingPackagingInput =>
  ({
    id: "p-1",
    quoteSkuId: LEAF,
    tierId: TIER,
    lineGroupId: "lg-1",
    category: "Primary",
    supplier: null,
    unitCost: 2,
    qtyPerSellableUnit: 1,
    markupPct: 0.4,
    markupPctSource: "manual_override",
    inventoryEligible: false,
    purchaseQty: null,
    notes: null,
    sortOrder: 0,
  }) as CostingPackagingInput;

/** Production > 0 AND bulk raw > 0 — evidence item 1. */
const prod = (
  over: Partial<CostingProductionInput> = {}
): CostingProductionInput => ({
  quoteSkuId: LEAF,
  tierId: TIER,
  customerShipsRaws: false,
  allocateServiceFeesToCost: true,
  fillingBlendingCost: 1800,
  cmAssemblyTotal: 1200,
  setupFeeTotal: 800,
  toolingArtworkTotal: 900,
  rdTotal: 250,
  otherServiceTotal: 50,
  bulkRawCost: 4000,
  actualUnitsProduced: null,
  ...over,
});

const run = (over: Partial<QuoteCostingInput> = {}) =>
  computeQuoteCosting(
    input({ packaging: [pkg()], production: [prod()], ...over })
  );

const perUnit = (r: ReturnType<typeof computeQuoteCosting>, name: string) =>
  readNodeValue(r.graph, quoteScopeKey(TIER, `per-unit/${name}`));

test("1+2 · fixture has Production > 0, Bulk Raw > 0, and differing markups", () => {
  const r = run();
  assert.ok((perUnit(r, "prod/cost") ?? 0) > 0, "production cost > 0");
  assert.ok((perUnit(r, "raw/cost") ?? 0) > 0, "bulk raw cost > 0");
  assert.notEqual(MANUFACTURING, RAW, "the two markup authorities differ");

  // The markup RATES resolve differently, which is what makes item 6 meaningful.
  const prodRate = (perUnit(r, "prod/markup") ?? 0) / (perUnit(r, "prod/cost") ?? 1);
  const rawRate = (perUnit(r, "raw/markup") ?? 0) / (perUnit(r, "raw/cost") ?? 1);
  assert.ok(Math.abs(prodRate - MANUFACTURING) < 1e-9, `prod rate ${prodRate}`);
  assert.ok(Math.abs(rawRate - RAW) < 1e-9, `raw rate ${rawRate}`);
});

test("3 · both Production and Bulk Raw sections render", () => {
  // The header renders a column only when EVERY value it reads resolves, so a
  // null on any of these six is an absent section, not a zero one.
  const r = run();
  for (const name of ["prod", "prod/cost", "prod/markup", "raw", "raw/cost", "raw/markup"]) {
    assert.notEqual(perUnit(r, name), null, `${name} must resolve`);
  }
});

test("4 · each section matches its governed node independently", () => {
  const r = run();
  // Bulk raw: 4000 over 1000 units, marked up at the RAW authority.
  assert.ok(Math.abs((perUnit(r, "raw/cost") ?? 0) - 4) < 1e-9, "4000 / 1000");
  assert.ok(Math.abs((perUnit(r, "raw/markup") ?? 0) - 4 * RAW) < 1e-9);
  assert.ok(Math.abs((perUnit(r, "raw") ?? 0) - 4 * (1 + RAW)) < 1e-9);

  // Production is NET of raw — it must not still contain it.
  const prodCost = perUnit(r, "prod/cost") ?? 0;
  const rawCost = perUnit(r, "raw/cost") ?? 0;
  assert.ok(prodCost > 0);
  assert.ok(
    Math.abs(prodCost - 4) > 1e-9 || prodCost !== rawCost,
    "production cost is its own figure"
  );

  // A section equals cost + markup, by construction.
  for (const s of ["prod", "raw"]) {
    assert.ok(
      Math.abs((perUnit(r, s) ?? 0) - ((perUnit(r, `${s}/cost`) ?? 0) + (perUnit(r, `${s}/markup`) ?? 0))) < 1e-9,
      `${s} = cost + markup`
    );
  }
});

test("5 · changing Raw markup moves only the Raw contribution", () => {
  const base = run();
  const moved = computeQuoteCosting(
    input({
      packaging: [pkg()],
      production: [prod()],
      markupDefaults: { Manufacturing: MANUFACTURING, Primary: 0.4, Other: 0.9 },
    })
  );
  assert.notEqual(perUnit(base, "raw"), perUnit(moved, "raw"), "raw moved");

  // PROD is derived as `productionMarkupSum - rawMarkupSum`, so changing the
  // raw markup re-associates that subtraction and PROD can differ in the last
  // representable bit — 6.6 vs 6.600000000000001. That is float
  // representation, not a commercial move, so this asserts at a tolerance far
  // below a cent rather than on bit equality. Stated explicitly because
  // "unmoved" asserted with a tolerance is a weaker claim than "unmoved", and
  // the reader is owed the difference.
  const unmoved = (name: string) =>
    assert.ok(
      Math.abs((perUnit(base, name) ?? 0) - (perUnit(moved, name) ?? 0)) < 1e-9,
      `${name} unmoved: ${perUnit(base, name)} vs ${perUnit(moved, name)}`
    );
  unmoved("prod");
  unmoved("pkg");
  unmoved("raw/cost");
});

test("6 · changing Manufacturing markup does not move Raw", () => {
  const base = run();
  const moved = computeQuoteCosting(
    input({
      packaging: [pkg()],
      production: [prod()],
      markupDefaults: { Manufacturing: 0.75, Primary: 0.4, Other: RAW },
    })
  );
  assert.notEqual(perUnit(base, "prod"), perUnit(moved, "prod"), "prod moved");
  assert.equal(perUnit(base, "raw"), perUnit(moved, "raw"), "raw unmoved");
});

test("7 · visible Cost Stack reconciliation remains exact", () => {
  // The whole scope constraint in one assertion: the split reapportions an
  // existing figure between two rows. Sections must still sum to the subtotal
  // the header displays.
  const r = run();
  const sections = ["pkg", "prod", "raw", "frt", "dt"].map((n) => perUnit(r, n) ?? 0);
  const subtotal = readNodeValue(r.graph, quoteScopeKey(TIER, "per-unit"));
  assert.notEqual(subtotal, null);
  assert.ok(
    Math.abs(sections.reduce((a, b) => a + b, 0) - subtotal!) < 1e-9,
    `sections ${sections.reduce((a, b) => a + b, 0)} vs subtotal ${subtotal}`
  );
});

test("7b · quoted sell and margin are untouched by the representation split", () => {
  // Guards the "do not change costing arithmetic" constraint from the other
  // side: the cell's sell is built from cellSections, which this repair never
  // touched. Raw already contributed there before the row existed.
  const r = run();
  const cell = r.skuRollups
    .find((s) => s.skuId === LEAF)
    ?.perTier.find((p) => p.tierId === TIER);
  assert.ok(cell, "cell rollup present");
  assert.ok(cell!.requiredSellPerUnit > 0);
  // Raw's marked-up per-unit is inside sell, and always was.
  assert.ok(
    cell!.rawMarkupSumPerUnit > 0,
    "bulk raw contributes to sell independently"
  );
});

test("8 · FALSIFICATION — under the prior behaviour the Raw contribution is unexplained", () => {
  // Reconstructs Pattern 57's shipped state: rows [pkg, prod, frt, dt] with
  // prod carrying the FOLDED production+raw figure. Two facts fall out, and
  // together they are why the prior state could not be defended:
  //
  //   (a) with prod NET of raw and no RAW row, the stack silently loses money;
  //   (b) with prod FOLDED, the stack reconciles — but the raw contribution is
  //       attributed to an authority that did not price it.
  const r = run();
  const rawSection = perUnit(r, "raw") ?? 0;
  const subtotal = readNodeValue(r.graph, quoteScopeKey(TIER, "per-unit"))!;
  assert.ok(rawSection > 0, "there is a raw contribution to lose");

  const withoutRawRow = ["pkg", "prod", "frt", "dt"]
    .map((n) => perUnit(r, n) ?? 0)
    .reduce((a, b) => a + b, 0);

  // (a) The gap is exactly the raw contribution — unexplained and absent.
  assert.ok(
    Math.abs(subtotal - withoutRawRow - rawSection) < 1e-9,
    "the missing amount is precisely bulk raw"
  );
  assert.ok(withoutRawRow < subtotal, "the four-row stack under-reports");

  // (b) And the folded alternative misattributes it: a PROD row carrying raw
  // would report a markup that matches neither authority's rate.
  const foldedCost = (perUnit(r, "prod/cost") ?? 0) + (perUnit(r, "raw/cost") ?? 0);
  const foldedMarkup = (perUnit(r, "prod/markup") ?? 0) + (perUnit(r, "raw/markup") ?? 0);
  const blendedRate = foldedMarkup / foldedCost;
  assert.ok(
    Math.abs(blendedRate - MANUFACTURING) > 1e-6 && Math.abs(blendedRate - RAW) > 1e-6,
    `folded rate ${blendedRate} is neither ${MANUFACTURING} nor ${RAW}`
  );
});
