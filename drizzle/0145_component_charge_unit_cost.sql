-- Preserve existing component charges as one-time tier totals. New per-unit
-- charges retain four-decimal entered rates and are extended by each product's
-- ordered quantity in costing, including product-level sub-quantities.
ALTER TABLE "quote_charge_instances"
  ADD COLUMN "cost_basis" text NOT NULL DEFAULT 'one_time';
ALTER TABLE "quote_charge_instances"
  ADD CONSTRAINT "quote_charge_instances_cost_basis_check"
  CHECK ("cost_basis" IN ('one_time', 'per_unit'));
ALTER TABLE "quote_charge_instance_tiers"
  ALTER COLUMN "cost_amount" TYPE numeric(14, 4);
