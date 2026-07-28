CREATE TABLE "netsuite_item_groups" (
	"composition_hash" text PRIMARY KEY NOT NULL,
	"netsuite_external_id" text NOT NULL,
	"netsuite_internal_id" text NOT NULL,
	"customer_netsuite_id" text NOT NULL,
	"base_sku" text NOT NULL,
	"itemid_display" text NOT NULL,
	"description" text,
	"first_used_by_quote_id" uuid,
	"first_used_by_user_id" uuid,
	"first_used_by_deal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "netsuite_item_groups_netsuite_external_id_unique" UNIQUE("netsuite_external_id")
);
--> statement-breakpoint
ALTER TABLE "netsuite_item_groups" ADD CONSTRAINT "netsuite_item_groups_first_used_by_quote_id_quotes_id_fk" FOREIGN KEY ("first_used_by_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "netsuite_item_groups" ADD CONSTRAINT "netsuite_item_groups_first_used_by_user_id_users_id_fk" FOREIGN KEY ("first_used_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "netsuite_item_groups_customer_base_sku_idx" ON "netsuite_item_groups" USING btree ("customer_netsuite_id","base_sku");