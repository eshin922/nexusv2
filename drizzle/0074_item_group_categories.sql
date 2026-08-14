-- Step 7 · Item Group Category — authority and naming separation.
--
-- The nine assembly-scope rows in `product_types` classify quote-local
-- containers. They have never been product types in the sense the leaf rows
-- are: no HubSpot origin, no field schema, no relationship to a specification.
-- Sharing a table with the leaf Spec Schemas is what let Item Groups be
-- presented as carrying a competing leaf `Product Type`.
--
-- NOT A REDESIGN. Same nine categories, same ids, same names, same behaviour.
-- What changes is which authority owns them.
--
-- WHY A TABLE AND NOT A RENAME. `createAssembly` enforces the separation today
-- with one runtime check (`scope !== 'assembly'` rejects). A separate table
-- makes it structural: the FK cannot reference a leaf Spec Schema, so no code
-- path can hand an assembly one, and no leaf logic can reach a category.
--
-- IDS ARE PRESERVED VERBATIM. Every existing `assemblies.product_type_id`
-- value is already a valid key here, so the backfill is a copy and no row's
-- classification changes. Remapping ids would have made "existing group data
-- is unchanged" something to verify rather than something structurally true.
--
-- ADDITIVE AND REVERSIBLE. `assemblies.product_type_id` is UNTOUCHED and stays
-- dual-written until the separate destructive step, so the currently deployed
-- code keeps reading a column it still populates.

CREATE TABLE IF NOT EXISTS "item_group_categories" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  -- Explicit, because the ordering was previously carried by a CASE expression
  -- in application code keyed on ids. That worked, but it put a display
  -- decision about categories inside a helper named for product types.
  "position" integer NOT NULL DEFAULT 0,
  "hidden" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Seeded FROM the existing rows rather than from a literal list, so the names
-- cannot drift from what operators currently see. Positions reproduce the
-- canonical §15.1 order the CASE expression encoded.
INSERT INTO "item_group_categories" ("id", "name", "position", "hidden")
SELECT
  "id",
  "name",
  CASE "id"
    WHEN 'asy_skincare'        THEN 1
    WHEN 'asy_supplement'      THEN 2
    WHEN 'asy_haircare'        THEN 3
    WHEN 'asy_colorcosmetics'  THEN 4
    WHEN 'asy_body'            THEN 5
    WHEN 'asy_beverage'        THEN 6
    WHEN 'asy_pet'             THEN 7
    WHEN 'asy_household'       THEN 8
    WHEN 'asy_other'           THEN 9
    ELSE 99
  END,
  "hidden"
FROM "product_types"
WHERE "scope" = 'assembly'
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "assemblies"
  ADD COLUMN IF NOT EXISTS "item_group_category_id" text
  REFERENCES "item_group_categories"("id");

UPDATE "assemblies"
   SET "item_group_category_id" = "product_type_id"
 WHERE "product_type_id" IS NOT NULL
   AND "item_group_category_id" IS NULL;
