-- Expand Product Type defaults from the original five component charges to the
-- governed associated-cost taxonomy. These remain advisory suggestions; they
-- never mutate existing quotes.
ALTER TABLE "product_type_charge_defaults"
  DROP CONSTRAINT IF EXISTS "product_type_charge_defaults_charge_key_values";
ALTER TABLE "product_type_charge_defaults"
  ADD CONSTRAINT "product_type_charge_defaults_charge_key_values"
  CHECK ("charge_key" IN (
    'print_plates', 'tooling', 'artwork_plate', 'samples', 'other_service',
    'filling_blending', 'cm_assembly_packout', 'project_setup',
    'rd_formulation', 'testing_micros'
  ));

INSERT INTO "product_type_charge_defaults" ("product_type_value", "charge_key", "note")
VALUES
  ('Ingestibles', 'rd_formulation', 'Formulation and product development for ingestible products.'),
  ('Ingestibles', 'testing_micros', 'Stability, potency, and microbiological testing.'),
  ('Ingestibles', 'filling_blending', 'Filling and blending production input.'),
  ('Ingestibles', 'cm_assembly_packout', 'Assembly and packout production input.'),
  ('Topicals', 'rd_formulation', 'Formulation and product development for topical products.'),
  ('Topicals', 'testing_micros', 'Stability and preservative-efficacy testing.'),
  ('Topicals', 'filling_blending', 'Filling and packout production input.'),
  ('Topicals', 'cm_assembly_packout', 'Assembly and packout production input.')
ON CONFLICT ("product_type_value", "charge_key") DO NOTHING;
