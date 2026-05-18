CREATE TABLE "pricing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"violation_tier_id" uuid,
	"suggestion_target_tier_ids" uuid[],
	"floor_breach_pp" numeric(4, 2),
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_violation_tier_id_quote_tiers_id_fk" FOREIGN KEY ("violation_tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricing_events_quote_event_created_idx" ON "pricing_events" USING btree ("quote_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "pricing_events_event_created_idx" ON "pricing_events" USING btree ("event_type","created_at");--> statement-breakpoint
ALTER TABLE "pricing_events" ADD CONSTRAINT "pricing_events_event_type_check" CHECK (event_type IN ('surgical_apply', 'request_override', 'recommended_fired', 'recommended_accepted', 'recommended_overridden'));