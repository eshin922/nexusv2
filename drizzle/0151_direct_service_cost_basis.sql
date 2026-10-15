ALTER TABLE "assembly_production_inputs"
  ADD COLUMN "direct_service_cost_basis" text NOT NULL DEFAULT 'total',
  ADD COLUMN "direct_service_unit_cost" numeric(14, 5);

ALTER TABLE "assembly_production_inputs"
  ADD CONSTRAINT "assembly_production_inputs_service_cost_basis_valid"
  CHECK ("direct_service_cost_basis" IN ('total', 'per_unit'));

ALTER TABLE "assembly_production_inputs"
  ADD CONSTRAINT "assembly_production_inputs_service_unit_cost_owner"
  CHECK (
    ("direct_service_cost_basis" = 'total' AND "direct_service_unit_cost" IS NULL)
    OR ("direct_service_cost_basis" = 'per_unit' AND "quote_leaf_id" IS NOT NULL)
  );
