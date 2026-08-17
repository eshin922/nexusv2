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
import { readFileSync } from "node:fs";

/** Source minus comments — an assertion about rendered copy must not read the
 *  rationale that explains the copy. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
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
/** One component of the build — its operands are the contributing products. */
const component = (input: QuoteCostingInput, unitId: string, name: string) =>
  findNode(computeQuoteCosting(input).graph, priceBuildKey(unitId, TIER, name));
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

test("P-PriceBuild-UX2 · every operand identifies its contributing product", () => {
  // The defect: operands carried `skuLabel`, which is the SKU CODE, and leaves
  // with no SKU rendered blank. Two anonymous numbers reconciling perfectly is
  // worse than a wrong total — nothing about it looks wrong.
  const noSku = (id: string, parent: string | null) => ({
    ...leaf(id, parent),
    skuLabel: "",
    productName: `Product ${id}`,
  });
  const input = quote({ skus: [noSku("a3", "A")], packaging: [pkg("a3", 4)] });
  const node = component(input, "A", "pkg");
  const labels = (node.operands ?? []).map((o: any) => o.label);
  assert.ok(labels.length >= 3);
  for (const l of labels) assert.notEqual(l.trim(), "", `blank operand label in ${labels}`);
  // Name when there is no code; name AND code when both exist.
  assert.ok(labels.includes("Product a3"), `expected the name to stand alone: ${labels}`);
  assert.ok(labels.some((l: string) => l.includes(" · ")), `expected "name · sku": ${labels}`);
});

test("P-PriceBuild-UX2 · identity is keyed canonically, not positionally", () => {
  // "Do not derive identity from array position, row order, or value matching."
  // Each operand's key ends in the contributor's canonical quote-leaf id, so
  // reordering the inputs cannot reassign a name to a different contribution.
  const node = component(quote(), "A", "pkg");
  const pairs = (node.operands ?? []).map((o: any) => [o.key.split("/").pop(), o.value]);
  assert.deepEqual(pairs, [["ql-a1", 12.5], ["ql-a2", 7.5]]);
  const swapped = component(
    { ...quote(), skus: [assembly("A"), leaf("a2", "A"), leaf("a1", "A")] },
    "A",
    "pkg",
  );
  const byId = Object.fromEntries(
    (swapped.operands ?? []).map((o: any) => [o.key.split("/").pop(), o.value]),
  );
  assert.equal(byId["ql-a1"], 12.5, "a1 keeps its own contribution after reordering");
  assert.equal(byId["ql-a2"], 7.5);
});

test("P-PriceBuild-UX2 · an unidentifiable product says so rather than rendering blank", () => {
  const anon = { ...leaf("x1", "A"), skuLabel: "", productName: "" };
  const input = quote({ skus: [anon], packaging: [pkg("x1", 4)] });
  const labels = (component(input, "A", "pkg").operands ?? []).map((o: any) => o.label);
  assert.ok(
    labels.some((l: string) => l.startsWith("Unresolved product")),
    `expected an explicit unresolved state: ${labels}`,
  );
  for (const l of labels) assert.notEqual(l.trim(), "");
});

test("P-PriceBuild-2 · the stack reads the staged graph, and no longer says `??`", () => {
  // Characterized before repaired: the staging context ALREADY computes a full
  // governed `computeQuoteCosting(preview)` including its graph, and the shell
  // read the committed store graph instead. So a staged adjustment moved the
  // margin banner while Price Build showed pre-adjustment figures, with nothing
  // saying which of the two was on screen. No new projection was invented.
  const shell = readFileSync(
    "src/components/pricing-surface/pricing-surface-shell.tsx",
    "utf8",
  );
  assert.match(shell, /const priceBuildGraph = previewResult\?\.graph \?\? graph;/);
  // The evaluation argument was added by PB-STAGED-1; without it the read
  // refused the preview graph and the table blanked. Matched loosely on the
  // graph rather than the exact argument list, so the two tests do not both
  // have to be edited whenever this call changes shape.
  assert.match(
    shell,
    /readNodeValue\(priceBuildGraph, k\(name\)/,
    "the price build must read the staged graph, not the committed one",
  );
  // `previewResult` is null exactly when nothing is staged, so committed
  // behaviour is unchanged — asserted so a later edit cannot make preview the
  // permanent source.
  assert.match(shell, /const previewing = previewResult !== null;/);

  // COMMENTS STRIPPED, and this is the fourth time the same shape has bitten in
  // this workstream. The assertion is about what an OPERATOR sees; a rationale
  // that names the precedence rule in source notation is not that, and every
  // author who explains why the string was removed trips the check that removed
  // it. Reworded the prose three times before fixing the instrument.
  const zone = stripComments(
    readFileSync("src/components/pricing-surface/detail-zone.tsx", "utf8"),
  );
  // The scope is RESOLVED, and the operator never sees an operator.
  assert.doesNotMatch(zone, /tier \?\? global/);
  assert.match(zone, /adjScopeLabel/);
  assert.match(zone, /replaces, not compounds/);
  // And a previewed stack states that it is previewing.
  assert.match(zone, /previewing staged changes/);
});

test("PB-STAGED-1 · the Price Build stays readable while previewing staged changes", () => {
  // Switching to `previewResult.graph` without declaring the expectation made
  // every read return null — `readNodeValue` refuses a graph whose evaluation
  // is not the one asked for, and it defaults to "committed". The whole table
  // rendered as em-dashes with "0 tiers could not be read", exactly when the
  // operator had staged something and most needed it.
  const shell = readFileSync(
    "src/components/pricing-surface/pricing-surface-shell.tsx",
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(
    shell,
    /readNodeValue\(priceBuildGraph, k\(name\), priceBuildEvaluation\)/,
    "the read must state which evaluation it expects",
  );
  // Derived from the same condition that CHOSE the graph. Reading
  // `graph.evaluation` instead would always match and the guard would stop
  // asserting anything — the fix must not be a way of switching it off.
  assert.match(
    shell,
    /const priceBuildEvaluation: GraphEvaluation = previewing \? "preview" : "committed";/,
  );
  assert.doesNotMatch(shell, /priceBuildGraph\.evaluation/, "must not read the expectation off the graph");
});

test("PB-STAGED-1 · the graph guard itself is untouched", () => {
  // "Do not weaken the graph guard." It still defaults to committed and still
  // refuses a mismatch; only the call site changed.
  const nodes = readFileSync("src/lib/costing-nodes.ts", "utf8");
  assert.match(nodes, /expect: GraphEvaluation = "committed",/);
  assert.match(nodes, /if \(graph\.evaluation !== expect\) return null;/);
});
