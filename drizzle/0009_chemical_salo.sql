ALTER TABLE "quote_skus" ADD COLUMN "cbm_per_unit" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "duty_pct" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "quote_skus" ADD COLUMN "tariff_pct" numeric(5, 4);