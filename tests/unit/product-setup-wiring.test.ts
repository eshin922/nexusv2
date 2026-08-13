// Product Setup wiring — two peer operator actions.
//
// The operator contract these hold:
//   Add Product      → Direct Product, assembly_id = NULL
//   Add Item Group   → explicit grouped structure
// Neither implies the other. Grouping is never inferred from product count.
//
// Structural + source-level. The end-to-end operator walk (attach → render →
// reload) is exercised separately; these guard the wiring that walk depends on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

/** Source with comments removed — comments may keep internal vocabulary. */
async function code(p: string): Promise<string> {
  return (await read(p))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");
}

// ------------------------------------------------------- two peer actions
test("Setup exposes Add Product and Add Item Group as peers", async () => {
  const src = await code("src/components/assembly-tree/assembly-tree-view.tsx");
  assert.match(src, /mode="direct"/);
  assert.match(src, /mode="group"/);
  // The single consolidated CTA is gone — it could only produce grouped
  // structure, so leaving it would have left grouping as the default.
  assert.doesNotMatch(src, /\+ Add component/);
});

test("each trigger names exactly one structure", async () => {
  const src = await read("src/components/library/library-browse-trigger.tsx");
  assert.match(src, /\+ Add Product/);
  assert.match(src, /\+ Add Item Group/);
});

// --------------------------------------------------------------- routing
test("the two actions route to two different writers", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // Chosen by the operator's explicit mode, never by product count and never
  // by falling back from one writer to the other.
  assert.match(src, /direct\s*\?\s*await attachQuoteProduct\(fd\)/);
  assert.match(src, /:\s*await attachAssemblyLeaf\(fd\)/);
  assert.doesNotMatch(src, /assemblies\.length\s*===\s*0\s*\?\s*await attachQuoteProduct/);
});

test("direct mode needs no item group to be attachable", async () => {
  const src = await read("src/components/library/library-browse-modal.tsx");
  // Gating Add Product on an existing group would make it impossible on the
  // very quote it exists to serve — one with no groups at all.
  assert.match(src, /attachReady = mode === "direct" \|\| Boolean\(targetAssemblyId\)/);
});

// ------------------------------------------------------------- rendering
test("Direct Products render as first-class rows beside Item Groups", async () => {
  const src = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  assert.match(src, /tree\.directProducts\.map/);
  assert.match(src, /<DirectProductRow/);
  // Peer, not nested: the direct map must not be inside the assembly map.
  const directAt = src.indexOf("tree.directProducts.map");
  const asyAt = src.indexOf("orderedAssemblies.map");
  assert.ok(directAt > 0 && asyAt > 0);
  assert.ok(directAt < asyAt, "Direct Products render before Item Groups");
});

test("a Direct-only quote is not treated as empty", async () => {
  const src = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  // The empty state must consider BOTH collections. Gating on assemblies alone
  // would render a Direct-only quote as if nothing had been added.
  assert.match(
    src,
    /orderedAssemblies\.length === 0 &&\s*tree\.directProducts\.length === 0/,
  );
  assert.doesNotMatch(src, /No assemblies\./);
});

test("the loader reads Direct attachments from the database", async () => {
  const src = await read("src/lib/assembly-tree.ts");
  // Persistence is what makes a Direct Product survive reload and navigation:
  // the row is read from quote_leaves on every render, never held in client
  // state.
  assert.match(src, /isNull\(quoteLeaves\.assemblyId\)/);
  // And the zero-assembly early return must not short-circuit past it.
  assert.match(
    src,
    /asmRows\.length === 0 && directRows\.length === 0/,
  );
});

test("the row shows operator identity and no internal ids", async () => {
  const src = await read("src/components/assembly-tree/direct-product-row.tsx");
  assert.match(src, /product\.name/);
  assert.match(src, /product\.sku/);
  // quoteLeafId is used as a React key and as the detach argument — never
  // rendered as text for the operator to read.
  assert.doesNotMatch(src, />\{product\.quoteLeafId\}</);
  assert.doesNotMatch(src, /junctionId/);
  assert.doesNotMatch(src, /compositionHash/);
});

// ------------------------------------------------------ no silent grouping
test("Add Product creates no assembly anywhere in its path", async () => {
  for (const file of [
    "src/app/actions/quote-products.ts",
    "src/lib/product-structure/direct-attachment.ts",
  ]) {
    const src = await code(file);
    assert.doesNotMatch(src, /insert\(assemblies\)/);
    assert.doesNotMatch(src, /createAssembly/);
  }
});

test("the grouped path still creates the grouped structure", async () => {
  const src = await read("src/app/actions/assemblies.ts");
  assert.match(src, /attachGroupedMembership/);
  assert.match(src, /insert\(assemblies\)/);
});

// -------------------------------------------------------------- ASY copy
test("ASY has left the operator vocabulary of this workflow", async () => {
  const operatorFiles = [
    "src/components/assembly-tree/assembly-tree-view.tsx",
    "src/components/assembly-tree/asy-row.tsx",
    "src/components/assembly-tree/asy-context-menu.tsx",
    "src/components/assembly-tree/asy-notes-drawer.tsx",
    "src/components/assembly-tree/leaf-context-menu.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
    "src/components/library/library-browse-trigger.tsx",
  ];
  for (const file of operatorFiles) {
    // ASY may remain as an internal implementation term in comments — the
    // requirement is that it never reaches the operator.
    assert.doesNotMatch(
      await code(file),
      /\bASY\b/,
      `${file} still shows ASY to operators`,
    );
  }
});

// ------------------------------------------------------- eligibility gate
test("the SKU-less gate guards the new attach path too", async () => {
  const src = await read("src/app/actions/quote-products.ts");
  assert.match(src, /evaluateAttachmentEligibility/);
  // Refuses before writing anything, so no partial attachment can exist.
  const gateAt = src.indexOf("evaluateAttachmentEligibility");
  const writeAt = src.indexOf("attachDirectProductRow");
  assert.ok(gateAt > 0 && writeAt > 0 && gateAt < writeAt);
});

test("the gate blocks NEW attachment only — history stays readable", async () => {
  // Nothing in the read path may filter on SKU presence. A quote that already
  // contains a SKU-less product must still render exactly as it did.
  const loader = await read("src/lib/assembly-tree.ts");
  assert.doesNotMatch(loader, /evaluateAttachmentEligibility/);
  assert.doesNotMatch(loader, /hasUsableSku/);
  // The row renders a placeholder rather than refusing to draw.
  const row = await read("src/components/assembly-tree/direct-product-row.tsx");
  assert.match(row, /product\.sku \?\? "—"/);
});

// ------------------------------------------------------- mixed structure
test("mixed structure projects both, and drops neither", async () => {
  const src = await read("src/lib/netsuite/mark-complete.ts");
  // Certified by P1 (SO2713): a group beside a flat line for an item in no
  // group produces no duplication. The blanket refusal is gone.
  assert.doesNotMatch(src, /Projecting both structures into one Sales Order is not yet/);
  // What replaced it matters more than its removal: Direct lines are now
  // EMITTED alongside groups. The previous `lines: []` would have dropped them
  // silently the moment the refusal lifted.
  assert.match(src, /lines: directLines/);
  assert.match(src, /groupMemberItemIds: expandedMemberItemIds/);
});

test("the surviving guard is membership-based and sits in the builder", async () => {
  const src = await read("src/lib/netsuite/sales-orders.ts");
  // Probe 7a established that a group's OWN members duplicate. That remains
  // permanently true and is now enforced precisely, one layer below Complete.
  assert.match(src, /already expands/);
  assert.match(src, /groupMemberItemIds/);
  // Undeclared membership is refused rather than assumed safe.
  assert.match(src, /membership cannot be checked/);
});

test("editing a mixed quote is never blocked", async () => {
  // The uncertified condition matters at the irreversible downstream boundary
  // and nowhere else. An operator may freely build a mixed quote.
  for (const file of [
    "src/app/actions/quote-products.ts",
    "src/app/actions/assemblies.ts",
    "src/lib/assembly-tree.ts",
  ]) {
    const src = await read(file);
    assert.doesNotMatch(src, /not yet certified/);
    assert.doesNotMatch(src, /mixes .* Item Group/);
  }
});
