CREATE TABLE "assembly_leaf_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_leaf_id" uuid NOT NULL,
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
CREATE TABLE "assembly_leaf_overrides" (
	"assembly_leaf_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"sell_price_override" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assembly_leaf_overrides_assembly_leaf_id_tier_id_pk" PRIMARY KEY("assembly_leaf_id","tier_id")
);
--> statement-breakpoint
CREATE TABLE "assembly_leaf_targets" (
	"assembly_leaf_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"client_target_price_per_unit" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assembly_leaf_targets_assembly_leaf_id_tier_id_pk" PRIMARY KEY("assembly_leaf_id","tier_id")
);
--> statement-breakpoint
CREATE TABLE "assembly_production_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"customer_ships_raws" boolean DEFAULT false NOT NULL,
	"allocate_service_fees_to_cost" boolean DEFAULT true NOT NULL,
	"notes" text,
	"filling_blending_cost" numeric(12, 2),
	"cm_assembly_total" numeric(12, 2),
	"setup_fee_total" numeric(12, 2),
	"tooling_artwork_total" numeric(12, 2),
	"rd_total" numeric(12, 2),
	"other_service_total" numeric(12, 2),
	"bulk_raw_cost" numeric(12, 2),
	"actual_units_produced" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assembly_leaf_inputs" ADD CONSTRAINT "assembly_leaf_inputs_assembly_leaf_id_assembly_leaves_id_fk" FOREIGN KEY ("assembly_leaf_id") REFERENCES "public"."assembly_leaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaf_inputs" ADD CONSTRAINT "assembly_leaf_inputs_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaf_overrides" ADD CONSTRAINT "assembly_leaf_overrides_assembly_leaf_id_assembly_leaves_id_fk" FOREIGN KEY ("assembly_leaf_id") REFERENCES "public"."assembly_leaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaf_overrides" ADD CONSTRAINT "assembly_leaf_overrides_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaf_targets" ADD CONSTRAINT "assembly_leaf_targets_assembly_leaf_id_assembly_leaves_id_fk" FOREIGN KEY ("assembly_leaf_id") REFERENCES "public"."assembly_leaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaf_targets" ADD CONSTRAINT "assembly_leaf_targets_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_production_inputs" ADD CONSTRAINT "assembly_production_inputs_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_production_inputs" ADD CONSTRAINT "assembly_production_inputs_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assembly_leaf_inputs_line_tier_idx" ON "assembly_leaf_inputs" USING btree ("assembly_leaf_id","line_group_id","tier_id");--> statement-breakpoint
CREATE INDEX "assembly_leaf_inputs_assembly_leaf_id_idx" ON "assembly_leaf_inputs" USING btree ("assembly_leaf_id");--> statement-breakpoint
CREATE INDEX "assembly_leaf_inputs_tier_id_idx" ON "assembly_leaf_inputs" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "assembly_leaf_inputs_line_group_id_idx" ON "assembly_leaf_inputs" USING btree ("line_group_id");--> statement-breakpoint
CREATE INDEX "assembly_leaf_overrides_tier_id_idx" ON "assembly_leaf_overrides" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "assembly_leaf_targets_tier_id_idx" ON "assembly_leaf_targets" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assembly_production_inputs_assembly_tier_idx" ON "assembly_production_inputs" USING btree ("assembly_id","tier_id");--> statement-breakpoint
CREATE INDEX "assembly_production_inputs_assembly_id_idx" ON "assembly_production_inputs" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX "assembly_production_inputs_tier_id_idx" ON "assembly_production_inputs" USING btree ("tier_id");