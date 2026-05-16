CREATE TYPE "public"."freight_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."freight_incoterm" AS ENUM('DDP', 'DAP', 'FOB', 'EXW', 'FCA', 'CIF');--> statement-breakpoint
CREATE TYPE "public"."freight_leg_mode" AS ENUM('parcel', 'ocean_fcl', 'ocean_lcl', 'air_freight', 'air_express', 'ltl_truck', 'truckload', 'drayage', 'exw_pickup', 'other');--> statement-breakpoint
CREATE TABLE "freight_customer_arranges_meta" (
	"freight_leg_id" uuid PRIMARY KEY NOT NULL,
	"customer_contact" text,
	"audit_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_leg_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"label" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_leg_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"freight_leg_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"total_freight" numeric(12, 2),
	"units_in_shipment" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "freight_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leg_group_id" uuid NOT NULL,
	"direction" "freight_direction" DEFAULT 'outbound' NOT NULL,
	"label" text,
	"origin" text,
	"destination" text,
	"crosses_international_border" boolean DEFAULT false NOT NULL,
	"treatment" "freight_treatment" DEFAULT 'bundled' NOT NULL,
	"mode" "freight_leg_mode",
	"carrier" text,
	"incoterm" "freight_incoterm",
	"cargo_ready_date" date,
	"vessel_etd" date,
	"freight_markup_pct" numeric(5, 4) DEFAULT '0.3000' NOT NULL,
	"duty_markup_pct" numeric(5, 4) DEFAULT '0.3000' NOT NULL,
	"tariff_markup_pct" numeric(5, 4) DEFAULT '0.3000' NOT NULL,
	"customs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freight_customer_arranges_meta" ADD CONSTRAINT "freight_customer_arranges_meta_freight_leg_id_freight_legs_id_fk" FOREIGN KEY ("freight_leg_id") REFERENCES "public"."freight_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_leg_groups" ADD CONSTRAINT "freight_leg_groups_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_leg_tiers" ADD CONSTRAINT "freight_leg_tiers_freight_leg_id_freight_legs_id_fk" FOREIGN KEY ("freight_leg_id") REFERENCES "public"."freight_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_leg_tiers" ADD CONSTRAINT "freight_leg_tiers_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freight_legs" ADD CONSTRAINT "freight_legs_leg_group_id_freight_leg_groups_id_fk" FOREIGN KEY ("leg_group_id") REFERENCES "public"."freight_leg_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "freight_leg_groups_quote_id_idx" ON "freight_leg_groups" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "freight_leg_tiers_leg_tier_idx" ON "freight_leg_tiers" USING btree ("freight_leg_id","tier_id");--> statement-breakpoint
CREATE INDEX "freight_leg_tiers_freight_leg_id_idx" ON "freight_leg_tiers" USING btree ("freight_leg_id");--> statement-breakpoint
CREATE INDEX "freight_leg_tiers_tier_id_idx" ON "freight_leg_tiers" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "freight_legs_leg_group_id_idx" ON "freight_legs" USING btree ("leg_group_id");