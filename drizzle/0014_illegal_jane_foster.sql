ALTER TABLE "quote_tiers" ADD COLUMN "tier_price_adj_pct" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "quote_tiers" ADD COLUMN "client_target_price_per_unit" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "target_margin_pct" numeric(5, 4);