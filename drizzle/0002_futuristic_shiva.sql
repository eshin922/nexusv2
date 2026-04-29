ALTER TABLE "quote_skus" ADD COLUMN "hubspot_product_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "field_source_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "last_hubspot_refresh_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "quote_skus_hubspot_product_id_idx" ON "quote_skus" USING btree ("hubspot_product_id");