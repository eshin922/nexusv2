-- Slice 12 Step 8c-3 schema — MANUAL variant of 0045_slice_12_step_8c3_schema
-- with idempotent guards (IF NOT EXISTS) so it can be safely applied
-- against a DB that already has the columns/tables from pre-rebase
-- test runs. Same content as drizzle/0045_slice_12_step_8c3_schema.sql
-- but with additive-safe clauses.
--
-- Apply via:
--   node --env-file=.env.local scripts/apply-manual-sql.mjs \
--     drizzle/manual/0045_slice_12_step_8c3_schema.sql
--
-- Once applied, drizzle-kit's _drizzle_migrations table is
-- out-of-sync with the actual schema for id 45+. This is banked as
-- a follow-up: at merge time to main, either (a) update the two
-- pre-existing rows' hashes to match the current SQL file hashes,
-- OR (b) delete the pending 0045 entry and let normal db:migrate
-- resume with the next schema change.

-- ---------- netsuite_customer_map ----------
CREATE TABLE IF NOT EXISTS "netsuite_customer_map" (
  "hubspot_company_id" text PRIMARY KEY NOT NULL,
  "netsuite_customer_id" text NOT NULL,
  "netsuite_customer_display_name" text,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "netsuite_customer_map_ns_id_idx"
  ON "netsuite_customer_map" ("netsuite_customer_id");

-- ---------- netsuite_so_pushes ----------
CREATE TABLE IF NOT EXISTS "netsuite_so_pushes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "accepted_tier_id" uuid NOT NULL,
  "status" text NOT NULL,
  "netsuite_so_id" text,
  "netsuite_so_tranid" text,
  "amount_pushed" numeric(15, 4),
  "idempotency_key" text NOT NULL,
  "error_class" text,
  "error_detail" text,
  "payload_snapshot" jsonb,
  "started_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "netsuite_so_pushes_success_unique_idx"
  ON "netsuite_so_pushes" ("quote_id", "accepted_tier_id")
  WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS "netsuite_so_pushes_quote_tier_idx"
  ON "netsuite_so_pushes" ("quote_id", "accepted_tier_id");

-- ---------- firm_settings new columns ----------
ALTER TABLE "firm_settings"
  ADD COLUMN IF NOT EXISTS "netsuite_subsidiary_id" text NOT NULL DEFAULT '2';
ALTER TABLE "firm_settings"
  ADD COLUMN IF NOT EXISTS "netsuite_default_tax_code_id" text NOT NULL DEFAULT '-8';
ALTER TABLE "firm_settings"
  ADD COLUMN IF NOT EXISTS "netsuite_so_order_status_code" text NOT NULL DEFAULT 'B';

-- ---------- quotes new columns ----------
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "netsuite_so_tranid" text;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "netsuite_so_push_status" text;
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "netsuite_so_push_error" text;
