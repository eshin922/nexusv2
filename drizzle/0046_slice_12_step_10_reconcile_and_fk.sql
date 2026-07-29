-- Slice 12 Step 10 §0.5 disposition — reconcile three out-of-band
-- manual data-fix migrations into auto-tracked form + add the
-- netsuite_so_pushes.accepted_tier_id FK constraint.
--
-- Reconciled from (all deleted post-merge):
--   drizzle/manual/0036_slice_12_step_7b_hubspot_stage_label_fix.sql
--   drizzle/manual/0037_slice_12_step_7b_hubspot_stage_key_to_id.sql
--   drizzle/manual/0046_slice_12_step_8c3_q4_revised_tax_code.sql
--
-- All three shipped as manual migrations during Slice 12 because the
-- fixes landed under time pressure and predated Pattern 22 §0.5
-- discipline maturing enough to reject the manual model. The actual
-- defect was oral-knowledge-only tracking: no manifest recorded which
-- manual migrations had been applied to which environment. A fresh
-- Supabase project rebuild would silently produce a system where:
--   * HubSpot acceptance fails at runtime (wrong stage id key)
--   * NetSuite SO push fails at runtime (tax code error on out-of-
--     state customers per Q4 REVISED)
-- Neither surfaces at startup - PMs discover in production.
--
-- Auto-tracking eliminates that failure mode. Live prod state already
-- reflects the manual migrations; every statement in this migration
-- is a no-op on prod (idempotent by design). On a fresh Supabase
-- rebuild, every statement runs and reaches the same state.
--
-- Live-DB verification pre-write (2026-07-29, DIRECT_URL :5432):
--   * firm_settings.hubspot_deal_stage_on_accept = '195607084' OK
--   * firm_settings.netsuite_default_tax_code_id column is nullable,
--     no default, active row is NULL OK
--   * Zero rows with tax_code_id = '-8' OK
--   * netsuite_so_pushes has 0 rows (FK add safe, no data migration)

-- ---------- schema-diff (drizzle-kit generated) ----------

ALTER TABLE "firm_settings" ALTER COLUMN "hubspot_deal_stage_on_accept" SET DEFAULT '195607084';--> statement-breakpoint
ALTER TABLE "firm_settings" ALTER COLUMN "netsuite_default_tax_code_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "firm_settings" ALTER COLUMN "netsuite_default_tax_code_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "netsuite_so_pushes" ADD CONSTRAINT "netsuite_so_pushes_accepted_tier_id_quote_tiers_id_fk" FOREIGN KEY ("accepted_tier_id") REFERENCES "public"."quote_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- ---------- data-fix reconciliation (from deleted manual migrations) ----------

-- manual/0036 + 0037 - HubSpot stage id reconciliation.
-- On live prod: 0 rows updated (already '195607084').
-- On fresh rebuild: converts the auto/0037-seeded 'Closed Won' default
-- value on the active row to the correct internal stage id.
UPDATE "firm_settings"
  SET "hubspot_deal_stage_on_accept" = '195607084'
  WHERE "effective_until" IS NULL
    AND "hubspot_deal_stage_on_accept" IN ('Closed Won', 'Won - In production');--> statement-breakpoint

-- manual/0046 - reset any lingering '-8' tax code inherited from
-- auto/0045's initial hardcoded default. Q4 REVISED (2026-07-28):
-- let NetSuite's tax engine derive per-line tax from customer +
-- ship-to; hardcoding overrides correct behavior on OTC/tooling
-- lines for out-of-state customers.
-- On live prod: 0 rows updated.
-- On fresh rebuild: nulls the '-8' inherited from auto/0045.
UPDATE "firm_settings"
  SET "netsuite_default_tax_code_id" = NULL
  WHERE "netsuite_default_tax_code_id" = '-8';
