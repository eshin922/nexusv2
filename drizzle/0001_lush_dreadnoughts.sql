CREATE TYPE "public"."accept_source" AS ENUM('manual_button', 'hubspot_stage_change', 'api');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'superseded', 'lost');--> statement-breakpoint
CREATE TYPE "public"."scenario_status" AS ENUM('active', 'dropped', 'accepted');--> statement-breakpoint
CREATE TABLE "quote_skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"sku_label" text NOT NULL,
	"product_name" text NOT NULL,
	"product_category" text,
	"packaging_category" text,
	"units_per_pack" integer DEFAULT 1 NOT NULL,
	"retail_benchmark" numeric(10, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"label" text NOT NULL,
	"qty" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scenario_label" text DEFAULT 'Primary' NOT NULL,
	"scenario_status" "scenario_status" DEFAULT 'active' NOT NULL,
	"version_number" integer NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"accepted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"accepted_tier_id" uuid,
	"accept_source" "accept_source",
	"pdf_url" text,
	"hubspot_quote_id" text,
	"global_price_adj_pct" numeric(5, 4) DEFAULT '0' NOT NULL,
	"copied_from_quote_id" uuid,
	"customer_facing_notes" text,
	"internal_notes" text,
	"valid_until" date,
	"accepted_snapshot_json" jsonb,
	"underpriced_override_user_id" uuid,
	"underpriced_override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "quote_skus" ADD CONSTRAINT "quote_skus_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_tiers" ADD CONSTRAINT "quote_tiers_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_tier_id_quote_tiers_id_fk" FOREIGN KEY ("accepted_tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_underpriced_override_user_id_users_id_fk" FOREIGN KEY ("underpriced_override_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_copied_from_fk" FOREIGN KEY ("copied_from_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_skus_quote_id_idx" ON "quote_skus" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_skus_product_category_idx" ON "quote_skus" USING btree ("product_category");--> statement-breakpoint
CREATE INDEX "quote_skus_packaging_category_idx" ON "quote_skus" USING btree ("packaging_category");--> statement-breakpoint
CREATE INDEX "quote_tiers_quote_id_idx" ON "quote_tiers" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_project_scenario_version_idx" ON "quotes" USING btree ("project_id","scenario_label","version_number");--> statement-breakpoint
CREATE INDEX "quotes_project_id_idx" ON "quotes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");