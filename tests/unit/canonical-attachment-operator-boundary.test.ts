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
  const rollbacks = packaging.match(/const rollback = \(message: string\) =>/g) ?? [];
  assert.equal(rollbacks.length, 2);
  assert.match(packaging, /rollback\(result\.error\.message\)/);

  // The cell path previously discarded its result entirely.
  assert.doesNotMatch(packaging, /await updateAssemblyLeafInputCell\(fd\);\n\s+mark\?\.\("action complete"\)/);
});

test("packaging captures the pre-edit value before projecting optimistically", () => {
  // Reading it back from the store at failure time would return the
  // optimistic value, not the confirmed one.
  assert.match(packaging, /preEditRef\.current === null\) preEditRef\.current = storeUnitCost/);
  // Rollback restores the store as well as the local input, so the Cost Stack
  // does not keep deriving from a value that was never persisted.
  assert.match(packaging, /updatePackagingCell\(rowId, \{ unitCost: num\(restore \?\? ""\) \}\)/);
});

test("production service-fee cells roll back on the thrown path too", () => {
  assert.match(production, /const rollback = \(message: string\) =>/);
  assert.match(production, /\} catch \{/);
  assert.match(production, /rollback\(result\.error\.message\)/);
  assert.match(production, /updateProductionCell\(sku\.id, tier\.id/);
});

test("a rejected production policy write is surfaced, not silently swallowed", () => {
  // Was: assert the two console.error strings. A thrown write not escaping the
  // transition is necessary but not sufficient — the control renders from the
  // RSC prop, so a rejected write leaves the OLD value on screen, which is
  // visually identical to "nothing happened". Logging to the console does not
  // reach the operator.
  //
  // Both failure paths — a governed `{ok:false}` and a thrown error — must now
  // land in operator-visible state. The count is 2 because BOTH quote-level
  // Production controls write policy: Customer ships raws and Allocate service
  // fees. A new writer without an error slot drops the count and fails here.
  const rejected = production.match(/setWriteError\(res\.error\.message\)/g) ?? [];
  const threw = production.match(/setWriteError\(\s*\n?\s*e instanceof Error/g) ?? [];
  assert.ok(rejected.length >= 2, `governed rejection surfaced (${rejected.length})`);
  assert.ok(threw.length >= 2, `thrown error surfaced (${threw.length})`);
  // And it must actually render, not just be held in state.
  assert.match(production, /r6-prod-toggle-error/);
  assert.match(production, /Could not save:/);
  // No path may go back to console-only.
  assert.doesNotMatch(production, /console\.error\("\[production-policy\]/);
});
