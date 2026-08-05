CREATE TABLE "quote_commercial_settings_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"quote_snapshot_id" uuid NOT NULL,
	"target_margin_pct" numeric(5, 4) NOT NULL,
	"floor_margin_pct" numeric(5, 4) NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "quote_commercial_settings_pins_quote_snapshot_id_unique" UNIQUE("quote_snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "quote_commercial_markup_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin_id" uuid NOT NULL,
	"quote_leaf_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"category" text NOT NULL,
	"chosen_rung" text NOT NULL,
	"markup_pct" numeric(5, 4) NOT NULL,
	"source_user_id" uuid,
	"source_set_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_commercial_settings_pins" ADD CONSTRAINT "quote_commercial_settings_pins_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_settings_pins" ADD CONSTRAINT "quote_commercial_settings_pins_quote_snapshot_id_quote_snapshots_id_fk" FOREIGN KEY ("quote_snapshot_id") REFERENCES "public"."quote_snapshots"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_settings_pins" ADD CONSTRAINT "quote_commercial_settings_pins_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_markup_pins" ADD CONSTRAINT "quote_commercial_markup_pins_pin_id_quote_commercial_settings_pins_id_fk" FOREIGN KEY ("pin_id") REFERENCES "public"."quote_commercial_settings_pins"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_markup_pins" ADD CONSTRAINT "quote_commercial_markup_pins_quote_leaf_id_quote_leaves_id_fk" FOREIGN KEY ("quote_leaf_id") REFERENCES "public"."quote_leaves"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_markup_pins" ADD CONSTRAINT "quote_commercial_markup_pins_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_commercial_markup_pins" ADD CONSTRAINT "quote_commercial_markup_pins_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_commercial_settings_pins_active_idx" ON "quote_commercial_settings_pins" USING btree ("quote_id") WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE INDEX "quote_commercial_settings_pins_quote_idx" ON "quote_commercial_settings_pins" USING btree ("quote_id","created_at" desc nulls last);
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_commercial_markup_pins_resolution_idx" ON "quote_commercial_markup_pins" USING btree ("pin_id","quote_leaf_id","tier_id","category");
--> statement-breakpoint
CREATE INDEX "quote_commercial_markup_pins_attachment_idx" ON "quote_commercial_markup_pins" USING btree ("quote_leaf_id","tier_id");
