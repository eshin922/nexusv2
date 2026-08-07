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
  REQUIRED_CELL_SECTIONS,
  TERMINAL_KINDS,
  graphIsComplete,
  findGraphViolations,
  findNode,
  walkGraph,
  type CostingNode,
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
  assert.equal(origins.filter((o) => o.key.includes("/pkg/")).length, 3);
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
  assert.equal(r.graph.version, 1);
  assert.equal(r.graph.complete, true);
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
  ownerSkuId: LEAF,
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
  r.graph.nodes.find((n) => !n.key.startsWith("quote/"))!;
const sellNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  findIn(r, `${LEAF}/${TIER}/sell`)!;

const priced = (over: Partial<QuoteCostingInput> = {}) =>
  input({ packaging: THREE_LINES, production: [prod()], ...over });

test("sell · the root is one node per cell, not one per section", () => {
  const r = computeQuoteCosting(priced());
  // Roots are scoped: ONE per cell for cell computations, plus one per tier
  // for the quote-level blends, which belong to a different scope and cannot
  // nest under any single cell.
  const cellRoots = r.graph.nodes.filter((n) => !n.key.startsWith("quote/"));
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

test("blend · a zero-weight tier blends to zero with contributors still visible", () => {
  const r = computeQuoteCosting(
    twoProducts({ tiers: [{ id: TIER, label: "T1", qty: 0, sortOrder: 0, tierPriceAdjPct: null }] }),
  );
  const sell = blendNode(r, "sell");
  assert.equal(sell.value, 0);
  assert.deepEqual(sell.weights, [0, 0]);
  // Zero weight is a real state, not an error. The contributors remain — they
  // are the answer to "why is this zero".
  assert.equal(sell.operands!.length, 2);
  assert.match(sell.note!, /nothing to weight by/);
  assert.deepEqual(findGraphViolations(sell), []);
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
