CREATE TYPE "public"."freight_mode" AS ENUM('parcel', 'ltl', 'ftl', 'ocean', 'air', 'courier', 'other');--> statement-breakpoint
CREATE TYPE "public"."freight_treatment" AS ENUM('bundled', 'pass_through');--> statement-breakpoint
CREATE TABLE "freight_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_sku_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"line_group_id" uuid NOT NULL,
	"shipment_id" text,
	"supplier" text,
	"freight_mode" "freight_mode",
	"freight_treatment" "freight_treatment" DEFAULT 'bundled' NOT NULL,
	"markup_pct" numeric(5, 4),
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"total_freight" numeric(12, 2),
	"units_in_shipment" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freight_inputs" ADD CONSTRAINT "freight_inputs_quote_sku_id_quote_skus_id_fk" FOREIGN KEY ("quote_sku_id") REFERENCES "public"."quote_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_inputs" ADD CONSTRAINT "freight_inputs_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "freight_inputs_line_tier_idx" ON "freight_inputs" USING btree ("quote_sku_id","line_group_id","tier_id");--> statement-breakpoint
CREATE INDEX "freight_inputs_quote_sku_id_idx" ON "freight_inputs" USING btree ("quote_sku_id");--> statement-breakpoint
CREATE INDEX "freight_inputs_tier_id_idx" ON "freight_inputs" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "freight_inputs_line_group_id_idx" ON "freight_inputs" USING btree ("line_group_id");