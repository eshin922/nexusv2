ALTER TABLE "firm_settings" ADD COLUMN "freight_markup_pct_default" numeric(5,4) NOT NULL DEFAULT 0.3000;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "freight_markup_pct" numeric(5,4) DEFAULT 0.3000;--> statement-breakpoint
ALTER TABLE "quote_commercial_settings_pins" ADD COLUMN "freight_markup_pct" numeric(5,4);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM freight_legs fl
    JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
    GROUP BY flg.quote_id
    HAVING count(DISTINCT fl.freight_markup_pct) > 1
  ) THEN
    RAISE EXCEPTION 'Phase 2 freight migration blocked: divergent leg markups exist within a Quote';
  END IF;
END $$;--> statement-breakpoint

UPDATE quotes q
SET freight_markup_pct = source.freight_markup_pct
FROM (
  SELECT flg.quote_id, min(fl.freight_markup_pct) AS freight_markup_pct
  FROM freight_legs fl
  JOIN freight_leg_groups flg ON flg.id = fl.leg_group_id
  GROUP BY flg.quote_id
) source
WHERE q.id = source.quote_id;--> statement-breakpoint

UPDATE quotes
SET freight_markup_pct = (
  SELECT freight_markup_pct_default
  FROM firm_settings
  WHERE effective_until IS NULL
  ORDER BY effective_from DESC
  LIMIT 1
)
WHERE freight_markup_pct IS NULL;--> statement-breakpoint

ALTER TABLE "quotes" ALTER COLUMN "freight_markup_pct" SET NOT NULL;--> statement-breakpoint

UPDATE quote_commercial_settings_pins pin
SET freight_markup_pct = q.freight_markup_pct
FROM quotes q
WHERE q.id = pin.quote_id;--> statement-breakpoint
ALTER TABLE "quote_commercial_settings_pins" ALTER COLUMN "freight_markup_pct" SET NOT NULL;--> statement-breakpoint

CREATE TABLE "freight_leg_component_tier_costs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_leg_id" uuid NOT NULL REFERENCES "freight_legs"("id") ON DELETE cascade,
  "quote_leaf_id" uuid NOT NULL REFERENCES "quote_leaves"("id") ON DELETE cascade,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE cascade,
  "actual_freight_cost" numeric(12,2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "freight_leg_component_tier_costs_nonnegative" CHECK (actual_freight_cost IS NULL OR actual_freight_cost >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "freight_leg_component_tier_costs_identity_idx" ON "freight_leg_component_tier_costs" ("freight_leg_id","quote_leaf_id","tier_id");--> statement-breakpoint
CREATE INDEX "freight_leg_component_tier_costs_leaf_idx" ON "freight_leg_component_tier_costs" ("quote_leaf_id");--> statement-breakpoint

CREATE TABLE "quote_snapshot_freight_inputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_snapshot_id" uuid NOT NULL REFERENCES "quote_snapshots"("id") ON DELETE cascade,
  "source_freight_leg_id" uuid NOT NULL,
  "source_quote_leaf_id" uuid NOT NULL,
  "source_tier_id" uuid NOT NULL,
  "actual_freight_cost" numeric(12,2) NOT NULL,
  "effective_units" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_snapshot_freight_inputs_cost_nonnegative" CHECK (actual_freight_cost >= 0),
  CONSTRAINT "quote_snapshot_freight_inputs_units_positive" CHECK (effective_units > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "quote_snapshot_freight_inputs_identity_idx" ON "quote_snapshot_freight_inputs" ("quote_snapshot_id","source_freight_leg_id","source_quote_leaf_id","source_tier_id");--> statement-breakpoint

CREATE FUNCTION enforce_component_freight_same_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE leg_quote uuid; leaf_quote uuid; tier_quote uuid;
BEGIN
  SELECT flg.quote_id INTO leg_quote FROM freight_legs fl JOIN freight_leg_groups flg ON flg.id=fl.leg_group_id WHERE fl.id=NEW.freight_leg_id;
  SELECT quote_id INTO leaf_quote FROM quote_leaves WHERE id=NEW.quote_leaf_id;
  SELECT quote_id INTO tier_quote FROM quote_tiers WHERE id=NEW.tier_id;
  IF leg_quote IS NULL OR leaf_quote IS NULL OR tier_quote IS NULL OR leg_quote<>leaf_quote OR leg_quote<>tier_quote THEN
    RAISE EXCEPTION 'component freight identity must resolve exactly one Quote';
  END IF;
  IF EXISTS (SELECT 1 FROM freight_leg_tiers WHERE freight_leg_id=NEW.freight_leg_id AND tier_id=NEW.tier_id AND total_freight IS NOT NULL) THEN
    RAISE EXCEPTION 'legacy and component freight cannot coexist for one leg/tier';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "freight_component_same_quote" BEFORE INSERT OR UPDATE ON "freight_leg_component_tier_costs" FOR EACH ROW EXECUTE FUNCTION enforce_component_freight_same_quote();--> statement-breakpoint

CREATE FUNCTION prevent_legacy_component_freight_mix() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_freight IS NOT NULL AND EXISTS (SELECT 1 FROM freight_leg_component_tier_costs WHERE freight_leg_id=NEW.freight_leg_id AND tier_id=NEW.tier_id) THEN
    RAISE EXCEPTION 'legacy and component freight cannot coexist for one leg/tier';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "freight_legacy_component_exclusive" BEFORE INSERT OR UPDATE ON "freight_leg_tiers" FOR EACH ROW EXECUTE FUNCTION prevent_legacy_component_freight_mix();
