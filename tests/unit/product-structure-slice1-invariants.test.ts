import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyMembership,
  PREFLIGHT_CLASSIFICATIONS,
  type MembershipCandidate,
} from "../../scripts/product-structure/slice1-preflight.ts";

const base: MembershipCandidate = {
  assemblyLeafId: "al-1",
  quoteId: "q-1",
  assemblyId: "a-1",
  leafId: "l-1",
  quantity: "2.0000",
  position: 3,
  parentAssemblyLeafId: null,
  mappedQuoteLeafId: null,
  requiredReferencesValid: true,
  candidates: [],
};

test("Slice 1 preflight exposes every approved classification", () => {
  assert.deepEqual(PREFLIGHT_CLASSIFICATIONS, [
    "missing_canonical_row",
    "exact_existing_match",
    "value_conflict",
    "duplicate_canonical_candidates",
    "orphan_canonical_grouped_row",
    "cross_quote_product_reference",
    "nested_legacy_membership",
    "invalid_required_reference",
  ]);
});

test("Slice 1 membership classification is deterministic and fail-closed", () => {
  assert.equal(classifyMembership(base), "missing_canonical_row");
  assert.equal(
    classifyMembership({
      ...base,
      mappedQuoteLeafId: "ql-1",
      candidates: [{ id: "ql-1", quantity: "2", position: 3 }],
    }),
    "exact_existing_match",
  );
  assert.equal(
    classifyMembership({
      ...base,
      candidates: [{ id: "ql-1", quantity: "1", position: 3 }],
    }),
    "value_conflict",
  );
  assert.equal(
    classifyMembership({
      ...base,
      candidates: [
        { id: "ql-1", quantity: "2", position: 3 },
        { id: "ql-2", quantity: "2", position: 3 },
      ],
    }),
    "duplicate_canonical_candidates",
  );
  assert.equal(
    classifyMembership({ ...base, parentAssemblyLeafId: "parent-1" }),
    "nested_legacy_membership",
  );
  assert.equal(
    classifyMembership({ ...base, quoteId: null }),
    "invalid_required_reference",
  );
  assert.equal(
    classifyMembership({ ...base, requiredReferencesValid: false }),
    "invalid_required_reference",
  );
  assert.equal(
    classifyMembership({
      ...base,
      mappedQuoteLeafId: "wrong",
      candidates: [{ id: "ql-1", quantity: "2", position: 3 }],
    }),
    "invalid_required_reference",
  );
});

test("Expand migration is additive and does not expose Direct writers", async () => {
  const migration = await readFile(
    new URL("../../drizzle/0048_product_structure_slice1_expand.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ALTER COLUMN "assembly_id" DROP NOT NULL/);
  assert.match(migration, /ADD COLUMN "quote_leaf_id" uuid/);
  assert.match(migration, /quote_leaves_assembly_quote_fk/);
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /assembly_leaves_quote_leaf_idx/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/);

  const actions = await Promise.all([
    readFile(new URL("../../src/app/actions/assemblies.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/actions/leaves.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(actions.join("\n"), /attachQuoteLeaf|attachDirectLeaf/);
});

test("proposed Backfill is bounded, fail-closed, and identity-only", async () => {
  const migration = await readFile(
    new URL("../../drizzle/0049_product_structure_slice1_backfill.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /approved_maximum_row_ceiling constant integer := 250/);
  assert.match(migration, /source_count > approved_maximum_row_ceiling/);
  assert.match(migration, /blocker_count <> 0/);
  for (const classification of PREFLIGHT_CLASSIFICATIONS) {
    assert.match(migration, new RegExp(classification));
  }
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /SET LOCAL nexus\.product_structure_write_bypass = 'migration-0049'/);
  assert.match(migration, /LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(migration, /parent_assembly_leaf_id IS NULL/);
  assert.match(migration, /SET quote_leaf_id = s\.final_quote_leaf_id/);
  assert.match(migration, /INSERT INTO quote_leaves/);
  assert.match(migration, /slice1_backfill_manifest/);
  assert.match(migration, /original_leaf_spec_version_id/);
  assert.match(migration, /specification_pin_preservation_status/);
  assert.match(migration, /prior_created_mapping/);
  assert.doesNotMatch(
    migration,
    /assembly_leaf_inputs|assembly_leaf_overrides|assembly_leaf_targets|quote_snapshots|netsuite_so_pushes/,
  );
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE|ALTER COLUMN/);
});

test("write pause blocks mixed-version writers at the database boundary", async () => {
  const pause = await readFile(
    new URL("../../scripts/product-structure/slice1-write-pause.sql", import.meta.url),
    "utf8",
  );
  const resume = await readFile(
    new URL("../../scripts/product-structure/slice1-write-resume.sql", import.meta.url),
    "utf8",
  );
  assert.match(pause, /BEFORE INSERT OR UPDATE OR DELETE ON assembly_leaves/);
  assert.match(pause, /BEFORE INSERT OR UPDATE OR DELETE ON quote_leaves/);
  assert.match(pause, /IS DISTINCT FROM 'migration-0049'/);
  assert.match(resume, /DROP TRIGGER IF EXISTS slice1_write_pause ON assembly_leaves/);
  assert.match(resume, /DROP TRIGGER IF EXISTS slice1_write_pause ON quote_leaves/);
});

test("draft Backfill cannot be applied by the generic migration command", async () => {
  const journal = JSON.parse(
    await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  assert.equal(
    journal.entries.some((entry) => entry.tag === "0049_product_structure_slice1_backfill"),
    false,
  );
  assert.equal(journal.entries.at(-1)?.tag, "0048_product_structure_slice1_expand");
});

test("Backfill rollback is manifest-selected and clears pointers first", async () => {
  const rollback = await readFile(
    new URL("../../scripts/product-structure/slice1-backfill-rollback.sql", import.meta.url),
    "utf8",
  );
  const clearAt = rollback.indexOf("UPDATE assembly_leaves al SET quote_leaf_id = NULL");
  const deleteAt = rollback.indexOf("DELETE FROM quote_leaves ql");
  assert.ok(clearAt >= 0 && deleteAt > clearAt);
  assert.match(rollback, /action_classification = 'created'/);
  assert.match(rollback, /NOT m\.original_canonical_row_existed/);
  assert.match(rollback, /Rollback selection uncertain/);
});
