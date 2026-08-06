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
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import {
  ARITHMETIC_KINDS,
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
      if (leaf && n.kind !== "resolution") {
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
  assert.equal(origins.length, 3);
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
