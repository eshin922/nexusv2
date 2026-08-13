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
  // CLASSIFIED — canonical, and the first write path that is. `quote_leaf_lifts`
  // keys on `quote_leaves.id`, so a lift is addressed the same way from the
  // staging key through `CostingLift` to the stored row, and the persisted row
  // reconstructs the in-effect lift with nothing to translate.
  //
  // It names the LEGACY id too, in exactly one place and for one reason: a
  // direct price still lives on `assembly_leaf_overrides` (OD-017), so Apply
  // must cross canonical → junction to write one. That crossing is a single
  // query scoped through `quote_leaves`, it fails closed on both absent and
  // duplicate, and it refuses the whole Apply rather than dropping one chip.
  // Retire the crossing when the cost-input tables re-key on quote_leaf_id.
  "src/app/actions/pricing-lifts.ts",
  "src/app/actions/leaf-specs.ts", "src/app/actions/leaves.ts",
  "src/app/actions/markup-defaults.ts", "src/app/actions/quotes.ts",
  "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/page.tsx", "src/components/add-product/add-product-modal.tsx",
  "src/components/assembly-tree/asy-row.tsx", "src/components/assembly-tree/leaf-context-menu.tsx",
  "src/components/costing-store-provider.tsx", "src/components/costs/freight-drilldown.tsx", "src/components/costs/production-drilldown.tsx",
  // CLASSIFIED — enduring. The packaging drilldown addresses graph nodes by
  // `line.quoteSkuId`, which IS the assembly_leaf id and IS the id the engine
  // keys its SKU rollups on for a grouped attachment. Naming the identity is
  // what makes the read addressable; it is the node-key contract, not a legacy
  // reference. Becomes a canonical quoteLeafId read when OD-017 is settled and
  // cost inputs stop being keyed on assembly_leaf_id.
  "src/components/costs/packaging-drilldown.tsx",
  "src/components/library/library-browse-modal.tsx", "src/components/spec-entry/change-type-modal.tsx",
  "src/components/spec-entry/spec-entry-surface.tsx", "src/components/spec-entry/spec-panel.tsx",
  "src/components/spec-entry/type-picker.tsx", "src/db/schema.ts", "src/lib/addendum-loader.ts",
  "src/lib/assembly-tree.ts", "src/lib/costing-adapter.ts",
  // CLASSIFIED — enduring. costing.ts carries canonicalQuoteLeafId on
  // CostingSku; the math layer keys on canonical identity by design.
  "src/lib/costing.ts",
  // CLASSIFIED — enduring. Gate 1B node keys are built from canonical
  // identity (quoteLeafId / tierId / lineGroupId) BY DESIGN: a key must be a
  // pure function of position in the computation so two graphs can be joined
  // for staged-vs-committed deltas. Naming the identity here is the contract,
  // not a legacy reference — positional keys would break that join.
  "src/lib/costing-nodes.ts",
  // CLASSIFIED — enduring, canonical-only. COSTS-RENDER-1. Resolves which
  // governed component a Packaging cost row is costing, so an operator can see
  // it on the row. Keys STRICTLY on quoteLeafId, because that is the identity
  // every assembly_leaf_inputs row carries post-OD-017; it names assemblyLeafId
  // only to document the id space it must NOT key on. Deliberately has no
  // legacy fallback — a permissive lookup would silently re-absorb the next
  // re-key, which is the defect this module exists to prevent. Nothing to
  // retire: it should be canonical-only forever.
  "src/lib/costs/packaging-row-identity.ts",
  // CLASSIFIED — canonical, session-scoped. The staging model addresses a
  // staged lift or direct price by `quote_leaf_id x tier_id`, which is the
  // canonical commercial attachment Phase 3 §1a requires lifts to persist
  // against. Naming it here is the contract rather than a legacy reference:
  // keying staging on the legacy grouped-membership id would stage a change
  // against an identity the lift itself may not resolve to.
  //
  // Resolution happens in the engine, once, and fails closed. This layer only
  // carries the address; it writes nothing and resolves nothing.
  "src/lib/pricing-staging.ts",
  // CLASSIFIED — canonical, and resolves nothing. The Apply plan decides WHICH
  // rows change by comparing two maps of composite cell ids. It names the
  // canonical identity because that is what a lift's address is made of, and it
  // never touches the legacy one: the single canonical → junction crossing an
  // Apply needs lives in the action, where the database is.
  //
  // The one thing it is careful about is that its address is NOT the staging
  // key. `:` here, `::` there — a durable entity id and a browser-session
  // address are not interchangeable, and a shared separator invites one to be
  // parsed as the other.
  "src/lib/pricing-apply-plan.ts",
  // CLASSIFIED — canonical, and it never resolves. The cost-base fingerprint
  // names `quoteLeafId` only as part of a freight component row's composite
  // identity, so that two rows for different commercial lines cannot digest to
  // the same string. It reads the id, writes nothing, and asserts no mapping
  // between the canonical and legacy identities.
  "src/lib/pricing-cost-base.ts",
  // CLASSIFIED — the compatibility window made legible, and the one place both
  // identities appear ON PURPOSE. A-2 asks who set a governed input; the graph
  // addresses that input canonically while four of the thirteen writers record
  // it against the legacy junction, so the lookup cannot be written without
  // holding both and stating which is which.
  //
  // It is a BRIDGE, not a mapping it invents: every crossing is looked up in an
  // index the loader built from real rows, and a miss resolves to `thin` rather
  // than to a guess. An inferred id here would attribute one commercial line's
  // price to another and read as an answer. Shrinks to nothing when the cost
  // inputs re-key on quote_leaf_id (OD-017).
  "src/lib/pricing-provenance.ts",
  // CLASSIFIED — read-only, and the place the bridge is BUILT. Reads
  // `quote_leaves` left-joined to `assembly_leaves` to learn, per SKU, both the
  // canonical id and the legacy one the audit rows use. It resolves nothing on
  // its own and writes nothing; it hands the pairs to the classifier, which is
  // the only thing entitled to cross between them.
  "src/app/actions/pricing-provenance.ts",
  "src/components/pricing-surface/pricing-staging-context.tsx",
  // CLASSIFIED — carries, does not resolve. The staging bar renders one chip
  // per pending change and hands each change's composite cell key to a
  // labeller supplied by the caller. It never parses the key and never
  // resolves an identity: a component that resolved one is a component that
  // can resolve it wrongly, and the caller already holds the SKU and tier
  // names. Named here because the key it passes through encodes the canonical
  // attachment, and a file touching that identity should say so even when its
  // only role is transport.
  "src/components/pricing-surface/staging-bar.tsx",
  // CLASSIFIED — carries, does not resolve. CellAction stages a lift or a
  // direct price against a `CellRef` its CALLER resolved; it never derives one.
  // The identity appears here only in the type it receives and in the composite
  // key it builds to ask the staging model whether this cell is already staged.
  //
  // Named because the cost of getting it wrong is the highest on the surface: a
  // price change landing on a different commercial line. The resolution lives
  // at the composition point, where `canonicalQuoteLeafId` and the tier UUID
  // both exist, and fails closed to null — at which point this component
  // refuses to stage rather than addressing a guess.
  "src/components/pricing-surface/cell-action.tsx",
  // CLASSIFIED — display only, fails closed. The Phase 3 mount builds the
  // labeller the staging bar transports keys to, and that is the one place the
  // composite cell key is taken apart. It resolves canonical quote_leaf_id →
  // product name from `skuRollups`, which carries both, and nothing else: no
  // write, no commercial read, no mapping asserted between canonical and
  // legacy identity.
  //
  // Named here because the resolution is easy to get subtly wrong and was:
  // the classifier's `state.skus[].id` is the engine's SKU id, a SEPARATE
  // field from `canonicalQuoteLeafId` on the same rollup. Keyed on the former
  // this matches nothing and every chip degrades to two raw UUIDs. It fails
  // closed to exactly that raw key when either half is unresolved — an ugly
  // chip is recoverable, a chip naming the wrong SKU beside a price change is
  // not.
  "src/components/pricing-surface/pricing-surface-shell.tsx",
  "src/lib/freight-workbook.ts", "src/lib/leaf-spec-loader.ts",
  "src/lib/commercial-settings.ts",
  "src/lib/library-browse-loader.ts", "src/lib/nav/home-queries.ts", "src/lib/netsuite/item-resolver.ts",
  "src/lib/netsuite/mark-complete.ts", "src/lib/product-structure/canonical-attachment-identity.ts",
  "src/lib/product-structure/grouped-membership-compatibility.ts", "src/lib/quote-guards.ts",
  "src/lib/quote-cost-completeness-contract.ts", "src/lib/quote-cost-completeness.ts",
  "src/lib/scenario-copy-loader.ts", "src/lib/workspace-queries.ts",
  // CLASSIFIED — verification only. Rebuilds the drilldown's grid from
  // assembly_leaf_inputs to prove the per-line cutover moved exactly the
  // cells the pre-flight predicted and blanked none.
  "scripts/gate-1b/verify-packaging-cutover.ts",
  "scripts/parity/so-field-parity.ts", "scripts/product-structure/slice1-compatibility-rehearsal.ts",
  "scripts/product-structure/slice1-contract-rehearsal.ts",
  "scripts/product-structure/slice1-cutover-rehearsal.ts", "scripts/product-structure/slice1-preflight.ts",
  "scripts/provision-cb-step10-fixture.ts", "scripts/provision-cb-step8b-fixture.ts",
  "scripts/provision-cb-step8c4-fixture.ts", "scripts/seed-sample-order.mjs",
  "scripts/validation/phase-1-identity-reachability.ts",
  "scripts/validation/fixtures.ts",
  "scripts/verify/canonical-repair-digest.mjs",
  "src/lib/packaging-materialization.ts",
  // CLASSIFIED — transitional, read-only. Gate 1B S-7 fixture selection
  // joins assembly_leaf_inputs.assembly_leaf_id purely to COUNT which node
  // kinds each quote's data can produce. It resolves no identity, writes
  // nothing, and asserts no mapping — the join is a census, not authority.
  // Retire with the S-7 baseline once the node graph lands.
  "scripts/gate-1b/select-fixtures.ts",
  // CLASSIFIED — evidence, read-only. Both count and compare identity columns
  // to settle OD-014 and to prove the C-2 population swap could not reorder or
  // revalue anything. They resolve no identity and write nothing. The ordering
  // check is retained rather than deleted because it is the precondition any
  // future change of population source must re-prove.
  "scripts/gate-1b/od-014-ordering-check.ts",
  "scripts/gate-1b/od-014-population-evidence.ts",
  // CLASSIFIED — verification, read-only. Asserts that the engine's leaf
  // population equals the canonical attachment set by identity. It resolves
  // the canonical-to-legacy mapping only to predict the id the engine emits,
  // and writes nothing. Retire when cost inputs key on quote_leaf_id and the
  // coalesce it mirrors disappears.
  "scripts/gate-1b/verify-sku-population.ts",
  // CLASSIFIED — rehearsal, read-only, and the one place naming both identities
  // is the whole point. R2 exists to prove the canonical row and the legacy
  // membership denote the same attachment during the Slice 1 compatibility
  // window, so it must hold both ids side by side to compare them.
  //
  // It resolves nothing itself: the verdict is `lookupCanonicalAttachment` and
  // its reverse — the production resolvers a lift would call. The row columns
  // it reads directly serve only the failure-category breakdown, printed to say
  // why a resolver that has already refused did so. Retire with the
  // compatibility window.
  "scripts/rehearsal/r2-identity-parity.ts",
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
  // OD-017 added `quoteLeaves.id` / `quote_leaves.id`. Without them the sweep
  // LOSES a file the moment it converts from the legacy junction to canonical
  // identity — the registry would quietly shrink exactly when a file starts
  // handling the governed identity, which is the opposite of what it is for.
  const identity = /assemblyLeafId|assembly_leaf_id|assemblyLeaves\.id|assembly_leaves\.id|quoteLeafId|quote_leaf_id|quoteLeaves\.id|quote_leaves\.id|leafId|leaf_id|junctionId/;
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
  // OD-017 · both halves now come from the resolved attachment. The legacy id
  // is context, and for a Direct Component it is legitimately null — reading it
  // from the resolver rather than from a local is what makes that expressible.
  assert.match(costing, /quote_leaf_id: attachment\.quoteLeafId[\s\S]*assembly_leaf_id: attachment\.assemblyLeafId/);
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
