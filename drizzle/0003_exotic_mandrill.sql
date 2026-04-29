DROP INDEX "quote_skus_product_category_idx";--> statement-breakpoint
DROP INDEX "quote_skus_packaging_category_idx";--> statement-breakpoint
ALTER TABLE "quote_skus" DROP COLUMN "product_category";--> statement-breakpoint
ALTER TABLE "quote_skus" DROP COLUMN "packaging_category";--> statement-breakpoint
ALTER TABLE "quote_skus" DROP COLUMN "field_source_json";