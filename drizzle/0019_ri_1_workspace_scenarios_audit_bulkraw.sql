-- Slice RI.1 — pg_trgm extension required by audit_log trigram GIN indexes.
-- Drizzle-kit doesn't auto-emit CREATE EXTENSION; added manually.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."bulk_raw_native_unit" AS ENUM('kg', 'L', 'mL', 'oz', 'g', 'lb');--> statement-breakpoint
CREATE TYPE "public"."cost_section_kind" AS ENUM('packaging', 'production', 'bulk_raw');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('none', 'due', 'invoiced', 'paid', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."raws_mode" AS ENUM('cm_sources', 'dps_sources', 'customer_supplies');--> statement-breakpoint
CREATE TYPE "public"."scenario_drop_reason" AS ENUM('superseded_by_copy', 'draft_at_accept', 'accept_sibling', 'manual', 'other');--> statement-breakpoint
CREATE TABLE "bulk_raw_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"markup_pct" numeric(5, 4),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_raw_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"native_unit" "bulk_raw_native_unit" NOT NULL,
	"cost_per_native_unit" numeric(10, 4),
	"usage_per_filled_unit" numeric(10, 4),
	"per_filled_unit_cost" numeric(10, 4) GENERATED ALWAYS AS (cost_per_native_unit * usage_per_filled_unit) STORED,
	"hts_code" text,
	"supplier_id" uuid,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_raw_section_meta" (
	"quote_id" uuid PRIMARY KEY NOT NULL,
	"raws_mode" "raws_mode" DEFAULT 'cm_sources' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_section_deposits" (
	"quote_id" uuid NOT NULL,
	"section_kind" "cost_section_kind" NOT NULL,
	"deposit_pct" numeric(5, 4),
	"deposit_amount" numeric(12, 2),
	"deposit_status" "deposit_status" DEFAULT 'none' NOT NULL,
	"deposit_invoice_id" text,
	"deposit_invoiced_at" timestamp with time zone,
	"deposit_paid_at" timestamp with time zone,
	"deposit_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_section_deposits_quote_id_section_kind_pk" PRIMARY KEY("quote_id","section_kind")
);
--> statement-breakpoint
CREATE TABLE "user_pinned_projects" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"pin_order" integer DEFAULT 0 NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_projects_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "user_project_visits" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"last_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_project_visits_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "caused_by_audit_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entity_label" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "is_recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "drop_reason" "scenario_drop_reason";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "dropped_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "dropped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulk_raw_categories" ADD CONSTRAINT "bulk_raw_categories_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_raw_ingredients" ADD CONSTRAINT "bulk_raw_ingredients_category_id_bulk_raw_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."bulk_raw_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_raw_section_meta" ADD CONSTRAINT "bulk_raw_section_meta_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_section_deposits" ADD CONSTRAINT "cost_section_deposits_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_projects" ADD CONSTRAINT "user_pinned_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_projects" ADD CONSTRAINT "user_pinned_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_visits" ADD CONSTRAINT "user_project_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_visits" ADD CONSTRAINT "user_project_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_raw_categories_quote_id_idx" ON "bulk_raw_categories" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "bulk_raw_ingredients_category_id_idx" ON "bulk_raw_ingredients" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "cost_section_deposits_quote_id_idx" ON "cost_section_deposits" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "user_pinned_projects_user_pin_order_idx" ON "user_pinned_projects" USING btree ("user_id","pin_order");--> statement-breakpoint
CREATE INDEX "user_project_visits_user_visited_idx" ON "user_project_visits" USING btree ("user_id","last_visited_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_caused_by_audit_id_audit_log_id_fk" FOREIGN KEY ("caused_by_audit_id") REFERENCES "public"."audit_log"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_dropped_by_user_id_users_id_fk" FOREIGN KEY ("dropped_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_caused_by_idx" ON "audit_log" USING btree ("caused_by_audit_id") WHERE caused_by_audit_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_summary_trgm_idx" ON "audit_log" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_log_entity_label_trgm_idx" ON "audit_log" USING gin ("entity_label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotes_project_recommended_idx" ON "quotes" USING btree ("project_id") WHERE is_recommended = true;