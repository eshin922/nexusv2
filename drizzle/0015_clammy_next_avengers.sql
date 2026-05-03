CREATE TABLE "quote_sku_tiers" (
	"quote_sku_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"sell_price_override" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_sku_tiers_quote_sku_id_tier_id_pk" PRIMARY KEY("quote_sku_id","tier_id")
);
--> statement-breakpoint
ALTER TABLE "quote_sku_tiers" ADD CONSTRAINT "quote_sku_tiers_quote_sku_id_quote_skus_id_fk" FOREIGN KEY ("quote_sku_id") REFERENCES "public"."quote_skus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_sku_tiers" ADD CONSTRAINT "quote_sku_tiers_tier_id_quote_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_sku_tiers_tier_id_idx" ON "quote_sku_tiers" USING btree ("tier_id");