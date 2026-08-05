import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("all explicit grouped membership writers use the governed boundary", async () => {
  const [assemblies, quotes, boundary] = await Promise.all([
    read("src/app/actions/assemblies.ts"),
    read("src/app/actions/quotes.ts"),
    read("src/lib/product-structure/grouped-membership-compatibility.ts"),
  ]);
  assert.match(assemblies, /attachGroupedMembership\(tx/);
  assert.match(assemblies, /detachGroupedMembership\(tx/);
  assert.match(assemblies, /detachGroupedMembershipsForAssembly\(tx/);
  assert.match(assemblies, /reorderGroupedMemberships\(tx/);
  assert.match(quotes, /attachGroupedMembership\(tx/);
  assert.doesNotMatch(assemblies, /\.insert\(assemblyLeaves\)/);
  assert.doesNotMatch(assemblies, /\.update\(assemblyLeaves\)/);
  assert.doesNotMatch(assemblies, /\.delete\(assemblyLeaves\)/);
  assert.doesNotMatch(quotes, /\.insert\(assemblyLeaves\)/);
  assert.match(boundary, /updateGroupedMembershipQuantity/);
});

test("compatibility boundary defines canonical-first mutation and explicit detach order", async () => {
  const boundary = await read("src/lib/product-structure/grouped-membership-compatibility.ts");
  const attachCanonical = boundary.indexOf(".insert(quoteLeaves)");
  const attachLegacy = boundary.indexOf(".insert(assemblyLeaves)");
  assert.ok(attachCanonical >= 0 && attachLegacy > attachCanonical);
  const detachLegacy = boundary.indexOf(".delete(assemblyLeaves)");
  const detachCanonical = boundary.indexOf(".delete(quoteLeaves)");
  assert.ok(detachLegacy >= 0 && detachCanonical > detachLegacy);
  assert.match(boundary, /attach_after_canonical/);
  assert.match(boundary, /detach_after_legacy/);
  assert.match(boundary, /quantity_after_canonical/);
  assert.match(boundary, /reorder_after_canonical/);
});

test("existing authentication and draft guards remain on operator actions", async () => {
  const actions = await read("src/app/actions/assemblies.ts");
  for (const name of [
    "attachAssemblyLeaf",
    "detachAssemblyLeaf",
    "reorderAssemblyLeaves",
    "deleteAssembly",
  ]) {
    const start = actions.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, `${name} missing`);
    const next = actions.indexOf("export async function", start + 1);
    const body = actions.slice(start, next < 0 ? undefined : next);
    assert.match(body, /ensureUser\(\)/, `${name} authentication guard missing`);
    assert.match(body, /assertDraft\(quote\)/, `${name} draft guard missing`);
  }
});

test("controlled Slice 1 migrations remain inactive as later additive migrations advance", async () => {
  const journal = JSON.parse(await read("drizzle/meta/_journal.json")) as {
    entries: Array<{ tag: string }>;
  };
  assert.equal(journal.entries.at(-1)?.tag, "0055_phase_2_worksheet_freight_snapshots");
  assert.equal(
    journal.entries.some((entry) => entry.tag === "0049_product_structure_slice1_backfill"),
    false,
  );
  assert.equal(
    journal.entries.some((entry) => entry.tag === "0050_product_structure_slice1_contract"),
    false,
  );
});

test("delete FK contract preserves legacy dependents and reusable LEAF", async () => {
  const [schema, expand] = await Promise.all([
    read("src/db/schema.ts"),
    read("drizzle/0048_product_structure_slice1_expand.sql"),
  ]);
  assert.match(schema, /assemblyLeafId:[\s\S]*references\(\(\) => assemblyLeaves\.id, \{ onDelete: "cascade" \}\)/);
  assert.match(schema, /leafId:[\s\S]*references\(\(\) => leaves\.id, \{ onDelete: "restrict" \}\)/);
  assert.match(expand, /assembly_leaves_quote_leaf_id_quote_leaves_id_fk[\s\S]*ON DELETE cascade/);
});
