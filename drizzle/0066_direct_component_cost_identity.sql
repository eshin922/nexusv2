-- OD-017 · One governed cost-input identity: quote_leaves.id.
--
-- Cost inputs key on `assembly_leaf_id` — a row in the ASY↔leaf junction. A
-- Direct Component (`quote_leaves.assembly_id IS NULL`) has no junction row, so
-- today it is structurally expressible but economically unreachable: there is
-- no identity to hang a cost, an override, a target or a freight membership on.
-- This migration moves those four tables onto `quote_leaf_id`, which exists for
-- both shapes and is already the canonical commercial SKU (OD-014).
--
-- WHY RE-KEY RATHER THAN ADD A SECOND NULLABLE KEY. A nullable
-- `assembly_leaf_id` beside a nullable `quote_leaf_id` creates two identity
-- domains and needs a CHECK to keep them exclusive. One column needs no such
-- rule: after this migration there is exactly one domain, so an ASY-backed leaf
-- and a Direct Component cannot collide — not improbably, but unaskably.
--
-- EXPAND ONLY. Nothing is dropped that carries data. `assembly_leaf_id` is
-- retained as nullable legacy evidence; its removal is a later governed cleanup
-- after a release proves nothing reads it.
--
-- PRE-MIGRATION FACTS, measured live (docs/validation/od-017-persistence-model.md §1):
--   assembly_leaf_inputs        298 rows, 298/298 map, 0 orphans
--   assembly_leaf_overrides       0 rows
--   assembly_leaf_targets         0 rows
--   freight_subcategory_items     7 rows,   7/7 map, 0 orphans
--   assembly_leaves             150 rows → 150 DISTINCT quote_leaf_id (injective)
--   quote_leaves                150 rows, 0 Direct Components
--
-- The backfill is lossless because the junction is strictly 1:1 with
-- quote_leaves. That injectivity is also what preserves every uniqueness
-- contract re-keyed below; each was falsified against live data first and
-- returned 0 collisions. The migration does not trust that measurement — every
-- backfill is asserted, and any NULL aborts the transaction.

-- ── assembly_leaf_inputs ────────────────────────────────────────────────────

ALTER TABLE "assembly_leaf_inputs" ADD COLUMN "quote_leaf_id" uuid;--> statement-breakpoint

UPDATE "assembly_leaf_inputs" x
   SET "quote_leaf_id" = al."quote_leaf_id"
  FROM "assembly_leaves" al
 WHERE al."id" = x."assembly_leaf_id";--> statement-breakpoint

DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped FROM "assembly_leaf_inputs" WHERE "quote_leaf_id" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'OD-017 abort: % assembly_leaf_inputs rows did not resolve to a quote leaf', unmapped;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "assembly_leaf_inputs" ALTER COLUMN "quote_leaf_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "assembly_leaf_inputs"
  ADD CONSTRAINT "assembly_leaf_inputs_quote_leaf_id_quote_leaves_id_fk"
  FOREIGN KEY ("quote_leaf_id") REFERENCES "quote_leaves"("id") ON DELETE CASCADE;--> statement-breakpoint

CREATE INDEX "assembly_leaf_inputs_quote_leaf_id_idx"
  ON "assembly_leaf_inputs" ("quote_leaf_id");--> statement-breakpoint

-- One row per (leaf, line, tier) — the anti-duplicate-cell contract, re-keyed.
DROP INDEX IF EXISTS "assembly_leaf_inputs_line_tier_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "assembly_leaf_inputs_line_tier_idx"
  ON "assembly_leaf_inputs" ("quote_leaf_id", "line_group_id", "tier_id");--> statement-breakpoint

-- Legacy column survives as evidence, but may no longer be required: a Direct
-- Component's row has no junction to point at. The FK is RETAINED rather than
-- dropped — NULL satisfies a foreign key, so keeping it costs a Direct
-- Component nothing while continuing to guard every legacy row that does carry
-- a value.
ALTER TABLE "assembly_leaf_inputs" ALTER COLUMN "assembly_leaf_id" DROP NOT NULL;--> statement-breakpoint

-- ── assembly_leaf_overrides ─────────────────────────────────────────────────
-- Empty (0 rows). Re-keying a primary key costs nothing today and will not stay
-- free, which is the argument for doing it now rather than when it has data.

ALTER TABLE "assembly_leaf_overrides" ADD COLUMN "quote_leaf_id" uuid;--> statement-breakpoint

UPDATE "assembly_leaf_overrides" x
   SET "quote_leaf_id" = al."quote_leaf_id"
  FROM "assembly_leaves" al
 WHERE al."id" = x."assembly_leaf_id";--> statement-breakpoint

DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped FROM "assembly_leaf_overrides" WHERE "quote_leaf_id" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'OD-017 abort: % assembly_leaf_overrides rows did not resolve to a quote leaf', unmapped;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "assembly_leaf_overrides" ALTER COLUMN "quote_leaf_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "assembly_leaf_overrides"
  DROP CONSTRAINT "assembly_leaf_overrides_assembly_leaf_id_tier_id_pk";--> statement-breakpoint

ALTER TABLE "assembly_leaf_overrides" ALTER COLUMN "assembly_leaf_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "assembly_leaf_overrides"
  ADD CONSTRAINT "assembly_leaf_overrides_quote_leaf_id_tier_id_pk"
  PRIMARY KEY ("quote_leaf_id", "tier_id");--> statement-breakpoint

ALTER TABLE "assembly_leaf_overrides"
  ADD CONSTRAINT "assembly_leaf_overrides_quote_leaf_id_quote_leaves_id_fk"
  FOREIGN KEY ("quote_leaf_id") REFERENCES "quote_leaves"("id") ON DELETE CASCADE;--> statement-breakpoint

-- ── assembly_leaf_targets ───────────────────────────────────────────────────
-- Empty (0 rows). Same shape as overrides.

ALTER TABLE "assembly_leaf_targets" ADD COLUMN "quote_leaf_id" uuid;--> statement-breakpoint

UPDATE "assembly_leaf_targets" x
   SET "quote_leaf_id" = al."quote_leaf_id"
  FROM "assembly_leaves" al
 WHERE al."id" = x."assembly_leaf_id";--> statement-breakpoint

DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped FROM "assembly_leaf_targets" WHERE "quote_leaf_id" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'OD-017 abort: % assembly_leaf_targets rows did not resolve to a quote leaf', unmapped;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "assembly_leaf_targets" ALTER COLUMN "quote_leaf_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "assembly_leaf_targets"
  DROP CONSTRAINT "assembly_leaf_targets_assembly_leaf_id_tier_id_pk";--> statement-breakpoint

ALTER TABLE "assembly_leaf_targets" ALTER COLUMN "assembly_leaf_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "assembly_leaf_targets"
  ADD CONSTRAINT "assembly_leaf_targets_quote_leaf_id_tier_id_pk"
  PRIMARY KEY ("quote_leaf_id", "tier_id");--> statement-breakpoint

ALTER TABLE "assembly_leaf_targets"
  ADD CONSTRAINT "assembly_leaf_targets_quote_leaf_id_quote_leaves_id_fk"
  FOREIGN KEY ("quote_leaf_id") REFERENCES "quote_leaves"("id") ON DELETE CASCADE;--> statement-breakpoint

-- ── freight_subcategory_items ───────────────────────────────────────────────
-- The subcategory REMAINS the shipment/destination container. Only the product
-- membership is re-keyed. Freight economics, markup, destination, break and
-- customs contracts are untouched by this migration.
--
-- The 7 live rows resolve to 6 distinct quote leaves — one leaf ships in two
-- subcategories, which is legal and stays legal: the identity contract is
-- (subcategory, product), not (product). Re-keyed, the 7 rows form 7 distinct
-- groups, verified before authoring.

ALTER TABLE "freight_subcategory_items" ADD COLUMN "quote_leaf_id" uuid;--> statement-breakpoint

UPDATE "freight_subcategory_items" x
   SET "quote_leaf_id" = al."quote_leaf_id"
  FROM "assembly_leaves" al
 WHERE al."id" = x."assembly_leaf_id";--> statement-breakpoint

DO $$
DECLARE unmapped int;
BEGIN
  SELECT count(*) INTO unmapped FROM "freight_subcategory_items" WHERE "quote_leaf_id" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION 'OD-017 abort: % freight_subcategory_items rows did not resolve to a quote leaf', unmapped;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "freight_subcategory_items" ALTER COLUMN "quote_leaf_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "freight_subcategory_items"
  ADD CONSTRAINT "freight_subcategory_items_quote_leaf_id_quote_leaves_id_fk"
  FOREIGN KEY ("quote_leaf_id") REFERENCES "quote_leaves"("id") ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "freight_subcategory_items"
  DROP CONSTRAINT "freight_subcategory_items_identity_idx";--> statement-breakpoint

ALTER TABLE "freight_subcategory_items"
  ADD CONSTRAINT "freight_subcategory_items_identity_idx"
  UNIQUE ("freight_subcategory_id", "quote_leaf_id");--> statement-breakpoint

CREATE INDEX "freight_subcategory_items_quote_leaf_idx"
  ON "freight_subcategory_items" ("quote_leaf_id");--> statement-breakpoint

ALTER TABLE "freight_subcategory_items" ALTER COLUMN "assembly_leaf_id" DROP NOT NULL;
