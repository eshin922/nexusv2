CREATE TABLE "hubspot_deals_cache" (
	"deal_id" text PRIMARY KEY NOT NULL,
	"deal_name" text NOT NULL,
	"deal_stage" text,
	"amount" numeric(15, 2),
	"close_date" date,
	"sales_rep_id" text,
	"sales_rep_name" text,
	"sales_rep_email" text,
	"pm_id" text,
	"pm_name" text,
	"pm_email" text,
	"associated_company_id" text,
	"associated_company_name" text,
	"created_at_hubspot" timestamp with time zone,
	"updated_at_hubspot" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hubspot_deals_cache_deal_name_idx" ON "hubspot_deals_cache" USING btree ("deal_name");--> statement-breakpoint
CREATE INDEX "hubspot_deals_cache_deal_stage_idx" ON "hubspot_deals_cache" USING btree ("deal_stage");--> statement-breakpoint
CREATE INDEX "hubspot_deals_cache_last_synced_at_idx" ON "hubspot_deals_cache" USING btree ("last_synced_at");