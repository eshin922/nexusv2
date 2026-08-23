-- Per-charge commercial recovery — the operator-selected layer between
-- internal cost truth and customer presentation.
--
-- ── WHY TWO ENUMS AND NOT text/JSONB ─────────────────────────────────────
--
-- `recovery_charge` is a CLOSED set. A charge exists because it is governed,
-- not because a field is numeric, and adding one SHOULD be a governed act —
-- so it is a migration, which an enum enforces and a text column does not.
-- Same reasoning for `recovery_mode`: exactly three modes, and the database
-- refuses a fourth.
--
-- This is commercial configuration that reaches a customer document. A JSONB
-- blob would be easy to extend and impossible to constrain.
--
-- Note what is ABSENT from `recovery_charge`: filling/blending, CM assembly,
-- bulk raw, packaging. Per-unit COGS is not a charge — it is the unit price.
-- That boundary is what stops recovery spreading to every numeric field, and
-- it is enforced here rather than only in code.
--
-- ── WHY ABSENCE OF A ROW IS THE LOAD-BEARING STATE ───────────────────────
--
-- There is no `per_assembly` mode, because it was never a commercial election
-- — it is the ABSENCE of one. A missing row means "nobody elected; read the
-- legacy source", which keeps two different things apart:
--
--     no row          ->  legacy: per-assembly allocate_service_fees_to_cost
--                         (landed charges: 'included')
--     row 'included'  ->  someone elected 'included'
--
-- A fourth enum member would collapse those and lose the provenance.
--
-- The consequence is that NO BACKFILL IS REQUIRED and none is performed. All
-- 89 existing quotes and all 29 frozen snapshots resolve to exactly the
-- behaviour that produced them with ZERO rows in these tables. An old
-- snapshot rendered today is byte-identical to the day it froze.
--
-- It also preserves the three real mixed-allocation quotes — f2db6e10,
-- f5f5ac14 and a264a755 (SENT) — which carry OFF and ON simultaneously.
-- Legacy resolution reads the per-assembly value, so mixed state survives
-- without being flattened into a quote-level answer.
--
-- ── WHY THE SNAPSHOT MIRROR EXISTS ───────────────────────────────────────
--
-- A sent revision must never inherit a later revision's election. Mirroring
-- the elections into the snapshot inside the send transaction makes that
-- structural rather than a rule someone has to remember.
--
-- ── NO BACKFILL FROM freight_treatment ───────────────────────────────────
--
-- `freight_subcategories.treatment` keeps its data and its internal display
-- label and does NOT become a second source of commercial truth. Inferring a
-- quote-level commercial decision from a per-subcategory label is precisely
-- the two-sources-of-truth error this model exists to avoid. BV-009 is itself
-- unratified (OD-001), and BV-011 §4.5 already flags that freight's
-- presentation authority and its accounting destination must be stated
-- explicitly or they will be read as competing.
--
-- ── DEPLOYMENT ORDER ─────────────────────────────────────────────────────
--
-- ADDITIVE, and therefore safe ahead of the code that reads it: new types and
-- new tables only, no constraint on any existing table. Every existing writer
-- of `quotes` and `quote_snapshots` continues to succeed without mentioning
-- these tables. (The destructive step in this slice was 0099, which correctly
-- followed the removal of its last reader.)

CREATE TYPE "recovery_mode" AS ENUM ('included', 'separate', 'absorbed');
--> statement-breakpoint

CREATE TYPE "recovery_charge" AS ENUM (
  'container_freight',
  'duty_tariffs',
  'tooling',
  'project_setup',
  'artwork_plate',
  'rd_formulation',
  'testing_micros',
  'other_service',
  'tooling_artwork_legacy'
);
--> statement-breakpoint

-- Live/working elections. Editable while the quote is a draft; frozen
-- thereafter by `assertNotFrozen` (Pattern 52 — these join the freeze list).
CREATE TABLE IF NOT EXISTS "quote_charge_recovery" (
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "charge_key" "recovery_charge" NOT NULL,
  "mode" "recovery_mode" NOT NULL,
  "elected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "elected_by_user_id" uuid REFERENCES "users"("id"),
  CONSTRAINT "quote_charge_recovery_pk" PRIMARY KEY ("quote_id", "charge_key")
);
--> statement-breakpoint

-- The durable record, mirrored inside the send transaction.
CREATE TABLE IF NOT EXISTS "quote_snapshot_charge_recovery" (
  "snapshot_id" uuid NOT NULL REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "charge_key" "recovery_charge" NOT NULL,
  "mode" "recovery_mode" NOT NULL,
  CONSTRAINT "quote_snapshot_charge_recovery_pk" PRIMARY KEY ("snapshot_id", "charge_key")
);
