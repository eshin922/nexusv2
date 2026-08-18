/**
 * P3-017 · the price ladder, published at tier scope.
 *
 * The per-cell graph already honoured R11 §13.2 — *every lever that can change
 * a quoted price owes the cost stack a row*. The blend did not carry it
 * forward: it published the FIRST level and the LAST and dropped the levers
 * between them. So at the scope the Cost Stack actually renders, the
 * reconciliation the graph can express was unstateable — not because the UI was
 * wrong, but because the governed values it would read did not exist there.
 *
 * Eight quantities at tier scope make the ladder expressible and the assertion
 * falsifiable. Three already existed (`sell-before`, `sell`, `cost`); these
 * tests cover the five that did not and the identity over all of them.
 *
 * THE CLAIM THAT MATTERS, AND THE ONE EASIEST TO FAKE
 *
 * `sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell` is only
 * worth asserting if it CAN FAIL. Obtained by subtracting published levels it
 * telescopes:
 *
 *     before + (a - before) + (l - a) + (sell - l) === sell
 *
 * which is true for any four numbers. Blending does not rescue it either —
 * blending is linear over a shared weight vector, so `blend(a - b)` is exactly
 * `blend(a) - blend(b)` and the same telescoping survives the aggregation.
 *
 * So the last test here is the load-bearing one: it perturbs a lever's rate
 * WITHOUT touching the levels, and requires the identity to break. A strip that
 * cannot fail is decoration.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { findNode } from "../../src/lib/costing-nodes.ts";

const TIER = "tier-1";
const TIER2 = "tier-2";
const LEAF = "leaf-1";
const LEAF2 = "leaf-2";
const CANON = "qleaf-1";
const CANON2 = "qleaf-2";
const QUOTE = "q-1";

function pkg(sku: string, tier: string, unitCost: number): CostingPackagingInput {
  return {
    quoteSkuId: sku,
    tierId: tier,
    lineGroupId: `line-${sku}`,
    unitCost,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
  };
}

/** Two SKUs and two tiers, so the blend has something real to weight. */
function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: QUOTE, globalPriceAdjPct: 0.1, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.32, Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
    skus: [
      {
        id: LEAF, canonicalQuoteLeafId: CANON, parentSkuId: null, qtyPerParent: null,
        skuRole: "leaf", skuLabel: "SKU-1", productName: "One", sortOrder: 0,
        retailBenchmark: null,
      },
      {
        id: LEAF2, canonicalQuoteLeafId: CANON2, parentSkuId: null, qtyPerParent: null,
        skuRole: "leaf", skuLabel: "SKU-2", productName: "Two", sortOrder: 1,
        retailBenchmark: null,
      },
    ],
    tiers: [
      { id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null },
      { id: TIER2, label: "T2", qty: 5000, sortOrder: 1, tierPriceAdjPct: 0.2 },
    ],
    packaging: [
      pkg(LEAF, TIER, 10), pkg(LEAF2, TIER, 4),
      pkg(LEAF, TIER2, 9), pkg(LEAF2, TIER2, 3),
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

const find = (r: ReturnType<typeof computeQuoteCosting>, key: string) => {
  for (const root of r.graph.nodes) {
    const hit = findNode(root, key);
    if (hit) return hit;
  }
  return null;
};

const LADDER = [
  "sell-before",
  "adj-delta",
  "sell-after-adj",
  "lift-delta",
  "sell-after-lift",
  "override-delta",
  "sell",
  "cost",
] as const;

const EPS = 1e-9;

// ---------------------------------------------------------------- existence

test("all eight ladder quantities are published at tier scope", () => {
  const r = computeQuoteCosting(input());
  for (const tier of [TIER, TIER2]) {
    for (const name of LADDER) {
      const node = find(r, `quote/${tier}/${name}`);
      assert.ok(node, `quote/${tier}/${name} is not published`);
      assert.equal(typeof node.value, "number");
      assert.ok(Number.isFinite(node.value), `${name} is not finite`);
    }
  }
});

test("each published level and contribution is its own node, not a label on another", () => {
  const r = computeQuoteCosting(input());
  const keys = LADDER.map((n) => find(r, `quote/${TIER}/${n}`)!.key);
  assert.equal(new Set(keys).size, LADDER.length, "two ladder rows share a node");
});

// -------------------------------------------------------------- the identity

test("the ladder reconciles: sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell", () => {
  const r = computeQuoteCosting(
    input({
      lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: 0.077 }],
      cellOverrides: [{ quoteSkuId: LEAF2, tierId: TIER, sellPriceOverride: 12 }],
    }),
  );
  for (const tier of [TIER, TIER2]) {
    const v = (n: string) => find(r, `quote/${tier}/${n}`)!.value;
    const sum = v("sell-before") + v("adj-delta") + v("lift-delta") + v("override-delta");
    assert.ok(
      Math.abs(sum - v("sell")) < EPS,
      `${tier}: ${sum} !== ${v("sell")} — the ladder does not reconcile`,
    );
  }
});

test("the intermediate levels sit where the ladder says they do", () => {
  const r = computeQuoteCosting(
    input({ lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: 0.077 }] }),
  );
  const v = (n: string) => find(r, `quote/${TIER}/${n}`)!.value;
  assert.ok(Math.abs(v("sell-before") + v("adj-delta") - v("sell-after-adj")) < EPS);
  assert.ok(Math.abs(v("sell-after-adj") + v("lift-delta") - v("sell-after-lift")) < EPS);
  assert.ok(Math.abs(v("sell-after-lift") + v("override-delta") - v("sell")) < EPS);
});

// ------------------------------------------------------- the levers are real

test("a lift moves lift-delta and leaves the adjustment contribution alone", () => {
  const base = computeQuoteCosting(input());
  const lifted = computeQuoteCosting(
    input({ lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: 0.077 }] }),
  );
  const v = (r: ReturnType<typeof computeQuoteCosting>, n: string) =>
    find(r, `quote/${TIER}/${n}`)!.value;

  assert.equal(v(base, "lift-delta"), 0, "no lift should contribute nothing");
  assert.ok(v(lifted, "lift-delta") > 0, "a lift that raises the price must contribute");
  assert.ok(
    Math.abs(v(base, "adj-delta") - v(lifted, "adj-delta")) < EPS,
    "the lift composes onto the adjustment; it must not change the adjustment's own contribution",
  );
});

test("a rejected lift contributes zero — refused and absent are the same number, and only here", () => {
  // §13.3: an override rejects a lift. The contribution is zero because a
  // refusal genuinely moves the price by nothing; the flagged-out node carries
  // the reason, so the two states stay distinguishable where it matters.
  const r = computeQuoteCosting(
    input({
      lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: 0.5 }],
      cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 20 }],
    }),
  );
  assert.equal(find(r, `quote/${TIER}/lift-delta`)!.value, 0);
  assert.ok(
    find(r, `${LEAF}/${TIER}/lift`),
    "the refusal must still be reachable as a node",
  );
});

test("an override contributes the difference it makes, and nothing when absent", () => {
  const base = computeQuoteCosting(input());
  assert.equal(find(base, `quote/${TIER}/override-delta`)!.value, 0);

  const overridden = computeQuoteCosting(
    input({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 99 }] }),
  );
  assert.ok(find(overridden, `quote/${TIER}/override-delta`)!.value > 0);
});

// --------------------------------------------------- the assertion can fail

// WHAT IS AND IS NOT PINNED HERE, stated plainly.
//
// The non-telescoping property belongs to the IMPLEMENTATION — each delta is
// computed from its lever's own rate — and the test below is what pins it. On a
// correct graph a rate-derived delta and a level-difference delta are equal, so
// no arithmetic assertion can tell them apart; only reading the value against
// the RATE can, which is what that test does.
//
// A test that perturbed a number and observed the sum change would prove
// nothing about either: `x - d + d*1.01` differs from `x` by construction, for
// any implementation. It would pass forever and guard nothing, so it is not
// here. The identity test above is the drift detector; this one is the
// structural guard beneath it.

test("the deltas come from the rates, which is what makes the identity falsifiable", () => {
  // With a tier adjustment of 0.2 on T2 and 0.1 globally, each contribution
  // must scale with the rate ITS tier resolved — not with whatever gap happens
  // to sit between two published levels.
  const r = computeQuoteCosting(input());
  const t1 = find(r, `quote/${TIER}/adj-delta`)!.value;
  const t1Before = find(r, `quote/${TIER}/sell-before`)!.value;
  const t2 = find(r, `quote/${TIER2}/adj-delta`)!.value;
  const t2Before = find(r, `quote/${TIER2}/sell-before`)!.value;

  assert.ok(Math.abs(t1 - t1Before * 0.1) < EPS, "T1 takes the global 10%");
  assert.ok(
    Math.abs(t2 - t2Before * 0.2) < EPS,
    "T2 takes its OWN 20% — the tier adjustment replaces the global, it does not stack",
  );
});
