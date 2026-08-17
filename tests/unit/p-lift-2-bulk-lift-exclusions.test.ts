/**
 * P-Lift-2 · "Lift all to floor" must not offer to move a terminal direct price.
 *
 * OBSERVED. A tier sits below floor, one of its cells has a directly-set price,
 * the bulk CTA is offered, and invoking it visibly corrects nothing.
 *
 * THE SEMANTICS ARE ALREADY DECIDED, AND THEY ARE NOT CHANGING HERE. A direct
 * price is terminal: the engine refuses a lift over one (`LiftRejection`
 * "overridden") and the classifier already marks the cell `lift_blocked`. That
 * precedence is correct and is not weakened to make a button succeed.
 *
 * THE DEFECT IS THE OFFER, NOT THE ARITHMETIC. `lift_offer_pct` is computed for
 * ANY below-floor cell — deliberately, so the grid can show what WOULD clear it.
 * The bulk CTA filtered on that field alone, so a blocked cell was counted in
 * "Lift all N to floor" and staged, and the engine then refused it. The count
 * promised a correction that precedence had already ruled out.
 *
 * These tests characterize the tier first, then hold the repair: eligible cells
 * still move, blocked cells never do, and the CTA stops claiming otherwise.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * One tier, two priced leaves, both below floor. `blocked` carries a direct
 * price; `eligible` does not. This is the shape the operator hit.
 */
function quote(opts: { lifts?: boolean; override?: boolean }): QuoteCostingInput {
  const leaf = (id: string, cost: number) => ({
    id, canonicalQuoteLeafId: `ql-${id}`, parentSkuId: null, qtyPerParent: null,
    skuRole: "leaf" as const, skuLabel: id, productName: id, sortOrder: 0,
    retailBenchmark: null,
  });
  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [leaf("eligible", 10), leaf("blocked", 10)],
    tiers: [{ id: "tier", label: "1000", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      { quoteSkuId: "eligible", tierId: "tier", lineGroupId: "g1", unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0.05 },
      { quoteSkuId: "blocked", tierId: "tier", lineGroupId: "g2", unitCost: 10, qtyPerSellableUnit: 1, category: "Primary", markupPct: 0.05 },
    ],
    production: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    // A direct price on `blocked` only, deliberately below floor so the cell
    // stays outstanding and keeps attracting an offer.
    cellOverrides: opts.override ? [{ quoteSkuId: "blocked", tierId: "tier", sellPriceOverride: 10.5 }] : [],
    cellTargets: [],
    lifts: opts.lifts
      ? [
          { quoteLeafId: "ql-eligible", tierId: "tier", liftPct: 0.5 },
          { quoteLeafId: "ql-blocked", tierId: "tier", liftPct: 0.5 },
        ]
      : [],
  };
}

const cell = (input: QuoteCostingInput, id: string) =>
  computeQuoteCosting(input).skuRollups.find((s) => s.skuId === id)!.perTier[0];

test("characterize · both cells are below floor, and only one is direct-priced", () => {
  // The precondition. Without it the rest of the file could pass on a fixture
  // where nothing was ever breaching and no lift was ever warranted.
  const base = quote({ override: true });
  const e = cell(base, "eligible");
  const b = cell(base, "blocked");
  assert.ok(e.marginPct !== null && e.marginPct < 0.25, `eligible margin ${e.marginPct}`);
  assert.ok(b.marginPct !== null && b.marginPct < 0.25, `blocked margin ${b.marginPct}`);
  assert.equal(b.sellSource, "cell_override", "the blocked cell's price is the direct one");
  assert.notEqual(e.sellSource, "cell_override");
});

test("a lift staged over a direct price changes nothing about that cell", () => {
  // Stated as an invariance rather than an expected number. The first draft
  // asserted `computedSellPerUnit === 10.5` and read 0 — that field is the
  // computed ladder value, which an overridden cell does not use, so the
  // assertion was about the wrong quantity and would have been satisfied or
  // broken for reasons unrelated to precedence. Comparing the cell to ITSELF
  // with and without the lift cannot pick the wrong field: whatever the engine
  // reports, it must report the same thing both times.
  const without = cell(quote({ override: true }), "blocked");
  const with_ = cell(quote({ override: true, lifts: true }), "blocked");
  assert.equal(with_.sellSource, "cell_override", "precedence holds — the direct price wins");
  assert.deepEqual(
    { source: with_.sellSource, margin: with_.marginPct, sell: with_.computedSellPerUnit },
    { source: without.sellSource, margin: without.marginPct, sell: without.computedSellPerUnit },
    "a lift over a terminal direct price must be inert",
  );
});

test("a blocked cell in the batch does NOT stop the eligible cell moving", () => {
  // The finding said to trace this separately if eligible cells also failed.
  // They do not — measured, not assumed: the eligible cell moves 10.50 -> 15.75
  // and clears the floor while its blocked sibling is refused in the same
  // batch. The refusal is per-cell. Had this failed it would have been a
  // second, functional defect and the repair below would have been premature.
  const before = cell(quote({ override: true }), "eligible");
  const after = cell(quote({ override: true, lifts: true }), "eligible");
  assert.ok(
    after.computedSellPerUnit! > before.computedSellPerUnit!,
    `eligible cell must move: ${before.computedSellPerUnit} -> ${after.computedSellPerUnit}`,
  );
  assert.ok(after.marginPct! >= 0.25, `and must clear the floor: ${after.marginPct}`);
});

test("the classifier already separates the two — the offer must consume that", () => {
  // `lift_blocked` exists and is correct. The bulk CTA simply did not read it,
  // which is why the count promised a correction precedence had ruled out.
  const src = stripComments(readFileSync("src/lib/pricing-classifier.ts", "utf8"));
  assert.match(src, /lift_blocked: liftOffer !== null && overrideApplied/);
});

test("the bulk CTA counts and stages only lift-ELIGIBLE cells", () => {
  const grid = stripComments(
    readFileSync("src/components/pricing-surface/compliance-grid.tsx", "utf8"),
  );
  // The `need` set is what the button both counts and mutates, so excluding
  // blocked cells there fixes the promise and the action in one place.
  const start = grid.indexOf("const outstanding = state.cells.filter");
  assert.ok(start > 0, "the per-tier outstanding set must be named");
  const need = grid.slice(start, grid.indexOf("return (", start));
  assert.match(need, /const need = outstanding\.filter\([\s\S]{0,120}?!c\.lift_blocked/,
    "blocked cells must be excluded from the set the button counts AND mutates");
  assert.match(need, /const blocked = outstanding\.filter\(\(c\) => c\.lift_blocked\)/);
  // And the section's own visibility uses the same predicate, so a tier whose
  // only breaches are direct-priced does not render an actionable CTA at all.
  assert.match(
    grid,
    /state\.cells\.some\(\(c\) =>[\s\S]{0,120}?!c\.lift_blocked/,
    "the section gate must use the same eligibility test as the button",
  );
});

test("when exclusions remain, the tier says so instead of showing a dash", () => {
  // "1 manual price remains below floor · adjust directly" — the required
  // truthful state. A bare em-dash reads as 'nothing to do here', which is the
  // opposite of what is true: something IS wrong and the bulk action cannot
  // reach it.
  const grid = readFileSync("src/components/pricing-surface/compliance-grid.tsx", "utf8");
  assert.match(grid, /manual price/, "the excluded-cell state must be stated");
  assert.match(grid, /adjust directly/, "and must name the action that can fix it");
  // Navigation to the affected cell, not just a sentence about it.
  const block = grid.slice(grid.indexOf("manual price") - 2000, grid.indexOf("manual price") + 1200);
  assert.match(block, /onSelectCell|selectCell|onClick/, "the state must be navigable to the cell");
});
