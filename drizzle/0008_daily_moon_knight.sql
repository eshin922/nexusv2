CREATE TABLE "production_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_sku_id" uuid NOT NULL,
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
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_quote_sku_id_quote_skus_id_fk" FOREIGN KEY ("quote_sku_id") REFERENCES "public"."quote_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "production_inputs_sku_tier_idx" ON "production_inputs" USING btree ("quote_sku_id","tier_id");--> statement-breakpoint
CREATE INDEX "production_inputs_quote_sku_id_idx" ON "production_inputs" USING btree ("quote_sku_id");--> statement-breakpoint
CREATE INDEX "production_inputs_tier_id_idx" ON "production_inputs" USING btree ("tier_id");