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
