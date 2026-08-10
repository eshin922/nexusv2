/**
 * The trace renders the graph. It does not reconstruct it.
 *
 * Two kinds of assertion here, and they answer different questions.
 *
 * The SOURCE assertions establish what the component cannot do — no arithmetic,
 * no re-derivation, no recovery from an ambiguous key. A property of absence
 * cannot be tested by calling anything.
 *
 * The BEHAVIOURAL assertions run the real engine and check the graph is
 * actually navigable: that every non-terminal has somewhere to go, that every
 * root-to-leaf path ends in a terminal, and that `reconcile` — the function
 * the trace displays rather than duplicates — agrees with the graph's own
 * validation. Those hold today, without A-2, which is the claim being made.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import {
  TERMINAL_KINDS,
  ARITHMETIC_KINDS,
  findGraphViolations,
  reconcile,
  resolveNode,
  walkGraph,
  type CostingNode,
} from "../../src/lib/costing-nodes.ts";

const SRC = readFileSync(
  new URL("../../src/components/pricing-surface/pricing-trace.tsx", import.meta.url),
  "utf8",
);
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const TIER = "tier-1";
const LEAF = "leaf-1";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
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
    packaging: [
      { quoteSkuId: LEAF, tierId: TIER, lineGroupId: "l1", unitCost: 10,
        qtyPerSellableUnit: 1, category: "Primary", markupPct: null } satisfies CostingPackagingInput,
      { quoteSkuId: LEAF, tierId: TIER, lineGroupId: "l2", unitCost: 4,
        qtyPerSellableUnit: 2, category: "Other", markupPct: 0.2 },
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

const R = computeQuoteCosting(input());

// ─────────────────────────────────────────────── the component cannot compute

test("the trace performs no commercial arithmetic", () => {
  // Precise shapes only. An earlier version of this test counted arithmetic
  // OPERATORS and asserted the count stayed under a threshold — which flagged
  // `depth + 1` and string concatenation, and would have passed a genuine
  // re-derivation hidden among them. A test whose failure identifies nothing
  // is worse than no test: it spends attention and buys nothing.
  assert.ok(
    !/\.reduce\(/.test(CODE),
    "a reduce in the trace is a sum the graph already computed",
  );
  assert.ok(
    !/operands\.reduce|\+\s*o\.value/.test(CODE),
    "re-summing operands is exactly what the prototype does and we do not",
  );
  assert.ok(!/\*\s*\(1\s*\+/.test(CODE), "applying a markup in the renderer");
  assert.ok(
    !/1\s*-\s*\w*[Cc]ost\s*\//.test(CODE),
    "computing a margin in the renderer",
  );
});

test("reconciliation is displayed, not recomputed", () => {
  // The prototype re-sums because its data source has no assertion to call.
  // Ours does, and a trace checking itself against itself can never fail
  // informatively.
  assert.ok(/reconcile\(node, operands\)/.test(CODE), "must call the shared check");
  assert.ok(
    !/Math\.abs\([^)]*-\s*node\.value\)/.test(CODE),
    "an epsilon comparison in the renderer is a second reconciler",
  );
});

test("an ambiguous or missing key fails closed", () => {
  assert.ok(/resolveNode\(graph\.nodes, nodeKey\)/.test(CODE));
  assert.ok(
    !/\.find\(\s*\(?n\)?\s*=>\s*n\.key === nodeKey/.test(CODE),
    "a find() takes the first of a duplicate pair — and 'first' is an " +
      "ordering accident, not a resolution",
  );
  assert.ok(
    /root === null/.test(CODE),
    "the unresolvable case must be rendered, not thrown or silently empty",
  );
});

test("every node kind has a label, with no fallthrough", () => {
  assert.ok(
    /const KIND_LABEL: Record<CostingNode\["kind"\], string>/.test(SRC),
    "an exhaustive Record, so a new kind fails to compile rather than " +
      "rendering under whatever the default happened to be",
  );
});

// ──────────────────────────────────────────────── the graph is navigable now

test("every non-terminal is expandable, so no chain dead-ends", () => {
  for (const root of R.graph.nodes) {
    walkGraph(root, (n) => {
      if (TERMINAL_KINDS.has(n.kind)) return;
      const onward =
        (n.operands?.length ?? 0) > 0 ||
        (n.candidates?.length ?? 0) > 0 ||
        n.superseded !== undefined;
      // The contract permits exactly one non-terminal with nothing beneath it:
      // a SUM valued zero. Sigma of nothing is nothing, so it accounts for
      // itself — whereas an empty sum valued 4.20 is a number from nowhere,
      // which is the case `findGraphViolations` exists to catch. An empty
      // freight section on a quote with no freight is the ordinary instance.
      const emptySumAtZero = n.kind === "sum" && Math.abs(n.value) < 1e-9;
      assert.ok(
        onward || emptySumAtZero,
        `${n.key} (${n.kind}) is a non-terminal with nowhere to go`,
      );
    });
  }
});

test("every root-to-leaf path terminates in a human act", () => {
  // The promise the trace makes. It holds structurally today; what A-2 adds is
  // WHO, not whether the chain ends.
  const walk = (n: CostingNode, path: string[]) => {
    const kids = n.operands ?? [];
    if (kids.length === 0) {
      // Three legitimate ends, and only three. A `resolution` ends a path by
      // design — §4 rule 6: its children are candidates, not operands, and
      // alternatives do not combine. The sanctioned empty sum ends one too.
      // Anything else ending here is a derived number with no chain behind it,
      // which is the failure R10 load-bearing item 2 names.
      const ok =
        TERMINAL_KINDS.has(n.kind) ||
        n.kind === "resolution" ||
        (n.kind === "sum" && Math.abs(n.value) < 1e-9);
      assert.ok(
        ok,
        `path ${[...path, n.key].join(" → ")} ends in ${n.kind}, a derived number`,
      );
      return;
    }
    for (const k of kids) walk(k, [...path, n.key]);
  };
  for (const root of R.graph.nodes) walk(root, []);
});

test("the trace's reconciliation agrees with the graph's own validation", () => {
  // Two routes to the same verdict: the per-node check the component calls,
  // and the whole-graph sweep. If they could disagree, one of them is not the
  // assertion it claims to be.
  for (const root of R.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `violations under ${root.key}`);
    walkGraph(root, (n) => {
      const operands = n.operands ?? [];
      if (!ARITHMETIC_KINDS.has(n.kind) || operands.length === 0) return;
      assert.equal(reconcile(n, operands), null, `${n.key} does not reconcile`);
    });
  }
});

test("a cell chain is reachable by key, at any depth", () => {
  // Entry-at-node: pressing a stack cell opens the trace AT that node. That
  // requires the key to resolve on its own, not only from the root down.
  for (const key of [
    `${LEAF}/${TIER}/pkg`,
    `${LEAF}/${TIER}/sell-before`,
    `${LEAF}/${TIER}/sell`,
  ]) {
    assert.notEqual(resolveNode(R.graph.nodes, key), null, `${key} unreachable`);
  }
});

// ──────────────────────────────────────────────────── provenance, thin is ok

test("origin terminals carry a grade, and thin is a complete answer", () => {
  let origins = 0;
  for (const root of R.graph.nodes) {
    walkGraph(root, (n) => {
      if (n.kind !== "origin") return;
      origins += 1;
      assert.ok(n.origin, `${n.key} is an origin with no provenance block`);
      assert.ok(
        ["thin", "sourced"].includes(String(n.origin?.grade)),
        `${n.key} carries grade ${n.origin?.grade}`,
      );
    });
  }
  assert.ok(origins > 0, "the fixture must exercise at least one terminal");
});

test("an unattributed terminal says so rather than inventing an actor", () => {
  // A-2 landed the lookup, so the copy changed — but the property did not.
  // Thin still has to READ as thin. The two causes it can have (set before the
  // audit trail existed, or nothing writes one at all) are both "no recorded
  // author", and neither is a blank to fill.
  assert.ok(
    /not yet attributed/.test(SRC),
    "an unattributed terminal must say so",
  );
  assert.ok(
    /no recorded author for this input/.test(SRC),
    "and must name why, so a thin terminal does not read as a broken one",
  );
  assert.ok(
    !/\?\?\s*"(Unknown|System|PM)"/.test(CODE),
    "a placeholder actor is a fabricated human act",
  );
});

// ────────────────────────────────────────────────────── the override branch

test("an override shows the chain it replaced, demoted but reachable", () => {
  const r = computeQuoteCosting(
    input({ cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 42 }] }),
  );
  const root = resolveNode(r.graph.nodes, `${LEAF}/${TIER}/quoted`)!;
  assert.equal(root.kind, "override");
  assert.equal(root.value, 42);
  assert.ok(
    root.superseded,
    "demoted must not mean unreachable — 'what would this have been' needs " +
      "a real chain behind its answer",
  );
  assert.ok(/root\.superseded/.test(CODE), "and the trace must render it");
  // The superseded chain is not an operand, so it takes no part in any sum.
  assert.ok(!(root.operands ?? []).includes(root.superseded!));
});

// ───────────────────────────────────────────────────────── a recorded gap

test("a resolution's chosen rung can now carry provenance — the gap is closed", () => {
  // This test used to assert the OPPOSITE, and its note said: "when the gap
  // closes this test fails, and whoever closes it updates the note rather than
  // leaving a stale known-limitation behind." A-2 closed it; this is that
  // update.
  //
  // The gap was never a missing query. It was a missing FIELD: `NodeCandidate`
  // was `{ label, value, chosen, unavailableReason }`, so even with the lookup
  // written a rung had nowhere to hold the answer. R10's `Resolution` renders
  // `node.chosen.origin` and ours had no such thing.
  //
  // Two fields close it, and the second is the one that makes it safe:
  //
  //   origin          where the answer goes
  //   provenanceKey   WHICH AUTHORITY set this rung, in the key grammar
  //
  // Without the address the resolver would have to match on `label`, and the
  // day someone improved the wording of "Firm default" the firm's target margin
  // would silently stop being attributable.
  const target = resolveNode(R.graph.nodes, "quote-wide/target-margin")!;
  assert.equal(target.kind, "resolution");
  const candidates = target.candidates ?? [];
  const chosen = candidates.filter((c) => c.chosen);
  assert.equal(chosen.length, 1);

  // Every rung names its authority, not only the winner — a losing rung is what
  // makes the winner legible, and an operator comparing them wants both.
  assert.deepEqual(
    candidates.map((c) => c.provenanceKey),
    ["quote-wide/target-margin/quote-override", "quote-wide/target-margin/firm-default"],
  );

  // The ENGINE still leaves `origin` empty, and must. It is pure and cannot
  // read the audit trail; a value it filled would be a guess. The overlay fills
  // it, which is why provenance survives the client rebuilding the graph on
  // every optimistic edit.
  assert.equal(chosen[0].origin, undefined, "the engine must not fabricate provenance");
});
