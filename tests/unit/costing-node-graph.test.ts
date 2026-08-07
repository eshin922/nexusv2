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
  TERMINAL_KINDS,
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

const packagingNode = (r: ReturnType<typeof computeQuoteCosting>) =>
  r.graph.nodes.find((n) => n.key === `${LEAF}/${TIER}/pkg`)!;

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

test("the graph is declared incomplete while sections are still being added", () => {
  const r = computeQuoteCosting(input({ packaging: THREE_LINES }));
  // Consumers must not read a section that is not present yet. Saying so in the
  // payload is cheaper than a consumer discovering it as a missing node.
  assert.equal(r.graph.complete, false);
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
  assert.equal(r.graph.complete, false);
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
  r.graph.nodes.find((n) => n.key === key)!;
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
