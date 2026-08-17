/**
 * Every consumer of Client Target, and the two that would have lost it.
 *
 * Moving a table's identity is not finished when the reads and writes move.
 * CLAUDE.md records this twice as Pattern 70 — a migration audit that covered
 * queries and writes but missed realtime subscriptions and publication
 * membership, then a second one that missed raw SQL in `src/lib/`. Both
 * surfaced in production.
 *
 * So this enumerates the consumers rather than trusting that the compiler
 * found them. Two were only found by grepping for the old table name after the
 * read path already type-checked clean:
 *
 *   · SCENARIO COPY — cloned `assembly_leaf_targets`, which after the move
 *     meant copying an empty table. A copied quote would have silently lost the
 *     client's stated price, reading as though nobody had ever asked.
 *
 *   · STRUCTURAL MOVE — a Direct Product moved INTO an Item Group stops being a
 *     sellable unit, and its target would have survived the move: FK intact,
 *     CHECK satisfied, and then emitted as a target on a member leaf, where the
 *     engine WOULD have computed a verdict against it. A benchmark the customer
 *     never gave, on a component they are not buying.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

async function code(rel: string): Promise<string> {
  const raw = await readFile(path.join(SRC, rel), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ── the read path ─────────────────────────────────────────────────────────

test("the costing loader reads the new authority and not the old one", async () => {
  const src = await code("app/actions/costing.ts");
  assert.match(src, /from\(quoteClientTargets\)/);
  // The old table's loader is gone, and so is its writer.
  assert.doesNotMatch(src, /from\(assemblyLeafTargets\)/);
  assert.doesNotMatch(src, /export async function updateAssemblyLeafTarget/);
});

test("the adapter RESOLVES per tier rather than passing rows through", async () => {
  const src = await code("lib/costing-adapter.ts");
  assert.match(src, /resolveClientTarget\(/);
  assert.match(src, /indexClientTargets\(/);
  // A unit with no target at a tier emits no row, so absence stays absence
  // rather than becoming zero.
  assert.match(src, /if \(value === null\) continue;/);
});

test("nothing collapses the target to one value per SKU row", async () => {
  // The defect the whole change exists to remove: "the first non-null found
  // while iterating tiers", against which every cell's headroom was measured.
  const ctx = await code("components/pricing-surface/pricing-classifier-context.tsx");
  assert.doesNotMatch(ctx, /clientTargetUnit == null/);
  assert.match(ctx, /client_target_unit: cellTargetLookup\(sr\.skuId, pt\.tierId\)/);

  const classifier = await code("lib/pricing-classifier.ts");
  // The headroom reads the CELL's target, so it and the engine's verdict are
  // computed against the same number.
  assert.match(classifier, /const clientTarget = cellRaw\.client_target_unit/);
  assert.doesNotMatch(classifier, /sku\.client_target_unit/);
});

// ── the two that would have lost it ───────────────────────────────────────

test("scenario copy clones the new authority, remapping both id spaces", async () => {
  const src = await code("app/actions/quotes.ts");
  assert.match(src, /from\(quoteClientTargets\)/, "copy must read the new table");
  assert.match(src, /insert\(quoteClientTargets\)/, "and write it");
  assert.doesNotMatch(src, /assemblyLeafTargets/, "the old clone is gone");
  // BOTH id columns are remapped — exactly one is set on any row, and which
  // one depends on whether the unit is an Item Group or a Direct Product.
  assert.match(src, /assemblyIdMap\.get\(r\.assemblyId\)/);
  assert.match(src, /quoteLeafIdMap\.get\(r\.quoteLeafId\)/);
});

test("a copied COMMON target stays common rather than being mapped to a tier", async () => {
  // `tier_id` NULL is a fact — "every tier" — not an unmapped reference. Sent
  // through the tier map it would resolve to nothing and trip the guard; given
  // a tier it would silently become an override on whichever one.
  const src = await code("app/actions/quotes.ts");
  assert.match(src, /const newTierId = r\.tierId \? tierIdMap\.get\(r\.tierId\) \?\? null : null;/);
  // And an unmapped reference that IS set fails loudly rather than dropping.
  assert.match(src, /unmapped sellable unit/);
  assert.match(src, /unmapped tier/);
});

test("a Direct Product moved into a group loses its target, and says so", async () => {
  const src = await code("lib/product-structure/structural-move.ts");
  // Only that direction. Member → Direct gains a sellable unit and has no
  // target to lose; member → member never had one.
  assert.match(
    src,
    /args\.target\.kind === "group" && fromAssemblyId === null/,
    "the drop must be scoped to Direct → group",
  );
  assert.match(src, /delete\(quoteClientTargets\)/);
  // Counted and returned. A structural move that quietly discards a commercial
  // input is the kind of loss nobody finds until they look for the number they
  // entered.
  assert.match(src, /clientTargetsDropped/);
});

test("the dual-keyed repoint list does NOT gain the new table", async () => {
  // `DEPENDENT_TABLES` is the set carrying both a canonical `quote_leaf_id` and
  // the legacy `assembly_leaf_id` a move re-points. Client Target has no legacy
  // column; adding it there would re-point a value that has no junction, and
  // would hide the fact that a move can invalidate it outright.
  const src = await code("lib/product-structure/structural-move.ts");
  const list = /const DEPENDENT_TABLES = \[([\s\S]*?)\] as const;/.exec(src);
  assert.ok(list, "the dual-keyed list must still exist");
  assert.doesNotMatch(list[1], /quoteClientTargets/);
});

// ── the boundary ──────────────────────────────────────────────────────────

test("Client Target reaches no customer-facing or external surface", async () => {
  // Internal. Currently true by absence; asserted so the absence is enforced.
  for (const rel of [
    "lib/customer-view-resolver.ts",
    "lib/customer-view-to-cpdf.ts",
  ]) {
    assert.doesNotMatch(
      await code(rel),
      /client_target|clientTarget/i,
      `${rel} must not carry the client target`,
    );
  }
});
