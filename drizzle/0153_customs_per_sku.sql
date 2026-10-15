ALTER TABLE "freight_customs_breaks"
  ADD COLUMN "quote_leaf_id" uuid REFERENCES "quote_leaves"("id") ON DELETE CASCADE;

ALTER TABLE "freight_customs_breaks"
  DROP CONSTRAINT "freight_customs_breaks_identity_idx";

CREATE UNIQUE INDEX "freight_customs_breaks_legacy_identity_idx"
  ON "freight_customs_breaks" ("freight_customs_entry_id", "charge_type", "tier_id")
  WHERE "quote_leaf_id" IS NULL;

CREATE UNIQUE INDEX "freight_customs_breaks_sku_identity_idx"
  ON "freight_customs_breaks" ("freight_customs_entry_id", "charge_type", "tier_id", "quote_leaf_id")
  WHERE "quote_leaf_id" IS NOT NULL;
