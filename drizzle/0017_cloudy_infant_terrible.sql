CREATE TABLE "quote_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"table_name" text,
	"row_id" text,
	"field_name" text,
	"tier_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"accept_reason_kind" text,
	"accept_reason_text" text,
	"auto_resolved_at" timestamp with time zone,
	"message" text NOT NULL,
	"detail_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_warnings" ADD CONSTRAINT "quote_warnings_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_warnings" ADD CONSTRAINT "quote_warnings_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_warnings" ADD CONSTRAINT "quote_warnings_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_warnings_quote_active_idx" ON "quote_warnings" USING btree ("quote_id","status") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "quote_warnings_quote_scope_idx" ON "quote_warnings" USING btree ("quote_id","scope");--> statement-breakpoint
CREATE INDEX "quote_warnings_row_idx" ON "quote_warnings" USING btree ("table_name","row_id") WHERE table_name IS NOT NULL;