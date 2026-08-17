-- Client Target authority, keyed to the top-level sellable unit.
--
-- ADDITIVE ONLY. One new table, no column tightened, nothing dropped — so this
-- is safe to apply ahead of the code that reads it, per the deployment-order
-- rule in CLAUDE.md ("Migration deployment order is determined by
-- compatibility"). No deployed writer can violate a constraint on a table that
-- does not yet exist for it.
--
-- `assembly_leaf_targets` is deliberately NOT dropped here. It holds zero rows
-- and becomes dead once the read path moves, but dropping it is a DESTRUCTIVE
-- migration and must not precede the code that stops reading it. It goes in a
-- follow-up, after this ships.
--
-- WHY A NEW TABLE RATHER THAN REUSING THE OLD ONE
--
-- `assembly_leaf_targets` keys `(quote_leaf_id, tier_id)`. That is the correct
-- identity for a Direct Product, where the leaf IS the sellable unit, and the
-- wrong one for an Item Group, where a leaf is an internal member nobody named
-- a price for — and there is no key on it that addresses an Item Group
-- finished good at all. It also cannot express "one target across all tiers",
-- because `tier_id` is NOT NULL and in its primary key.
--
-- Zero live rows meant the identity could be corrected rather than preserved.
-- Full trace: docs/validation/client-target-identity-trace.md

CREATE TABLE "quote_client_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL,
  -- Exactly one of the next two. The CHECK below enforces it.
  "assembly_id" uuid,
  "quote_leaf_id" uuid,
  -- NULL = the common target, applying to every tier.
  "tier_id" uuid,
  "client_target_price_per_unit" numeric(10, 4) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_client_targets_one_unit" CHECK (
    ("assembly_id" IS NOT NULL AND "quote_leaf_id" IS NULL)
    OR ("assembly_id" IS NULL AND "quote_leaf_id" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "quote_client_targets"
  ADD CONSTRAINT "quote_client_targets_quote_id_quotes_id_fk"
  FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_client_targets"
  ADD CONSTRAINT "quote_client_targets_assembly_id_assemblies_id_fk"
  FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_client_targets"
  ADD CONSTRAINT "quote_client_targets_quote_leaf_id_quote_leaves_id_fk"
  FOREIGN KEY ("quote_leaf_id") REFERENCES "public"."quote_leaves"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_client_targets"
  ADD CONSTRAINT "quote_client_targets_tier_id_quote_tiers_id_fk"
  FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "quote_client_targets_quote_idx"
  ON "quote_client_targets" USING btree ("quote_id");
--> statement-breakpoint
-- The business invariant: one COMMON target per sellable unit, and one
-- EXPLICIT target per sellable unit per tier.
--
-- Four partial indexes rather than two plain ones because Postgres treats NULL
-- as distinct in a unique index, so `UNIQUE (assembly_id, tier_id)` would admit
-- any number of rows with `tier_id IS NULL` — i.e. any number of "common"
-- targets for one unit, which is the one thing this must prevent.
CREATE UNIQUE INDEX "quote_client_targets_asy_common_uq"
  ON "quote_client_targets" USING btree ("assembly_id")
  WHERE assembly_id IS NOT NULL AND tier_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_client_targets_asy_tier_uq"
  ON "quote_client_targets" USING btree ("assembly_id","tier_id")
  WHERE assembly_id IS NOT NULL AND tier_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_client_targets_leaf_common_uq"
  ON "quote_client_targets" USING btree ("quote_leaf_id")
  WHERE quote_leaf_id IS NOT NULL AND tier_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_client_targets_leaf_tier_uq"
  ON "quote_client_targets" USING btree ("quote_leaf_id","tier_id")
  WHERE quote_leaf_id IS NOT NULL AND tier_id IS NOT NULL;
