-- Slice 5.5 architecture revision: drop 'formulation_assembly' from
-- sku_role enum and rename 'umbrella' → 'assembly'. Final values:
-- ('leaf', 'assembly'). See docs/BOM_NOTES.md for rationale (formulation
-- is captured by cost_category, not sku_role).
--
-- Step 1: rename umbrella → assembly in-place (preserves existing rows
-- without column manipulation).
ALTER TYPE "public"."sku_role" RENAME VALUE 'umbrella' TO 'assembly';--> statement-breakpoint
-- Step 2: defensively backfill any formulation_assembly rows (none exist
-- in current state but make the migration idempotent if reapplied).
UPDATE "public"."quote_skus" SET "sku_role" = 'assembly' WHERE "sku_role"::text = 'formulation_assembly';--> statement-breakpoint
-- Step 3: drop column default so the type can be recreated.
ALTER TABLE "public"."quote_skus" ALTER COLUMN "sku_role" DROP DEFAULT;--> statement-breakpoint
-- Step 4: cast column to text, drop the old enum (which still carries
-- the unused 'formulation_assembly' value), recreate enum with only
-- 'leaf' and 'assembly', then cast column back.
ALTER TABLE "public"."quote_skus" ALTER COLUMN "sku_role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."sku_role";--> statement-breakpoint
CREATE TYPE "public"."sku_role" AS ENUM('leaf', 'assembly');--> statement-breakpoint
ALTER TABLE "public"."quote_skus" ALTER COLUMN "sku_role" SET DATA TYPE "public"."sku_role" USING "sku_role"::"public"."sku_role";--> statement-breakpoint
-- Step 5: restore the default.
ALTER TABLE "public"."quote_skus" ALTER COLUMN "sku_role" SET DEFAULT 'leaf'::"public"."sku_role";
