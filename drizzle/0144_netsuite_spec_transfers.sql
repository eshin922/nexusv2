-- Ordered-spec transfer status, one row per posted Sales Order. ADDITIVE.
--
-- Kept apart from `netsuite_so_pushes` and `quotes.netsuite_so_push_status` on
-- purpose: commercial Sales Order success and specification transfer success
-- are different facts, and neither may stand in for the other.
--
-- ── ORDERING ─────────────────────────────────────────────────────────────
--
-- A new table nothing deployed reads or writes: safe ahead of code. The code
-- that writes it must not deploy before this is applied.

CREATE TABLE "netsuite_spec_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "quote_snapshot_id" uuid NOT NULL REFERENCES "quote_snapshots"("id") ON DELETE RESTRICT,
  "netsuite_so_id" text NOT NULL,
  "status" text NOT NULL,
  "projection_version" text NOT NULL,
  "product_line_count" integer DEFAULT 0 NOT NULL,
  "verified_count" integer DEFAULT 0 NOT NULL,
  "exception_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_detail" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "netsuite_spec_transfers_status_known" CHECK (
    "status" IN ('pending','succeeded','succeeded_with_exceptions','failed','conflict')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_spec_transfers_so_unique_idx" ON "netsuite_spec_transfers" ("netsuite_so_id");
--> statement-breakpoint
CREATE INDEX "netsuite_spec_transfers_quote_idx" ON "netsuite_spec_transfers" ("quote_id");
