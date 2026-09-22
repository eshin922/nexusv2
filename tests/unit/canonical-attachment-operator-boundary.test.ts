/**
 * Operator-safety contract for canonical attachment resolution failures.
 *
 * Two defects are locked down here, both surfaced when a Packaging markup edit
 * on quote 27581262 crashed the Costs workspace and left an unpersisted value
 * on screen looking saved:
 *
 *   1. The resolver's hard exception escaped `runAction` and became a
 *      full-page runtime boundary instead of a governed result.
 *   2. The optimistic projection was never rolled back, because the write
 *      paths only handled `!result.ok` — never a THROWN failure.
 *
 * The resolver itself must keep failing closed, so the fix is at the operator
 * boundary only. These tests assert that split holds, and that the rollback
 * covers the thrown path as well as the governed one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const guards = read("src/lib/quote-guards.ts");
const actionResult = read("src/lib/action-result.ts");
const resolver = read("src/lib/product-structure/canonical-attachment-identity.ts");
const packaging = read("src/components/costs/packaging-drilldown.tsx");
const production = read("src/components/costs/production-drilldown.tsx");

test("DATA_INTEGRITY is a distinct code, not folded into validation", () => {
  assert.match(actionResult, /DATA_INTEGRITY: "DATA_INTEGRITY"/);
  // Collapsing it into VALIDATION_ERROR would tell an operator to correct
  // input that was never wrong.
  assert.doesNotMatch(actionResult, /DATA_INTEGRITY: "VALIDATION_ERROR"/);
});

test("the resolver still fails closed — the invariant is untouched", () => {
  // Exactly the two call sites, each still throwing on a non-unique resolve.
  const throws = resolver.match(/if \(rows\.length !== 1\)/g) ?? [];
  assert.equal(throws.length, 2);
  assert.doesNotMatch(resolver, /ActionGuardError/);
  // No degradation to null / zero-cost.
  assert.doesNotMatch(resolver, /return null/);
});

test("the remaining legacy-keyed write boundary resolves through the converting helper", () => {
  // ONE now, not two. `quoteForAssemblyLeafInputLineGroup` no longer converts
  // from a legacy `assembly_leaf_id`: it reads the row's canonical
  // `quote_leaf_id` and delegates to `quoteForQuoteLeaf`.
  //
  // The count going DOWN is the improvement, not a regression. Every legacy
  // conversion is a path that a top-level Direct Product cannot travel — its
  // rows carry a NULL `assembly_leaf_id` — and that is exactly what made every
  // packaging line-level edit refuse with "Packaging line not found".
  //
  // `quoteForAssemblyLeaf` remains and still converts; it is the last one.
  const converted = guards.match(/await resolveAttachmentForOperator\(/g) ?? [];
  assert.equal(converted.length, 1);

  // …and the line-group guard now reaches the canonical path instead.
  const lineGroup = guards.slice(
    guards.indexOf("export async function quoteForAssemblyLeafInputLineGroup("),
  );
  assert.match(lineGroup, /await quoteForQuoteLeaf\(quoteLeafId\)/);

  // The raw resolver is reached only from inside the helper, never directly
  // from a guard body.
  const raw = guards.match(/await lookupCanonicalAttachmentByLegacyId\(/g) ?? [];
  assert.equal(raw.length, 1);

  assert.match(guards, /e instanceof CanonicalAttachmentResolutionError/);
  assert.match(guards, /ERR\.DATA_INTEGRITY, ATTACHMENT_INTEGRITY_MESSAGE/);
});

test("conversion is scoped to the boundary, not applied globally", () => {
  // A blanket conversion inside runAction would silence the invariant for
  // migrations and jobs too.
  assert.doesNotMatch(actionResult, /CanonicalAttachmentResolutionError/);
});

test("the failure log carries the identifiers and the candidate count", () => {
  for (const field of ["quoteId", "assemblyId", "leafId", "candidateCount", "reason"]) {
    assert.match(guards, new RegExp(`\\b${field}[,:]`), `missing ${field}`);
  }
  // The zero-vs-multiple distinction support needs to pick a repair.
  assert.match(guards, /missing_pointer_no_canonical_row/);
  assert.match(guards, /drifting_mapping/);
});

test("the operator message says the edit was not saved", () => {
  assert.match(guards, /could not be resolved/);
  assert.match(guards, /not saved/);
});

test("packaging rolls back on BOTH the governed and the thrown path", () => {
  // Two write paths in this file: line meta (markup/category/vendor) and the
  // per-tier cost cell. Each needs a rollback reachable from a throw.
  const catches = packaging.match(/\} catch \{/g) ?? [];
  assert.ok(catches.length >= 2, `expected >= 2 catch blocks, got ${catches.length}`);

  // The line-meta path keeps its named closure; the cell path expresses the
  // same rollback inline, because it must decide OWNERSHIP before reverting
  // and a closure captured at dispatch cannot see a draft typed after it.
  // Shape is not the invariant — reverting on both failure kinds is.
  const rollbacks = packaging.match(/const rollback = \(message: string\) =>/g) ?? [];
  assert.equal(rollbacks.length, 1, "the line-meta rollback closure is still there");
  assert.match(packaging, /rollback\(result\.error\.message\)/);

  // The cell path: a governed rejection and a thrown one both reach operator
  // state, and both restore the input AND the store.
  const cell = packaging.slice(packaging.indexOf("function fireSave()"));
  assert.match(cell, /threw = true;/, "a thrown write is caught, not swallowed");
  assert.match(
    cell,
    /if \(threw \|\| \(result !== null && !result\.ok\)\)/,
    "governed and thrown failures share one branch",
  );
  assert.match(cell, /\.error\n?\s*\.message/, "the governed message reaches the operator");
  assert.match(cell, /setUnitCost\(restore\)/);
  assert.match(cell, /updatePackagingCell\(rowId, \{ unitCost: num\(restore\) \}\)/);

  // The cell path previously discarded its result entirely.
  assert.doesNotMatch(packaging, /await updateAssemblyLeafInputCell\(fd\);\n\s+mark\?\.\("action complete"\)/);
});

test("the packaging rollback target is the server-accepted value, never the optimistic store", () => {
  // Reading it back from the store at failure time would return the
  // optimistic value, not the confirmed one. `committedRef` succeeds
  // `preEditRef`: same guarantee, plus one the old ref could not make — an
  // EARLIER save accepted while a newer one is open advances the baseline, so
  // a later failure restores what the server took rather than the value from
  // before the burst. Behaviour is asserted in
  // `packaging-cell-draft-ownership.test.tsx`; this locks the shape it needs.
  const cell = packaging.slice(packaging.indexOf("function fireSave()"));

  // Advanced by an ACCEPTED write, before the ownership check — so it happens
  // whether or not the operator has typed since.
  const accepted = cell.indexOf("committedRef.current = sent;");
  assert.ok(accepted > 0, "an accepted save must advance the baseline");
  assert.match(
    cell.slice(accepted),
    /if \(!owns\) return;/,
    "the baseline advances before ownership is checked, not after",
  );

  // Read at FAILURE time, not captured at dispatch — that is what lets an
  // earlier acceptance count.
  assert.match(cell, /const restore = committedRef\.current;/);
  assert.doesNotMatch(
    cell.slice(0, cell.indexOf("startTransition")),
    /committedRef\.current/,
    "the rollback target must not be frozen at dispatch",
  );

  // And it is never written from a keystroke: a draft is not a confirmation.
  const change = packaging.slice(packaging.indexOf("function handleChange(value: string)"));
  assert.doesNotMatch(
    change.slice(0, change.indexOf("}")),
    /committedRef\.current =/,
    "typing must not advance the server-accepted baseline",
  );
});

test("production service-fee cells roll back on the thrown path too", () => {
  assert.match(production, /const rollback = \(message: string\) =>/);
  assert.match(production, /\} catch \{/);
  assert.match(production, /rollback\(result\.error\.message\)/);
  assert.match(production, /updateProductionCell\(sku\.id, tier\.id/);
});

test("the Production surface no longer writes policy, so it needs no error slot", () => {
  // Was: BOTH quote-level Production controls write policy, so both governed
  // rejection and thrown error must land in operator-visible state — count 2.
  //
  // The count is now ZERO. Both controls were removed: `Customer ships raws`
  // retired outright, allocation moved to the Commercial Recovery redesign.
  // A write with no error slot is the defect that test existed to catch, so
  // the honest successor asserts there is no write — and that the error
  // machinery went with it rather than being left as an orphan.
  for (const gone of [
    /setWriteError\(/,
    /r6-prod-toggle-error/,
    /function flipToggle/,
    /function bulkSetAllocation/,
  ]) {
    assert.doesNotMatch(production, gone, `${gone} survived its control`);
  }
  // And no path may go back to console-only reporting if a writer returns.
  assert.doesNotMatch(production, /console\.error\("\[production-policy\]/);
});