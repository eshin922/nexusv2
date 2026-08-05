CREATE TYPE "public"."freight_fact_source" AS ENUM('manual', 'imported', 'corrected_after_import');
CREATE TYPE "public"."freight_customs_source" AS ENUM('invoice', 'estimate');
CREATE TYPE "public"."freight_customs_charge_type" AS ENUM('duty', 'tariff');

CREATE TABLE "freight_subcategories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "assembly_id" uuid NOT NULL REFERENCES "assemblies"("id") ON DELETE CASCADE,
  "label" text NOT NULL, "origin" text, "carrier_forwarder" text,
  "incoterm" "freight_incoterm", "cargo_ready_date" date, "journey_label" text,
  "treatment" "freight_treatment" DEFAULT 'bundled' NOT NULL,
  "crosses_international_border" boolean DEFAULT false NOT NULL,
  "selected_destination_id" uuid, "selection_reason" text,
  "display_order" integer DEFAULT 0 NOT NULL,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "freight_subcategory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_subcategory_id" uuid NOT NULL REFERENCES "freight_subcategories"("id") ON DELETE CASCADE,
  "assembly_leaf_id" uuid NOT NULL REFERENCES "assembly_leaves"("id") ON DELETE CASCADE,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "freight_subcategory_items_identity_idx" UNIQUE("freight_subcategory_id", "assembly_leaf_id")
);
CREATE TABLE "freight_destinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_subcategory_id" uuid NOT NULL REFERENCES "freight_subcategories"("id") ON DELETE CASCADE,
  "destination" text NOT NULL, "consignee" text, "transit_days" text,
  "quote_reference" text, "internal_notes" text,
  "same_value_all_breaks" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "freight_destinations_id_subcategory_idx" UNIQUE("id", "freight_subcategory_id")
);
ALTER TABLE "freight_subcategories" ADD CONSTRAINT "freight_subcategories_selected_destination_fk"
  FOREIGN KEY ("selected_destination_id", "id") REFERENCES "freight_destinations"("id", "freight_subcategory_id") ON DELETE RESTRICT;
CREATE TABLE "freight_destination_breaks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_destination_id" uuid NOT NULL REFERENCES "freight_destinations"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE CASCADE,
  "freight_amount" numeric(12,2), "freight_markup_pct" numeric(5,4),
  "mode" "freight_leg_mode", "shipment_note" text, "cbm" numeric(12,3),
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "freight_destination_breaks_identity_idx" UNIQUE("freight_destination_id", "tier_id"),
  CONSTRAINT "freight_destination_breaks_amount_nonnegative" CHECK ("freight_amount" IS NULL OR "freight_amount" >= 0),
  CONSTRAINT "freight_destination_breaks_cbm_nonnegative" CHECK ("cbm" IS NULL OR "cbm" >= 0)
);
CREATE TABLE "freight_customs_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_subcategory_id" uuid NOT NULL UNIQUE REFERENCES "freight_subcategories"("id") ON DELETE CASCADE,
  "source_mode" "freight_customs_source" DEFAULT 'invoice' NOT NULL,
  "invoice_reference" text, "entry_description" text,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE "freight_customs_breaks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_customs_entry_id" uuid NOT NULL REFERENCES "freight_customs_entries"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE CASCADE,
  "charge_type" "freight_customs_charge_type" NOT NULL,
  "amount" numeric(12,2), "markup_pct" numeric(5,4), "rate_base" numeric(12,2),
  "rate_pct" numeric(7,6), "detail" text,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "freight_customs_breaks_identity_idx" UNIQUE("freight_customs_entry_id", "charge_type", "tier_id"),
  CONSTRAINT "freight_customs_breaks_amount_nonnegative" CHECK ("amount" IS NULL OR "amount" >= 0)
);
CREATE TABLE "freight_destination_tracking" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "freight_destination_id" uuid NOT NULL UNIQUE REFERENCES "freight_destinations"("id") ON DELETE CASCADE,
  "etd" date, "eta" date, "actual_delivery_date" date,
  "source" "freight_fact_source" DEFAULT 'manual' NOT NULL,
  "field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX "freight_subcategories_quote_order_idx" ON "freight_subcategories"("quote_id", "display_order");
CREATE INDEX "freight_subcategories_assembly_idx" ON "freight_subcategories"("assembly_id");
CREATE INDEX "freight_subcategory_items_leaf_idx" ON "freight_subcategory_items"("assembly_leaf_id");
CREATE INDEX "freight_destinations_subcategory_order_idx" ON "freight_destinations"("freight_subcategory_id", "display_order");
CREATE INDEX "freight_destination_breaks_tier_idx" ON "freight_destination_breaks"("tier_id");
CREATE INDEX "freight_customs_breaks_tier_idx" ON "freight_customs_breaks"("tier_id");

CREATE FUNCTION enforce_worksheet_freight_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sub_quote uuid; sub_assembly uuid; related_quote uuid; related_assembly uuid;
BEGIN
  IF TG_TABLE_NAME = 'freight_subcategory_items' THEN
    SELECT quote_id, assembly_id INTO sub_quote, sub_assembly FROM freight_subcategories WHERE id = NEW.freight_subcategory_id;
    SELECT a.quote_id, al.assembly_id INTO related_quote, related_assembly FROM assembly_leaves al JOIN assemblies a ON a.id = al.assembly_id WHERE al.id = NEW.assembly_leaf_id;
  ELSIF TG_TABLE_NAME = 'freight_destination_breaks' THEN
    SELECT s.quote_id INTO sub_quote FROM freight_destinations d JOIN freight_subcategories s ON s.id = d.freight_subcategory_id WHERE d.id = NEW.freight_destination_id;
    SELECT quote_id INTO related_quote FROM quote_tiers WHERE id = NEW.tier_id;
  ELSE
    SELECT s.quote_id INTO sub_quote FROM freight_customs_entries e JOIN freight_subcategories s ON s.id = e.freight_subcategory_id WHERE e.id = NEW.freight_customs_entry_id;
    SELECT quote_id INTO related_quote FROM quote_tiers WHERE id = NEW.tier_id;
  END IF;
  IF sub_quote IS NULL OR related_quote IS NULL OR sub_quote <> related_quote OR (TG_TABLE_NAME = 'freight_subcategory_items' AND sub_assembly <> related_assembly) THEN
    RAISE EXCEPTION 'worksheet freight identity must resolve to one Quote and owning commercial product';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER freight_subcategory_items_identity_guard BEFORE INSERT OR UPDATE ON freight_subcategory_items FOR EACH ROW EXECUTE FUNCTION enforce_worksheet_freight_identity();
CREATE TRIGGER freight_destination_breaks_identity_guard BEFORE INSERT OR UPDATE ON freight_destination_breaks FOR EACH ROW EXECUTE FUNCTION enforce_worksheet_freight_identity();
CREATE TRIGGER freight_customs_breaks_identity_guard BEFORE INSERT OR UPDATE ON freight_customs_breaks FOR EACH ROW EXECUTE FUNCTION enforce_worksheet_freight_identity();
