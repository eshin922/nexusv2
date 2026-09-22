/**
 * The shared packaging-line graph read.
 *
 * This is the read the Packaging drawer has always used and the M2 preview now
 * uses too. The defect it guards against is documented in its own header: the
 * drawer once recomputed `unit x (1 + markupPct ?? 0)` while the engine resolved
 * markup through a ladder, and on production the two disagreed on 15 of 283 line
 * nodes — every one a line with no category and no explicit markup, where the
 * engine applied the Other default of 30% and the display applied none.
 *
 * So the assertion that matters is not "the read returns a number". It is that
 * the read returns THE ENGINE'S number and the engine's chosen rung, including
 * on a line that states no markup of its own.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_PACKAGING_LINE_READ,
  packagingReadKey,
  readPackagingLineTiers,
} from "../../src/lib/costs/packaging-line-graph-read.ts";
import { nodeKey, type CostingGraph, type CostingNode } from "../../src/lib/costing-nodes.ts";

const LEAF = "ql-1";
const TIER = "tier-1";
const LG = "lg-1";

/** A packaging line node shaped exactly as the engine emits it. */
function lineNode(opts: {
  cost: number;
  markup: number;
  chosen: string;
  below?: { label: string; value: number };
}): CostingNode {
  const base = nodeKey(LEAF, TIER, "pkg", LG);
  return {
    key: base,
    kind: "markup",
    label: "Packaging · Primary",
    value: opts.cost * (1 + opts.markup),
    unit: "usd",
    op: `$${opts.cost} cost × (1 + ${opts.markup} markup)`,
    operands: [
      {
        key: nodeKey(base, "cost"),
        kind: "origin",
        label: "Line unit cost",
        value: opts.cost,
        unit: "usd",
        origin: { grade: "thin", actor: null, when: null, doc: null },
      },
      {
        key: nodeKey(base, "markup"),
        kind: "resolution",
        label: "Line markup",
        value: opts.markup,
        unit: "pct",
        op: "line ?? category default ?? Other ?? firm fallback",
        candidates: [
          { label: "Line override", value: null, chosen: opts.chosen === "Line override", unavailableReason: null },
          ...(opts.below
            ? [{ label: opts.below.label, value: opts.below.value, chosen: opts.chosen === opts.below.label, unavailableReason: null }]
            : []),
        ],
      },
    ],
  };
}

function graphOf(nodes: CostingNode[]): CostingGraph {
  return { version: 2, evaluation: "committed", nodes, complete: true };
}

const LINES = [{ lineGroupId: LG, quoteLeafId: LEAF }];
const TIERS = [{ id: TIER }];

test("the resolved markup is the engine's, on a line that states none of its own", () => {
  // The exact shape of the production defect: no line override, the engine
  // falling through to the Other default of 30%.
  const graph = graphOf([
    lineNode({
      cost: 1.11,
      markup: 0.3,
      chosen: "Other default",
      below: { label: "Other default", value: 0.3 },
    }),
  ]);
  const read = readPackagingLineTiers(graph, LINES, TIERS).get(
    packagingReadKey(LG, TIER),
  )!;

  assert.equal(read.markup, 0.3, "read from the engine, not defaulted to zero");
  assert.equal(read.markupSource, "Other default", "which rung supplied it");
  assert.equal(read.cost, 1.11, "the cost operand, not a re-multiplication");
  assert.equal(read.value, 1.11 * 1.3);
});

test("a line override reports itself as the source, and the rung below as inherited", () => {
  const base = nodeKey(LEAF, TIER, "pkg", LG);
  const node = lineNode({
    cost: 2,
    markup: 0.45,
    chosen: "Line override",
    below: { label: "Category default", value: 0.2 },
  });
  // The engine marks the override chosen and still carries its value.
  node.operands![1].candidates![0] = {
    label: "Line override",
    value: 0.45,
    chosen: true,
    unavailableReason: null,
  };
  node.operands![1].candidates![1] = {
    label: "Category default",
    value: 0.2,
    chosen: false,
    unavailableReason: null,
  };
  assert.equal(node.operands![1].key, nodeKey(base, "markup"));

  const read = readPackagingLineTiers(graphOf([node]), LINES, TIERS).get(
    packagingReadKey(LG, TIER),
  )!;
  assert.equal(read.markup, 0.45);
  assert.equal(read.markupSource, "Line override");
  // A PLACEHOLDER says "what you get if you leave this empty", so on a line
  // that HAS an override the resolved rate is the wrong number to offer.
  assert.equal(read.inheritedMarkup, 0.2);
  assert.equal(read.inheritedSource, "Category default");
});

test("a cell the graph cannot answer reads as nothing, not as zero", () => {
  const empty = readPackagingLineTiers(graphOf([]), LINES, TIERS);
  assert.deepEqual(empty.get(packagingReadKey(LG, TIER)), NO_PACKAGING_LINE_READ);
  assert.equal(empty.size, 1, "every requested pair is present, so a caller cannot read absence as a missing line");
});

test("a duplicate key resolves to nothing rather than to one of the two", () => {
  const node = lineNode({ cost: 1, markup: 0.1, chosen: "Other default", below: { label: "Other default", value: 0.1 } });
  const twin = lineNode({ cost: 9, markup: 0.9, chosen: "Other default", below: { label: "Other default", value: 0.9 } });
  const read = readPackagingLineTiers(graphOf([node, twin]), LINES, TIERS).get(
    packagingReadKey(LG, TIER),
  )!;
  assert.deepEqual(read, NO_PACKAGING_LINE_READ, "fails closed on ambiguity");
});

test("a preview graph is not read as committed authority", () => {
  const graph: CostingGraph = {
    ...graphOf([lineNode({ cost: 1, markup: 0.1, chosen: "Other default", below: { label: "Other default", value: 0.1 } })]),
    evaluation: "preview",
  };
  const read = readPackagingLineTiers(graph, LINES, TIERS).get(
    packagingReadKey(LG, TIER),
  )!;
  assert.deepEqual(read, NO_PACKAGING_LINE_READ);
});

test("one traversal covers every requested line and tier", () => {
  const other = lineNode({ cost: 1, markup: 0.1, chosen: "Other default", below: { label: "Other default", value: 0.1 } });
  const reads = readPackagingLineTiers(
    graphOf([other]),
    [
      { lineGroupId: LG, quoteLeafId: LEAF },
      { lineGroupId: "lg-2", quoteLeafId: LEAF },
    ],
    [{ id: TIER }, { id: "tier-2" }],
  );
  assert.equal(reads.size, 4);
  assert.equal(reads.get(packagingReadKey(LG, TIER))!.markup, 0.1);
  assert.deepEqual(reads.get(packagingReadKey("lg-2", "tier-2")), NO_PACKAGING_LINE_READ);
});
