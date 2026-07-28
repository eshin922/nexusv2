CREATE TABLE "netsuite_customer_map" (
	"hubspot_company_id" text PRIMARY KEY NOT NULL,
	"netsuite_customer_id" text NOT NULL,
	"netsuite_customer_display_name" text,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "netsuite_so_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"accepted_tier_id" uuid NOT NULL,
	"status" text NOT NULL,
	"netsuite_so_id" text,
	"netsuite_so_tranid" text,
	"amount_pushed" numeric(15, 4),
	"idempotency_key" text NOT NULL,
	"error_class" text,
	"error_detail" text,
	"payload_snapshot" jsonb,
	"started_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "netsuite_subsidiary_id" text DEFAULT '2' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "netsuite_default_tax_code_id" text DEFAULT '-8' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "netsuite_so_order_status_code" text DEFAULT 'B' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "netsuite_so_tranid" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "netsuite_so_push_status" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "netsuite_so_push_error" text;--> statement-breakpoint
ALTER TABLE "netsuite_customer_map" ADD CONSTRAINT "netsuite_customer_map_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "netsuite_so_pushes" ADD CONSTRAINT "netsuite_so_pushes_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "netsuite_so_pushes" ADD CONSTRAINT "netsuite_so_pushes_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "netsuite_customer_map_ns_id_idx" ON "netsuite_customer_map" USING btree ("netsuite_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_so_pushes_success_unique_idx" ON "netsuite_so_pushes" USING btree ("quote_id","accepted_tier_id") WHERE status = 'succeeded';--> statement-breakpoint
CREATE INDEX "netsuite_so_pushes_quote_tier_idx" ON "netsuite_so_pushes" USING btree ("quote_id","accepted_tier_id");