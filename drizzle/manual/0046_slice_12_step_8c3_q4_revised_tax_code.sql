-- Slice 12 Step 8c-3 Q4 REVISED (CA 2026-07-28) — supersedes the
-- 0045 hardcoded tax-code column.
--
-- Before: netsuite_default_tax_code_id NOT NULL DEFAULT '-8'
-- After:  netsuite_default_tax_code_id (nullable, no default)
--
-- NetSuite's tax engine derives per-line tax from customer + ship-to;
-- hardcoding overrides correct behavior on the exact lines most
-- likely to need it (OTC/tooling for out-of-state customers).
-- Column stays as an override escape hatch — null means "let NetSuite
-- derive"; admin sets it only if the engine ever misbehaves.
--
-- Manual variant with IF EXISTS/idempotent constructs so it can be
-- applied to a DB that already has 0045's constraints.
--
-- Apply via:
--   node --env-file=.env.local scripts/apply-manual-sql.mjs \
--     drizzle/manual/0046_slice_12_step_8c3_q4_revised_tax_code.sql

ALTER TABLE "firm_settings"
  ALTER COLUMN "netsuite_default_tax_code_id" DROP NOT NULL;
ALTER TABLE "firm_settings"
  ALTER COLUMN "netsuite_default_tax_code_id" DROP DEFAULT;

-- Reset existing rows that inherited the '-8' default to NULL.
-- The '-8' value came from the initial 0045 default and was the
-- superseded Q4 assumption. Admins can re-populate via
-- /admin/firm-settings if the override is ever needed.
UPDATE "firm_settings"
  SET "netsuite_default_tax_code_id" = NULL
  WHERE "netsuite_default_tax_code_id" = '-8';
