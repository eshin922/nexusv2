-- Admin-configured HubSpot Product Type → component-charge suggestions.
-- Product Type values are references to HubSpot's vocabulary (never labels or
-- a second Nexus taxonomy). Rules only populate advisory Setup suggestions;
-- they do not create or mutate quote charge instances.

CREATE TABLE "product_type_charge_defaults" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_type_value" text NOT NULL,
  "charge_key" text NOT NULL,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "product_type_charge_defaults_charge_key_values" CHECK (
    "charge_key" IN ('print_plates', 'tooling', 'artwork_plate', 'samples', 'other_service')
  ),
  CONSTRAINT "product_type_charge_defaults_type_not_blank" CHECK (
    length(btrim("product_type_value")) > 0
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_type_charge_defaults_pair_idx"
  ON "product_type_charge_defaults" ("product_type_value", "charge_key");
--> statement-breakpoint
CREATE INDEX "product_type_charge_defaults_type_idx"
  ON "product_type_charge_defaults" ("product_type_value");
--> statement-breakpoint
-- Preserve the two advisory lists previously rendered by Setup, keyed by the
-- actual HubSpot internal values (Primary/Secondary). These rows only render
-- unchecked chips; they never add a quote charge.
INSERT INTO "product_type_charge_defaults" ("product_type_value", "charge_key", "note")
VALUES
  ('Primary', 'tooling', 'Carried forward from Setup suggestions; stock versus custom tooling is still confirmed per component.'),
  ('Primary', 'samples', 'Carried forward from Setup suggestions; the operator confirms applicability.'),
  ('Secondary', 'print_plates', 'Carried forward from Setup suggestions; printed versus unprinted packaging is still confirmed per component.'),
  ('Secondary', 'tooling', 'Carried forward from Setup suggestions; cutting die or tooling is still confirmed per component.'),
  ('Secondary', 'samples', 'Carried forward from Setup suggestions; the operator confirms applicability.'),
  ('Ingestibles', 'samples', 'Suggested in the Product Type audit; the operator confirms applicability. R&D, testing and filling remain quote or assembly-level charges.'),
  ('Topicals', 'samples', 'Suggested in the Product Type audit; the operator confirms applicability. R&D, testing and filling remain quote or assembly-level charges.')
ON CONFLICT ("product_type_value", "charge_key") DO NOTHING;
