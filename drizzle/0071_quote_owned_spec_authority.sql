-- B-3 · quote-owned product specification authority.
--
-- A Library product is reusable master data whose Product Type and default
-- specs are a TEMPLATE for future attachments. Once attached to a quote, that
-- quote owns its specification outright: editing it changes nothing else, and
-- later Library changes reach future attachments only.
--
-- Scope is what the table was missing. `version_number`, `is_current` and the
-- effective dates were all scoped to a leaf's LIBRARY timeline; quote-owned
-- rows are siblings, not a succession, and without a scope column those three
-- would each have to mean two things. `quote_id` names the scope, and each
-- column then means one thing within it.
--
--   quote_id IS NULL      → Library master / default (a version lineage)
--   quote_id IS NOT NULL  → quote-owned authority (no lineage; one per quote)

ALTER TABLE "leaf_specs"
  ADD COLUMN "quote_id" uuid REFERENCES "quotes"("id") ON DELETE CASCADE,
  ADD COLUMN "templated_from_spec_id" uuid REFERENCES "leaf_specs"("id"),
  -- The Product Type IS the schema `spec_values` are validated against, so a
  -- quote that froze its values while inheriting a mutable Library type would
  -- reproduce the same defect one level down: a Library type change would
  -- silently invalidate or empty every quote's pinned specification, with no
  -- record of what schema those values were authored under.
  -- text, matching product_types.id — NOT uuid.
  ADD COLUMN "product_type_id" text REFERENCES "product_types"("id");

-- One quote-owned authority per (quote, leaf). This is the rule that two
-- appearances of the same SKU in one quote cannot silently diverge, enforced by
-- construction rather than by convention — and it is why quote-side edits need
-- no reference counting: exclusivity is structural.
CREATE UNIQUE INDEX "leaf_specs_quote_owned_idx"
  ON "leaf_specs" ("quote_id", "leaf_id") WHERE "quote_id" IS NOT NULL;

-- Only a Library-scope row may be the Library default. A relaxation of the
-- existing predicate, not a tightening of the data: every row satisfies
-- quote_id IS NULL at this moment, so no existing row can violate it.
DROP INDEX IF EXISTS "leaf_specs_current_idx";
CREATE UNIQUE INDEX "leaf_specs_current_idx"
  ON "leaf_specs" ("leaf_id") WHERE "quote_id" IS NULL AND "is_current" = true;

-- Resolution index: the quote-context readers look up by (quote, leaf).
CREATE INDEX "leaf_specs_quote_leaf_idx" ON "leaf_specs" ("quote_id", "leaf_id");

-- ---------------------------------------------------------------------------
-- Backfill — every existing attachment emerges with its own authority.
--
-- DELIBERATELY is_current = false ON QUOTE-OWNED ROWS. `is_current` is a
-- Library-scope concept and quote rows opt out of it, which has a second
-- effect that makes this migration safe to apply ahead of the code: every
-- deployed reader filters `is_current = true`, so the rows created here are
-- invisible to them and their results are unchanged. Had these been created
-- `true`, a deployed reader's `limit(1)` could have returned another quote's
-- specification.
--
-- With quote_id present the flag is still unambiguous:
--   quote_id IS NULL  AND is_current = false → superseded Library version
--   quote_id IS NOT NULL                     → live quote authority
-- Quote authority is established by the pointer, never by the flag.
--
-- LOSSLESS, and provably: there are zero superseded historical rows and the
-- maximum version_number is 1, so where a Library spec exists it is the only
-- row that has ever existed for that leaf. Copying it is exact, not a
-- reconstruction of history.
INSERT INTO "leaf_specs" (
  "leaf_id", "quote_id", "spec_values", "product_type_id",
  "templated_from_spec_id", "version_number", "is_current",
  "created_by", "updated_by"
)
SELECT
  ql."leaf_id",
  ql."quote_id",
  COALESCE(lib."spec_values", '{}'::jsonb),
  l."product_type_id",
  lib."id",
  1,
  false,
  -- Attribution for a system migration: the spec's original author where one
  -- exists, else the project's PM (pm_user_id lives on projects, not quotes),
  -- else the earliest user. Never invented.
  COALESCE(lib."created_by", p."pm_user_id",
           (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1)),
  NULL
FROM (SELECT DISTINCT "quote_id", "leaf_id" FROM "quote_leaves") ql
JOIN "quotes" q ON q."id" = ql."quote_id"
JOIN "projects" p ON p."id" = q."project_id"
JOIN "leaves" l ON l."id" = ql."leaf_id"
LEFT JOIN "leaf_specs" lib
  ON lib."leaf_id" = ql."leaf_id"
 AND lib."quote_id" IS NULL
 AND lib."is_current" = true;

-- Point every attachment at its quote's authority. Multiple attachments of the
-- same leaf in one quote resolve to the same row, by the unique index above.
UPDATE "quote_leaves" ql
SET "leaf_spec_version_id" = ls."id",
    "pinned_at" = now()
FROM "leaf_specs" ls
WHERE ls."quote_id" = ql."quote_id"
  AND ls."leaf_id" = ql."leaf_id";
