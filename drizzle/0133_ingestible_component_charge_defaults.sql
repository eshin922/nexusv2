-- Add the component-level setup charge suggested by the existing
-- Ingestibles/Topicals Production vocabulary. Filling, formulation and
-- stability/R&D remain Production inputs; they are not component-owned
-- charges and therefore do not belong in this picker.
INSERT INTO "product_type_charge_defaults" ("product_type_value", "charge_key", "note")
VALUES
  ('Ingestibles', 'tooling', 'Suggested from the Production tooling/setup line; the operator confirms applicability per component.'),
  ('Topicals', 'tooling', 'Suggested from the Production tooling/setup line; the operator confirms applicability per component.')
ON CONFLICT ("product_type_value", "charge_key") DO NOTHING;
