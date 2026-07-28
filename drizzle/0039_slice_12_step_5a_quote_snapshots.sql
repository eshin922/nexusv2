CREATE TABLE "quote_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"sent_at" timestamp with time zone NOT NULL,
	"valid_until" date,
	"quote_number" text,
	"tcs" text,
	"payment_terms" text,
	"lead_time" text,
	"incoterms" text,
	"days_valid" integer,
	"prepared_by_name" text,
	"prepared_by_email" text,
	"prepared_by_phone" text,
	"pdf_layout" "pdf_layout",
	"detail_level" "detail_level",
	"include_spec_addendum" boolean,
	"pdf_url" text,
	"accepted_snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_snapshots_current_idx" ON "quote_snapshots" USING btree ("quote_id","superseded_at");--> statement-breakpoint
CREATE INDEX "quote_snapshots_version_idx" ON "quote_snapshots" USING btree ("quote_id","version_number","effective_from" DESC NULLS LAST);