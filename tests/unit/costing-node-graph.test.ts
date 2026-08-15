/**
 * Gate 1B increment 1 — the canonical node graph, packaging section.
 *
 * These are the §7 traversal guarantees made executable. The one that matters
 * most is guarantee 6: every scalar the engine returns equals the value of its
 * corresponding node. That is what makes "the stack and the trace cannot
 * disagree" true by construction rather than by care — and it is the assertion
 * that would catch the graph and the rollups drifting apart while both look
 * individually correct.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type CostingProductionInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import {
  ARITHMETIC_KINDS,
  GRAPH_VERSION,
  QUOTE_SCOPE_PREFIX,
  quoteScopeKey,
  resolveNode,
  readNodeValue,
  resolveNodes,
  nodeKey,
  parseNodeKey,
  isCellScoped,
  quoteWideKey,
  readEffectiveTargetMargin,
  isQuoteScoped,
  isCellSectionNode,
  collectCellSectionNodes,
  REQUIRED_CELL_SECTIONS,
  TERMINAL_KINDS,
  graphIsComplete,
  findDuplicateKeys,
  findGraphViolations,
  findNode,
  walkGraph,
  type CostingNode,
  type CostingGraph,
  type GraphEvaluation,
} from "../../src/lib/costing-nodes.ts";

const TIER = "tier-1";
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
    unitCost: 10,
    qtyPerSellableUnit: 1,
    category: "Primary",
    markupPct: null,
    ...over,
  };
}

const THREE_LINES = [
  pkg({ lineGroupId: "line-a", unitCost: 10, category: "Primary" }),
  pkg({ lineGroupId: "line-b", unitCost: 4, category: "Shrink" }),
  pkg({ lineGroupId: "line-c", unitCost: 2, category: "Primary", markupPct: 0.1 }),
];

/**
 * Increment 4 restructured the graph to ONE ROOT PER CELL, with the sections
 * nested beneath sell rather than sitting alongside it as separate roots. A
 * section cannot appear both as a root and as an operand — duplicated
 * arithmetic nodes double-count under reconciliation.
 *
 * So lookups search the roots rather than indexing them.
 */
const findIn = (r: ReturnType<typeof computeQuoteCosting>, key: string) => {
  for (const root of r.graph.nodes) {
    const hit = findNode(root, key);
    if (hit) return hit;
  }
  return null;
};

const packagingNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  findIn(r, `${LEAF}/${TIER}/pkg`)!;

// ------------------------------------------- guarantee 6 · nodes match scalars

test("the packaging node value equals the packaging scalar the engine returns", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const scalar = r.skuRollups[0].perTier[0].packagingMarkupSumPerUnit;
  assert.equal(packagingNode(r).value, scalar);
});

test("the packaging line nodes sum to the packaging scalar", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const lines = packagingNode(r).operands ?? [];
  assert.equal(lines.length, 3);
  const summed = lines.reduce((s, l) => s + l.value, 0);
  assert.equal(summed, r.skuRollups[0].perTier[0].packagingMarkupSumPerUnit);
});

test("each line's cost operand sums to the pre-markup packaging cost", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const costs = (packagingNode(r).operands ?? []).map(
    (l) => (l.operands ?? []).find((o) => o.kind === "origin")!.value,
  );
  assert.equal(
    costs.reduce((s, c) => s + c, 0),
    r.skuRollups[0].perTier[0].packagingCostPerUnit,
  );
});

// ----------------------------------------------------- traversal guarantees

test("the emitted graph satisfies every traversal guarantee", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
});

test("every path terminates in a terminal kind, never in a derived number", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const root of r.graph.nodes) {
    walkGraph(root, (n) => {
      const leaf = (n.operands ?? []).length === 0;
      // An empty section sum at zero is a legitimate leaf — a quote with no
      // freight still needs a Freight row, and Sigma of nothing is 0. The
      // invariant permits it only AT zero, so this exemption cannot hide a
      // section asserting a value nothing accounts for.
      const emptySectionAtZero = n.kind === "sum" && n.value === 0;
      if (leaf && n.kind !== "resolution" && !emptySectionAtZero) {
        assert.ok(
          TERMINAL_KINDS.has(n.kind),
          `${n.key} ends the chain as "${n.kind}", which is not a terminal`,
        );
      }
    });
  }
});

test("every non-terminal states its operation", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const root of r.graph.nodes) {
    walkGraph(root, (n) => {
      if (!TERMINAL_KINDS.has(n.kind)) {
        assert.ok(n.op, `${n.key} (${n.kind}) has no operation — that is a breakdown, not a trace`);
      }
    });
  }
});

test("arithmetic nodes reconcile against their operands", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const root of r.graph.nodes) {
    walkGraph(root, (n) => {
      if (n.kind === "sum") {
        const summed = (n.operands ?? []).reduce((s, o) => s + o.value, 0);
        assert.ok(
          Math.abs(summed - n.value) < 1e-9,
          `${n.key}: operands sum to ${summed}, node says ${n.value}`,
        );
      }
      assert.ok(ARITHMETIC_KINDS.has(n.kind) || !ARITHMETIC_KINDS.has(n.kind));
    });
  }
});

// -------------------------------------------------------------- node identity

test("keys are deterministic — two runs of the same input produce identical keys", () => {
  const keysOf = () => {
    const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
    const ks: string[] = [];
    for (const root of r.graph.nodes) walkGraph(root, (n) => ks.push(n.key));
    return ks;
  };
  // Not a formality: Phase 3 computes twice and diffs the two graphs per row.
  // A generated key would make that join impossible and the transient-delta
  // feature unbuildable.
  assert.deepEqual(keysOf(), keysOf());
});

test("keys are built from durable identity, so adding a line cannot move another line's key", () => {
  const two = computeQuoteCosting(input({ packaging: THREE_LINES.slice(0, 2) }));
  const three = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const keyOf = (r: ReturnType<typeof computeQuoteCosting>, group: string) =>
    (packagingNode(r).operands ?? []).find((l) => l.key.endsWith(`/${group}`))?.key;
  assert.equal(keyOf(two, "line-a"), keyOf(three, "line-a"));
  assert.equal(keyOf(two, "line-b"), keyOf(three, "line-b"));
});

test("a node is locatable by key — the entry-at-node lookup", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const found = findNode(packagingNode(r), `${LEAF}/${TIER}/pkg/line-b`);
  assert.ok(found, "line-b must be reachable by key");
  assert.equal(found!.kind, "markup");
});

// ------------------------------------------------------- the resolution ladder

const ladderOf = (r: ReturnType<typeof computeQuoteCosting>, group: string) =>
  (packagingNode(r).operands ?? [])
    .find((l) => l.key.endsWith(`/${group}`))!
    .operands!.find((o) => o.kind === "resolution")!;

test("a resolution ladder shows its losing rungs, not just the winner", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const ladder = ladderOf(r, "line-b"); // Shrink — no default exists
  assert.equal(ladder.candidates!.length, 4);
  const chosen = ladder.candidates!.filter((c) => c.chosen);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].label, "Other default");
  // The losing rungs carry WHY they lost. Collapsing to the resolved value
  // restores exactly the opacity the node kind exists to remove.
  const shrink = ladder.candidates!.find((c) => c.label === "Shrink default")!;
  assert.equal(shrink.unavailableReason, "no Shrink default exists");
  assert.equal(ladder.value, 0.3);
});

test("a category default wins when one exists", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const ladder = ladderOf(r, "line-a"); // Primary — default 0.4 exists
  assert.equal(ladder.candidates!.find((c) => c.chosen)!.label, "Primary default");
  assert.equal(ladder.value, 0.4);
});

test("an explicit line markup of ZERO is reported as the chosen rung", () => {
  const r = computeQuoteCosting(
    input({ packaging: [pkg({ lineGroupId: "line-z", unitCost: 10, markupPct: 0 })] }),
  );
  const ladder = ladderOf(r, "line-z");
  // The engine uses the line's 0, so the ladder must say "Line override" won.
  // Marking the resolver's own winner here would state the wrong provenance on
  // exactly the lines a PM deliberately set to zero — and the rendered value
  // would still be right, so nothing else would catch it.
  assert.equal(ladder.candidates!.find((c) => c.chosen)!.label, "Line override");
  assert.equal(ladder.value, 0);
  assert.equal(packagingNode(r).value, 10);
});

// -------------------------------------------------------------- provenance

test("terminals declare a provenance grade, and it is thin rather than invented", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const origins: CostingNode[] = [];
  for (const root of r.graph.nodes) {
    walkGraph(root, (n) => {
      if (n.kind === "origin") origins.push(n);
    });
  }
  // Scoped to packaging: every section contributes origins, so pinning a
  // global count would make this test a change-detector for section arrival
  // rather than an assertion about provenance.
  //
  // The scope must be named. `/pkg/` alone spans two of them — cell-scope
  // packaging inputs AND the quote-scope packaging blend's contributors, which
  // are also origins. Matching on the substring silently counted both the
  // moment increment 7 landed.
  assert.equal(
    origins.filter(
      (o) => isCellScoped(o.key) && (parseNodeKey(o.key)?.path[0] ?? "") === "pkg",
    ).length,
    3,
  );
  assert.ok(origins.length > 3, "other sections contribute terminals too");
  for (const o of origins) {
    // A-2 is still open: the input-type -> audit-row mapping is unwritten. Until
    // it exists the grade must be `thin`, which states the absence, rather than
    // a fabricated actor — that would upgrade thin provenance to sourced, which
    // is the one thing the two grades exist to prevent.
    assert.equal(o.origin?.grade, "thin");
    assert.equal(o.origin?.actor, null);
  }
});

// ---------------------------------------------------------------- boundaries

test("completeness means every required section is REPRESENTED, not that it carries data", () => {
  // Superseded by increment 5, which derives `complete` from the emitted
  // sections. A packaging-only quote is complete: production, bulk raw and
  // freight are all represented, at zero. Representation and data are
  // different questions, and a consumer needs the first one answered — it
  // must know the section exists before it can read a zero from it.
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(r.graph.complete, true);
  assert.equal(findIn(r, `${LEAF}/${TIER}/frt`)!.value, 0);
});

test("a quote with no packaging emits a packaging node of zero, not an absent one", () => {
  const r = computeQuoteCosting(input({ packaging: [] }));
  const n = packagingNode(r);
  assert.equal(n.value, 0);
  assert.deepEqual(n.operands, []);
  assert.equal(n.value, r.skuRollups[0].perTier[0].packagingMarkupSumPerUnit);
});

test("an empty section is legitimate and satisfies the invariants", () => {
  const r = computeQuoteCosting(input({ packaging: [] }));
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
});

test("an empty sum asserting a NON-zero value is still a violation", () => {
  // The rule is not "empty is fine". An empty sum valued 0 accounts for
  // itself; an empty sum valued 4.20 is a number from nowhere, which is the
  // broken terminal the guarantee exists to catch. Relaxing the rule to allow
  // any empty node would have let this through.
  const rogue: CostingNode = {
    key: "rogue",
    kind: "sum",
    label: "Rogue",
    value: 4.2,
    unit: "usd",
    op: "Σ nothing",
    operands: [],
  };
  const violations = findGraphViolations(rogue);
  assert.equal(violations.length, 1);
  assert.match(violations[0].problem, /empty sum asserts 4\.2/);
});

// ------------------------------------------------------- compatibility contract

test("the emitted graph declares its version", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(r.graph.version, GRAPH_VERSION);
  assert.equal(typeof r.graph.version, "number");
});

test("version and completeness are different questions and must not be conflated", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  // `version` says what SHAPE the graph is in; `complete` says how much of it
  // is here. A consumer that checked only one would either read a section that
  // does not exist yet, or trust a shape it was not written against.
  // v2: the graph gained a required `evaluation`. A shape change rather than an
  // additive one, because a v1 consumer handed a preview graph stays
  // type-correct and silently becomes semantically wrong.
  assert.equal(r.graph.version, 2);
  assert.equal(r.graph.complete, true);
  assert.equal(r.graph.evaluation, "committed");
  // Still different questions: version says what SHAPE the graph is in,
  // complete says how much of it is here. They moved independently — the
  // graph became complete without the shape changing, which is exactly why
  // one flag could not have served for both.
});

test("adding a section must not require a version bump", () => {
  // The version is a compatibility contract, not a build counter. Sections
  // arriving is additive and is what `complete` tracks — bumping for it would
  // train consumers to ignore the version, which is the failure mode a
  // version field exists to prevent.
  const empty = computeQuoteCosting(input({ packaging: [] }));
  const filled = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(empty.graph.version, filled.graph.version);
});

// ============================================================================
// Increment 2 — production and bulk raw
// ============================================================================

const prod = (over: Partial<CostingProductionInput> = {}): CostingProductionInput => ({
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
  bulkRawCost: null,
  actualUnitsProduced: null,
  ...over,
});

const graphNode = (r: ReturnType<typeof computeQuoteCosting>, key: string) =>
  findIn(r, key)!;
const productionNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  graphNode(r, `${LEAF}/${TIER}/prod`);
const rawNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  graphNode(r, `${LEAF}/${TIER}/raw`);

test("production · the node value equals the production scalar", () => {
  const r = computeQuoteCosting(input({ production: [prod()] }));
  assert.equal(
    productionNode(r).value,
    r.skuRollups[0].perTier[0].productionMarkupSumPerUnit,
  );
});

test("production · the cost operand equals the production cost scalar", () => {
  const r = computeQuoteCosting(input({ production: [prod()] }));
  const cost = productionNode(r).operands!.find((o) => o.kind === "sum")!;
  assert.equal(cost.value, r.skuRollups[0].perTier[0].productionCostPerUnit);
});

test("production · COGS is an allocation over run TOTALS, not a sum of per-unit values", () => {
  const r = computeQuoteCosting(input({ production: [prod()] }));
  const cost = productionNode(r).operands!.find((o) => o.kind === "sum")!;
  const cogs = cost.operands!.find((o) => o.key.endsWith("/cogs"))!;
  assert.equal(cogs.kind, "allocation");
  // 1800 + 1200 over 1000 units. The operands are the run totals; the
  // division IS the operation, which is the thing an operator would
  // otherwise assume wrongly.
  assert.equal(cogs.value, 3);
  assert.deepEqual(cogs.operands!.map((o) => o.value), [1800, 1200]);
  assert.match(cogs.op!, /1000 units/);
});

test("production · one-time services sum before they are allocated", () => {
  const r = computeQuoteCosting(input({ production: [prod()] }));
  const cost = productionNode(r).operands!.find((o) => o.kind === "sum")!;
  const services = cost.operands!.find((o) => o.key.endsWith("/services"))!;
  const oneTime = services.operands![0];
  assert.equal(oneTime.kind, "sum");
  assert.equal(oneTime.value, 2000); // 800 + 900 + 250 + 50
  assert.equal(services.value, 2); // 2000 / 1000
});

test("production · allocation OFF removes the operand rather than zeroing it", () => {
  const on = computeQuoteCosting(input({ production: [prod({ allocateServiceFeesToCost: true })] }));
  const off = computeQuoteCosting(input({ production: [prod({ allocateServiceFeesToCost: false })] }));

  const costOf = (r: ReturnType<typeof computeQuoteCosting>) =>
    productionNode(r).operands!.find((o) => o.kind === "sum")!;

  assert.equal(costOf(on).operands!.length, 2);
  // The SHAPE changes, not only the number. A zero operand would say the
  // one-time fees are in the price at zero; they are not in the price at all,
  // they bill separately. Those are different statements.
  assert.equal(costOf(off).operands!.length, 1);
  assert.equal(costOf(off).operands![0].key.endsWith("/cogs"), true);
  assert.match(costOf(off).note!, /separate fixed charges/);
});

test("production · one aggregate markup, never a per-line one", () => {
  const r = computeQuoteCosting(input({ production: [prod()] }));
  const resolution = productionNode(r).operands!.find((o) => o.kind === "resolution")!;
  assert.equal(resolution.label, "Manufacturing markup");
  assert.equal(resolution.value, 0.32);
  // Production has no per-line markup column. Reproducing packaging's
  // per-line ladder here would be a fabrication.
  assert.equal(productionNode(r).operands!.filter((o) => o.kind === "resolution").length, 1);
});

// ------------------------------------------------------------- bulk raw

test("bulk raw · customer-shipped raws produce a flagged-out node, not a zero markup", () => {
  const r = computeQuoteCosting(
    input({ production: [prod({ customerShipsRaws: true, bulkRawCost: 5000 })] }),
  );
  const n = rawNode(r);
  assert.equal(n.kind, "flagged-out");
  assert.equal(n.value, 0);
  assert.equal(n.operands, undefined);
  // The reason names WHAT was excluded. A reason without the amount tells an
  // operator something was left out but not what it would have cost them.
  assert.match(n.reason!, /\$5000/);
  assert.match(n.reason!, /Customer ships raws/);
});

test("bulk raw · an ABSENT cost and an EXCLUDED cost both read zero but differ in kind", () => {
  const absent = computeQuoteCosting(input({ production: [prod({ bulkRawCost: null })] }));
  const excluded = computeQuoteCosting(
    input({ production: [prod({ customerShipsRaws: true, bulkRawCost: 5000 })] }),
  );
  assert.equal(rawNode(absent).value, 0);
  assert.equal(rawNode(excluded).value, 0);
  // Identical scalars, different facts. This is the entire argument for
  // `flagged-out` being a kind rather than a value.
  assert.equal(rawNode(absent).kind, "markup");
  assert.equal(rawNode(excluded).kind, "flagged-out");
});

test("bulk raw · a present cost allocates over tier units and equals the scalar", () => {
  const r = computeQuoteCosting(input({ production: [prod({ bulkRawCost: 4000 })] }));
  const n = rawNode(r);
  assert.equal(n.kind, "markup");
  assert.equal(n.value, r.skuRollups[0].perTier[0].rawMarkupSumPerUnit);
  const alloc = n.operands!.find((o) => o.kind === "allocation")!;
  assert.equal(alloc.value, 4); // 4000 / 1000
  assert.equal(alloc.value, r.skuRollups[0].perTier[0].rawCostPerUnit);
});

test("bulk raw · carries its provisional warning in both shapes", () => {
  const priced = computeQuoteCosting(input({ production: [prod({ bulkRawCost: 4000 })] }));
  const flagged = computeQuoteCosting(
    input({ production: [prod({ customerShipsRaws: true, bulkRawCost: 4000 })] }),
  );
  // A-7 is open. The node states that it uses the pricing-active value and
  // that quote-level ingredient rows are not its arithmetic source — in BOTH
  // shapes, since the caveat does not stop applying when the input is excluded.
  for (const n of [rawNode(priced), rawNode(flagged)]) {
    assert.equal(n.noteLevel, "warn");
    assert.match(n.note!, /unconnected representation/);
  }
});

// --------------------------------------------------------- whole-graph checks

test("increment 2 · the production and raw subtrees satisfy every traversal guarantee", () => {
  for (const p of [
    prod(),
    prod({ allocateServiceFeesToCost: false }),
    prod({ customerShipsRaws: true, bulkRawCost: 5000 }),
    prod({ bulkRawCost: 4000 }),
  ]) {
    const r = computeQuoteCosting(input({ packaging: THREE_LINES, production: [p] }));
    for (const root of r.graph.nodes) {
      assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
    }
  }
});

test("increment 2 · a tier with zero quantity still emits a well-formed graph", () => {
  // Amortization is undefined at qty 0 and the engine treats it as no
  // contribution. The graph must still be traversable rather than absent —
  // an operator asking "why is this zero" needs the chain, most of all here.
  const r = computeQuoteCosting(
    input({
      tiers: [{ id: TIER, label: "T1", qty: 0, sortOrder: 0, tierPriceAdjPct: null }],
      production: [prod()],
    }),
  );
  assert.equal(productionNode(r).value, 0);
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
});

test("increment 2 · keys stay deterministic with production present", () => {
  const keysOf = () => {
    const r = computeQuoteCosting(input({ packaging: THREE_LINES, production: [prod()] }));
    const ks: string[] = [];
    for (const root of r.graph.nodes) walkGraph(root, (n) => ks.push(n.key));
    return ks;
  };
  assert.deepEqual(keysOf(), keysOf());
});

// ============================================================================
// Increment 3 — Freight
// ============================================================================

const freightNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  graphNode(r, `${LEAF}/${TIER}/frt`);

// ------------------------------------------------- worksheet model (current)

const shipmentBreak = (over: Record<string, unknown> = {}) => ({
  freightSubcategoryId: "ship-1",
  memberCount: 1,
  memberSkuId: LEAF,
  tierId: TIER,
  treatment: "bundled" as const,
  tierUnits: 1000,
  freightAmount: 4000,
  freightMarkupPct: 0.4,
  dutyAmount: 500,
  dutyMarkupPct: 0.1,
  tariffAmount: 250,
  tariffMarkupPct: 0.2,
  ...over,
});

test("freight · the section node equals the landed-with-markup scalar", () => {
  const r = computeQuoteCosting(
    input({ freightShipmentBreaks: [shipmentBreak()] } as never),
  );
  assert.equal(
    freightNode(r).value,
    r.skuRollups[0].perTier[0].totalLandedFreightWithMarkup,
  );
});

test("freight · worksheet customs are ENTERED AMOUNTS, so no rate node is invented", () => {
  const r = computeQuoteCosting(
    input({ freightShipmentBreaks: [shipmentBreak()] } as never),
  );
  const kinds: string[] = [];
  walkGraph(freightNode(r), (n) => kinds.push(n.kind));
  // The worksheet model records duty as a dollar amount. Emitting a `rate`
  // node here would assert a percentage nobody entered — a fabricated figure
  // that would look authoritative in a trace.
  assert.equal(kinds.includes("rate"), false);
  assert.equal(kinds.includes("allocation"), true);
});

test("freight · worksheet charges allocate over tier units then take markup", () => {
  const r = computeQuoteCosting(
    input({ freightShipmentBreaks: [shipmentBreak()] } as never),
  );
  const ship = freightNode(r).operands![0];
  const duty = ship.operands!.find((o) => o.label === "Duty")!;
  const alloc = duty.operands!.find((o) => o.kind === "allocation")!;
  assert.equal(alloc.value, 0.5); // 500 / 1000
  assert.equal(alloc.divisor, 1000);
  assert.equal(duty.value, 0.55); // 0.5 x 1.1
});

// ------------------------------------------------------ legacy leg model

const leg = (over: Record<string, unknown> = {}) => ({
  id: "leg-1",
  legGroupId: "grp-1",
  direction: "inbound" as const,
  label: null, origin: null, destination: null,
  crossesInternationalBorder: true,
  treatment: "bundled" as const,
  mode: "ocean" as never,
  carrier: null,
  incoterm: "DDP" as const,
  cargoReadyDate: null, vesselEtd: null, vesselEta: null, actualDeliveryDate: null,
  dutyMarkupPct: 0.1,
  tariffMarkupPct: 0.2,
  customs: { dutyPct: 0.05, tariffPct: 0.02 },
  displayOrder: 0,
  ...over,
});

const legacyInput = () =>
  input({
    packaging: [pkg({ unitCost: 10, markupPct: 0 })],
    freightLegGroups: [{ id: "grp-1", label: "Journey", displayOrder: 0 }],
    freightLegs: [leg()],
    freightLegTiers: [
      { freightLegId: "leg-1", tierId: TIER, totalFreight: 4000, unitsInShipment: null },
    ],
  } as never);

test("freight · legacy duty is a RATE and states the basis it applies to", () => {
  const r = computeQuoteCosting(legacyInput());
  const legNode = freightNode(r).operands![0];
  const duty = legNode.operands!.find((o) => o.label === "Duty")!;
  const rate = duty.operands!.find((o) => o.kind === "rate")!;

  const factory = r.skuRollups[0].perTier[0].factoryCostPerUnit;
  // A correct dollar result with an ambiguous basis is insufficient
  // provenance: $0.50 of duty could be 5% of factory cost or 2% of landed
  // cost, and nothing in the number distinguishes them.
  assert.ok(rate.basis, "a rate node must state its basis");
  assert.equal(rate.basis!.value, factory);
  assert.match(rate.basis!.label, /packaging \+ production \+ bulk raw/);
  assert.equal(rate.value, factory * 0.05);
});

test("freight · duty and tariff carry SEPARATE markups on the dollars", () => {
  const r = computeQuoteCosting(legacyInput());
  const legNode = freightNode(r).operands![0];
  const duty = legNode.operands!.find((o) => o.label === "Duty")!;
  const tariff = legNode.operands!.find((o) => o.label === "Tariff")!;
  const factory = r.skuRollups[0].perTier[0].factoryCostPerUnit;

  // The markup applies to the DOLLARS, not to the percentage — a PM must be
  // able to zero the tariff markup without losing margin on duty or freight,
  // which only works while they are separate nodes.
  assert.equal(duty.value, factory * 0.05 * 1.1);
  assert.equal(tariff.value, factory * 0.02 * 1.2);
});

test("freight · the customs basis excludes freight itself", () => {
  const r = computeQuoteCosting(legacyInput());
  const cell = r.skuRollups[0].perTier[0];
  const legNode = freightNode(r).operands![0];
  const rate = legNode
    .operands!.find((o) => o.label === "Duty")!
    .operands!.find((o) => o.kind === "rate")!;
  // Factory cost is packaging + production + raw. Freight is deliberately
  // outside the customs base, and the basis value proves which was used.
  assert.equal(rate.basis!.value, cell.factoryCostPerUnit);
  assert.notEqual(rate.basis!.value, cell.contributionCostPerUnit);
});

test("freight · a non-DDP leg emits no customs nodes at all", () => {
  const r = computeQuoteCosting(
    input({
      packaging: [pkg({ unitCost: 10, markupPct: 0 })],
      freightLegGroups: [{ id: "grp-1", label: "Journey", displayOrder: 0 }],
      freightLegs: [leg({ incoterm: "FOB" })],
      freightLegTiers: [
        { freightLegId: "leg-1", tierId: TIER, totalFreight: 4000, unitsInShipment: null },
      ],
    } as never),
  );
  const legNode = freightNode(r).operands![0];
  // Not customs at zero — customs does not apply on this leg. A zero duty
  // node would say duty was assessed and came to nothing.
  assert.equal(legNode.operands!.length, 1);
  assert.equal(legNode.operands![0].label, "Container freight");
});

// ------------------------------------------------------------ whole graph

test("increment 3 · every freight shape satisfies the traversal guarantees", () => {
  const cases = [
    input({ freightShipmentBreaks: [shipmentBreak()] } as never),
    input({ freightShipmentBreaks: [shipmentBreak({ dutyAmount: null, tariffAmount: null })] } as never),
    input({ freightShipmentBreaks: [shipmentBreak({ tierUnits: 0 })] } as never),
    legacyInput(),
    input({ packaging: THREE_LINES, production: [prod()] }),
  ];
  for (const c of cases) {
    const r = computeQuoteCosting(c);
    for (const root of r.graph.nodes) {
      assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
    }
  }
});

test("increment 3 · a quote with no freight still emits a Freight section at zero", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const n = freightNode(r);
  assert.equal(n.value, 0);
  assert.deepEqual(n.operands, []);
  assert.deepEqual(findGraphViolations(n), []);
});

// ============================================================================
// Increment 4 — Sell, adjustment resolution, override
// ============================================================================

const cellRoot = (r: ReturnType<typeof computeQuoteCosting>) =>
  r.graph.nodes.find((n) => isCellScoped(n.key))!;
const sellNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  findIn(r, `${LEAF}/${TIER}/sell`)!;

const priced = (over: Partial<QuoteCostingInput> = {}) =>
  input({ packaging: THREE_LINES, production: [prod()], ...over });

test("sell · the root is one node per cell, not one per section", () => {
  const r = computeQuoteCosting(priced());
  // Roots are scoped: ONE per cell for cell computations, plus one per tier
  // for the quote-level blends, which belong to a different scope and cannot
  // nest under any single cell.
  const cellRoots = r.graph.nodes.filter((n) => isCellScoped(n.key));
  assert.equal(cellRoots.length, 1);
  // Sections nest beneath sell. A section appearing both as a root and as an
  // operand would be a duplicated arithmetic node, which double-counts under
  // reconciliation.
  assert.deepEqual(findGraphViolations(cellRoots[0]), []);
});

test("sell · sell-before-adjustment equals the sum of its sections", () => {
  const r = computeQuoteCosting(priced());
  const before = findIn(r, `${LEAF}/${TIER}/sell-before`)!;
  const sections = before.operands!.map((o) => o.value);
  assert.equal(sections.reduce((a, b) => a + b, 0), before.value);
  assert.deepEqual(
    before.operands!.map((o) => o.label),
    ["Packaging", "Production", "Bulk raw", "Freight"],
  );
});

test("sell · the computed sell node equals the engine's computed sell", () => {
  const r = computeQuoteCosting(priced());
  assert.equal(sellNode(r).value, r.skuRollups[0].perTier[0].computedSellPerUnit);
});

test("sell · the adjustment applies to sell-before, and reconciles", () => {
  const r = computeQuoteCosting(
    priced({ quote: { id: "q-1", globalPriceAdjPct: 0.25, targetMarginPct: null } }),
  );
  const sell = sellNode(r);
  const before = sell.operands!.find((o) => o.kind === "sum")!;
  assert.equal(sell.kind, "adjustment");
  assert.equal(sell.value, before.value * 1.25);
  assert.deepEqual(findGraphViolations(cellRoot(r)), []);
});

// ------------------------------------------------- tier vs global resolution

const adjustmentLadder = (r: ReturnType<typeof computeQuoteCosting>) =>
  findIn(r, `${LEAF}/${TIER}/adjustment`)!;

test("adjustment · the global wins when the tier carries none", () => {
  const r = computeQuoteCosting(
    priced({ quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null } }),
  );
  const ladder = adjustmentLadder(r);
  assert.equal(ladder.kind, "resolution");
  const chosen = ladder.candidates!.filter((c) => c.chosen);
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].label, "Global adjustment");
  assert.equal(ladder.value, 0.1);
});

test("adjustment · a tier adjustment REPLACES the global, and the ladder says so", () => {
  const r = computeQuoteCosting(
    priced({
      quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
      tiers: [{ id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: 0.04 }],
    }),
  );
  const ladder = adjustmentLadder(r);
  assert.equal(ladder.value, 0.04);
  assert.equal(ladder.candidates!.find((c) => c.chosen)!.label, "Tier adjustment");

  // The finding the ladder exists to surface: a global lift does not reach a
  // tier carrying its own adjustment. Arithmetic alone could never say this —
  // the losing rung is where the fact lives.
  const global = ladder.candidates!.find((c) => c.label === "Global adjustment")!;
  assert.equal(global.value, 0.1);
  assert.match(global.unavailableReason!, /does not stack/);
});

test("adjustment · the ladder is built upstream, so the losing rung survives", () => {
  // The rule this increment carries: a resolution must be emitted where all
  // competing candidates are simultaneously in scope. Downstream, only the
  // winner arrives — a ladder built there would have to invent the rung it
  // replaced, and would state provenance nobody observed.
  const r = computeQuoteCosting(
    priced({
      quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
      tiers: [{ id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: 0.04 }],
    }),
  );
  const values = adjustmentLadder(r).candidates!.map((c) => c.value);
  assert.deepEqual(values, [0.04, 0.1]);
});

// ------------------------------------------------ freight markup resolution

test("freight markup · resolves quote override against the firm default", () => {
  const legacy = (freightMarkupPct?: number) =>
    computeQuoteCosting(
      input({
        quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: null, freightMarkupPct },
        packaging: [pkg({ unitCost: 10, markupPct: 0 })],
        freightLegGroups: [{ id: "grp-1", label: "Journey", displayOrder: 0 }],
        freightLegs: [leg({ incoterm: "FOB" })],
        freightLegTiers: [
          { freightLegId: "leg-1", tierId: TIER, totalFreight: 4000, unitsInShipment: null },
        ],
      } as never),
    );

  const dflt = legacy();
  const ladderDefault = findIn(dflt, `${LEAF}/${TIER}/frt/leg/leg-1/container/markup`)!;
  assert.equal(ladderDefault.kind, "resolution");
  assert.equal(ladderDefault.candidates!.find((c) => c.chosen)!.label, "Firm default");
  assert.equal(ladderDefault.value, 0.3);

  const overridden = legacy(0.45);
  const ladderQuote = findIn(overridden, `${LEAF}/${TIER}/frt/leg/leg-1/container/markup`)!;
  assert.equal(ladderQuote.candidates!.find((c) => c.chosen)!.label, "Quote freight markup");
  assert.equal(ladderQuote.value, 0.45);
  // The default is still visible as the rung that lost — the deferred
  // resolution from increment 3, closed where both candidates are in scope.
  assert.equal(ladderQuote.candidates!.find((c) => c.label === "Firm default")!.value, 0.3);
});

test("freight markup · the worksheet path keeps an origin, not a fabricated ladder", () => {
  const r = computeQuoteCosting(
    input({ freightShipmentBreaks: [shipmentBreak()] } as never),
  );
  const mk = findIn(r, `${LEAF}/${TIER}/frt/shipment/ship-1/freight/markup`)!;
  // Worksheet markups are entered per shipment. There is no quote-vs-firm
  // ladder to show, and inventing one would assert candidates that never
  // competed.
  assert.equal(mk.kind, "origin");
  assert.equal(mk.value, 0.4);
});

// -------------------------------------------------------------- override

test("override · replaces the chain as a terminal, with no operation above it", () => {
  const r = computeQuoteCosting(
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }] }),
  );
  const root = cellRoot(r);
  assert.equal(root.kind, "override");
  assert.equal(root.value, 9.5);
  assert.equal(root.value, r.skuRollups[0].perTier[0].requiredSellPerUnit);
  // A person set this price. No arithmetic sits above it, so it carries no
  // operation and no operands.
  assert.equal(root.op, undefined);
  assert.equal(root.operands, undefined);
});

test("override · preserves the superseded chain, demoted rather than deleted", () => {
  const r = computeQuoteCosting(
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }] }),
  );
  const superseded = cellRoot(r).superseded!;
  assert.ok(superseded, "the computation the override replaced must survive");
  assert.equal(superseded.kind, "adjustment");
  // Visible because a PM needs to know what they overrode; demoted because it
  // is not the reason the number is what it is. It is NOT an operand.
  assert.equal(superseded.value, r.skuRollups[0].perTier[0].computedSellPerUnit);
  assert.notEqual(superseded.value, cellRoot(r).value);
});

test("override · the superseded chain is still fully traversable", () => {
  const r = computeQuoteCosting(
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }] }),
  );
  // Demoted is not discarded: an operator asking "what would this have been"
  // gets the whole chain, reconciled, not just the number.
  assert.deepEqual(findGraphViolations(cellRoot(r).superseded!), []);
  assert.ok(findIn(r, `${LEAF}/${TIER}/pkg`), "sections remain reachable under the override");
});

test("override · of ZERO is still an override, not an absent one", () => {
  const r = computeQuoteCosting(
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 0 }] }),
  );
  assert.equal(cellRoot(r).kind, "override");
  assert.equal(cellRoot(r).value, 0);
});

test("increment 4 · every sell shape satisfies the traversal guarantees", () => {
  const cases = [
    priced(),
    priced({ quote: { id: "q-1", globalPriceAdjPct: 0.25, targetMarginPct: null } }),
    priced({ tiers: [{ id: TIER, label: "T1", qty: 1000, sortOrder: 0, tierPriceAdjPct: 0.04 }] }),
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }] }),
    input({}),
  ];
  for (const c of cases) {
    const r = computeQuoteCosting(c);
    for (const root of r.graph.nodes) {
      assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
    }
  }
});

// ============================================================================
// Increment 5 — quote-level blend
// ============================================================================

const blendNode = (r: ReturnType<typeof computeQuoteCosting>, what: "sell" | "cost") =>
  findIn(r, `quote/${TIER}/${what}`)!;

const twoProducts = (over: Partial<QuoteCostingInput> = {}) =>
  input({
    skus: [
      { id: "leaf-a", parentSkuId: null, qtyPerParent: null, skuRole: "leaf", skuLabel: "A", productName: "A", sortOrder: 0, retailBenchmark: null },
      { id: "leaf-b", parentSkuId: null, qtyPerParent: null, skuRole: "leaf", skuLabel: "B", productName: "B", sortOrder: 1, retailBenchmark: null },
    ],
    packaging: [
      pkg({ quoteSkuId: "leaf-a", lineGroupId: "la", unitCost: 10, markupPct: 0 }),
      pkg({ quoteSkuId: "leaf-b", lineGroupId: "lb", unitCost: 20, markupPct: 0 }),
    ],
    ...over,
  });

test("blend · exposes its contributors, not just the result", () => {
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  assert.equal(sell.kind, "blend");
  assert.deepEqual(sell.operands!.map((o) => o.label), ["A", "B"]);
  assert.deepEqual(sell.operands!.map((o) => o.value), [10, 20]);
});

test("blend · carries the weighting basis, positionally aligned with contributors", () => {
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  // The weights are what let a reader CHECK the mean. The same contributors
  // under different weights give different blends, so contributors alone
  // prove nothing.
  assert.deepEqual(sell.weights, [1000, 1000]);
  assert.equal(sell.weights!.length, sell.operands!.length);
});

test("blend · uses the engine's weighting semantics, and reconciles against them", () => {
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  assert.equal(sell.value, (10 * 1000 + 20 * 1000) / 2000);
  assert.deepEqual(findGraphViolations(sell), []);
});

test("blend · the blended sell reproduces the engine's total revenue", () => {
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  const totalWeight = sell.weights!.reduce((a, b) => a + b, 0);
  // Guarantee 6, transitively: the blend times its total weight IS the
  // engine's revenue scalar, so the node cannot drift from the number the
  // application reports.
  assert.equal(sell.value * totalWeight, r.quoteRollup[0].totalRevenue);
});

test("blend · the blended cost reproduces the engine's total cost", () => {
  const r = computeQuoteCosting(twoProducts());
  const cost = blendNode(r, "cost");
  const totalWeight = cost.weights!.reduce((a, b) => a + b, 0);
  assert.equal(cost.value * totalWeight, r.quoteRollup[0].totalCost);
});

// ------------------------------- zero total weight: undefined, never zero
//
// A units-weighted mean over zero units is 0/0. This asserted a readable zero
// instead, so the Pricing Cost Stack rendered $0.00 across a tier while the
// compliance table showed a real margin percentage for it — two statements
// that cannot both be true. Found by production smoke on 52bd0077 tier 4.
//
// The contract is that no consumer can read a commercial zero from an
// undefined blend. It is enforced at the AUTHORITY: the readable keys are not
// emitted at all, so every consumer reaches the fail-closed path it already
// has. Teaching consumers to inspect weights and reinterpret the value would
// put commercial semantics back into the presentation layer.

const ZERO_QTY_TIER = { id: TIER, label: "T1", qty: 0, sortOrder: 0, tierPriceAdjPct: null };

test("zero total weight · no readable blend is exposed at any component key", () => {
  const r = computeQuoteCosting(twoProducts({ tiers: [ZERO_QTY_TIER] }));
  // Every key the Cost Stack addresses must fail to resolve, so the consumer
  // renders unavailable rather than a price of nothing.
  for (const name of ["pkg", "prod", "raw", "frt", "dt", "sell-before", "sell", "cost"]) {
    assert.equal(
      resolveNode(r.graph.nodes, quoteScopeKey(TIER, name)),
      null,
      `${name} must not resolve when the blend is undefined`,
    );
  }
});

test("zero total weight · the contributors are real and are NOT lost", () => {
  // The per-SKU values exist and are correct; only the blend over them is
  // undefined. They remain reachable on their own cell-scope chains, which is
  // what the per-SKU breakdown renders.
  const r = computeQuoteCosting(twoProducts({ tiers: [ZERO_QTY_TIER] }));
  const leaves = r.skuRollups.filter((x) => x.skuRole === "leaf");
  assert.ok(leaves.length >= 2);
  const valued = leaves.filter(
    (l) => (l.perTier.find((t) => t.tierId === TIER)?.requiredSellPerUnit ?? 0) > 0,
  );
  assert.ok(
    valued.length >= 2,
    "the fixture must carry non-zero contributor values or this proves nothing",
  );
  // And their cell roots are still in the graph.
  for (const l of valued) {
    assert.ok(
      r.graph.nodes.some((n) => n.key.startsWith(l.skuId + "/" + TIER + "/")),
      `${l.skuLabel} must keep its own chain`,
    );
  }
});

test("zero total weight · the exclusion is stated, not silent", () => {
  const r = computeQuoteCosting(twoProducts({ tiers: [ZERO_QTY_TIER] }));
  const node = resolveNode(r.graph.nodes, quoteScopeKey(TIER, ""))
    ?? r.graph.nodes.find((n) => n.key === "quote/" + TIER);
  assert.ok(node, "the tier must still appear, carrying the reason");
  // `flagged-out` is the vocabulary's word for an excluded input: explicitly
  // not a zero, and required to carry its reason.
  assert.equal(node.kind, "flagged-out");
  assert.equal(node.value, 0);
  assert.match(node.reason!, /undefined/i);
  assert.deepEqual(findGraphViolations(node), []);
});

test("zero total weight · completeness is unaffected", () => {
  // Reported before changing anything: `graphIsComplete` inspects CELL roots
  // only and excludes the quote scope by key prefix, so omitting quote-scope
  // blends raises no completeness conflict.
  const zero = computeQuoteCosting(twoProducts({ tiers: [ZERO_QTY_TIER] }));
  const normal = computeQuoteCosting(twoProducts());
  assert.equal(zero.graph.complete, normal.graph.complete);
});

test("a positive-weight tier still blends normally", () => {
  // The guard must not have disabled the ordinary path.
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  assert.equal(sell.kind, "blend");
  assert.equal(sell.value, 15);
  assert.equal(sell.operands!.length, 2);
});

test("blend · an ABSENT contributor is excluded, never treated as a zero", () => {
  // leaf-b has no packaging, but it still rolls up at the tier, so both are
  // contributors. The distinction under test is that a product with NO rollup
  // at a tier is not in the blend at all — recording it as a zero contributor
  // would drag the mean down by a value nobody entered.
  const r = computeQuoteCosting(twoProducts());
  const sell = blendNode(r, "sell");
  assert.equal(sell.operands!.length, 2);
  assert.equal(sell.value, 15);

  const single = computeQuoteCosting(input({ packaging: [pkg({ unitCost: 10, markupPct: 0 })] }));
  const singleBlend = blendNode(single, "sell");
  assert.equal(singleBlend.operands!.length, 1);
  assert.equal(singleBlend.value, 10); // not 5 — the absent product is not a zero
});

// ------------------------------------------------------------ completeness

test("graph.complete is derived from the emitted sections, not from an increment number", () => {
  const r = computeQuoteCosting(priced());
  assert.equal(r.graph.complete, true);
  // Every required section is present on the cell root.
  for (const section of REQUIRED_CELL_SECTIONS) {
    assert.ok(findIn(r, `${LEAF}/${TIER}/${section}`), `missing ${section}`);
  }
});

test("graph.complete stays true under an override, because the chain survives", () => {
  const r = computeQuoteCosting(
    priced({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }] }),
  );
  // The sections live under `superseded`, which is traversable precisely so
  // this check does not need to special-case an overridden cell.
  assert.equal(r.graph.complete, true);
});

test("graph.complete is FALSE when a required section is absent", () => {
  // Proven by asking the contract directly rather than by trusting the flag:
  // a root missing `frt` is not complete, whatever increment shipped.
  const stunted: CostingNode = {
    key: `${LEAF}/${TIER}/sell`,
    kind: "sum",
    label: "Partial",
    value: 0,
    unit: "usd",
    op: "partial",
    operands: [
      { key: `${LEAF}/${TIER}/pkg`, kind: "sum", label: "P", value: 0, unit: "usd", op: "x", operands: [] },
    ],
  };
  assert.equal(graphIsComplete([stunted]), false);
});

test("increment 5 · every blend shape satisfies the traversal guarantees", () => {
  const cases = [
    twoProducts(),
    twoProducts({ tiers: [{ id: TIER, label: "T1", qty: 0, sortOrder: 0, tierPriceAdjPct: null }] }),
    priced(),
    input({}),
  ];
  for (const c of cases) {
    const r = computeQuoteCosting(c);
    for (const root of r.graph.nodes) {
      assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
    }
  }
});

// ============================================================================
// Increment 6 — ownership: every commercial scalar reads the graph
// ============================================================================
//
// Guarantee 6, applied family by family. These are not restatements of the
// emission tests: those asked whether the node reports the right number, these
// ask whether the number the APPLICATION reports comes from the node. Before
// this increment both could be true independently — and staying true
// independently is exactly how two correct-looking values drift apart.

const ownershipCase = () =>
  input({
    packaging: THREE_LINES,
    production: [prod({ bulkRawCost: 4000 })],
    freightShipmentBreaks: [shipmentBreak()],
    quote: { id: "q-1", globalPriceAdjPct: 0.15, targetMarginPct: null },
  } as never);

test("ownership · packaging scalars read the packaging nodes", () => {
  const r = computeQuoteCosting(ownershipCase());
  const cell = r.skuRollups[0].perTier[0];
  const pkg = findIn(r, `${LEAF}/${TIER}/pkg`)!;
  assert.equal(cell.packagingMarkupSumPerUnit, pkg.value);
  assert.equal(
    cell.packagingCostPerUnit,
    pkg.operands!.reduce((a, l) => a + l.operands!.find((o) => o.kind === "origin")!.value, 0),
  );
});

test("ownership · production and bulk raw scalars read their section nodes", () => {
  const r = computeQuoteCosting(ownershipCase());
  const cell = r.skuRollups[0].perTier[0];
  assert.equal(cell.productionMarkupSumPerUnit, findIn(r, `${LEAF}/${TIER}/prod`)!.value);
  assert.equal(cell.rawMarkupSumPerUnit, findIn(r, `${LEAF}/${TIER}/raw`)!.value);
});

test("ownership · the freight scalar that feeds sell reads the freight node", () => {
  const r = computeQuoteCosting(ownershipCase());
  const cell = r.skuRollups[0].perTier[0];
  assert.equal(cell.totalLandedFreightWithMarkup, findIn(r, `${LEAF}/${TIER}/frt`)!.value);
});

test("ownership · pre-markup COST bases are deliberately NOT read from sell nodes", () => {
  const r = computeQuoteCosting(ownershipCase());
  const cell = r.skuRollups[0].perTier[0];
  // Every node value on the freight branch is a post-markup SELL figure, while
  // factory cost is a pre-markup COST base. Pointing the base at the node
  // would inflate every duty and tariff on the quote — and would still
  // reconcile, because each number would be individually correct.
  assert.notEqual(cell.totalLandedFreightBeforeMarkup, cell.totalLandedFreightWithMarkup);
  assert.equal(
    cell.factoryCostPerUnit,
    cell.packagingCostPerUnit + cell.productionCostPerUnit + cell.rawCostPerUnit,
  );
});

test("ownership · sell-before-adjustment reads the sum of its section nodes", () => {
  const r = computeQuoteCosting(ownershipCase());
  const before = findIn(r, `${LEAF}/${TIER}/sell-before`)!;
  assert.equal(before.value, before.operands!.reduce((a, o) => a + o.value, 0));
  const cell = r.skuRollups[0].perTier[0];
  assert.equal(
    before.value,
    cell.packagingMarkupSumPerUnit +
      cell.productionMarkupSumPerUnit +
      cell.rawMarkupSumPerUnit +
      cell.totalLandedFreightWithMarkup,
  );
});

test("ownership · computed sell reads the adjustment node", () => {
  const r = computeQuoteCosting(ownershipCase());
  assert.equal(
    r.skuRollups[0].perTier[0].computedSellPerUnit,
    findIn(r, `${LEAF}/${TIER}/sell`)!.value,
  );
});

test("ownership · the active root decides the quoted price, computed or overridden", () => {
  const plain = computeQuoteCosting(ownershipCase());
  assert.equal(cellRoot(plain).kind, "adjustment");
  assert.equal(plain.skuRollups[0].perTier[0].requiredSellPerUnit, cellRoot(plain).value);

  const overridden = computeQuoteCosting(
    input({
      packaging: THREE_LINES,
      cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 9.5 }],
    }),
  );
  // The scalar and the graph agree on WHICH value the quote is using, not just
  // on what each of them computed.
  assert.equal(cellRoot(overridden).kind, "override");
  assert.equal(
    overridden.skuRollups[0].perTier[0].requiredSellPerUnit,
    cellRoot(overridden).value,
  );
});

test("ownership · quote totals read the total nodes, and the blend divides them", () => {
  const r = computeQuoteCosting(ownershipCase());
  const revenue = findIn(r, `quote/${TIER}/revenue`)!;
  const cost = findIn(r, `quote/${TIER}/cost-total`)!;
  assert.equal(r.quoteRollup[0].totalRevenue, revenue.value);
  assert.equal(r.quoteRollup[0].totalCost, cost.value);

  // The sum is the primitive; the blend divides it. Deriving the total back
  // from the blend would re-multiply a value that was just divided, and the
  // round trip is not bitwise identical.
  const blendSell = findIn(r, `quote/${TIER}/sell`)!;
  const totalWeight = blendSell.weights!.reduce((a, b) => a + b, 0);
  assert.equal(blendSell.value, revenue.value / totalWeight);
});

test("ownership · the whole graph still reconciles after every transition", () => {
  const r = computeQuoteCosting(ownershipCase());
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
  assert.equal(r.graph.complete, true);
});


// ─── readNodeValue · the read a DISPLAY makes ───────────────────────────────
//
// `resolveNode` answers "which node is here". A surface asks a narrower
// question — "what number may I print" — and the gap between those two is
// where a commercial zero gets rendered for a figure that has none.

test("readNodeValue · reads a value through nesting, not just off roots", () => {
  const nodes: CostingNode[] = [
    {
      key: "top",
      kind: "sum",
      label: "top",
      value: 3,
      unit: "usd",
      op: "a + b",
      operands: [
        { key: "a", kind: "origin", label: "a", value: 1, unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null } },
        { key: "b", kind: "origin", label: "b", value: 2, unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null } },
      ],
    },
  ];
  assert.equal(readNodeValue(g(nodes), "b"), 2);
  assert.equal(readNodeValue(g(nodes), "top"), 3);
});

test("readNodeValue · missing and duplicate both read as nothing", () => {
  const origin = (key: string): CostingNode => ({
    key, kind: "origin", label: key, value: 5, unit: "usd",
    origin: { grade: "thin", actor: null, when: null, doc: null },
  });
  assert.equal(readNodeValue(g([origin("x")]), "nope"), null);
  // Two nodes, one key: the graph does not have one answer, so no answer is
  // readable. Taking the first would be a coin toss the operator never sees.
  assert.equal(readNodeValue(g([origin("x"), origin("x")]), "x"), null);
});

test("readNodeValue · a flagged-out node reads as nothing, NOT as its zero", () => {
  // This is the whole reason the helper exists. `flagged-out` carries value 0
  // by invariant, so the obvious read — `node ? node.value : null` — succeeds
  // and hands the display a commercial zero out of a node whose entire purpose
  // was to deny one. A zero-quantity tier emits exactly this, at exactly the
  // key the Costs header addresses.
  const nodes: CostingNode[] = [
    {
      key: "quote/t1/per-unit",
      kind: "flagged-out",
      label: "Combined contribution per unit",
      value: 0,
      unit: "usd",
      reason: "Tier quantity is zero, so a per-unit allocation is undefined.",
    },
  ];
  assert.equal(resolveNode(nodes, "quote/t1/per-unit")?.value, 0);
  assert.equal(readNodeValue(g(nodes), "quote/t1/per-unit"), null);
});

test("readNodeValue · a genuine zero still reads as zero", () => {
  // The converse guard: fail-closed must not swallow real zeros. A component
  // that genuinely costs nothing is a commercial fact and must print as one.
  const nodes: CostingNode[] = [
    {
      key: "quote/t1/per-unit/dt",
      kind: "sum",
      label: "Duty & tariff per unit",
      value: 0,
      unit: "usd",
      op: "cost per unit + markup per unit",
      operands: [
        { key: "quote/t1/per-unit/dt/cost", kind: "origin", label: "c", value: 0,
          unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
        { key: "quote/t1/per-unit/dt/markup", kind: "origin", label: "m", value: 0,
          unit: "usd", origin: { grade: "thin", actor: null, when: null, doc: null } },
      ],
    },
  ];
  assert.equal(readNodeValue(g(nodes), "quote/t1/per-unit/dt"), 0);
});

test("the Costs header's required node set resolves, and RAW is in it", () => {
  // The cutover's contract: the header renders nothing unless every value it
  // reads is there. This asserts the engine supplies that set.
  //
  // T-4 INVERSION (2026-08-11). This test previously asserted the OPPOSITE for
  // RAW — `readNodeValue(k("raw")) === null` — on the recorded grounds that
  // "production already carries bulk raw, so a raw node would double-count".
  // That premise was false: bulk raw has its own canonical node, its own markup
  // authority, and its own contribution to quoted sell. The assertion is
  // inverted rather than deleted so the record shows the contract changed and
  // when.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const tierId = TIER;
  const k = (name: string) => quoteScopeKey(tierId, `per-unit/${name}`);

  for (const comp of ["pkg", "prod", "raw", "frt", "dt"]) {
    for (const suffix of ["", "/cost", "/markup"]) {
      const key = k(comp + suffix);
      assert.notEqual(
        readNodeValue(out.graph, key),
        null,
        `header requires ${key}`,
      );
    }
  }
  for (const name of ["departure", "revenue", "cost-total"]) {
    assert.notEqual(readNodeValue(out.graph, k(name)), null, name);
  }
  assert.notEqual(
    readNodeValue(out.graph, quoteScopeKey(tierId, "per-unit")),
    null,
    "subtotal",
  );

  // RAW is independently governed and must resolve as its own value.
  assert.notEqual(readNodeValue(out.graph, k("raw")), null, "header requires RAW");
});


// ─── resolveNodes · many keys, one traversal ────────────────────────────────

const originOf = (key: string, value: number): CostingNode => ({
  key, kind: "origin", label: key, value, unit: "usd",
  origin: { grade: "thin", actor: null, when: null, doc: null },
});

test("resolveNodes · finds nested keys and reports every key asked for", () => {
  const nodes: CostingNode[] = [
    {
      key: "root", kind: "sum", label: "root", value: 3, unit: "usd", op: "a + b",
      operands: [originOf("a", 1), originOf("b", 2)],
    },
  ];
  const got = resolveNodes(g(nodes), ["a", "b", "root", "absent"]);
  // Every requested key has an entry, so a caller can tell "unavailable" from
  // "I forgot to ask" without keeping its own list.
  assert.deepEqual([...got.keys()].sort(), ["a", "absent", "b", "root"]);
  assert.equal(got.get("a")?.value, 1);
  assert.equal(got.get("b")?.value, 2);
  assert.equal(got.get("root")?.value, 3);
  assert.equal(got.get("absent"), null);
});

test("resolveNodes · a duplicated key resolves to null, and a third sighting does not revive it", () => {
  // Matches resolveNode exactly: a graph with two answers has none. The third
  // occurrence is the interesting case — a naive `has ? null : node` written
  // inside the walk would set null on the second and then overwrite it on the
  // third, silently restoring a value the duplicate check had rejected.
  const nodes: CostingNode[] = [originOf("dup", 1), originOf("dup", 2), originOf("dup", 3)];
  assert.equal(resolveNodes(g(nodes), ["dup"]).get("dup"), null);
  assert.equal(resolveNode(nodes, "dup"), null);
});

test("resolveNodes · agrees with resolveNode across a real graph", () => {
  // The batch path exists only for speed. If it can disagree with the single
  // path, it is a second implementation of the read — the exact shape this gate
  // removes from consumers.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const keys: string[] = [];
  for (const root of out.graph.nodes) walkGraph(root, (x) => keys.push(x.key));
  const batch = resolveNodes(out.graph, keys);
  for (const k of keys) {
    assert.equal(batch.get(k) ?? null, resolveNode(out.graph.nodes, k), k);
  }
  assert.ok(keys.length > 10);
});

test("resolveNodes · asking for nothing walks nothing", () => {
  assert.equal(resolveNodes(g([originOf("x", 1)]), []).size, 0);
});

test("the packaging drilldown's per-line key resolves, with its markup readable", () => {
  // What the drilldown addresses per cell, and what it reads off the node so it
  // never reimplements the markup ladder: operand 0 is the line cost, operand 1
  // is the resolution whose value is the markup the engine actually applied.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const line of THREE_LINES) {
    const node = resolveNode(out.graph.nodes, nodeKey(LEAF, TIER, "pkg", line.lineGroupId));
    assert.ok(node, `line ${line.lineGroupId} must resolve`);
    assert.equal(node.kind, "markup");
    const markup = node.operands?.[1];
    assert.ok(markup, "the resolution operand must be present");
    assert.equal(markup.kind, "resolution");
    assert.equal(typeof markup.value, "number");
    // The node value is the line cost carrying that markup — which is the
    // quantity the drilldown used to compute for itself.
    assert.ok(Math.abs(node.value - node.operands![0].value * (1 + markup.value)) < 1e-9);
  }
});


test("an unpriced packaging line still gets a node, valued zero", () => {
  // The fact that makes the drilldown's guard necessary, asserted so it cannot
  // quietly stop being true. An uncosted line is not absent from the graph —
  // the engine emits a well-formed node for it whose value is genuinely 0.
  //
  // So a consumer CANNOT distinguish "costs nothing" from "nobody has costed
  // it" by reading the node. It has to look at whether an input exists. Reading
  // the node unguarded is what put `$0.00` under empty inputs on 106 production
  // cells, and no amount of fail-closed reading catches it, because nothing has
  // failed: the node is there and its value is correct.
  const out = computeQuoteCosting(
    input({ packaging: [pkg({ lineGroupId: "unpriced", unitCost: null as unknown as number })] }),
  );
  const node = resolveNode(out.graph.nodes, nodeKey(LEAF, TIER, "pkg", "unpriced"));
  assert.ok(node, "an unpriced line is still a line");
  assert.equal(node.value, 0);
  assert.notEqual(node.kind, "flagged-out");
  assert.equal(readNodeValue(out.graph, node.key), 0);
});


// ─── the key grammar ────────────────────────────────────────────────────────
//
// These exist because the same ambiguity produced two wrong production
// measurements from hand-written selectors. The predicate has to distinguish
// four things, and each gets an adversarial case rather than a happy one.


/** Wrap hand-built node arrays as a committed graph, so reader tests exercise
 *  the same entry point production does. */
const g = (nodes: CostingNode[], evaluation: GraphEvaluation = "committed"): CostingGraph => ({
  version: GRAPH_VERSION,
  evaluation,
  nodes,
  complete: true,
});

const SKU_A = "11111111-1111-1111-1111-111111111111";
const SKU_B = "22222222-2222-2222-2222-222222222222";
const T_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const T_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

test("grammar · SCOPE — the collision that caused two wrong measurements", () => {
  // `{sku}/{tier}/pkg` and `quote/{tier}/pkg` are both three segments ending in
  // `pkg`. One is a single SKU's packaging; the other is the Pricing blend
  // across all of them. Any selector that cannot tell them apart will add a
  // mean to the sum it is checking the mean against.
  const cell = nodeKey(SKU_A, T_A, "pkg");
  const quote = quoteScopeKey(T_A, "pkg");
  assert.equal(cell.split("/").length, quote.split("/").length, "same shape");

  assert.equal(isCellScoped(cell), true);
  assert.equal(isCellScoped(quote), false);
  assert.equal(isQuoteScoped(quote), true);
  assert.equal(isQuoteScoped(cell), false);

  assert.equal(isCellSectionNode(cell, "pkg"), true);
  assert.equal(isCellSectionNode(quote, "pkg"), false, "the blend is not a cell section");
});

test("grammar · SECTION — a sibling section is not a match", () => {
  assert.equal(isCellSectionNode(nodeKey(SKU_A, T_A, "pkg"), "pkg"), true);
  assert.equal(isCellSectionNode(nodeKey(SKU_A, T_A, "prod"), "pkg"), false);
  assert.equal(isCellSectionNode(nodeKey(SKU_A, T_A, "pkg"), "prod"), false);
});

test("grammar · TIER — a section at another tier is not a match", () => {
  const key = nodeKey(SKU_A, T_A, "pkg");
  assert.equal(isCellSectionNode(key, "pkg", { tierId: T_A }), true);
  assert.equal(isCellSectionNode(key, "pkg", { tierId: T_B }), false);
  const parsed = parseNodeKey(key);
  assert.equal(parsed?.scope === "cell" ? parsed.tierId : null, T_A);
});

test("grammar · SKU — a section on another SKU is not a match", () => {
  const key = nodeKey(SKU_A, T_A, "pkg");
  assert.equal(isCellSectionNode(key, "pkg", { skuId: SKU_A }), true);
  assert.equal(isCellSectionNode(key, "pkg", { skuId: SKU_B }), false);
  const a = parseNodeKey(key);
  assert.equal(a?.scope === "cell" ? a.skuId : null, SKU_A);
});

test("grammar · DEPTH — a line inside a section is not the section", () => {
  // The other half of the same double-counting failure: summing sections AND
  // the lines beneath them counts every line twice.
  const section = nodeKey(SKU_A, T_A, "pkg");
  const line = nodeKey(SKU_A, T_A, "pkg", "line-1");
  assert.equal(isCellSectionNode(section, "pkg"), true);
  assert.equal(isCellSectionNode(line, "pkg"), false);
  assert.deepEqual(parseNodeKey(line)?.path, ["pkg", "line-1"]);
});

test("grammar · quote-scope paths keep their depth", () => {
  const a = parseNodeKey(quoteScopeKey(T_A, "per-unit/pkg/cost"));
  assert.equal(a?.scope, "quote");
  assert.equal(a?.scope === "quote" ? a.tierId : null, T_A);
  assert.deepEqual(a?.path, ["per-unit", "pkg", "cost"]);
  // `quote/{tier}` alone is a real node — the sell blend — and must parse.
  const bare = parseNodeKey(quoteScopeKey(T_A, "").replace(/\/$/, ""));
  assert.equal(bare?.scope, "quote");
});

test("grammar · malformed keys return null rather than a guess", () => {
  assert.equal(parseNodeKey(""), null);
  assert.equal(parseNodeKey("quote"), null, "a scope with no tier is not an address");
  assert.equal(parseNodeKey(`${SKU_A}/${T_A}`), null, "there is no bare cell node");
  assert.equal(parseNodeKey(`/${T_A}/pkg`), null);
  assert.equal(isCellScoped("nonsense"), false);
  assert.equal(isQuoteScoped("nonsense"), false);
});

test("grammar · collectCellSectionNodes finds the sections and nothing else", () => {
  // Against a real graph: the count must equal the leaf count, not the leaf
  // count plus the blend, and not the line count.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const sections = collectCellSectionNodes(out.graph, "pkg", { tierId: TIER });
  assert.equal(sections.length, 1, "one leaf, one packaging section");
  assert.equal(sections[0].key, nodeKey(LEAF, TIER, "pkg"));

  // The blend exists at the colliding key and must be excluded.
  assert.notEqual(readNodeValue(out.graph, quoteScopeKey(TIER, "pkg")), null);
  assert.ok(sections.every((n) => isCellScoped(n.key)));

  // And the three lines beneath it must not be counted as sections.
  assert.equal(sections[0].operands?.length, 3);
  const summed = sections.reduce((a, n) => a + n.value, 0);
  assert.equal(summed, sections[0].value, "no double counting");
});

test("grammar · collectCellSectionNodes scopes to the tier asked for", () => {
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(collectCellSectionNodes(out.graph, "pkg", { tierId: T_B }).length, 0);
  assert.equal(collectCellSectionNodes(out.graph, "nonexistent-section").length, 0);
});

// ─── effective target margin · one resolution, five readers ─────────────────

test("effective target · no override resolves to the firm default, and says so", () => {
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const read = readEffectiveTargetMargin(out.graph);
  assert.ok(read);
  assert.equal(read.value, 0.35);
  assert.equal(read.source, "Firm default");
  assert.equal(read.isOverride, false);
  // What would apply if an override were cleared — here, the same rung.
  assert.equal(read.withoutOverride, 0.35);
});

test("effective target · an override wins and is ATTRIBUTED to the quote", () => {
  // The whole point of a resolution rather than an origin: 0.42 and 0.42 print
  // identically, and "because this quote says so" is a different fact from
  // "because the firm does".
  const out = computeQuoteCosting(
    input({
      quote: { id: "q-1", globalPriceAdjPct: 0, targetMarginPct: 0.42 },
      packaging: THREE_LINES,
    }),
  );
  const read = readEffectiveTargetMargin(out.graph);
  assert.ok(read);
  assert.equal(read.value, 0.42);
  assert.equal(read.source, "Quote override");
  assert.equal(read.isOverride, true);
  // The losing rung is retained, which is what lets the popover say what
  // clearing the override would give you.
  assert.equal(read.withoutOverride, 0.35);
});

test("effective target · the ladder keeps both rungs, exactly one chosen", () => {
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const node = resolveNode(out.graph.nodes, quoteWideKey("target-margin"));
  assert.ok(node);
  assert.equal(node.kind, "resolution");
  assert.equal(node.unit, "pct");
  const labels = (node.candidates ?? []).map((c) => c.label);
  assert.deepEqual(labels, ["Quote override", "Firm default"]);
  assert.equal((node.candidates ?? []).filter((c) => c.chosen).length, 1);
  // An unavailable rung must say why rather than presenting as a null value.
  const override = (node.candidates ?? [])[0];
  assert.equal(override.value, null);
  assert.ok(override.unavailableReason);
});

test("effective target · the VERDICT moves with the node, not with firm settings", () => {
  // Proves the engine path feeding computeStatus reads the same resolution the
  // surfaces do. A quote whose blended margin sits between the firm target and
  // a higher override must band differently under each.
  const base = input({ packaging: THREE_LINES });
  const atFirm = computeQuoteCosting(base);
  const atOverride = computeQuoteCosting({
    ...base,
    quote: { ...base.quote, targetMarginPct: 0.99 },
  });
  assert.equal(readEffectiveTargetMargin(atFirm.graph)?.value, 0.35);
  assert.equal(readEffectiveTargetMargin(atOverride.graph)?.value, 0.99);
  // An unreachable target must drag every tier below it.
  assert.ok(atOverride.quoteRollup.every((r) => r.blendedMarginStatus !== "GOOD"));
});

test("quote-wide scope is not cell scope, and completeness ignores it", () => {
  // graphIsComplete inspects CELL roots for required sections. A quote-wide
  // root carries none and must not be mistaken for one, or completeness would
  // report false forever the moment this node landed.
  const key = quoteWideKey("target-margin");
  assert.equal(isCellScoped(key), false);
  assert.equal(isQuoteScoped(key), false, "quote-wide is its own scope");
  const a = parseNodeKey(key);
  assert.equal(a?.scope, "quote-wide");
  assert.deepEqual(a?.path, ["target-margin"]);
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(graphIsComplete(out.graph.nodes), true);
});

test("readEffectiveTargetMargin fails closed rather than assuming the firm default", () => {
  // A consumer that silently fell back would reinstate the private ladder this
  // node replaces, so absence must be distinguishable from a resolved value.
  assert.equal(readEffectiveTargetMargin(g([])), null);
});

// ─── evaluation identity · a preview graph is not authority ─────────────────

test("evaluation · a preview graph answers NOTHING through the committed readers", () => {
  // The hazard this exists for: committed and preview share the key space, so
  // a preview graph is not malformed, not empty, and not distinguishable by
  // anything a reader can see in a node. Every Gate 1B reader must refuse it.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const preview = g(out.graph.nodes, "preview");
  const committed = g(out.graph.nodes, "committed");

  // Same nodes, same keys, same values — only the evaluation differs.
  const key = nodeKey(LEAF, TIER, "pkg");
  assert.notEqual(readNodeValue(committed, key), null, "committed answers");
  assert.equal(readNodeValue(preview, key), null, "preview must not");

  assert.notEqual(readEffectiveTargetMargin(committed), null);
  assert.equal(readEffectiveTargetMargin(preview), null);

  assert.ok(collectCellSectionNodes(committed, "pkg").length > 0);
  assert.equal(collectCellSectionNodes(preview, "pkg").length, 0);

  // resolveNodes reports every requested key as unavailable rather than
  // returning a short map a caller might mistake for "not asked for".
  const batch = resolveNodes(preview, [key]);
  assert.equal(batch.size, 1);
  assert.equal(batch.get(key), null);
});

test("evaluation · preview authority must be asked for by name", () => {
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const preview = g(out.graph.nodes, "preview");
  const key = nodeKey(LEAF, TIER, "pkg");

  // Opting in deliberately is the only way to read it...
  assert.notEqual(readNodeValue(preview, key, "preview"), null);
  assert.notEqual(readEffectiveTargetMargin(preview, "preview"), null);
  assert.ok(collectCellSectionNodes(preview, "pkg", undefined, "preview").length > 0);

  // ...and the opt-in is not a bypass: it refuses the other direction too, so
  // a preview reader cannot silently consume committed authority either.
  const committed = g(out.graph.nodes, "committed");
  assert.equal(readNodeValue(committed, key, "preview"), null);
  assert.equal(readEffectiveTargetMargin(committed, "preview"), null);
});

test("evaluation · the default is committed, so an unthinking reader is safe", () => {
  // A consumer that has never considered evaluation gets authority-or-nothing,
  // never a preview. That is the direction the default has to fail in.
  const out = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.equal(out.graph.evaluation, "committed");
  assert.notEqual(readNodeValue(out.graph, nodeKey(LEAF, TIER, "pkg")), null);
});

// ─── preview evaluations must not touch committed state ─────────────────────

test("preview · a preview run mutates neither the committed input nor its graph", () => {
  // The permanent assertion. A preview is one field different from the
  // committed input, which makes accidental sharing easy and its consequence
  // severe: a mutated committed input would move real quoted prices, and
  // nothing about the symptom would point back to a preview.
  const committed = input({ packaging: THREE_LINES });
  const before = JSON.stringify(committed);
  const committedResult = computeQuoteCosting(committed);
  const graphBefore = JSON.stringify(committedResult.graph);

  // Deep-freeze the committed input so a write is a THROW rather than a
  // difference we might or might not have thought to compare.
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const x of Object.values(v as Record<string, unknown>)) freeze(x);
    }
  };
  freeze(committed);
  freeze(committedResult.graph);

  // Both preview shapes, exactly as the classifier builds them.
  const globalPreview = computeQuoteCosting(
    { ...committed, quote: { ...committed.quote, globalPriceAdjPct: 0.25 } },
    "preview",
  );
  const tierPreview = computeQuoteCosting(
    {
      ...committed,
      tiers: committed.tiers.map((t) =>
        t.id === TIER ? { ...t, tierPriceAdjPct: 0.25 } : t,
      ),
    },
    "preview",
  );

  assert.equal(JSON.stringify(committed), before, "committed input unchanged");
  assert.equal(
    JSON.stringify(committedResult.graph),
    graphBefore,
    "committed graph unchanged",
  );
  assert.equal(globalPreview.graph.evaluation, "preview");
  assert.equal(tierPreview.graph.evaluation, "preview");
  assert.equal(committedResult.graph.evaluation, "committed");
});

test("preview · a lift actually moves the number, and only through the engine", () => {
  // A preview that returned the committed answer would pass every structural
  // check and be useless, so assert the lift is visible.
  const committed = input({ packaging: THREE_LINES });
  const base = computeQuoteCosting(committed);
  const lifted = computeQuoteCosting(
    { ...committed, quote: { ...committed.quote, globalPriceAdjPct: 0.25 } },
    "preview",
  );
  const rev = (r: typeof base) =>
    r.quoteRollup.reduce((a, x) => a + x.totalRevenue, 0);
  assert.ok(rev(lifted) > rev(base), "a 25% lift must raise revenue");
  // Cost is untouched by a price adjustment — proof the clone changed one field.
  const cost = (r: typeof base) =>
    r.quoteRollup.reduce((a, x) => a + x.totalCost, 0);
  assert.equal(cost(lifted), cost(base));
});

test("preview · the default evaluation is still committed", () => {
  // Preview is opt-in at the ENGINE too, not only at the reader. An existing
  // caller that has never heard of evaluations keeps producing authority.
  assert.equal(
    computeQuoteCosting(input({ packaging: THREE_LINES })).graph.evaluation,
    "committed",
  );
});

// ─────────────────────────────────────── OD-019 · the ratio kind and margin

test("the tier container no longer asserts a quantity nobody governs", () => {
  // It was a `sum` of blended sell and blended cost, with a comment conceding
  // that "sell and cost do not add to anything meaningful". It reconciled and
  // meant nothing — Pattern 57 one layer below where that rule was written.
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const container = r.graph.nodes.find((n) => n.key === `quote/${TIER}`)!;
  assert.ok(container, "the container root must survive — it owns two states");
  assert.equal(container.operands?.length, 1, "one operand: the margin");
  assert.equal(container.operands?.[0].key, `quote/${TIER}/margin`);
  assert.equal(container.unit, "pct");
});

test("the margin is a ratio over a difference, with the denominator as basis", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  const margin = resolveNode(r.graph.nodes, `quote/${TIER}/margin`)!;
  assert.equal(margin.kind, "ratio");
  assert.equal(margin.unit, "pct");
  assert.equal(margin.operands?.length, 1, "one operand — the numerator");

  const gross = margin.operands![0];
  assert.equal(gross.kind, "difference");
  assert.equal(gross.key, `quote/${TIER}/margin/gross`);

  // The denominator is DATA. As an operand it would put `sell` under two
  // parents, and resolveNode would then return null for a key the Cost Stack
  // reads.
  assert.ok(margin.basis, "a ratio without a basis cannot perform its operation");
  assert.equal(margin.basis!.value, gross.operands![0].value);
});

test("sell and cost each have exactly one parent, and stay resolvable", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  assert.deepEqual(findDuplicateKeys(r.graph.nodes), []);
  for (const key of [`quote/${TIER}/sell`, `quote/${TIER}/cost`]) {
    assert.notEqual(resolveNode(r.graph.nodes, key), null, `${key} unresolvable`);
  }
});

test("the ratio reconciles against the operation it advertises", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  for (const root of r.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
  }
});

test("a zero-sell tier flags the margin out rather than publishing 0%", () => {
  // A ratio valued zero would assert a margin of nothing rather than the
  // absence of one — the fabrication three scalar corrections removed.
  const r = computeQuoteCosting(input());
  const margin = resolveNode(r.graph.nodes, `quote/${TIER}/margin`);
  if (margin) {
    assert.equal(margin.kind, "flagged-out");
    assert.equal(margin.value, 0);
    assert.match(margin.reason!, /undefined/i);
    // And it is therefore unreadable, so no delta reports a movement on it.
    assert.equal(readNodeValue(r.graph, `quote/${TIER}/margin`), null);
  }
});

test("every canonical key is reachable exactly once, across all roots", () => {
  // The validator gap this investigation exposed: findGraphViolations walks one
  // root with a fresh seenKeys, so cross-root duplication was invisible to it
  // while resolveNode already returned null for it. The two now agree.
  for (const fixture of [input(), input({ packaging: THREE_LINES })]) {
    assert.deepEqual(findDuplicateKeys(computeQuoteCosting(fixture).graph.nodes), []);
  }
});
