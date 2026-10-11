-- A product may have independently priced, noted instances of any associated service.
-- Existing unlabeled services remain unique through COALESCE(label, '').
-- Requires migration 0147_grouped_product_associated_services first.
ALTER TABLE "quote_leaves"
  ADD COLUMN "service_instance_label" text;

ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_service_instance_label_check"
  CHECK (
    "service_instance_label" IS NULL OR
    ("commercial_kind" = 'service' AND "associated_product_quote_leaf_id" IS NOT NULL AND btrim("service_instance_label") <> '')
  );

DROP INDEX "quote_leaves_product_service_unique_idx";

CREATE UNIQUE INDEX "quote_leaves_product_service_instance_unique_idx"
  ON "quote_leaves" (
    "associated_product_quote_leaf_id",
    "leaf_id",
    coalesce(lower(btrim("service_instance_label")), '')
  )
  WHERE "associated_product_quote_leaf_id" IS NOT NULL;
