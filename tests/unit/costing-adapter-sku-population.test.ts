/**
 * OD-014 / C-2 — the governed SKU population.
 *
 * OD-014 settles that the commercial SKU for Pricing aggregation is the
 * quote-scoped leaf attachment, `quote_leaves.id`. C-2 is the finding that the
 * adapter discovered its population from `assembly_leaves` instead, so an
 * attachment's existence as a SKU depended on an assembly being present.
 *
 * These tests assert the POPULATION and its IDENTITY, not the resulting
 * numbers. That distinction is the whole lesson of the reverted increment 7:
 * its fixture asserted a value, on a structure where the right and the wrong
 * population happened to be the same set of entities, so it passed while the
 * semantics were wrong. A test that can only see the number cannot see that.
 *
 * The fixture below is therefore built to make the populations DIFFERENT by
 * construction, which production data cannot currently do — every one of the
 * 137 live attachments carries quantity 1, so weighted and unweighted means
 * are numerically identical on every real quote.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { computeQuoteCosting } from "../../src/lib/costing.ts";
import {
  findGraphViolations,
  findNode,
  quoteScopeKey,
  resolveNode,
  type CostingNode,
} from "../../src/lib/costing-nodes.ts";
import {
  buildQuoteCostingInputFromNewModel,
  type BuildQuoteCostingInputFromNewModelArgs,
  type AdapterQuoteLeafAttachmentRow,
} from "../../src/lib/costing-adapter.ts";

const QUOTE = "q-1";
const TIER_A = "tier-a";
const ASSEMBLY = "asy-1";

/**
 * Deliberately unlike production, and the reasons are the requirements:
 *
 *  - NESTED: three leaves under one assembly, so "one assembly" and "three
 *    SKUs" are different counts and a contributor population is observable.
 *  - UNEQUAL QUANTITIES (2, 3, 5): so a weighted mean and an unweighted mean
 *    cannot agree. Production is uniformly quantity 1 and cannot distinguish
 *    them, which is precisely why copying real shape is not sufficient here.
 *  - REPEATED LIBRARY LEAF: `lib-repeat` attaches twice. Its two attachments
 *    must stay distinct commercial lines, which is the property that rules
 *    `leaf_id` out as identity.
 *  - DIRECT ATTACHMENT: one leaf with no assembly at all, which is the shape
 *    ASY-optional quote authoring produces and which the old population source
 *    could not represent.
 */
function attachments(): AdapterQuoteLeafAttachmentRow[] {
  return [
    {
      quoteLeafId: "ql-grouped-1",
      assemblyLeafId: "al-1",
      assemblyId: ASSEMBLY,
      leafId: "lib-repeat",
      quantity: "2",
      position: 0,
      leafName: "Repeated component",
      leafSku: "LIB-R",
    },
    {
      quoteLeafId: "ql-grouped-2",
      assemblyLeafId: "al-2",
      assemblyId: ASSEMBLY,
      leafId: "lib-repeat", // same library leaf, second attachment
      quantity: "3",
      position: 1,
      leafName: "Repeated component",
      leafSku: "LIB-R",
    },
    {
      quoteLeafId: "ql-grouped-3",
      assemblyLeafId: "al-3",
      assemblyId: ASSEMBLY,
      leafId: "lib-other",
      quantity: "5",
      position: 2,
      leafName: "Other component",
      leafSku: "LIB-O",
    },
    {
      quoteLeafId: "ql-direct-1",
      assemblyLeafId: null, // no legacy row — direct canonical attachment
      assemblyId: null,
      leafId: "lib-direct",
      quantity: "7",
      position: 0,
      leafName: "Directly attached component",
      leafSku: "LIB-D",
    },
  ];
}

function args(
  over: Partial<BuildQuoteCostingInputFromNewModelArgs> = {},
): BuildQuoteCostingInputFromNewModelArgs {
  return {
    quote: { id: QUOTE, globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Primary: 0.4 },
    tiers: [{ id: TIER_A, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    assemblies: [{ id: ASSEMBLY, sku: "ASY-1", name: "Assembly one", position: 0 }],
    quoteLeafAttachments: attachments(),
    assemblyLeafInputs: [],
    assemblyProductionInputs: [],
    assemblyLeafOverrides: [],
    clientTargets: [],
    // No lift on this fixture — the population question is about which
    // attachments become SKUs, not what is priced onto them.
    //
    // Stated because `as BuildQuoteCostingInputFromNewModelArgs` below is an
    // assertion, not a check: it told the compiler this object was complete
    // while the field was absent, and the adapter mapped over `undefined` at
    // run time. The cast is why the type gate stayed silent and the governed
    // test command did not.
    lifts: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
    freightComponentTierCosts: [],
    ...over,
  } as BuildQuoteCostingInputFromNewModelArgs;
}

const leafSkus = (a: BuildQuoteCostingInputFromNewModelArgs) =>
  buildQuoteCostingInputFromNewModel(a).skus.filter((s) => s.skuRole === "leaf");

test("every canonical attachment becomes exactly one commercial SKU", () => {
  const leaves = leafSkus(args());
  assert.equal(leaves.length, 4);
  assert.deepEqual(
    leaves.map((s) => s.canonicalQuoteLeafId).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("the population is the attachment set, not the assembly set", () => {
  // One assembly, three grouped attachments. If these two numbers were allowed
  // to be conflated, a blend over "products" would divide by the wrong count.
  const built = buildQuoteCostingInputFromNewModel(args());
  assert.equal(built.skus.filter((s) => s.skuRole === "assembly").length, 1);
  assert.equal(built.skus.filter((s) => s.skuRole === "leaf").length, 4);
});

test("repeated uses of one library leaf stay distinct commercial lines", () => {
  const leaves = leafSkus(args());
  const repeats = leaves.filter((s) => s.skuLabel === "LIB-R");
  assert.equal(repeats.length, 2);
  // Distinct by canonical identity...
  assert.notEqual(repeats[0].canonicalQuoteLeafId, repeats[1].canonicalQuoteLeafId);
  // ...and by the id the math layer keys on, or they would collapse into one
  // rollup and the quote would silently lose a line.
  assert.notEqual(repeats[0].id, repeats[1].id);
  // Their differing quantities must survive, since that is the blend weight.
  assert.deepEqual(repeats.map((r) => r.qtyPerParent).sort(), [2, 3]);
});

test("a direct canonical attachment is a SKU without any assembly", () => {
  const direct = leafSkus(args()).find((s) => s.canonicalQuoteLeafId === "ql-direct-1");
  assert.ok(direct, "direct attachment must be present in the population");
  assert.equal(direct.parentSkuId, null);
  assert.equal(direct.skuRole, "leaf");
  assert.equal(direct.qtyPerParent, 7);
  // With no legacy row, identity falls back to the canonical id. This is the
  // shape ASY-optional quote authoring produces.
  assert.equal(direct.id, "ql-direct-1");
});

test("a quote with no assemblies at all still has a SKU population", () => {
  // The end state of ASY-optional authoring. Under the previous population
  // source this quote had zero SKUs, because the query reached the quote
  // through `assemblies`.
  const built = buildQuoteCostingInputFromNewModel(
    args({
      assemblies: [],
      quoteLeafAttachments: attachments().filter((a) => a.assemblyId === null),
    }),
  );
  assert.equal(built.skus.length, 1);
  assert.equal(built.skus[0].canonicalQuoteLeafId, "ql-direct-1");
});

test("dropping the legacy row removes cost data but never the SKU", () => {
  // Compatibility data is not population. An attachment whose legacy row is
  // missing must still be a governed SKU — otherwise the absence of a
  // transitional artefact silently deletes a commercial line.
  const stripped = attachments().map((a) => ({ ...a, assemblyLeafId: null }));
  const leaves = leafSkus(args({ quoteLeafAttachments: stripped }));
  assert.equal(leaves.length, 4);
  assert.deepEqual(
    leaves.map((s) => s.id).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("unequal quantities are preserved, so weighting is observable", () => {
  // The guard against the increment-7 failure mode. Production is uniformly
  // quantity 1, where a weighted and an unweighted mean coincide; if this
  // fixture ever drifts to uniform quantities it stops being able to tell a
  // correct blend from an incorrect one, and would pass either way.
  const weights = leafSkus(args()).map((s) => s.qtyPerParent);
  assert.deepEqual(weights, [2, 3, 5, 7]);
  assert.equal(
    new Set(weights).size,
    weights.length,
    "quantities must stay distinct or weighting becomes unobservable",
  );
});

test("production data anchors to the lowest-position leaf, by canonical order", () => {
  // Per-assembly production coerces onto an anchor leaf. The anchor must be
  // chosen from the canonical population; picking it from the legacy set would
  // reintroduce the dependency this change removes.
  const built = buildQuoteCostingInputFromNewModel(
    args({
      assemblyProductionInputs: [
        {
          assemblyId: ASSEMBLY,
          // Stage 3 A · the other owner branch. Explicit null rather than
          // omitted, so this fixture states which owner it is exercising.
          quoteLeafId: null,
          tierId: TIER_A,
          customerShipsRaws: false,
          allocateServiceFeesToCost: true,
          fillingBlendingCost: "100",
          cmAssemblyTotal: null,
          setupFeeTotal: null,
          toolingArtworkTotal: null,
          toolingTotal: null,
          artworkTotal: null,
          rdTotal: null,
          otherServiceTotal: null,
          bulkRawCost: null,
          actualUnitsProduced: null,
        },
      ],
    }),
  );
  assert.equal(built.production.length, 1);
  // OD-017 · same leaf, named canonically. `ql-grouped-1` IS the position-0
  // attachment `al-1` used to stand for; the anchor did not move.
  assert.equal(built.production[0].quoteSkuId, "ql-grouped-1"); // position 0
});

// ---------------------------------------------------------------------------
// Commercial identity survives to the engine's OUTPUT.
//
// `canonicalQuoteLeafId` was carried on the input and dropped at the output
// boundary, so no consumer could read commercial identity from a rollup.
// Increment 7 reads contributor identity from exactly there.
// ---------------------------------------------------------------------------

test("every leaf rollup carries its canonical commercial identity", () => {
  const result = computeQuoteCosting(buildQuoteCostingInputFromNewModel(args()));
  const leaves = result.skuRollups.filter((r) => r.skuRole === "leaf");
  assert.equal(leaves.length, 4);
  assert.deepEqual(
    leaves.map((r) => r.canonicalQuoteLeafId).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("assemblies carry no commercial identity", () => {
  // An assembly is not a commercial line: Pricing excludes it and the customer
  // is never quoted a price for one. Null is the correct answer, not an
  // oversight, and a consumer must not read one here.
  const result = computeQuoteCosting(buildQuoteCostingInputFromNewModel(args()));
  const asy = result.skuRollups.filter((r) => r.skuRole === "assembly");
  assert.equal(asy.length, 1);
  assert.equal(asy[0].canonicalQuoteLeafId, null);
});

test("identity is distinct per rollup where the legacy key would collide", () => {
  // The two attachments of one library leaf must remain separable BY
  // COMMERCIAL IDENTITY at the output, not merely by the legacy id.
  const result = computeQuoteCosting(buildQuoteCostingInputFromNewModel(args()));
  const repeats = result.skuRollups.filter((r) => r.skuLabel === "LIB-R");
  assert.equal(repeats.length, 2);
  assert.notEqual(repeats[0].canonicalQuoteLeafId, repeats[1].canonicalQuoteLeafId);
});

test("identity is null, never the legacy id, when it cannot be resolved", () => {
  // Falling back to skuId would substitute the legacy `assembly_leaf_id` for a
  // commercial identity — the resolution Phase 3 forbids. Unresolvable must
  // stay visibly unresolvable so a consumer fails closed.
  const built = buildQuoteCostingInputFromNewModel(args());
  const withoutIdentity = {
    ...built,
    skus: built.skus.map((s) => ({ ...s, canonicalQuoteLeafId: null })),
  };
  const result = computeQuoteCosting(withoutIdentity);
  for (const r of result.skuRollups) {
    assert.equal(r.canonicalQuoteLeafId, null);
    assert.notEqual(r.canonicalQuoteLeafId, r.skuId);
  }
});

// ---------------------------------------------------------------------------
// Gate 1B increment 7 — the component blends, over the governed population.
//
// The reverted attempt blended over TOP-LEVEL PRODUCTS. With one assembly that
// is a single contributor, so the "blend" returned the assembly's rolled-up
// SUM. These tests assert the blend is a weighted MEAN over the governed
// quote-leaf population, and they assert the CONTRIBUTORS and the WEIGHTS —
// not only the resulting number, which is what let the old fixture pass.
// ---------------------------------------------------------------------------

/** Per-leaf packaging so the contributors carry genuinely different values. */
function packagingInputs() {
  // OD-017 · cost rows key on the canonical `quote_leaf_id`. The VALUES below
  // are unchanged from the legacy-keyed fixture on purpose: if re-keying moved
  // any commercial number, every expectation downstream would shift. They do
  // not, which is the evidence that this was an identity change and not an
  // economic one.
  const line = (quoteLeafId: string, unitCost: string) => ({
    quoteLeafId,
    tierId: TIER_A,
    lineGroupId: `lg-${quoteLeafId}`,
    pricingVendorHubspotCompanyId: null,
    pricingVendorNameSnapshot: null,
    unitCost,
    qtyPerSellableUnit: "1",
    category: "Primary",
    markupPct: null,
  });
  return [
    line("ql-grouped-1", "10"),
    line("ql-grouped-2", "20"),
    line("ql-grouped-3", "30"),
  ];
}

const withCosts = () => args({ assemblyLeafInputs: packagingInputs() });

/** A quote whose price departs from the build-up, via a global adjustment. */
const withDeparture = () =>
  args({
    assemblyLeafInputs: packagingInputs(),
    quote: { id: QUOTE, globalPriceAdjPct: 0.1, targetMarginPct: null, freightMarkupPct: 0 },
  });

function blendNode(key: string): CostingNode {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  for (const root of r.graph.nodes) {
    const hit = findNode(root, `quote/${TIER_A}/${key}`);
    if (hit) return hit;
  }
  throw new Error(`node quote/${TIER_A}/${key} not found`);
}

test("the blend contributors are the governed quote-leaf population", () => {
  const pkg = blendNode("pkg");
  assert.equal(pkg.kind, "blend");
  // Four canonical attachments, four contributors — not one per assembly.
  assert.equal(pkg.operands?.length, 4);
  assert.deepEqual(
    (pkg.operands ?? []).map((o) => o.key.split("/").pop()).sort(),
    ["ql-direct-1", "ql-grouped-1", "ql-grouped-2", "ql-grouped-3"],
  );
});

test("operands are keyed by canonical identity, so a repeated leaf stays two", () => {
  const pkg = blendNode("pkg");
  // Matched on a CONTAINED code rather than an exact label. P-PriceBuild-UX2
  // changed the label to "name · sku" because leaves with no SKU rendered
  // blank rows in a trace; the identity being asserted here — that one library
  // leaf attached twice stays two distinctly-keyed operands — is untouched by
  // how the row is worded, and this now says so.
  const repeats = (pkg.operands ?? []).filter((o) => o.label.includes("LIB-R"));
  assert.equal(repeats.length, 2);
  assert.notEqual(repeats[0].key, repeats[1].key);
});

test("weights are units at the tier: attachment quantity x tier quantity", () => {
  const pkg = blendNode("pkg");
  // Attachment quantities 2, 3, 5, 7 against a tier of 1000.
  assert.deepEqual(pkg.weights, [2000, 3000, 5000, 7000]);
});

test("the blend is a weighted mean of its own operands", () => {
  const pkg = blendNode("pkg");
  const ops = pkg.operands ?? [];
  const w = pkg.weights ?? [];
  const expected =
    ops.reduce((acc, o, i) => acc + o.value * w[i], 0) /
    w.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(pkg.value - expected) < 1e-9);
});

test("the blend is NOT the sum of its operands — the reverted defect", () => {
  // The single assertion that would have caught the reverted increment. With
  // one assembly the old blend returned the rolled-up sum, and a test that
  // only checked "some number" could not tell the two apart.
  const pkg = blendNode("pkg");
  const sum = (pkg.operands ?? []).reduce((a, o) => a + o.value, 0);
  assert.ok(sum > 0, "fixture must produce non-zero packaging or this proves nothing");
  assert.ok(
    Math.abs(pkg.value - sum) > 1e-6,
    `blend ${pkg.value} must not equal the operand sum ${sum}`,
  );
  assert.ok(pkg.value < sum, "a mean over multiple contributors is below their sum");
});

test("unequal weights change the answer — weighting is load-bearing", () => {
  // Recompute the same operands with the uniform weights production happens to
  // have. If the two agree, the fixture cannot distinguish a weighted mean
  // from an unweighted one and every other assertion here is weaker than it
  // looks.
  const pkg = blendNode("pkg");
  const ops = pkg.operands ?? [];
  const unweighted = ops.reduce((a, o) => a + o.value, 0) / ops.length;
  assert.ok(
    Math.abs(pkg.value - unweighted) > 1e-6,
    `weighted ${pkg.value} and unweighted ${unweighted} must differ`,
  );
});

test("sell-before is the sum of the component blends", () => {
  const sellBefore = blendNode("sell-before");
  assert.equal(sellBefore.kind, "sum");
  assert.equal(sellBefore.operands?.length, 5);
  const summed = (sellBefore.operands ?? []).reduce((a, o) => a + o.value, 0);
  assert.ok(Math.abs(sellBefore.value - summed) < 1e-9);
  assert.deepEqual(
    (sellBefore.operands ?? []).map((o) => o.key.split("/").pop()),
    ["pkg", "prod", "raw", "frt", "dt"],
  );
});

test("component blend labels state a sell quantity, never a cost", () => {
  // The consuming surface heads these numbers "UNIT COST". A correct value
  // under a wrong label is still a wrong statement, and the graph is where the
  // statement is made.
  for (const key of ["pkg", "prod", "raw", "frt", "dt"]) {
    const n = blendNode(key);
    assert.ok(!/cost/i.test(n.label), `${key} label must not say "cost": ${n.label}`);
    assert.match(n.label, /sell/i);
  }
});

test("a SKU present but unpriced contributes at zero, and is not silently dropped", () => {
  // The direct attachment cannot carry cost inputs — every cost-input table
  // keys on assembly_leaf_id (OD-017). It is a governed SKU with a rollup of
  // zeros, so it participates at zero rather than being excluded.
  //
  // Pinned rather than designed: whether an unpriceable SKU should instead be
  // an absentee is an OD-017 question and is deliberately not settled here.
  // Zero such rows exist in production, so this has no live effect today.
  const pkg = blendNode("pkg");
  const direct = (pkg.operands ?? []).find((o) => o.key.endsWith("ql-direct-1"));
  assert.ok(direct, "the direct attachment must still be a contributor");
  assert.equal(direct.value, 0);
  assert.equal(pkg.weights?.[3], 7000);
});

test("the graph reconciles on the nested, unequal-quantity fixture", () => {
  // Reconciliation is asserted against THIS fixture, not only the flat one.
  // The blends are the newest arithmetic in the graph and they are the nodes
  // whose operands and weights this fixture was built to stress.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
});

// ---------------------------------------------------------------------------
// The traversal API the Pricing Cost Stack reads through.
// ---------------------------------------------------------------------------

test("resolveNode finds nodes that are nested, not only roots", () => {
  // The component blends are operands of `sell-before`. A root-only lookup
  // returns nothing for every one of them, which is what shipped a Cost Stack
  // that rendered every tier incomplete.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const key = quoteScopeKey(TIER_A, "pkg");
  assert.equal(r.graph.nodes.find((n) => n.key === key), undefined);
  assert.ok(resolveNode(r.graph.nodes, key), "traversal must find it");
});

test("resolveNode fails closed on a missing key", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  assert.equal(resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "nope")), null);
});

test("resolveNode fails closed on a duplicate key", () => {
  // Two matches means the graph does not have one answer, so no single answer
  // can be read from it. Returning the first would be a coin toss the operator
  // never sees.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const key = quoteScopeKey(TIER_A, "pkg");
  const dupe = resolveNode(r.graph.nodes, key)!;
  assert.equal(resolveNode([...r.graph.nodes, dupe], key), null);
});

test("every key the Cost Stack addresses resolves exactly once", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  for (const name of ["pkg", "prod", "raw", "frt", "dt", "sell-before", "sell"]) {
    assert.ok(
      resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, name)),
      `${name} must resolve exactly once`,
    );
  }
});

// ---------------------------------------------------------------------------
// Costs cost-stack header — per-unit allocations.
//
// A DIFFERENT commercial quantity from the Pricing blend: the quote's tier
// total spread over the tier quantity, versus a weighted mean across SKUs.
// Both are correct; the defect was that the header derived its own.
// ---------------------------------------------------------------------------

test("per-unit allocation carries its divisor as data, not in a label", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const rev = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit/revenue"))!;
  assert.equal(rev.kind, "allocation");
  assert.equal(rev.divisor, 1000);
  // The reconciler can only check the operation because the divisor is data.
  assert.deepEqual(findGraphViolations(rev), []);
});

test("per-unit subtotal is the tier total over tier quantity", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const node = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit"))!;
  const roll = r.quoteRollup.find((x) => x.tierId === TIER_A)!;
  const b = roll.costBreakdown;
  const expected =
    (b.packagingMarkupSum + b.productionMarkupSum +
     b.freightContainerMarkupSum + b.dutyAndTariffMarkupSum) / roll.qty;
  assert.ok(Math.abs(node.value - expected) < 1e-9);
});

test("per-unit and the Pricing blend are DIFFERENT quantities", () => {
  // The guard against collapsing one into the other. On this fixture four
  // SKUs sit under one quote, so a sum across the quote and a mean across
  // SKUs cannot agree — and if a future change makes them agree, that is a
  // semantic regression even though every number would still reconcile.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const perUnit = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit"))!;
  const blend = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "sell-before"))!;
  assert.ok(perUnit.value > 0, "fixture must carry value or this proves nothing");
  assert.ok(
    Math.abs(perUnit.value - blend.value) > 1e-6,
    `per-unit ${perUnit.value} must differ from blend ${blend.value}`,
  );
});

test("zero tier quantity · no readable per-unit allocation is exposed", () => {
  // Same contract as the zero-weight blend: dividing by zero units is
  // undefined, and undefined is not zero.
  const zero = args({
    tiers: [{ id: TIER_A, label: "T1", qty: 0, sortOrder: 0, tierPriceAdjPct: null }],
    assemblyLeafInputs: packagingInputs(),
  });
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(zero));
  for (const k of ["per-unit/revenue", "per-unit/cost-total", "per-unit/pkg"]) {
    assert.equal(resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, k)), null, k);
  }
  const container = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit"))!;
  assert.equal(container.kind, "flagged-out");
  assert.match(container.reason!, /undefined/i);
});

// ---------------------------------------------------------------------------
// `difference` — the Costs header's gap between quoted price and build-up.
// ---------------------------------------------------------------------------

test("the departure node is a difference of two identified operands", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const d = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit/departure"))!;
  assert.equal(d.kind, "difference");
  assert.equal(d.operands?.length, 2);
  assert.match(d.operands![0].label, /revenue/i);
  assert.match(d.operands![1].label, /contribution/i);
  assert.ok(Math.abs(d.value - (d.operands![0].value - d.operands![1].value)) < 1e-9);
  assert.deepEqual(findGraphViolations(d), []);
});

test("reversing a difference's operands FAILS reconciliation", () => {
  // Order is the identification. A difference read the wrong way round is not
  // a smaller error than a wrong number — it inverts the business meaning,
  // turning a price above the build-up into one below it.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withDeparture()));
  const d = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit/departure"))!;
  assert.ok(Math.abs(d.value) > 1e-6, "fixture must have a non-zero gap or this proves nothing");
  const reversed = { ...d, operands: [d.operands![1], d.operands![0]] };
  const problems = findGraphViolations(reversed);
  assert.ok(problems.length > 0, "operand reversal must be caught");
});

test("a difference with the wrong operand count is rejected", () => {
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const d = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit/departure"))!;
  const truncated = { ...d, operands: [d.operands![0]] };
  assert.ok(findGraphViolations(truncated).length > 0);
});

test("the departure label names the quantity, not its commonest cause", () => {
  // It is non-zero for per-tier adjustments, cell overrides AND unrendered
  // passthrough components. Calling it "price adjustment" would be right
  // about two of those and wrong about the third.
  const r = computeQuoteCosting(buildQuoteCostingInputFromNewModel(withCosts()));
  const d = resolveNode(r.graph.nodes, quoteScopeKey(TIER_A, "per-unit/departure"))!;
  assert.doesNotMatch(d.label, /^Adjustment|^Override/);
  assert.match(d.label, /quoted price less/i);
});
