-- Additive: no existing quantity or monetary record is rewritten.
CREATE TABLE "quote_product_tier_quantities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE CASCADE,
  "assembly_id" uuid REFERENCES "assemblies"("id") ON DELETE CASCADE,
  "quote_leaf_id" uuid REFERENCES "quote_leaves"("id") ON DELETE CASCADE,
  "quantity" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "quote_product_tier_quantities_owner_xor" CHECK ((assembly_id IS NOT NULL) <> (quote_leaf_id IS NOT NULL)),
  CONSTRAINT "quote_product_tier_quantities_positive" CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE INDEX "quote_product_tier_quantities_quote_idx" ON "quote_product_tier_quantities" ("quote_id");
CREATE UNIQUE INDEX "quote_product_tier_quantities_assembly_uq" ON "quote_product_tier_quantities" ("assembly_id", "tier_id") WHERE assembly_id IS NOT NULL;
CREATE UNIQUE INDEX "quote_product_tier_quantities_leaf_uq" ON "quote_product_tier_quantities" ("quote_leaf_id", "tier_id") WHERE quote_leaf_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION validate_product_tier_quantity_owner() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND assembly_id IS NULL AND commercial_kind = 'product'
  ) THEN
    RAISE EXCEPTION 'Order quantity must belong to a top-level product on the same quote';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_product_tier_quantities_owner_guard
  BEFORE INSERT OR UPDATE ON quote_product_tier_quantities
  FOR EACH ROW EXECUTE FUNCTION validate_product_tier_quantity_owner();
--> statement-breakpoint
-- Moving a explicitly quantified direct product into a group needs an explicit
-- quantity transition. Do not leave an override that a new parent would hide.
CREATE FUNCTION guard_quantified_product_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assembly_id IS DISTINCT FROM OLD.assembly_id AND EXISTS (
    SELECT 1 FROM quote_product_tier_quantities WHERE quote_leaf_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Clear product order quantity overrides before changing its group membership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_leaves_quantity_membership_guard
  BEFORE UPDATE OF assembly_id ON quote_leaves
  FOR EACH ROW EXECUTE FUNCTION guard_quantified_product_membership();
