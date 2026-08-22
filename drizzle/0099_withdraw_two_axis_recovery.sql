-- Withdraw the two-axis commercial recovery model (0098).
--
-- ── WHY THIS IS A REVERSAL AND NOT AN EDIT OF 0098 ───────────────────────
--
-- 0098 is APPLIED to the shared database (97 applied migrations; journal row
-- id=100, created_at=1786320156000). It happened. Deleting its file and its
-- journal entry would leave the shared database carrying four columns and two
-- types that NO repository migration creates and none can ever drop — so a
-- database built fresh from this repo would diverge from production
-- permanently, and nothing would report it.
--
-- So 0098 stays, exactly as applied, and this migration undoes it. A fresh
-- database replays 0098 then 0099 and lands where the shared database lands
-- after 0099: net zero, with the journal telling the truth about both steps.
--
-- ── WHY IT IS SAFE TO APPLY NOW ──────────────────────────────────────────
--
-- This is a DESTRUCTIVE migration, so the governing rule is that it may not
-- precede the code that stops reading what it removes. It does not:
--
--   · `origin/main` contains ZERO references to these columns — verified, not
--     assumed. The two-axis reader (`schema.ts`, `commercial-projection.ts`,
--     `commercial-recovery.ts`) was never committed and never deployed.
--   · Every one of the four columns is NULL on all 89 quotes, so no value is
--     lost — but that is why it is behaviour-neutral, NOT why it is safe. Kind
--     decides ordering; effect does not.
--
-- The design document's sequence included a "deploy so the last reader is
-- gone" step. That step is unnecessary HERE because there was never a
-- deployed reader — the reverted code lived only in a working tree. Recorded
-- rather than silently skipped, because the step is mandatory whenever a
-- reader HAS shipped.
--
-- ── ORDER WITHIN THE MIGRATION ───────────────────────────────────────────
--
-- Columns first, then the types they depend on. Dropping a type still
-- referenced by a column fails. `IF EXISTS` throughout so a replay against a
-- database that never received 0098 is a no-op rather than an error.
--
-- Superseded by the per-charge model: `quote_charge_recovery`, whose grain is
-- one governed charge rather than one cost class.

ALTER TABLE "quotes"
  DROP COLUMN IF EXISTS "recovery_service_fees",
  DROP COLUMN IF EXISTS "recovery_freight";
--> statement-breakpoint

ALTER TABLE "quote_snapshots"
  DROP COLUMN IF EXISTS "recovery_service_fees",
  DROP COLUMN IF EXISTS "recovery_freight";
--> statement-breakpoint

DROP TYPE IF EXISTS "recovery_service_fees";
--> statement-breakpoint

DROP TYPE IF EXISTS "recovery_freight";
