CREATE TYPE "public"."sku_role" AS ENUM('leaf', 'umbrella', 'formulation_assembly');--> statement-breakpoint
ALTER TABLE "quote_skus" ALTER COLUMN "hubspot_product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "parent_sku_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "sku_role" "sku_role" DEFAULT 'leaf' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "qty_per_parent" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "quote_skus" ADD CONSTRAINT "quote_skus_parent_sku_id_quote_skus_id_fk" FOREIGN KEY ("parent_sku_id") REFERENCES "public"."quote_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_skus_parent_sku_id_idx" ON "quote_skus" USING btree ("parent_sku_id");--> statement-breakpoint
CREATE INDEX "quote_skus_sku_role_idx" ON "quote_skus" USING btree ("sku_role");