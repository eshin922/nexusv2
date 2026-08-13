/**
 * OD-028 — the Complete line builder must join costing output on the CANONICAL
 * cost-input identity.
 *
 * OD-017 re-keyed `skuRollups` from `assembly_leaf_id` to `quote_leaf_id`. The
 * Sales Order line builder kept matching tree nodes on `junctionId`, so on a
 * post-OD-017 quote EVERY leaf was skipped, `lines` came out empty, and the
 * fail-closed guard refused the push with "No SO lines built".
 *
 * Measured on Order B before the repair: junction-id matches 0/2, quote-leaf-id
 * matches 2/2.
 *
 * Both ids are `string`, so nothing failed to compile — the third consumer
 * found this way, after the Packaging row identity map (COSTS-RENDER-1) and the
 * draft worksheet freight loader.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Order B's real ids — the fixture cannot drift into proving something else.
const BOX = { sku: "10064-GNX-Box", junctionId: "c1ff6c6b-e62a-45ac-a733-e5b2e8cf3eb7", quoteLeafId: "184f1fd6-595e-4bd1-ad9a-259afa7ad135" };
const BOTTLE = { sku: "DPS-BOTTLE-0001", junctionId: "90a9b8ab-697f-4eb7-9e92-7974871aa3a2", quoteLeafId: "8d4ec58f-8baf-48d1-b559-98453acf057a" };

const TREE_CHILDREN = [BOX, BOTTLE];
/** `skuRollups` as the math layer emits them post-OD-017 — keyed on quote_leaf. */
const LEAF_ROLLUPS = [
  { skuId: BOX.quoteLeafId, qtyPerParent: 1, rate: 1.25 },
  { skuId: BOTTLE.quoteLeafId, qtyPerParent: 1, rate: 2.25 },
];

/** The repaired predicate. */
const findByCanonical = (skuId: string) =>
  TREE_CHILDREN.find((c) => c.quoteLeafId === skuId);
/** The predicate as it stood before OD-028. */
const findByJunction = (skuId: string) =>
  TREE_CHILDREN.find((c) => c.junctionId === skuId);

/** Mirrors the builder's skip-on-no-match, including the empty-lines guard. */
function buildLines(match: (skuId: string) => { sku: string } | undefined) {
  const lines: Array<{ sku: string; quantity: number; rate: number }> = [];
  for (const r of LEAF_ROLLUPS) {
    const child = match(r.skuId);
    if (!child) continue; // ← every leaf took this branch before the repair
    lines.push({ sku: child.sku, quantity: 1000 * r.qtyPerParent, rate: r.rate });
  }
  if (lines.length === 0) {
    throw new Error(
      "No SO lines built — every leaf failed to resolve or had no per-tier rollup. Cannot push.",
    );
  }
  return lines;
}

test("post-OD-017 quote builds the expected SO lines", () => {
  const lines = buildLines(findByCanonical);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines, [
    { sku: "10064-GNX-Box", quantity: 1000, rate: 1.25 },
    { sku: "DPS-BOTTLE-0001", quantity: 1000, rate: 2.25 },
  ]);
  // …and the amounts are the Accounting artifact's, so a silent mis-join that
  // still produced two lines could not pass this.
  assert.equal(lines.reduce((s, l) => s + l.quantity * l.rate, 0), 3500);
});

test("Box and Bottle each resolve exactly once", () => {
  for (const leaf of [BOX, BOTTLE]) {
    const hits = LEAF_ROLLUPS.filter((r) => findByCanonical(r.skuId)?.sku === leaf.sku);
    assert.equal(hits.length, 1, `${leaf.sku} resolves exactly once`);
  }
});

test("FALSIFICATION · the junction-id predicate resolves 0/2 and trips the guard", () => {
  const matched = LEAF_ROLLUPS.filter((r) => findByJunction(r.skuId)).length;
  assert.equal(matched, 0, "0/2 — the measured pre-repair behaviour");
  assert.equal(LEAF_ROLLUPS.filter((r) => findByCanonical(r.skuId)).length, 2, "2/2 after");
  // The guard is what turned a wrong join into a refusal rather than an empty
  // Sales Order, and it must keep doing so.
  assert.throws(() => buildLines(findByJunction), /No SO lines built/);
});

test("the empty-lines fail-closed guard is preserved, not bypassed", () => {
  assert.throws(() => buildLines(() => undefined), /Cannot push/);
});

test("grouped projection is unaffected — qtyPerParent still drives quantity", () => {
  const two = [{ skuId: BOX.quoteLeafId, qtyPerParent: 2, rate: 1.25 }];
  const line = two.map((r) => ({
    sku: findByCanonical(r.skuId)!.sku,
    quantity: 1000 * r.qtyPerParent,
  }))[0];
  assert.deepEqual(line, { sku: "10064-GNX-Box", quantity: 2000 });
});

test("the source joins on quoteLeafId, with no junction-id fallback", async () => {
  const src = await readFile(
    new URL("../../src/lib/netsuite/mark-complete.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /child\.quoteLeafId === leafRollup\.skuId/);
  assert.doesNotMatch(src, /child\.junctionId === leafRollup\.skuId/);
  // A fallback would silently re-absorb the next re-key — the mechanism by
  // which this class has now recurred three times.
  assert.doesNotMatch(src, /child\.quoteLeafId === leafRollup\.skuId \|\|/);

  const tree = await readFile(
    new URL("../../src/lib/assembly-tree.ts", import.meta.url),
    "utf8",
  );
  assert.match(tree, /quoteLeafId: string;/);
  assert.match(tree, /quoteLeafId: j\.quoteLeafId/);
});
