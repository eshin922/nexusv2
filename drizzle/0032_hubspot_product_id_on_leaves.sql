ALTER TABLE "leaves" ADD COLUMN "hubspot_product_id" text;--> statement-breakpoint
CREATE INDEX "leaves_archived_idx" ON "leaves" USING btree ("archived") WHERE archived = true;--> statement-breakpoint
CREATE UNIQUE INDEX "leaves_hubspot_product_id_idx" ON "leaves" USING btree ("hubspot_product_id") WHERE hubspot_product_id is not null;