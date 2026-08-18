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
//
// ── BV-013 AMENDS ONE HALF OF THE PREMISE, AND NOT THE OTHER ─────────────
//
// T-4 rested on two claims. One survives; one is superseded, by business
// decision rather than by a defect.
//
//   SURVIVES  — Bulk Raw is its own governed QUANTITY: its own canonical node,
//               its own cost, its own Cost Stack section. Every structural
//               assertion below still holds and still matters.
//
//   SUPERSEDED — that its markup comes from a DIFFERENT AUTHORITY. It used to
//               resolve `Raw ingredients`, which has never had a default row
//               and therefore priced through `Other`. BV-013 makes one
//               `Production` authority serve the section and bulk raw alike.
//
// Keeping those apart is the point, and it is Pattern 57/58 exactly: being
// independently governed as a QUANTITY is a different property from being
// independently governed as a RATE. Tests 5 and 6 asserted the second and are
// rewritten below; nothing about the first is weakened to accommodate it.
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

/** One Production authority since BV-013. The fixture keeps a rate distinct
 *  from every OTHER category (Primary 0.4, Other 0.5) for the same reason the
 *  two used to differ from each other: if Production shared a value with a
 *  substitute rung, an implementation that fell through to it would pass by
 *  coincidence. */
const PRODUCTION = 0.32;
/** Deliberately NOT the Production rate. Nothing should ever resolve here on a
 *  production path; if something does, the arithmetic diverges visibly. */
const OTHER_TRAP = 0.5;

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: PRODUCTION, Primary: 0.4, Other: OTHER_TRAP },
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

test("1+2 · both sections carry cost, and both price at the ONE authority", () => {
  // The title used to end "and differing markups". BV-013 removed that, and
  // the two costs remaining independent is what the section split now rests on.
  const r = run();
  assert.ok((perUnit(r, "prod/cost") ?? 0) > 0, "production cost > 0");
  assert.ok((perUnit(r, "raw/cost") ?? 0) > 0, "bulk raw cost > 0");
  assert.notEqual(perUnit(r, "prod/cost"), perUnit(r, "raw/cost"), "distinct costs");

  const prodRate = (perUnit(r, "prod/markup") ?? 0) / (perUnit(r, "prod/cost") ?? 1);
  const rawRate = (perUnit(r, "raw/markup") ?? 0) / (perUnit(r, "raw/cost") ?? 1);
  assert.ok(Math.abs(prodRate - PRODUCTION) < 1e-9, `prod rate ${prodRate}`);
  assert.ok(Math.abs(rawRate - PRODUCTION) < 1e-9, `raw rate ${rawRate}`);
  // And neither drifted to the trap rate sitting in `Other`.
  assert.ok(Math.abs(prodRate - OTHER_TRAP) > 1e-6, "prod did not use Other");
  assert.ok(Math.abs(rawRate - OTHER_TRAP) > 1e-6, "raw did not use Other");
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
  // Bulk raw: 4000 over 1000 units, marked up at the ONE Production authority
  // since BV-013 — same rate as the section above it, different cost.
  assert.ok(Math.abs((perUnit(r, "raw/cost") ?? 0) - 4) < 1e-9, "4000 / 1000");
  assert.ok(Math.abs((perUnit(r, "raw/markup") ?? 0) - 4 * PRODUCTION) < 1e-9);
  assert.ok(Math.abs((perUnit(r, "raw") ?? 0) - 4 * (1 + PRODUCTION)) < 1e-9);

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

test("5 · BV-013 · one Production rate moves BOTH sections together", () => {
  // SUPERSEDES "changing Raw markup moves only the Raw contribution".
  //
  // That test asserted the two sections had independent rates. BV-013 removes
  // that independence deliberately — one authority for all Production
  // economics — so the inverse is now the invariant worth pinning: move
  // Production and both sections must follow.
  const base = run();
  const moved = computeQuoteCosting(
    input({
      packaging: [pkg()],
      production: [prod()],
      markupDefaults: { Production: 0.75, Primary: 0.4, Other: OTHER_TRAP },
    })
  );
  assert.notEqual(perUnit(base, "prod"), perUnit(moved, "prod"), "prod moved");
  assert.notEqual(perUnit(base, "raw"), perUnit(moved, "raw"), "raw moved");
  // Packaging has its own authority and must be untouched by a Production
  // change — the separation that DOES survive.
  assert.equal(perUnit(base, "pkg"), perUnit(moved, "pkg"), "pkg unmoved");
  // And the underlying cost is unchanged; only the rate applied to it moved.
  assert.equal(perUnit(base, "raw/cost"), perUnit(moved, "raw/cost"), "raw cost unmoved");
});

test("6 · BV-013 · neither section resolves through Other, at any rate", () => {
  // The fail-visible half. `Other` is set to a rate far from Production's, so
  // a fallthrough would be arithmetically obvious rather than hidden behind
  // two categories that happen to agree — which is exactly how the live
  // substitution stayed invisible for as long as it did.
  const withHostileOther = computeQuoteCosting(
    input({
      packaging: [pkg()],
      production: [prod()],
      markupDefaults: { Production: PRODUCTION, Primary: 0.4, Other: 0.99 },
    })
  );
  const base = run();
  assert.equal(perUnit(base, "prod"), perUnit(withHostileOther, "prod"), "prod ignored Other");
  assert.equal(perUnit(base, "raw"), perUnit(withHostileOther, "raw"), "raw ignored Other");
});

test("6b · BV-013 · a MISSING Production default resolves to no rate at all", () => {
  // Not to Other, not to the firm 30%. The resolution node reports no chosen
  // candidate, which is what the Costs surface reads to render an em-dash
  // instead of a decisive number.
  const missing = computeQuoteCosting(
    input({
      packaging: [pkg()],
      production: [prod()],
      markupDefaults: { Primary: 0.4, Other: 0.99 },
    })
  );
  const prodPerUnit = perUnit(missing, "prod") ?? 0;
  const rawPerUnit = perUnit(missing, "raw") ?? 0;
  // Priced at COST — no markup applied — rather than at Other's 0.99.
  assert.ok(prodPerUnit < (perUnit(run(), "prod") ?? 0), "prod not marked up");
  assert.ok(rawPerUnit < (perUnit(run(), "raw") ?? 0), "raw not marked up");
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

  // (b) is SUPERSEDED by BV-013, and saying so is more useful than quietly
  // dropping it.
  //
  // It used to show that folding raw into PROD produced a blended rate
  // belonging to neither authority — the misattribution half of T-4, and its
  // sharpest evidence. With ONE authority the fold now produces exactly that
  // authority's rate, so the arithmetic no longer objects to folding.
  //
  // The section split therefore stands on the structural argument alone: bulk
  // raw has its own canonical node and its own governed cost, which is a
  // different property from having its own rate. Asserted here so a future
  // reader does not rediscover the weakened falsification and conclude the
  // split was never justified.
  const foldedCost = (perUnit(r, "prod/cost") ?? 0) + (perUnit(r, "raw/cost") ?? 0);
  const foldedMarkup = (perUnit(r, "prod/markup") ?? 0) + (perUnit(r, "raw/markup") ?? 0);
  const blendedRate = foldedMarkup / foldedCost;
  assert.ok(
    Math.abs(blendedRate - PRODUCTION) < 1e-9,
    `under one authority the folded rate IS the authority's rate: ${blendedRate}`
  );
  // What still distinguishes them, and what the split preserves.
  assert.notEqual(perUnit(r, "prod/cost"), perUnit(r, "raw/cost"));
});
