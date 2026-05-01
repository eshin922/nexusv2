CREATE TABLE "firm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_margin_pct" numeric(5, 4) DEFAULT '0.3500' NOT NULL,
	"floor_margin_pct" numeric(5, 4) DEFAULT '0.2500' NOT NULL,
	"effective_from" date DEFAULT CURRENT_DATE NOT NULL,
	"effective_until" date,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD CONSTRAINT "firm_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "firm_settings_current_idx" ON "firm_settings" USING btree ("effective_from" DESC NULLS LAST,"effective_until" DESC NULLS FIRST);