-- A sub-quantity belongs to the product occurrence, including a grouped one.
-- Membership changes preserve that fact; they do not erase or reinterpret it.
CREATE OR REPLACE FUNCTION validate_product_tier_quantity_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quote_tiers WHERE id = NEW.tier_id AND quote_id = NEW.quote_id) THEN
    RAISE EXCEPTION 'Product quantity tier must belong to the same quote';
  END IF;
  IF NEW.assembly_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assemblies WHERE id = NEW.assembly_id AND quote_id = NEW.quote_id
  ) THEN
    RAISE EXCEPTION 'Product quantity group must belong to the same quote';
  END IF;
  IF NEW.quote_leaf_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM quote_leaves WHERE id = NEW.quote_leaf_id AND quote_id = NEW.quote_id
      AND commercial_kind = 'product'
  ) THEN
    RAISE EXCEPTION 'Order quantity must belong to a product on the same quote';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER quote_leaves_quantity_membership_guard ON quote_leaves;
DROP FUNCTION guard_quantified_product_membership();
