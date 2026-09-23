-- Suggest the two production fees that a product can own as one-time charges.
-- Suggestions are advisory: the Setup picker never pre-checks them and existing
-- quote charges are not changed. ON CONFLICT preserves configured rows.
INSERT INTO "product_type_charge_defaults" ("product_type_value", "charge_key", "note")
VALUES
  ('Ingestibles', 'project_setup', 'One-off setup or changeover caused by this product.'),
  ('Topicals', 'project_setup', 'One-off setup or changeover caused by this product.')
ON CONFLICT ("product_type_value", "charge_key") DO NOTHING;
