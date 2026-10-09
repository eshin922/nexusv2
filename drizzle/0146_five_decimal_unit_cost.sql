-- Preserve five-decimal vendor unit rates (e.g. $124.05 per thousand = $0.12405).
-- Add one precision digit without reducing the allowed whole-dollar range.
ALTER TABLE "assembly_leaf_inputs"
  ALTER COLUMN "unit_cost" TYPE numeric(11, 5);

-- Per-unit component charges use the same vendor-rate precision. One-time
-- charge totals remain restricted to cents by the action validator.
ALTER TABLE "quote_charge_instance_tiers"
  ALTER COLUMN "cost_amount" TYPE numeric(15, 5);
