/**
 * Phase 3 · the surgical lift, as a node — behaviour only, no persistence.
 *
 * §13.5 draws the line this file sits on: *"Specification of the lift's
 * behaviour is unblocked and complete. Only its persistence is blocked."* The
 * table waits on OD-012. What it means does not, and building the meaning first
 * means the table lands against a contract that is already proven rather than
 * one written alongside it.
 *
 * FOUR CLAIMS THAT ARE EASY TO GET WRONG AND HARD TO NOTICE
 *
 *   1. **It composes; it does not replace.** Tier and global adjustment are a
 *      ladder — one wins. A lift added as a third rung would silently turn a
 *      composing lever into an alternative, and the arithmetic would still
 *      reconcile, because each number would be individually correct.
 *   2. **It owes the stack a row** (§13.2). A lever that moves a price without
 *      producing a node produces no row, and a stack missing a contribution
 *      cannot assert reconciliation — which is the only thing that makes it
 *      worth reading.
 *   3. **An override rejects it** (§13.3), and the rejection is VISIBLE. A
 *      refusal that renders as an absence is the failure this guards: the
 *      operator pulls a lever, nothing happens, and nothing says why.
 *   4. **Identity resolution fails closed** (§1a). A lift resolved to the wrong
 *      cell is a wrong price wearing a deliberate one's clothes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeQuoteCosting,
  type CostingPackagingInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { findNode, findGraphViolations } from "../../src/lib/costing-nodes.ts";

const TIER = "tier-1";
const LEAF = "leaf-1";
const CANON = "qleaf-1";

function input(over: Partial<QuoteCostingInput> = {}): QuoteCostingInput {
  return {
    quote: { id: "q-1", globalPriceAdjPct: 0.1, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Manufacturing: 0.32, Primary: 0.4, Other: 0.3 },
    skus: [
      {
        id: LEAF,
        canonicalQuoteLeafId: CANON,
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
      {
        quoteSkuId: LEAF,
        tierId: TIER,
        lineGroupId: "line-1",
        unitCost: 10,
        qtyPerSellableUnit: 1,
        category: "Primary",
        markupPct: null,
      } satisfies CostingPackagingInput,
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

const LIFT = 0.077;
const find = (r: ReturnType<typeof computeQuoteCosting>, key: string) => {
  for (const root of r.graph.nodes) {
    const hit = findNode(root, key);
    if (hit) return hit;
  }
  return null;
};

const BASE = computeQuoteCosting(input());
const LIFTED = computeQuoteCosting(
  input({ lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: LIFT }] }),
);

const cell = (r: ReturnType<typeof computeQuoteCosting>) =>
  r.skuRollups[0].perTier.find((p) => p.tierId === TIER)!;

// ------------------------------------------------------------- composition

test("the lift multiplies the adjusted sell — it does not replace the adjustment", () => {
  const before = find(BASE, `${LEAF}/${TIER}/sell-before`)!.value;
  const adjusted = find(BASE, `${LEAF}/${TIER}/sell`)!.value;
  // Global adjustment is 0.1 and no tier adjustment is set.
  assert.ok(Math.abs(adjusted - before * 1.1) < 1e-12);

  const lifted = find(LIFTED, `${LEAF}/${TIER}/lift`)!;
  assert.equal(lifted.kind, "adjustment");
  assert.ok(
    Math.abs(lifted.value - before * 1.1 * (1 + LIFT)) < 1e-12,
    "sell = sell_before x (1 + A) x (1 + lift)",
  );
  // The distinguishing assertion: composing, not replacing. If the lift had
  // joined the ladder it would have won outright and produced
  // `before x (1 + lift)` — a number that is arithmetically fine and answers a
  // different question.
  assert.ok(
    Math.abs(lifted.value - before * (1 + LIFT)) > 1e-9,
    "a replacing lift would drop the global adjustment entirely",
  );
});

test("the adjustment resolution is untouched by the lift", () => {
  // The ladder still has exactly its two rungs. A lift appearing as a third
  // candidate would present a composing lever as an alternative.
  const ladder = find(LIFTED, `${LEAF}/${TIER}/adjustment`)!;
  assert.equal(ladder.kind, "resolution");
  assert.equal(ladder.candidates?.length, 2);
  assert.deepEqual(
    ladder.candidates?.map((c) => c.label),
    ["Tier adjustment", "Global adjustment"],
  );
});

test("the quoted sell scalar equals the lift node", () => {
  // Guarantee 6 of §7, applied to the new node: the scalar and the graph
  // cannot disagree about what the quote is actually using.
  assert.equal(cell(LIFTED).requiredSellPerUnit, find(LIFTED, `${LEAF}/${TIER}/lift`)!.value);
});

// ------------------------------------------------------- the stack owes a row

test("the lift produces a node, and the graph still reconciles", () => {
  // §13.2: every lever that can change a quoted price owes the stack a row.
  // Reconciliation is what the row buys — asserted here rather than assumed.
  assert.notEqual(find(LIFTED, `${LEAF}/${TIER}/lift`), null);
  // Per root — `findGraphViolations` walks a node, not a graph. Passing the
  // graph reports two violations against a node with no key, which is the
  // check describing the caller rather than the subject.
  for (const root of LIFTED.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `lifted: ${root.key}`);
  }
  for (const root of BASE.graph.nodes) {
    assert.deepEqual(findGraphViolations(root), [], `base: ${root.key}`);
  }
});

test("the lift percentage is a terminal a person set, not a derived rate", () => {
  // The reconciliation guard caught this during implementation, and the
  // distinction it forced is real. A `rate` node is an amount DERIVED by
  // applying a percentage to a basis — duty and tariff are rates. Nobody
  // derives a lift; somebody chooses one. So it terminates, and it terminates
  // in a human act, which is what the trace promises all the way down.
  const pct = find(LIFTED, `${LEAF}/${TIER}/lift/pct`)!;
  assert.notEqual(pct, null);
  assert.equal(pct.kind, "origin");
  assert.equal(pct.value, LIFT);
  assert.equal(pct.unit, "pct");
  // Thin until A-2 lands the provenance query — declared, not defaulted.
  assert.equal(pct.origin?.grade, "thin");
});

// ------------------------------------------------------------ override rejects

const OVERRIDDEN = computeQuoteCosting(
  input({
    cellOverrides: [{ quoteSkuId: LEAF, tierId: TIER, sellPriceOverride: 99 }],
    lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: LIFT }],
  }),
);

test("a lift over a direct price is rejected, not applied", () => {
  assert.equal(cell(OVERRIDDEN).requiredSellPerUnit, 99, "the person's price stands");
});

test("the rejection is visible in the graph, with a reason", () => {
  // The failure this prevents: the lever does nothing and nothing says so.
  // A rejected lift is `flagged-out` — present, valued zero, carrying why.
  const rejected = find(OVERRIDDEN, `${LEAF}/${TIER}/lift`)!;
  assert.notEqual(rejected, null, "a refused lift must still appear");
  assert.equal(rejected.kind, "flagged-out");
  assert.equal(rejected.value, 0);
  assert.match(String(rejected.reason), /set directly|overturn/i);
});

test("a rejected lift is reachable from the cell it concerns", () => {
  // Filed anywhere else, the operator would have to know to go looking.
  const root = OVERRIDDEN.graph.nodes.find((n) =>
    findNode(n, `${LEAF}/${TIER}/lift`),
  );
  assert.notEqual(root, undefined);
  assert.equal(root!.key, `${LEAF}/${TIER}/quoted`);
});

// --------------------------------------------------------- independence (H5/H6)

test("removing the lift leaves the adjustment exactly as it was", () => {
  // H5. The two levers answer to different authorities — the firm's floor and
  // the operator's commercial judgement — so one must never disturb the other.
  assert.equal(
    find(BASE, `${LEAF}/${TIER}/sell`)!.value,
    find(LIFTED, `${LEAF}/${TIER}/sell`)!.value,
  );
});

test("return to baseline is exact", () => {
  // H6. Not "close" — the same float. Every adjustment is an additive layer
  // over a base that does not move, and that is only true if it is true
  // bit-for-bit.
  const returned = computeQuoteCosting(input({ lifts: [] }));
  assert.equal(
    cell(returned).requiredSellPerUnit,
    cell(BASE).requiredSellPerUnit,
  );
});

test("no lift changes nothing at all", () => {
  // The non-regression that matters: the engine gained an input slot, and a
  // quote that does not use it must be untouched. S-7 asserts this across 24
  // production quotes; this asserts it where the fixture can be read.
  const undefinedLifts = computeQuoteCosting(input());
  const emptyLifts = computeQuoteCosting(input({ lifts: [] }));
  assert.deepEqual(undefinedLifts.quoteSummary, emptyLifts.quoteSummary);
  assert.equal(find(emptyLifts, `${LEAF}/${TIER}/lift`), null, "no node when no lift");
});

// ----------------------------------------------------- identity fails closed

test("a lift for an attachment not on this quote is ignored, not guessed", () => {
  // §1a: no fallback to a reusable id, no inferred tuple match. The lift
  // simply does not apply, and no cell is silently repriced.
  const foreign = computeQuoteCosting(
    input({ lifts: [{ quoteLeafId: "qleaf-elsewhere", tierId: TIER, liftPct: LIFT }] }),
  );
  assert.equal(cell(foreign).requiredSellPerUnit, cell(BASE).requiredSellPerUnit);
  assert.equal(find(foreign, `${LEAF}/${TIER}/lift`), null);
});

test("an ambiguous attachment fails closed rather than picking a leaf", () => {
  // Two leaves answering to one canonical attachment is a data defect.
  // Choosing between them here would bury it under a plausible number, so
  // BOTH are rejected and both say why.
  const twoLeaves = input({
    skus: [
      {
        id: LEAF, canonicalQuoteLeafId: CANON, parentSkuId: null, qtyPerParent: null,
        skuRole: "leaf", skuLabel: "SKU-1", productName: "A", sortOrder: 0,
        retailBenchmark: null,
      },
      {
        id: "leaf-2", canonicalQuoteLeafId: CANON, parentSkuId: null, qtyPerParent: null,
        skuRole: "leaf", skuLabel: "SKU-2", productName: "B", sortOrder: 1,
        retailBenchmark: null,
      },
    ],
    packaging: [
      { quoteSkuId: LEAF, tierId: TIER, lineGroupId: "l1", unitCost: 10,
        qtyPerSellableUnit: 1, category: "Primary", markupPct: null },
      { quoteSkuId: "leaf-2", tierId: TIER, lineGroupId: "l2", unitCost: 10,
        qtyPerSellableUnit: 1, category: "Primary", markupPct: null },
    ],
    lifts: [{ quoteLeafId: CANON, tierId: TIER, liftPct: LIFT }],
  });
  const r = computeQuoteCosting(twoLeaves);
  for (const skuId of [LEAF, "leaf-2"]) {
    const n = find(r, `${skuId}/${TIER}/lift`)!;
    assert.notEqual(n, null, `${skuId}: the rejection must be visible`);
    assert.equal(n.kind, "flagged-out");
    assert.match(String(n.reason), /more than one/i);
  }
});
