import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guards = readFileSync("src/lib/quote-guards.ts", "utf8");
const packaging = readFileSync("src/app/actions/assembly-leaf-inputs.ts", "utf8");
const costing = readFileSync("src/app/actions/costing.ts", "utf8");
const pinWriter = readFileSync("src/lib/commercial-settings.ts", "utf8");
const proof = readFileSync("scripts/validation/phase-1-identity-reachability.ts", "utf8");

test("every legacy-keyed production mutation reaches canonical identity through a governed guard", () => {
  // The raw resolver is now reached once, inside resolveAttachmentForOperator,
  // which both write boundaries call. The invariant is unchanged -- two
  // legacy-keyed mutation paths reach canonical identity through a governed
  // guard -- but the call is centralised so the boundary conversion lives in
  // one place. See canonical-attachment-operator-boundary.test.ts.
  assert.equal((guards.match(/lookupCanonicalAttachmentByLegacyId\(/g) ?? []).length, 1);
  assert.equal((guards.match(/resolveAttachmentForOperator\(/g) ?? []).length, 3);
  // One fewer call site since addAssemblyLeafInput was removed: Setup now owns
  // packaging structure, so Costs no longer has a create path to guard.
  assert.equal((packaging.match(/quoteForAssemblyLeaf\(/g) ?? []).length, 1);
  // One fewer since deleteAssemblyLeafInputLine was removed: Costs no longer
  // has a structure-delete path to guard.
  assert.equal((packaging.match(/quoteForAssemblyLeafInputLineGroup\(/g) ?? []).length, 1);
  assert.equal((costing.match(/quoteForAssemblyLeaf\(/g) ?? []).length, 2);
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
