import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guards = readFileSync("src/lib/quote-guards.ts", "utf8");
const packaging = readFileSync("src/app/actions/assembly-leaf-inputs.ts", "utf8");
const costing = readFileSync("src/app/actions/costing.ts", "utf8");
const clientTargets = readFileSync("src/app/actions/client-targets.ts", "utf8");
const pinWriter = readFileSync("src/lib/commercial-settings.ts", "utf8");
const proof = readFileSync("scripts/validation/phase-1-identity-reachability.ts", "utf8");

test("every legacy-keyed production mutation reaches canonical identity through a governed guard", () => {
  // The raw resolver is now reached once, inside resolveAttachmentForOperator,
  // which both write boundaries call. The invariant is unchanged -- two
  // legacy-keyed mutation paths reach canonical identity through a governed
  // guard -- but the call is centralised so the boundary conversion lives in
  // one place. See canonical-attachment-operator-boundary.test.ts.
  assert.equal((guards.match(/lookupCanonicalAttachmentByLegacyId\(/g) ?? []).length, 1);
  // TWO now, not three. `quoteForAssemblyLeafInputLineGroup` stopped converting
  // from a legacy `assembly_leaf_id` and reads the row's canonical
  // `quote_leaf_id` instead.
  assert.equal((guards.match(/resolveAttachmentForOperator\(/g) ?? []).length, 2);
  // ZERO now. The packaging cell writer used to resolve through
  // `quoteForAssemblyLeaf`, which reaches the quote via `assemblies` — so a
  // top-level Direct Product, which has none, refused with "Cell not found"
  // while its row plainly existed. It now uses the governed canonical guard,
  // and BOTH structural shapes travel one path.
  assert.equal((packaging.match(/quoteForAssemblyLeaf\(/g) ?? []).length, 0);
  assert.equal((packaging.match(/quoteForQuoteLeaf\(/g) ?? []).length, 1);
  // One fewer since deleteAssemblyLeafInputLine was removed: Costs no longer
  // has a structure-delete path to guard.
  assert.equal((packaging.match(/quoteForAssemblyLeafInputLineGroup\(/g) ?? []).length, 1);
  // OD-017 · the two sparse-cell mutations in costing.ts now reach canonical
  // identity DIRECTLY, through `quoteForQuoteLeaf` →
  // `resolveCanonicalAttachmentForOperator` → `lookupCanonicalAttachment`.
  // The invariant is unchanged — every mutation reaches canonical identity
  // through a governed guard — but these two no longer need a legacy junction
  // to get there, which is what makes them reachable for a Direct Component.
  //
  // ONE now, not two. `updateAssemblyLeafTarget` was the second, and it was
  // removed when Client Target moved to an authority keyed on the top-level
  // sellable unit — a per-(leaf, tier) target is the wrong identity for an Item
  // Group, whose finished good is what a client names a price for. The
  // mutation did not disappear; it moved, and is asserted at its new home
  // below.
  assert.equal((costing.match(/quoteForQuoteLeaf\(/g) ?? []).length, 1);
  assert.doesNotMatch(costing, /quoteForAssemblyLeaf\(/);
  // Client Target reaches canonical identity through the SAME governed guards,
  // on both branches: an Item Group through `quoteForAssembly`, a Direct
  // Product through `quoteForQuoteLeaf`. A member leaf is refused rather than
  // resolved, so the legacy junction has nothing here to address.
  assert.equal((clientTargets.match(/quoteForQuoteLeaf\(/g) ?? []).length, 1);
  assert.equal((clientTargets.match(/quoteForAssembly\(/g) ?? []).length, 1);
  assert.doesNotMatch(clientTargets, /quoteForAssemblyLeaf\(|assemblyLeafId/);
  // Definition plus its single call site inside the canonical guard.
  assert.equal(
    (guards.match(/resolveCanonicalAttachmentForOperator\(/g) ?? []).length,
    2,
  );
  assert.equal(
    (guards.match(/lookupCanonicalAttachment\((?!ByLegacyId)/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(packaging, /lookupCanonicalAttachmentByLegacyId/);
  assert.doesNotMatch(costing, /lookupCanonicalAttachmentByLegacyId/);
});

test("send pins only canonical quote_leaves identity and fails closed on compatibility drift", () => {
  assert.match(pinWriter, /quoteLeafId: attachment\.id/);
  assert.match(pinWriter, /membershipAssemblyId !== row\.canonicalAssemblyId/);
  assert.match(pinWriter, /membershipLeafId !== row\.canonicalLeafId/);
  assert.doesNotMatch(pinWriter, /quoteLeafId:\s*row\.membershipId/);
});

test("isolated proof covers current, legacy, missing, duplicate, cross-Quote, and drift routes", () => {
  for (const marker of [
    "currentRoute",
    "compatibilityRoute",
    "missingRejected",
    "duplicateRejected",
    "crossQuoteRejected",
    "driftRejected",
  ]) {
    assert.ok(proof.includes(marker), `identity proof lacks ${marker}`);
  }
});
