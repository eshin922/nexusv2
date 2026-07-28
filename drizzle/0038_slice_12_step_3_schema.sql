CREATE TYPE "public"."quote_review_event_type" AS ENUM('sent', 'responded', 'asked', 'revision_requested');--> statement-breakpoint
CREATE TABLE "quote_review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"event_type" "quote_review_event_type" NOT NULL,
	"note" text,
	"author_user_id" uuid,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_accepted_tier_id_quote_tiers_id_fk";
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "hubspot_deal_stage_on_accept" text DEFAULT 'Closed Won' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "netsuite_so_status_on_create" text DEFAULT 'Pending Fulfillment' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "netsuite_so_id" varchar(50);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "netsuite_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_review_events" ADD CONSTRAINT "quote_review_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_review_events" ADD CONSTRAINT "quote_review_events_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_review_events_composite_idx" ON "quote_review_events" USING btree ("quote_id","version_number","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_accepted_tier_id_quote_tiers_id_fk" FOREIGN KEY ("accepted_tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE restrict ON UPDATE no action;