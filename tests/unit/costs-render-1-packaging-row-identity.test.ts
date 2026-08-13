/**
 * COSTS-RENDER-1 — a Packaging cost row must visibly identify the governed
 * component it costs.
 *
 * THE DEFECT. OD-017 re-keyed cost rows from `assembly_leaf_id` to
 * `quote_leaf_id`, but the Costs page kept building its identity lookup on
 * `assembly_leaf_id`. The join therefore searched one id space in a map built
 * from another and never hit, so every Packaging row rendered the literal
 * string "Unknown component". Both ids are `string`, so nothing failed to
 * compile.
 *
 * WHY THIS NEEDS ITS OWN TEST RATHER THAN A TOTALS CHECK. The fixture below is
 * Order B: two components, DIFFERENT costs, EQUAL markups. Swapping the two
 * costs leaves the subtotal, the sell, the margin and the turnkey completely
 * unchanged. Reconciliation is therefore structurally incapable of detecting
 * the misattribution — `aggregateIsBlindToSwap` proves exactly that, so this
 * suite cannot be replaced by an aggregate assertion later on.
 *
 * The fixture also renders in an order DIFFERENT from creation order — Box was
 * created first and renders second — because row position was the only thing an
 * operator could have used to guess identity, and it is wrong.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPackagingIdentityMap,
  resolvePackagingRowIdentity,
  UNIDENTIFIED_COMPONENT,
  type PackagingIdentitySku,
} from "../../src/lib/costs/packaging-row-identity.ts";

// ── Order B, verbatim from the live scenario ────────────────────────────────
// Scenario 89688023 · "NEXUS V1 ACCOUNTING REVIEW — SANDBOX · single Item
// Group". Ids, names and costs are the real governed values, so the fixture
// cannot drift into proving something the product does not do.
//
// `name` retains its leading space exactly as stored — the resolver must handle
// real data, not tidied data.

const BOX: PackagingIdentitySku = {
  id: "c1ff6c6b-e62a-45ac-a733-e5b2e8cf3eb7", // assembly_leaf id
  quoteLeafId: "184f1fd6-595e-4bd1-ad9a-259afa7ad135", // governed identity
  skuLabel: "10064-GNX-Box",
  productName: " Genexa - Box - Kids' Cough (10064-GNX)",
};

const BOTTLE: PackagingIdentitySku = {
  id: "90a9b8ab-697f-4eb7-9e92-7974871aa3a2",
  quoteLeafId: "8d4ec58f-8baf-48d1-b559-98453acf057a",
  skuLabel: "DPS-BOTTLE-0001",
  productName: " Primary - Bottle",
};

// An assembly owns no cost row and carries no governed cost-input identity.
const ASSEMBLY: PackagingIdentitySku = {
  id: "91509967-2a54-48da-bfc6-9af27960ef56",
  quoteLeafId: null,
  skuLabel: "ASY-89688023-1",
  productName: "Accounting Review Finished Product",
};

/** Creation order: Box (18:51:49) then Bottle (18:52:38). */
const CREATION_ORDER = [BOX, BOTTLE];

type Row = { lineGroupId: string; quoteSkuId: string; unitCost: number; markup: number };

/** Render order, by sort_order — the INVERSE of creation order. */
const RENDER_ROWS: Row[] = [
  { lineGroupId: "d5db8a89-c03a-4264-8a0a-fc6c294750cf", quoteSkuId: BOTTLE.quoteLeafId!, unitCost: 1.125, markup: 1 },
  { lineGroupId: "f9738441-8fa2-4230-946a-14889ad99083", quoteSkuId: BOX.quoteLeafId!, unitCost: 0.625, markup: 1 },
];

const SKUS = [ASSEMBLY, BOTTLE, BOX];

/** The reconciliation instrument — sell per unit across the drawer. */
function aggregateSellPerUnit(rows: readonly Row[]): number {
  return rows.reduce((sum, r) => sum + r.unitCost * (1 + r.markup), 0);
}

/** What an operator can actually see on each row, in render order. */
function visibleRows(skus: readonly PackagingIdentitySku[], rows: readonly Row[]) {
  const map = buildPackagingIdentityMap(skus);
  return rows.map((r) => ({
    ...resolvePackagingRowIdentity(map, r.quoteSkuId),
    unitCost: r.unitCost,
  }));
}

test("render order differs from creation order — position cannot identify a row", () => {
  assert.deepEqual(CREATION_ORDER.map((s) => s.skuLabel), ["10064-GNX-Box", "DPS-BOTTLE-0001"]);
  const rendered = RENDER_ROWS.map((r) =>
    r.quoteSkuId === BOX.quoteLeafId ? "10064-GNX-Box" : "DPS-BOTTLE-0001",
  );
  assert.deepEqual(rendered, ["DPS-BOTTLE-0001", "10064-GNX-Box"]);
  assert.notDeepEqual(rendered, CREATION_ORDER.map((s) => s.skuLabel));
});

test("each visible row resolves to the correct governed leaf, and its own cost", () => {
  const [first, second] = visibleRows(SKUS, RENDER_ROWS);

  assert.equal(first.skuLabel, "DPS-BOTTLE-0001");
  assert.equal(first.componentName, "Primary - Bottle");
  assert.equal(first.unitCost, 1.125, "Bottle label must stay bound to the Bottle cost");

  assert.equal(second.skuLabel, "10064-GNX-Box");
  assert.equal(second.componentName, "Genexa - Box - Kids' Cough (10064-GNX)");
  assert.equal(second.unitCost, 0.625, "Box label must stay bound to the Box cost");
});

test("no fallback to Unknown component when the bound leaf has governed identity", () => {
  for (const row of visibleRows(SKUS, RENDER_ROWS)) {
    assert.equal(row.resolved, true);
    assert.notEqual(row.componentName, UNIDENTIFIED_COMPONENT);
    assert.ok(row.skuLabel.length > 0, "SKU sub-text must be present");
  }
});

test("reordering rows does not change identity", () => {
  const forward = visibleRows(SKUS, RENDER_ROWS);
  const reversed = visibleRows(SKUS, [...RENDER_ROWS].reverse());
  // Same bindings, presented in the opposite order.
  assert.deepEqual([...reversed].reverse(), forward);
  // And identity travels with the row, not with the position.
  assert.equal(reversed[0].skuLabel, "10064-GNX-Box");
  assert.equal(reversed[0].unitCost, 0.625);
});

test("shuffling the SKU array does not change identity", () => {
  const shuffled = visibleRows([BOX, ASSEMBLY, BOTTLE], RENDER_ROWS);
  assert.deepEqual(shuffled, visibleRows(SKUS, RENDER_ROWS));
});

test("FALSIFICATION — aggregate reconciliation is blind to the swap this test catches", () => {
  const swapped: Row[] = [
    { ...RENDER_ROWS[0], unitCost: RENDER_ROWS[1].unitCost }, // Bottle row gets Box's cost
    { ...RENDER_ROWS[1], unitCost: RENDER_ROWS[0].unitCost }, // Box row gets Bottle's cost
  ];

  // 1 · Every aggregate an operator or a reconciliation check would look at is
  //     IDENTICAL. $3.50/unit either way, so $3,500 at tier 1,000 either way.
  assert.equal(aggregateSellPerUnit(RENDER_ROWS), 3.5);
  assert.equal(aggregateSellPerUnit(swapped), 3.5);
  assert.equal(
    aggregateSellPerUnit(swapped),
    aggregateSellPerUnit(RENDER_ROWS),
    "reconciliation cannot discriminate — this is why per-row identity is required",
  );

  // 2 · Per-row attribution is NOT identical. This is the only instrument that
  //     separates the correct quote from the misattributed one.
  const correct = visibleRows(SKUS, RENDER_ROWS).map((r) => `${r.skuLabel}=${r.unitCost}`);
  const wrong = visibleRows(SKUS, swapped).map((r) => `${r.skuLabel}=${r.unitCost}`);
  assert.deepEqual(correct, ["DPS-BOTTLE-0001=1.125", "10064-GNX-Box=0.625"]);
  assert.deepEqual(wrong, ["DPS-BOTTLE-0001=0.625", "10064-GNX-Box=1.125"]);
  assert.notDeepEqual(wrong, correct);
});

test("REGRESSION — keying on assembly_leaf id (the pre-fix join) identifies nothing", () => {
  // Reproduces the defect exactly: a map built on `s.id` searched with the
  // row's governed `quote_leaf_id`. Asserting the OLD behaviour is unresolvable
  // is what keeps this suite honest — without it the test could pass against
  // code that never had the bug.
  const preFixMap = new Map(SKUS.map((s) => [s.id, s]));
  for (const row of RENDER_ROWS) {
    const hit = preFixMap.get(row.quoteSkuId);
    assert.equal(hit, undefined, "the two id spaces must not overlap");
  }
  const resolved = resolvePackagingRowIdentity(
    new Map(),
    RENDER_ROWS[0].quoteSkuId,
  );
  assert.equal(resolved.componentName, UNIDENTIFIED_COMPONENT);
  assert.equal(resolved.resolved, false);
});

test("an assembly is not a lookup target — it owns no cost row", () => {
  const map = buildPackagingIdentityMap(SKUS);
  assert.equal(map.size, 2, "only the two leaves carry a governed identity");
  assert.equal(map.has(ASSEMBLY.id), false);
});

test("whitespace-only identity does not count as identity", () => {
  const blank: PackagingIdentitySku = {
    id: "a", quoteLeafId: "q-blank", skuLabel: "  ", productName: " ",
  };
  const r = resolvePackagingRowIdentity(buildPackagingIdentityMap([blank]), "q-blank");
  assert.equal(r.resolved, false);
  assert.equal(r.componentName, UNIDENTIFIED_COMPONENT);
});
