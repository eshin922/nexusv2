CREATE TYPE "public"."markup_pct_source" AS ENUM('category_default', 'manual_override');--> statement-breakpoint
CREATE TABLE "markup_defaults" (
	"category" text PRIMARY KEY NOT NULL,
	"default_markup_pct" numeric(5, 4) NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packaging_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_sku_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"line_group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"supplier" text,
	"qty_per_sellable_unit" numeric,
	"category" text,
	"markup_pct" numeric(5, 4),
	"markup_pct_source" "markup_pct_source",
	"inventory_eligible" boolean DEFAULT false NOT NULL,
	"notes" text,
	"unit_cost" numeric(10, 4),
	"purchase_qty" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markup_defaults" ADD CONSTRAINT "markup_defaults_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_inputs" ADD CONSTRAINT "packaging_inputs_quote_sku_id_quote_skus_id_fk" FOREIGN KEY ("quote_sku_id") REFERENCES "public"."quote_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaging_inputs" ADD CONSTRAINT "packaging_inputs_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "packaging_inputs_line_tier_idx" ON "packaging_inputs" USING btree ("quote_sku_id","line_group_id","tier_id");--> statement-breakpoint
CREATE INDEX "packaging_inputs_quote_sku_id_idx" ON "packaging_inputs" USING btree ("quote_sku_id");--> statement-breakpoint
CREATE INDEX "packaging_inputs_tier_id_idx" ON "packaging_inputs" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "packaging_inputs_line_group_id_idx" ON "packaging_inputs" USING btree ("line_group_id");--> statement-breakpoint
-- Seed markup_defaults with the temporary Excel-worksheet vocabulary.
-- Slice 9 will rewrite this entirely with the new "line of work" schedule.
-- ON CONFLICT DO NOTHING makes the migration safely re-runnable.
INSERT INTO "markup_defaults" ("category", "default_markup_pct") VALUES
  ('Primary',       0.4000),
  ('Secondary',     0.5000),
  ('Manufacturing', 0.3000),
  ('Tooling',       0.2000),
  ('Freight',       0.2000),
  ('Soft Goods',    0.3500),
  ('Other',         0.3000)
ON CONFLICT ("category") DO NOTHING;