-- Commercial recovery profile — the operator-selected layer between internal
-- cost truth and customer presentation.
--
-- ── WHY DISCRETE ENUMS RATHER THAN JSONB ─────────────────────────────────
--
-- This is commercial configuration that reaches a customer document. A JSONB
-- blob is easy to extend and impossible to constrain; a typed column refuses a
-- value the model does not have. It also mirrors the presentation axes
-- (pdf_layout / detail_level / include_spec_addendum), which already use this
-- exact live-column + snapshot shape — so recovery extends a convention rather
-- than inventing one.
--
-- ── WHY EVERY COLUMN IS NULLABLE WITH NO DEFAULT ─────────────────────────
--
-- NULL IS A VALUE WITH A MEANING, not an absence awaiting one:
--
--     NULL recovery_service_fees  ->  'per_assembly'
--     NULL recovery_freight       ->  'bundled'
--
-- Those are not defaults chosen now. They are EXACTLY the behaviour that
-- produced every existing quote and all 29 existing snapshots — per-assembly
-- allocation reads, and `freightLines: []`. Resolution is pinned to them in
-- code and asserted by test, so reading an old snapshot can never fall through
-- to a new default.
--
-- A DEFAULT would defeat that: it would write a decision nobody made onto every
-- existing row, and the difference between "nobody chose" and "someone chose
-- this" would be lost. `ResolvedRecovery.source = 'legacy'` keeps them apart.
--
-- ── NO BACKFILL FROM freight_treatment ───────────────────────────────────
--
-- `freight_subcategories.treatment` keeps its data and its internal display
-- label and does NOT become a second source of commercial truth. The sole
-- `pass_through` row belongs to a COMPLETE quote (immutable), no open draft
-- exercises it, and inferring a quote-level commercial decision from a
-- per-subcategory label is precisely the two-sources-of-truth error this model
-- exists to avoid.
--
-- ── DEPLOYMENT ORDER ─────────────────────────────────────────────────────
--
-- ADDITIVE and safe ahead of the code that reads it: every existing writer of
-- `quotes` and `quote_snapshots` continues to succeed without mentioning these
-- columns, because they are nullable with no constraint. (A tightening
-- migration would need a deployed-writer proof; this one does not.)

CREATE TYPE "recovery_service_fees" AS ENUM ('per_assembly', 'allocate', 'separate');
--> statement-breakpoint
CREATE TYPE "recovery_freight" AS ENUM ('bundled', 'separate_line');
--> statement-breakpoint

-- Live/working values. Editable while the quote is a draft; frozen thereafter
-- by `assertNotFrozen` (Pattern 52 — these columns join the freeze list).
ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "recovery_service_fees" "recovery_service_fees",
  ADD COLUMN IF NOT EXISTS "recovery_freight" "recovery_freight";
--> statement-breakpoint

-- The durable record, mirrored inside the send transaction. A sent revision
-- reads these and can never inherit a later revision's recovery change.
ALTER TABLE "quote_snapshots"
  ADD COLUMN IF NOT EXISTS "recovery_service_fees" "recovery_service_fees",
  ADD COLUMN IF NOT EXISTS "recovery_freight" "recovery_freight";
