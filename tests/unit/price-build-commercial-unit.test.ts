/**
 * Price Build · dollars are scoped to one commercial unit of account.
 *
 * THE DEFECT. Pricing presented an Item Group's economics divided by the leaf
 * count of the WHOLE quote. On the live walk quote an Item Group selling at
 * $7.51 rendered as $1.0729 — 7.51 / 7 — where the 7 spanned a second Item
 * Group and an unrelated Direct Component. Removing a zero-value leaf moved the
 * figure while the turnkey economics did not, because the denominator was never
 * the finished good's own composition.
 *
 * WHAT IS AND IS NOT BEING CHANGED. The blend nodes remain, and remain a valid
 * analytical primitive; margin keeps its revenue-weighted authority and is
 * numerically untouched. What changes is that DOLLAR presentation reads a node
 * scoped to one sellable unit.
 *
 * The tests below are mostly INVARIANCE tests, because the defect was not a
 * wrong formula — it was a right formula over the wrong population, and the
 * only thing that distinguishes those is what fails to move it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting, type QuoteCostingInput } from "../../src/lib/costing.ts";
import { priceBuildKey } from "../../src/lib/costing-nodes.ts";

const TIER = "tier";

function findNode(graph: { nodes: readonly unknown[] } | readonly unknown[], key: string): any {
  const walk = (n: any): any =>
    n.key === key ? n : (n.operands ?? []).reduce((f: any, o: any) => f ?? walk(o), null);
  const roots: any[] = Array.isArray(graph) ? graph : ((graph as any).nodes ?? []);
  return roots.reduce((f: any, n: any) => f ?? walk(n), null);
}

const leaf = (id: string, parent: string | null) => ({
  id,
  canonicalQuoteLeafId: `ql-${id}`,
  parentSkuId: parent,
  qtyPerParent: null,
  skuRole: "leaf" as const,
  skuLabel: id,
  productName: id,
  sortOrder: 0,
  retailBenchmark: null,
});
const assembly = (id: string) => ({ ...leaf(id, null), skuRole: "assembly" as const });
const pkg = (skuId: string, unitCost: number) => ({
  quoteSkuId: skuId,
  tierId: TIER,
  lineGroupId: `lg-${skuId}`,
  unitCost,
  qtyPerSellableUnit: 1,
  category: "Primary",
  markupPct: 0.25,
});

/** One Item Group of two priced leaves. Extra skus/packaging compose on top. */
function quote(extra: {
  skus?: QuoteCostingInput["skus"];
  packaging?: ReturnType<typeof pkg>[];
} = {}): QuoteCostingInput {
  return {
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: {},
    skus: [assembly("A"), leaf("a1", "A"), leaf("a2", "A"), ...(extra.skus ?? [])],
    tiers: [{ id: TIER, label: "1000", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [pkg("a1", 10), pkg("a2", 6), ...(extra.packaging ?? [])],
    production: [],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  };
}

/** The BUILD — components summed. Pre-adjustment by construction. */
const build = (input: QuoteCostingInput, unitId: string) =>
  findNode(computeQuoteCosting(input).graph, priceBuildKey(unitId, TIER, "sell-before"));
/** The governed TERMINAL sell, after adjustment, lift and override. */
const terminal = (input: QuoteCostingInput, unitId: string) =>
  findNode(computeQuoteCosting(input).graph, priceBuildKey(unitId, TIER, "sell"));

const parts = (node: any): Record<string, number> =>
  Object.fromEntries((node.operands ?? []).map((o: any) => [o.key.split("/").pop(), o.value]));

test("F1 · an Item Group's components ADD to its pre-adjustment build", () => {
  const node = build(quote(), "A");
  // 16 of cost at 25% = 20. Composition, not a coincidence of one number:
  // every component is named and they sum to the whole.
  assert.equal(parts(node).pkg, 20);
  assert.equal(node.value, 20);
  assert.equal(node.kind, "sum");
  assert.deepEqual(
    (node.operands ?? []).map((o: any) => o.key.split("/").pop()),
    ["pkg", "prod", "raw", "frt", "dt"],
  );
});

test("F2 · it reconciles to the unit's own rollup, which is what Costs and the PDF read", () => {
  const r = computeQuoteCosting(quote());
  const roll = r.skuRollups.find((s) => s.skuId === "A")!.perTier[0];
  const node = findNode(r.graph, priceBuildKey("A", TIER, "sell"));
  assert.ok(Math.abs(node.value - roll.requiredSellPerUnit) < 1e-9);
  // And on a single-unit quote that is also the tier's per-unit revenue — the
  // figure the customer PDF divides out.
  const tier = r.quoteRollup[0];
  assert.ok(Math.abs(node.value - tier.totalRevenue / tier.qty) < 1e-9);
});

test("F3 · adding or removing a ZERO-VALUE component does not move the dollars", () => {
  // The operator's exact falsification: a zero-value leaf changed an 8-leaf
  // denominator to a 7-leaf one and the displayed dollars moved. Under a
  // per-unit sum a zero contributes zero, which is the only correct answer.
  const before = build(quote(), "A");
  const withZero = build(quote({ skus: [leaf("a3", "A")], packaging: [pkg("a3", 0)] }), "A");
  assert.equal(withZero.value, before.value);
  assert.equal(parts(withZero).pkg, parts(before).pkg);
  // A zero-value leaf that is not even costed — no packaging row at all.
  const withAbsent = build(quote({ skus: [leaf("a4", "A")] }), "A");
  assert.equal(withAbsent.value, before.value);
});

test("F4 · adding another PRICED Item Group does not move the first one's build", () => {
  // This is what the blend could not do. A second group changes the quote's
  // leaf population, so it changed every blended dollar; it must not touch a
  // figure that belongs to a different product.
  const before = build(quote(), "A");
  const twoGroups = quote({
    skus: [assembly("B"), leaf("b1", "B"), leaf("b2", "B")],
    packaging: [pkg("b1", 100), pkg("b2", 300)],
  });
  const after = build(twoGroups, "A");
  assert.equal(after.value, before.value);
  assert.deepEqual(parts(after), parts(before));
});

test("F5 · the second unit carries its OWN economics, and nothing sums the two", () => {
  const input = quote({
    skus: [assembly("B"), leaf("b1", "B"), leaf("b2", "B")],
    packaging: [pkg("b1", 100), pkg("b2", 300)],
  });
  const a = build(input, "A");
  const b = build(input, "B");
  assert.equal(a.value, 20);
  assert.equal(b.value, 500); // 400 of cost at 25%
  assert.notEqual(a.value, b.value);
  // No price-build node anywhere equals the sum of the two, which is what an
  // "all products per unit" figure would be. That number must not exist in
  // this scope: the two are unrelated sellable products.
  const graph = computeQuoteCosting(input).graph;
  assert.equal(findNode(graph, priceBuildKey("A", TIER, "sell")).value + 0, 20);
  const combined = a.value + b.value;
  for (const id of ["A", "B"]) {
    assert.notEqual(findNode(graph, priceBuildKey(id, TIER, "sell")).value, combined);
  }
});

test("F5b · a Direct Component standing alone is its own unit of account", () => {
  const input = quote({ skus: [leaf("d1", null)], packaging: [pkg("d1", 40)] });
  const direct = build(input, "d1");
  assert.equal(direct.value, 50);
  assert.equal(terminal(input, "d1").value, 50); // no levers on this fixture
  // Its label names a product, not a finished good — the two are different
  // commercial objects and the copy must not conflate them.
  assert.match(terminal(input, "d1").label, /^Product sell per unit/);
  assert.match(terminal(input, "A").label, /^Finished-good sell per unit/);
  // And a leaf INSIDE a group is not a unit of account, or the same dollars
  // would be addressable twice.
  assert.equal(findNode(computeQuoteCosting(input).graph, priceBuildKey("a1", TIER, "sell")), null);
});

test("F6 · margin is numerically unchanged, and still the revenue-weighted one", () => {
  // The presentation repair must not move a margin. It cannot: weight is
  // tierQty x qtyPerParent, so in (Sigma(s.w) - Sigma(c.w)) / Sigma(s.w) both
  // tierQty and Sigma(w) cancel. Asserted rather than argued.
  const one = computeQuoteCosting(quote());
  const two = computeQuoteCosting(quote({ skus: [leaf("a3", "A")], packaging: [pkg("a3", 0)] }));
  assert.equal(one.quoteRollup[0].blendedMarginPct, 0.2);
  assert.equal(two.quoteRollup[0].blendedMarginPct, one.quoteRollup[0].blendedMarginPct);
  // The margin node still resolves and still equals the engine's scalar.
  const marginNode = findNode(one.graph, `quote/${TIER}/margin`);
  assert.ok(marginNode, "the quote-scope margin node must survive");
  assert.ok(Math.abs(marginNode.value - one.quoteRollup[0].blendedMarginPct) < 1e-12);
});

test("the blend nodes are NOT removed — they remain a margin-analysis primitive", () => {
  // Superseding a presentation is not the same as deleting a graph operation.
  // The margin node is built from these, and the reconciler's `blend` handling
  // exists to check them.
  const g = computeQuoteCosting(quote()).graph;
  const sellBlend = findNode(g, `quote/${TIER}/sell`);
  assert.ok(sellBlend);
  assert.equal(sellBlend.kind, "blend");
});

test("P-PriceBuild-1 · the terminal sell is NOT the build when a lever is applied", () => {
  // THE TEST THAT WAS MISSING. Every fixture above carries no adjustment, no
  // lift and no override, so the build and the terminal coincide and a binding
  // to the wrong one passes all of them. Live Tier 2 showed the cost of that:
  // a $4.3262 baseline presented as the customer sell while the ladder beneath
  // it ran to $4.8337.
  const adjusted: QuoteCostingInput = {
    ...quote(),
    quote: { id: "q", globalPriceAdjPct: 0.1, targetMarginPct: null },
  };
  const b = build(adjusted, "A");
  const t = terminal(adjusted, "A");
  assert.equal(b.value, 20, "the build is unmoved by a pricing lever");
  assert.ok(t.value > b.value, `terminal ${t.value} must exceed build ${b.value}`);
  assert.equal(t.value, 22);
  // And it is the engine's own figure, not a sum of rendered deltas.
  const roll = computeQuoteCosting(adjusted).skuRollups.find((s) => s.skuId === "A")!.perTier[0];
  assert.equal(t.value, roll.requiredSellPerUnit);
});

test("P-PriceBuild-1 · the ladder reconciles to the terminal, which is why the footer goes green", () => {
  // `sellBefore + adjDelta + liftDelta + overrideDelta === sell` is the rule
  // the strip enforces. It reported three failing columns because `sell` was
  // bound to the baseline, so the identity could only hold where every lever
  // was zero. Asserted here so the footer turns green from the binding rather
  // than from a loosened epsilon.
  const adjusted: QuoteCostingInput = {
    ...quote(),
    quote: { id: "q", globalPriceAdjPct: 0.1, targetMarginPct: null },
  };
  const g = computeQuoteCosting(adjusted).graph;
  const v = (n: string) => findNode(g, priceBuildKey("A", TIER, n)).value;
  const sum = v("sell-before") + v("adj-delta") + v("lift-delta") + v("override-delta");
  assert.ok(Math.abs(sum - v("sell")) < 1e-9, `ladder ${sum} vs terminal ${v("sell")}`);
});
