-- BV-011 destination mapping + the Tooling / Artwork split.
--
-- ADDITIVE ONLY. One new table, one new enum, three new columns. Nothing
-- existing is altered or dropped, so no deployed-writer compatibility proof is
-- required — there is nothing current code could violate.
--
-- `netsuite_service_item_map` is NOT dropped here. Per the amended deployment
-- rule the additive create and backfill land first, deployed code moves onto
-- the new model, and only then is the old table retired in a later migration.

-- ── 1 · the governed destination catalogue ───────────────────────────────
--
-- All sixteen BV-011 destinations, not only the seven V1 reaches. The set is a
-- business fact governed by BV-011; enumerating it fully means adding an input
-- later needs a mapping row, not an enum migration.
--
-- Keys are snake_case rather than the display strings ("OTC - Freight, Duties,
-- Tariffs" carries commas and spaces). The display label and the governed item
-- type live in code, where BV-011 is the authority — duplicating item type into
-- this table would create a second copy free to drift from the document that
-- governs it.
CREATE TYPE "bv011_destination" AS ENUM (
  -- §1.a finished-good component / item
  'otc_filling',
  'otc_packout',
  'otc_raws',
  -- §1.b OTC / service lines
  'otc_freight_duties_tariffs',
  'otc_customs',
  'otc_setup',
  'otc_artwork',
  'otc_tooling',
  'otc_formulation',
  'otc_testing',
  'otc_other_service',
  'otc_dies',
  'otc_print_plates',
  'otc_samples',
  'otc_processing_fee',
  'otc_cartons'
);

-- ── 2 · destination → NetSuite record ────────────────────────────────────
--
-- Keyed on the DESTINATION, not on the economic source.
--
-- The previous table keyed on `service_identity`, which conflated what a fee
-- MEANS (BV-011, fixed) with which record it POSTS TO (admin-governed). The
-- conflation was already biting: `rd_total` and the `formulation` service
-- identity both resolve to `OTC - Formulation`, so identity-keying needed two
-- rows for one item and they were free to drift apart. Destination-keying
-- makes that one row, structurally.
--
-- Admins configure the NetSuite record here. They do not configure the
-- accounting meaning of a fee; that is BV-011's and is not editable.
CREATE TABLE "netsuite_destination_item_map" (
  "destination" "bv011_destination" PRIMARY KEY,
  "netsuite_item_code" text,
  "netsuite_internal_id" text,
  -- Last successful resolution against NetSuite. NULL means never verified —
  -- distinct from "verified and found missing", which the action layer records
  -- by clearing the ids. A transient NetSuite failure must leave BOTH of these
  -- untouched: indeterminate is not the same as unmapped (#291 disposition).
  "resolved_at" timestamptz,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "netsuite_destination_item_map" IS
  'BV-011 destination -> NetSuite item. Admins configure the record, never the accounting meaning. Supersedes netsuite_service_item_map, which keyed on economic source identity and therefore needed one row per source rather than per destination.';

-- Carry the single governed mapping forward. `filling_blending -> BLD-FILL`
-- was a service-identity row; the same NetSuite record is the OTC - Filling
-- destination.
INSERT INTO "netsuite_destination_item_map"
  ("destination", "netsuite_item_code", "netsuite_internal_id",
   "resolved_at", "resolved_by_user_id")
SELECT 'otc_filling', m."netsuite_item_code", m."netsuite_internal_id",
       m."resolved_at", m."resolved_by_user_id"
  FROM "netsuite_service_item_map" m
 WHERE m."service_identity" = 'filling_blending'
ON CONFLICT ("destination") DO NOTHING;

-- ── 3 · Tooling and Artwork become distinct inputs ───────────────────────
--
-- BV-011 governs them as separate destinations with DIFFERENT item types:
-- `OTC - Tooling` is an Inventory Item, `OTC - Artwork` is Non-inventory. One
-- Nexus column could only ever post one of them correctly, and posting Artwork
-- through an Inventory Item to avoid a migration is a knowingly wrong
-- accounting record.
--
-- `tooling_artwork_total` is DELIBERATELY RETAINED, not backfilled and not
-- split. There is no authoritative rule for whether an existing combined amount
-- is Tooling, Artwork, or both — any split would be fabricated. It stays as
-- legacy unresolved data, recognizable by being non-null, and an operator
-- resolves it into the two governed inputs when a value must project.
ALTER TABLE "assembly_production_inputs"
  ADD COLUMN "tooling_total" numeric(12, 2),
  ADD COLUMN "artwork_total" numeric(12, 2);

COMMENT ON COLUMN "assembly_production_inputs"."tooling_artwork_total" IS
  'LEGACY, unresolved. Predates the BV-011 Tooling/Artwork split. Never backfilled: no rule can say whether a combined amount is Tooling, Artwork, or both, so any split would be fabricated. Still contributes to unit economics exactly as before. A separately-billed value here BLOCKS NetSuite projection with a named remediation rather than being guessed or skipped.';

COMMENT ON COLUMN "assembly_production_inputs"."tooling_total" IS
  'BV-011 OTC - Tooling (Inventory Item).';
COMMENT ON COLUMN "assembly_production_inputs"."artwork_total" IS
  'BV-011 OTC - Artwork (Non-inventory Item).';

-- ── 4 · the frozen line records its governed destination ─────────────────
--
-- NULL is normal and means different things per line kind, which is why it is
-- not NOT NULL: a product line resolves by SKU and has no BV-011 destination
-- at all, whereas an OTC line with NULL here is the legacy combined charge —
-- the state that blocks projection.
--
-- Persisted rather than re-derived so the frozen row is self-describing. The
-- alternative is string-matching `display_name` at push time, which would make
-- a copy change silently repoint an accounting destination.
ALTER TABLE "quote_snapshot_lines"
  ADD COLUMN "bv011_destination" "bv011_destination";

COMMENT ON COLUMN "quote_snapshot_lines"."bv011_destination" IS
  'Governed BV-011 destination for this line, fixed by the input it came from. NULL on product lines (they resolve by SKU) and on legacy combined Tooling/Artwork charges (which block projection).';
