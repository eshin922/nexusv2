ALTER TABLE "freight_inputs" ADD COLUMN "sku_total_cbm" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "quote_skus" DROP COLUMN "cbm_per_unit";