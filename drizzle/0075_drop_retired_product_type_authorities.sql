-- Step 9 · isolated destructive removal of the retired legacy authorities.
--
--   leaves.product_type_id       the Nexus leaf taxonomy, superseded by
--                                HubSpot `hs_product_type` + the pinned
--                                Spec Schema
--   assemblies.product_type_id   superseded by item_group_category_id
--
-- `leaf_specs.product_type_id` is DELIBERATELY NOT INCLUDED. It is a different
-- column with a different disposition, held separately.
--
-- No compatibility alias. No replacement column carrying the old semantics. No
-- fallback read. No legacy write path. The point is structural removal.
--
-- ============================================================================
-- ARMED 2026-08-14. Deployment prerequisite satisfied.
-- ============================================================================
--
-- A destructive migration must never precede the code that stops depending on
-- the thing being destroyed. That prerequisite is met:
--
--   * main merged at 76bc952;
--   * GitHub/Vercel Production deployment for that commit succeeded, and no
--     newer Production deployment exists;
--   * the merged code carries ZERO references to either column — both
--     declarations, the leaves_product_type_idx index, the dual-writes in
--     createAssembly and copyQuote, and every reader were removed before the
--     merge;
--   * because Drizzle emits column lists from the model, that code is
--     compatible with the still-present columns, which is what made it safe to
--     deploy FIRST;
--   * Preview exercised the authority cutover against this same shared database
--     before merge.
--
-- The failure this ordering avoids is the 0066 attach-product outage: a schema
-- change landing ahead of the code, turning a dormant mismatch into 42703 for
-- every operator.
--
-- SCOPE. Two columns, both retired authorities. `leaf_specs.product_type_id` is
-- a DIFFERENT column with a separate disposition and is deliberately untouched.
-- No compatibility alias, no replacement column carrying the old semantics, no
-- fallback read, no legacy write path.

ALTER TABLE "leaves" DROP COLUMN IF EXISTS "product_type_id";

-- The index over the dropped column goes with it. Named explicitly rather than
-- relying on the implicit cascade, so the intent is legible in the migration
-- rather than inferred from Postgres behaviour.
DROP INDEX IF EXISTS "leaves_product_type_idx";

ALTER TABLE "assemblies" DROP COLUMN IF EXISTS "product_type_id";
