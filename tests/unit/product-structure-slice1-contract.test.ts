import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Contract migration validates every reconciliation invariant before NOT NULL", async () => {
  const migration = await read("drizzle/0050_product_structure_slice1_contract.sql");
  for (const invariant of [
    "legacy_missing_mapping", "mapped_identity_mismatch", "mapped_quantity_mismatch",
    "mapped_position_mismatch", "duplicate_legacy_mapping", "cross_quote_product_reference",
    "grouped_canonical_orphan", "duplicate_direct_membership",
    "duplicate_grouped_membership", "pinned_spec_leaf_mismatch",
  ]) assert.match(migration, new RegExp(invariant));
  const gate = migration.indexOf("Slice 1 Contract reconciliation failed");
  const notNull = migration.indexOf("ALTER COLUMN quote_leaf_id SET NOT NULL");
  assert.ok(gate >= 0 && notNull > gate);
  assert.match(migration, /CHECK \(quote_leaf_id IS NOT NULL\) NOT VALID/);
  assert.match(migration, /VALIDATE CONSTRAINT assembly_leaves_quote_leaf_id_contract_nn/);
  assert.match(migration, /LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE assembly_leaves|UPDATE quote_leaves/);
});

test("Contract rollback relaxes only nullability and preserves all data", async () => {
  const rollback = await read("scripts/product-structure/slice1-contract-rollback.sql");
  assert.match(rollback, /ALTER COLUMN quote_leaf_id DROP NOT NULL/);
  assert.doesNotMatch(rollback, /DELETE|UPDATE|DROP TABLE|DROP COLUMN/);
});

test("runtime schema makes compatibility mapping mandatory without removing legacy FKs", async () => {
  const schema = await read("src/db/schema.ts");
  assert.match(schema, /quoteLeafId: uuid\("quote_leaf_id"\)[\s\S]*?\.notNull\(\)[\s\S]*?references/);
  for (const table of ["assemblyLeafInputs", "assemblyLeafOverrides", "assemblyLeafTargets"]) {
    assert.match(schema, new RegExp(`export const ${table}[\\s\\S]*assemblyLeafId:[\\s\\S]*references\\(\\(\\) => assemblyLeaves\\.id`));
  }
});

test("Contract assets remain inactive and Direct production writes remain absent", async () => {
  const [journal, boundary] = await Promise.all([
    read("drizzle/meta/_journal.json"),
    read("src/lib/product-structure/grouped-membership-compatibility.ts"),
  ]);
  assert.doesNotMatch(journal, /0049_product_structure_slice1_backfill/);
  assert.doesNotMatch(journal, /0050_product_structure_slice1_contract/);
  assert.doesNotMatch(boundary, /assemblyId:\s*null/);
  assert.match(boundary, /invalid canonical mapping/);
});

test("controlled rehearsal proves null abort, rollback, hashes, and reapplication", async () => {
  const rehearsal = await read("scripts/product-structure/slice1-contract-rehearsal.ts");
  assert.match(rehearsal, /assertRuntimeSafety\(\)/);
  assert.match(rehearsal, /legacy_missing_mapping=1/);
  assert.match(rehearsal, /dataHashesUnchanged: true/);
  assert.match(rehearsal, /forwardReapplyMs/);
  assert.match(rehearsal, /externalCalls: 0/);
});
