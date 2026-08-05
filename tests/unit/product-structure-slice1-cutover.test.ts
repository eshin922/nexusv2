import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

const classifiedIdentityFiles = new Set([
  "src/app/actions/assemblies.ts", "src/app/actions/assembly-leaf-inputs.ts",
  "src/app/actions/costing.ts", "src/app/actions/freight-worksheet.ts",
  // CLASSIFIED — transitional. actions/freight.ts writes component-tier costs
  // keyed on canonical quoteLeafId, with the fail-closed identity guards
  // covered by phase-2-freight-lifecycle. Transitional compatibility
  // infrastructure retained until F3 Stage 4, not enduring V1 authority.
  "src/app/actions/freight.ts",
  "src/app/actions/leaf-specs.ts", "src/app/actions/leaves.ts",
  "src/app/actions/markup-defaults.ts", "src/app/actions/quotes.ts",
  "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/page.tsx", "src/components/add-product/add-product-modal.tsx",
  "src/components/assembly-tree/asy-row.tsx", "src/components/assembly-tree/leaf-context-menu.tsx",
  "src/components/costing-store-provider.tsx", "src/components/costs/freight-drilldown.tsx", "src/components/costs/production-drilldown.tsx",
  "src/components/library/library-browse-modal.tsx", "src/components/spec-entry/change-type-modal.tsx",
  "src/components/spec-entry/spec-entry-surface.tsx", "src/components/spec-entry/spec-panel.tsx",
  "src/components/spec-entry/type-picker.tsx", "src/db/schema.ts", "src/lib/addendum-loader.ts",
  "src/lib/assembly-tree.ts", "src/lib/costing-adapter.ts",
  // CLASSIFIED — enduring. costing.ts carries canonicalQuoteLeafId on
  // CostingSku; the math layer keys on canonical identity by design.
  "src/lib/costing.ts",
  "src/lib/freight-workbook.ts", "src/lib/leaf-spec-loader.ts",
  "src/lib/commercial-settings.ts",
  "src/lib/library-browse-loader.ts", "src/lib/nav/home-queries.ts", "src/lib/netsuite/item-resolver.ts",
  "src/lib/netsuite/mark-complete.ts", "src/lib/product-structure/canonical-attachment-identity.ts",
  "src/lib/product-structure/grouped-membership-compatibility.ts", "src/lib/quote-guards.ts",
  "src/lib/quote-cost-completeness-contract.ts", "src/lib/quote-cost-completeness.ts",
  "src/lib/scenario-copy-loader.ts", "src/lib/workspace-queries.ts",
  // Setup → Costs inheritance backfill. Reads assembly_leaves.id to insert the
  // inherited cost rows those leaves owe. Legacy identity, read-only against
  // structure — it never writes an identity column.
  "scripts/backfill/setup-costs-inheritance.ts",
  "scripts/parity/so-field-parity.ts", "scripts/product-structure/slice1-compatibility-rehearsal.ts",
  "scripts/product-structure/slice1-contract-rehearsal.ts",
  "scripts/product-structure/slice1-cutover-rehearsal.ts", "scripts/product-structure/slice1-preflight.ts",
  "scripts/provision-cb-step10-fixture.ts", "scripts/provision-cb-step8b-fixture.ts",
  "scripts/provision-cb-step8c4-fixture.ts", "scripts/seed-sample-order.mjs",
  "scripts/validation/phase-1-identity-reachability.ts",
  "scripts/validation/fixtures.ts",
  "scripts/smoke/mark-complete.ts", "scripts/verify/costing-adapter.ts",
  "scripts/verify/sample-order-margin.ts", "scripts/verify/slice-11-5-1-warnings-parity.ts",
  "tests/harness/fixtures/world.ts",
]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(dir.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

test("every source identity usage has an explicit Cutover classification", async () => {
  const identity = /assemblyLeafId|assembly_leaf_id|assemblyLeaves\.id|assembly_leaves\.id|quoteLeafId|quote_leaf_id|leafId|leaf_id|junctionId/;
  const matches: string[] = [];
  for (const file of [
    ...await sourceFiles("src"),
    ...await sourceFiles("scripts"),
    ...await sourceFiles("tests/harness"),
  ]) {
    if (identity.test(await read(file))) matches.push(file);
  }
  assert.deepEqual(matches.sort(), [...classifiedIdentityFiles].sort());
});

test("canonical lookup is branded, direct-capable, and fail-closed", async () => {
  const identity = await read("src/lib/product-structure/canonical-attachment-identity.ts");
  assert.match(identity, /type CanonicalQuoteLeafId = string &/);
  assert.match(identity, /lookupCanonicalAttachment\([\s\S]*quoteLeafId: CanonicalQuoteLeafId/);
  assert.match(identity, /lookupCanonicalAttachmentByLegacyId\([\s\S]*assemblyLeafId: LegacyAssemblyLeafId/);
  assert.match(identity, /canonical\.assemblyId === null/);
  assert.match(identity, /did not resolve exactly once/);
  assert.match(identity, /did not resolve exactly one canonical attachment/);
  assert.doesNotMatch(identity, /lookupCanonicalAttachment\([\s\S]{0,80}leafId:/);
});

test("grouped action evidence is canonical with legacy context", async () => {
  const [assemblies, costing, inputs] = await Promise.all([
    read("src/app/actions/assemblies.ts"), read("src/app/actions/costing.ts"),
    read("src/app/actions/assembly-leaf-inputs.ts"),
  ]);
  assert.match(assemblies, /entityType: "quote_leaf"[\s\S]*entityId: attached\.quoteLeafId/);
  assert.match(assemblies, /entityType: "quote_leaf"[\s\S]*entityId: detached\.quoteLeafId/);
  assert.match(assemblies, /quoteLeafId: membership\.quoteLeafId[\s\S]*junctionId: membership\.assemblyLeafId/);
  assert.match(costing, /quote_leaf_id: attachment\.quoteLeafId[\s\S]*assembly_leaf_id: assemblyLeafId/);
  assert.match(inputs, /quote_leaf_id: attachment\.quoteLeafId/);
});

test("Direct production writer stays unreachable and Migration 0049 stays inactive", async () => {
  const [journal, boundary, rehearsal] = await Promise.all([
    read("drizzle/meta/_journal.json"),
    read("src/lib/product-structure/grouped-membership-compatibility.ts"),
    read("scripts/product-structure/slice1-cutover-rehearsal.ts"),
  ]);
  assert.doesNotMatch(journal, /0049_product_structure_slice1_backfill/);
  assert.match(boundary, /assemblyId: args\.assemblyId/);
  assert.doesNotMatch(boundary, /assemblyId:\s*null/);
  assert.match(rehearsal, /assertRuntimeSafety\(\)/);
  assert.match(rehearsal, /assemblyId: null/);
});
