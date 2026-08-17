/**
 * BV-012 — Production authoring belongs to the Item Group.
 *
 * ── THE AUTHORITY ─────────────────────────────────────────────────────────
 *
 * The Item Group is the finished-good economic envelope and owns Production
 * economics. Production costs belong to the Item Group, not to an arbitrary
 * packaging component beneath it. The inverse governs equally: no Item Group,
 * no Production economics — a Direct Product passes through with standalone
 * packaging economics only.
 *
 * ── WHAT THE SURFACE DID INSTEAD ──────────────────────────────────────────
 *
 * A full Production table rendered for EVERY non-assembly SKU:
 *
 *   M-1  A Direct Product got editable Production cells whose writes were
 *        dropped by `if (!assemblyId) return` inside a fire-and-forget
 *        transition. An operator typed a filling fee on a folding carton and
 *        nothing persisted and nothing said so. Two independent failures: the
 *        affordance must not exist, AND accepting a value then discarding it
 *        silently is a defect whatever the authority says.
 *
 *   M-2  Under an Item Group with N members, N tables rendered for ONE
 *        assembly-owned row. Edits persisted correctly — the server applies
 *        `{...before, [changedField]: value}`, so nothing was destroyed — but
 *        reload re-rendered the value through the anchor leaf, so it looked
 *        as though it had moved to a different component. Misleading
 *        ownership, not data loss.
 *
 * ── WHAT THIS SLICE CHANGED, AND WHAT IT DID NOT ──────────────────────────
 *
 * DISPLAY KEY ONLY. `assembly_production_inputs` has always been keyed
 * `assembly_id NOT NULL` — the storage was already right. `getCostingBundle`
 * runs its OWN separate anchor-leaf fan-out in `costing-adapter.ts` and never
 * sees these rows, which is why the re-key moves no money.
 *
 * Proven, not assumed: a costing witness over all 11 quotes carrying non-zero
 * Production produced a bit-identical global digest before and after
 * (`d72af68f…`). If the two fan-outs had not been independent, that is the
 * measurement that would have said so.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** Comments stripped — this suite explains the defect by naming the old code. */
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const DRILL = "components/costs/production-drilldown.tsx";
const PAGE = "app/projects/[id]/quotes/[quoteId]/costs/page.tsx";

// ── one surface per Item Group, none anywhere else ────────────────────────

test("Production tables render from the assembly list and nothing else", async () => {
  const src = await code(DRILL);
  // Exactly one render site, driven by assemblies.
  assert.match(src, /\{assemblies\.map\(\(asm\) => \([\s\S]{0,1400}?<ProductionTable/);
  const mounts = src.match(/<ProductionTable/g) ?? [];
  assert.equal(mounts.length, 1, `${mounts.length} ProductionTable render sites`);
});

test("the tree walk that rendered a table per leaf is gone", async () => {
  // `buildTreeRenderOrder(skus).map(...)` with a non-assembly branch is the
  // shape that produced both M-1 and M-2.
  const src = await code(DRILL);
  assert.doesNotMatch(src, /buildTreeRenderOrder/);
  assert.doesNotMatch(src, /skuRole === "leaf"/);
});

test("a quote with no Item Group offers no Production authoring at all", async () => {
  // BV-012 §1.b, as the empty state rather than as an empty table the surface
  // would silently refuse to save.
  const src = await code(DRILL);
  assert.match(src, /assemblies\.length === 0/);
  assert.match(src, /Direct\s+products carry packaging economics only/);
});

test("the write targets the Item Group, not a parent walk", async () => {
  // The trap this slice had to avoid: `sku.parentSkuId` was correct while the
  // table rendered on member leaves and is NULL now that `sku` is the
  // assembly. Left unchanged it would have made `if (!assemblyId) return`
  // swallow every production write — silently, in a fire-and-forget
  // transition. The same defect as M-1, pointed at the whole surface.
  const src = await code(DRILL);
  assert.match(
    src,
    /const assemblyId = sku\.skuRole === "assembly" \? sku\.id : sku\.parentSkuId;/,
  );
});

// ── display re-key, and only display ──────────────────────────────────────

test("the display fan-out keys Production by assembly", async () => {
  const src = await code(PAGE);
  assert.match(src, /quoteSkuId: api\.assemblyId/);
  // The anchor-leaf indirection existed only to feed the per-leaf tables.
  assert.doesNotMatch(src, /anchorLeafByAssembly/);
});

test("the costing adapter is untouched and still anchor-leaf", async () => {
  // Deliberate. S-1 is structurally different but arithmetically exact, and
  // the disposition was not to change it for tidiness. If this ever fails,
  // someone refactored the math path inside a display slice.
  // Asserted on CODE. An earlier version of this matched `production[]`,
  // which appears in the adapter only in prose — the comment stripper removed
  // it and the test failed on correct code. An assertion that cannot survive
  // its own instrument is worse than none.
  const adapter = await code("lib/costing-adapter.ts");
  assert.match(adapter, /const anchorLeafByAssembly = new Map<string, string>\(\);/);
  assert.match(adapter, /anchorLeafByAssembly\.set\(/);
});

test("the server action and its storage contract are unchanged", async () => {
  const action = await code("app/actions/assembly-production-inputs.ts");
  // Still keyed on the assembly, still field-scoped on update — the property
  // that makes M-2 non-destructive.
  assert.match(action, /eq\(assemblyProductionInputs\.assemblyId, assemblyId\)/);
  assert.match(action, /\{ \.\.\.before, \[changedField\]: submittedFields\[changedField\] \}/);
});

// ── the surface still reads as Item-Group-owned ───────────────────────────

test("the block names the Item Group and says whose economics these are", async () => {
  const src = await readFile(SRC + DRILL, "utf8");
  assert.match(src, /Item group/);
  assert.match(src, /Production belongs to the finished good\./);
});

test("the production-block count counts Item Groups", async () => {
  // It counted leaves, which is the same wrong unit of account one line down.
  const src = await code(DRILL);
  assert.match(src, /<strong>\{assemblies\.length\}<\/strong> production block/);
  assert.doesNotMatch(src, /leafSkus/);
});

test("section-level reads re-point to the first Item Group", async () => {
  // Forced by the re-key: these read rows that are no longer leaf-keyed.
  // Section-level semantics are unchanged; only the key is.
  const src = await code(DRILL);
  assert.match(src, /const firstAssembly = assemblies\[0\];/);
  assert.match(src, /rowsBySku\.get\(firstAssembly\.id\)/);
  assert.doesNotMatch(src, /firstLeaf/);
});

test("allocation policy is read per assembly, directly", async () => {
  // The old read walked an assembly's children to find whichever one carried
  // the policy. With the re-key the row IS the assembly's.
  const src = await code(DRILL);
  assert.match(src, /for \(const asm of assemblies\)[\s\S]{0,200}?policyBySku\.get\(asm\.id\)/);
});
