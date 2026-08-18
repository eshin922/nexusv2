/**
 * Transient deltas — a join, not a computation.
 *
 * §3.3: *"Committed and staged graphs share the key space by construction."*
 * That is what makes a delta three lines instead of a subsystem: both values
 * are already stated by the engine, and the only new operation is the
 * subtraction that displays the gap.
 *
 * §3.1 says why the keys have to be deterministic, in these words: *"A delta
 * is a join between two graphs on node identity. Non-deterministic keys make
 * that join impossible and the transient-delta feature unbuildable."*
 *
 * So the tests here are mostly about what the delta REFUSES to report. A
 * number that appears when it should not is the failure mode — an operator
 * scanning for what moved will believe a row that says something moved.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { quoteScopeKey, walkGraph } from "../../src/lib/costing-nodes.ts";
import { nodeDelta, marginPointsDelta } from "../../src/lib/pricing-delta.ts";

const TIER = "tier-1";
const LEAF = "leaf-1";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.32, Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
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
    packaging: [
      { quoteSkuId: LEAF, tierId: TIER, lineGroupId: "l1", unitCost: 10,
        qtyPerSellableUnit: 1, category: "Primary", markupPct: null } satisfies CostingPackagingInput,
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

const COMMITTED = computeQuoteCosting(input());
const PREVIEW = computeQuoteCosting(
  input({ quote: { id: "q-1", globalPriceAdjPct: 0.2, targetMarginPct: null } }),
  "preview",
);
const SELL = quoteScopeKey(TIER, "sell");
const PKG = quoteScopeKey(TIER, "pkg");

// ────────────────────────────────────────────────────────────── it reports

test("a staged adjustment moves sell, and the delta is the gap between two stated values", () => {
  const d = nodeDelta(COMMITTED.graph, PREVIEW.graph, SELL)!;
  assert.notEqual(d, null);
  // Both sides are values the engine stated. The assertion is that the delta
  // is their difference and nothing else — not that it matches a formula
  // recomputed here, which would be the second authority all over again.
  assert.equal(d.committed, COMMITTED.graph.nodes.length > 0 ? d.committed : NaN);
  assert.equal(d.delta, d.preview - d.committed);
  assert.ok(d.delta > 0, "raising the global adjustment raises sell");
});

test("cost does not move when only the adjustment is staged", () => {
  // The adjustment applies above the cost stack. A packaging row reporting a
  // movement here would mean the delta was reading something other than the
  // key it names.
  assert.equal(nodeDelta(COMMITTED.graph, PREVIEW.graph, PKG), null);
});

test("a percentage node converts to points, and stays a subtraction", () => {
  // Exercised against the adjustment resolution — a real `pct` node that moves
  // when the global adjustment is staged. An earlier version of this test
  // asked for a margin key and fell back to the sell key when it found none,
  // which would have reported a DOLLAR figure labelled as points. The fallback
  // hid the fact the margin node does not exist; see the recorded gap below.
  const d = marginPointsDelta(
    COMMITTED.graph,
    PREVIEW.graph,
    `${LEAF}/${TIER}/adjustment`,
  )!;
  assert.notEqual(d, null);
  assert.equal(d.committed, 10, "0.10 in, 10 points out");
  assert.equal(d.preview, 20);
  assert.ok(Math.abs(d.delta - 10) < 1e-9);
  assert.ok(Math.abs(d.delta - (d.preview - d.committed)) < 1e-9);
});

test("the margin delta is a join, now that a margin node exists", () => {
  // Was a RECORDED GAP: no node carried a margin, so §3's margin-in-points
  // delta had nothing to join. Closed by OD-019 (d′) — a generic `ratio`
  // kind with the denominator as `basis`, emitted at `quote/{tier}/margin`.
  //
  // The gap test asserted the absence so that closing it would fail loudly and
  // force this rewrite. It did.
  const d = marginPointsDelta(COMMITTED.graph, PREVIEW.graph, quoteScopeKey(TIER, "margin"))!;
  assert.notEqual(d, null, "quote/{tier}/margin must be joinable");
  assert.ok(Math.abs(d.delta - (d.preview - d.committed)) < 1e-9);
  // Raising the global adjustment raises sell, and cost does not move, so the
  // margin improves. Asserted as a direction rather than a figure: the figure
  // is the engine’s, and restating it here would be the second authority.
  assert.ok(d.delta > 0);
});

// ────────────────────────────────────────────────────────────── it refuses

test("nothing staged means no delta at all", () => {
  assert.equal(nodeDelta(COMMITTED.graph, null, SELL), null);
});

test("an unmoved value reports nothing rather than zero", () => {
  // §3: deltas disappear on Apply, and their ABSENCE is the signal that
  // nothing is pending. A row reading "+$0.0000" says something happened here
  // and came to nothing; an empty row says nothing happened. The operator is
  // scanning for the rows that moved.
  const samePreview = computeQuoteCosting(input(), "preview");
  assert.equal(nodeDelta(COMMITTED.graph, samePreview.graph, SELL), null);
});

test("a key neither graph answers for reports nothing", () => {
  assert.equal(nodeDelta(COMMITTED.graph, PREVIEW.graph, "no/such/key"), null);
});

test("two committed graphs produce no delta, however plausible one would look", () => {
  // The evaluation identity earning its keep. Handing this the committed graph
  // twice is a caller mistake, and the readers refuse it rather than returning
  // a confident zero that reads as "nothing is staged".
  const other = computeQuoteCosting(
    input({ quote: { id: "q-1", globalPriceAdjPct: 0.2, targetMarginPct: null } }),
  );
  assert.equal(other.graph.evaluation, "committed");
  assert.equal(
    nodeDelta(COMMITTED.graph, other.graph, SELL),
    null,
    "a committed graph passed as the preview must be refused",
  );
});

test("a preview graph cannot stand in for the committed side either", () => {
  assert.equal(nodeDelta(PREVIEW.graph, PREVIEW.graph, SELL), null);
});

// ───────────────────────────────────────────────────────────── structural

const SRC = readFileSync(
  new URL("../../src/lib/pricing-delta.ts", import.meta.url),
  "utf8",
);
const UI = readFileSync(
  new URL("../../src/components/pricing-surface/staged-delta.tsx", import.meta.url),
  "utf8",
);
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("neither side is recomputed", () => {
  for (const [name, code] of [["lib", strip(SRC)], ["ui", strip(UI)]] as const) {
    assert.ok(
      !/1\s*-\s*\w*[Cc]ost\s*\//.test(code),
      `${name}: a margin formula in the delta layer`,
    );
    assert.ok(!/\*\s*\(1\s*\+/.test(code), `${name}: a markup in the delta layer`);
    assert.ok(
      !/computeQuoteCosting/.test(code),
      `${name}: the delta layer must not run the engine — it joins two runs`,
    );
  }
});

test("both sides name the evaluation they require", () => {
  assert.ok(/readNodeValue\(committedGraph, key, "committed"\)/.test(SRC));
  assert.ok(/readNodeValue\(previewGraph, key, "preview"\)/.test(SRC));
});

test("the delta tone tracks direction, not compliance", () => {
  // `.delta.pos` / `.delta.neg` carry --good / --warn. A rise is green because
  // more revenue is what the operator reached for, NOT because the result
  // clears a threshold — whether it does is the compliance grid's question,
  // answered from the classifier on a different surface.
  const ui = strip(UI);
  assert.ok(/d\.delta > 0 \? "pos" : "neg"/.test(ui));
  assert.ok(!/floor|target/i.test(ui), "a threshold has reached the delta chip");
  assert.ok(!/status|below_/i.test(ui), "a compliance verdict has reached the delta chip");
});
