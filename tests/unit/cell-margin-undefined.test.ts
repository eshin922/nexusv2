/**
 * Per-CELL blended margin is UNDEFINED at zero revenue.
 *
 * The third and last scope. Quote-wide, per-tier, per-cell — the same
 * `revenue > 0 ? … : 0` in three places, found one at a time because each was
 * individually invisible: every consumer downstream of it was correct.
 *
 * WHAT MAKES THIS ONE DIFFERENT
 *
 * The other two were discovered by reading the engine. This one was hidden by
 * a WORKAROUND. The classifier adapter carried a local heuristic —
 * `requiredSellPerUnit === 0 && contributionCostPerUnit === 0` — with a comment
 * spelling out the disambiguation it was making. The reasoning was right, and
 * it agreed with the engine on all 143 zero-revenue cells in production.
 *
 * That is exactly why it is worth deleting. A correct second authority is
 * still a second authority; it just fails later, and for reasons nobody
 * connects to it. And it could not express the case the engine now can: keyed
 * on both values being zero, it has no way to say "cost, no revenue."
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";

const PRICED = "tier-priced";
const EMPTY = "tier-empty";
const LEAF = "leaf-1";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
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
      { id: PRICED, label: "Priced", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: EMPTY, label: "Empty", qty: 1000, sortOrder: 1, tierPriceAdjPct: null },
    ],
    packaging: [
      {
        quoteSkuId: LEAF,
        tierId: PRICED,
        lineGroupId: "line-1",
        unitCost: 10,
        qtyPerSellableUnit: 1,
        category: "Primary",
        markupPct: null,
      } satisfies CostingPackagingInput,
    ],
    production: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    cellOverrides: [],
    cellTargets: [],
    ...over,
  };
}

const R = computeQuoteCosting(input());
const cell = (tierId: string) =>
  R.skuRollups[0].perTier.find((p) => p.tierId === tierId)!;

// ------------------------------------------------------------------ scalar

test("a cell with no sell price has a null margin, not zero percent", () => {
  const c = cell(EMPTY);
  assert.equal(c.requiredSellPerUnit, 0);
  assert.equal(c.marginPct, null);
  assert.equal(c.marginStatus, "UNAVAILABLE");
});

test("the priced cell in the same SKU is unaffected", () => {
  const c = cell(PRICED);
  assert.ok(c.requiredSellPerUnit > 0);
  assert.equal(typeof c.marginPct, "number");
  assert.notEqual(c.marginStatus, "UNAVAILABLE");
  assert.equal(
    c.marginPct,
    (c.requiredSellPerUnit - c.contributionCostPerUnit) / c.requiredSellPerUnit,
  );
});

test("cost without revenue is distinguished from nothing entered", () => {
  // Reachable at cell level the same way it is at tier level: an override of
  // zero on a costed line. Not present in production today — all 143
  // zero-revenue cells carry zero cost — and defined regardless, because the
  // case nobody has hit is the case nobody is watching for.
  const r = computeQuoteCosting(
    input({
      packaging: [
        { quoteSkuId: LEAF, tierId: PRICED, lineGroupId: "l1", unitCost: 10,
          qtyPerSellableUnit: 1, category: "Primary", markupPct: null },
        { quoteSkuId: LEAF, tierId: EMPTY, lineGroupId: "l2", unitCost: 10,
          qtyPerSellableUnit: 1, category: "Primary", markupPct: null },
      ],
      cellOverrides: [{ quoteSkuId: LEAF, tierId: EMPTY, sellPriceOverride: 0 }],
    }),
  );
  const c = r.skuRollups[0].perTier.find((p) => p.tierId === EMPTY)!;
  assert.equal(c.requiredSellPerUnit, 0);
  assert.ok(c.contributionCostPerUnit > 0);
  assert.equal(c.marginPct, null);
  assert.equal(c.marginStatus, "COST_WITHOUT_REVENUE");
});

test("the negative-sell sentinel is preserved and is not the same thing", () => {
  // -1 guards a bypass write landing a negative override, where
  // `(neg − pos) / neg` reports POSITIVE margin from two negatives. That is a
  // computed margin that is wrong. Null is the absence of one. Collapsing them
  // would lose a real corruption signal inside a benign empty state.
  const r = computeQuoteCosting(
    input({ cellOverrides: [{ quoteSkuId: LEAF, tierId: PRICED, sellPriceOverride: -5 }] }),
  );
  assert.equal(r.skuRollups[0].perTier.find((p) => p.tierId === PRICED)!.marginPct, -1);
});

// ------------------------------------------------------------- structural

test("computeStatus is not called for an undefined cell margin", () => {
  const src = readFileSync(new URL("../../src/lib/costing.ts", import.meta.url), "utf8");
  // Both cell sites — the leaf and the assembly rollup — route through the
  // shared helper rather than each deciding what zero revenue means.
  const routed = src.match(
    /marginPct === null\s*\n?\s*\?\s*zeroRevenueStatus\(/g,
  );
  assert.ok(
    routed !== null && routed.length >= 2,
    `expected leaf and assembly cells to route through zeroRevenueStatus, found ${routed?.length ?? 0}`,
  );
  assert.ok(
    !/: 0;\s*\n\s*const revenue = requiredSellPerUnit \* tierQty;/.test(src),
    "the `: 0` fallback is back on the leaf cell",
  );
});

test("an empty assembly no longer asserts a floor breach", () => {
  // This was hardcoded `marginStatus: "BELOW_FLOOR"` with a comment conceding
  // it — "visible for ~16ms before children fold in". Brief is not harmless;
  // it was 16ms of the page stating something untrue, and the true statement
  // costs nothing.
  const src = readFileSync(new URL("../../src/lib/costing.ts", import.meta.url), "utf8");
  assert.ok(
    !/marginPct: 0,[\s\S]{0,400}marginStatus: "BELOW_FLOOR",/.test(src),
    "the empty-assembly stub is asserting a band again",
  );
});

test("the classifier adapter reads the engine verdict instead of re-deriving it", () => {
  const src = readFileSync(
    new URL("../../src/components/pricing-surface/pricing-classifier-context.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/requiredSellPerUnit === 0 && pt\.contributionCostPerUnit === 0/.test(src),
    "the local isMissing heuristic is back — a second authority on what " +
      "'no data' means, in the file whose purpose is that there is one",
  );
  assert.ok(
    /const isMissing = pt\.marginPct === null;/.test(src),
    "missingness must come from the engine's verdict",
  );
});
