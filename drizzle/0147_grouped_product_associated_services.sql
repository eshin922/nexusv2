-- Allow a top-level direct service to name a product inside an Item Group.
-- Preserve same-quote/product-kind validation and NO ACTION on owner deletion.
-- Requires 0146_five_decimal_unit_cost to be journaled and applied first.
ALTER TABLE "quote_leaves"
  DROP CONSTRAINT "quote_leaves_associated_product_fk";

ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_association_product_key"
  UNIQUE ("id", "quote_id", "commercial_kind");

ALTER TABLE "quote_leaves"
  ADD CONSTRAINT "quote_leaves_associated_product_fk"
  FOREIGN KEY (
    "associated_product_quote_leaf_id",
    "quote_id",
    "associated_product_kind"
  ) REFERENCES "quote_leaves" ("id", "quote_id", "commercial_kind")
  ON DELETE NO ACTION;
