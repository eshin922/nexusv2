CREATE TABLE "quote_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_url" text NOT NULL,
	"mime_type" text,
	"file_size_bytes" integer,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
DROP INDEX "quotes_project_recommended_idx";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "intent_note" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "customer_target_tier_label" text;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_attachments_quote_id_idx" ON "quote_attachments" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_project_recommended_idx" ON "quotes" USING btree ("project_id") WHERE is_recommended = true;