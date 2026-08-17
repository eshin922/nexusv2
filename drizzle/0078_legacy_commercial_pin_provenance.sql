-- Legacy commercial-policy pins: snapshot link becomes optional provenance.
--
-- RELAXING + ADDITIVE ONLY. One NOT NULL dropped, one nullable column added.
-- Nothing is tightened and nothing is dropped, so this is safe to apply ahead
-- of the code that reads it, per the deployment-order rule in CLAUDE.md
-- ("Migration deployment order is determined by compatibility"). Every
-- deployed writer supplies `quote_snapshot_id` today and keeps working
-- unchanged; the relaxation only permits a value they never produce.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- `quote_commercial_settings_pins` freezes firm-level commercial policy at
-- send, so a sent quote does not reprice when Firm Settings later change. 14
-- non-draft quotes predate the mechanism and carry no pin; they resolve
-- `legacy_live` and would move with any policy change.
--
-- Pinning them was blocked by this column being NOT NULL: 10 of the 14 have no
-- `quote_snapshots` row at all, and creating one would mean inventing a send
-- record — `sent_at`, a quote number, a `pdf_url` that never existed. That
-- would corrupt the one table whose entire purpose is being the immutable
-- record of what was sent, in order to fix a different problem.
--
-- ── THE OWNERSHIP BOUNDARY THIS ENCODES ───────────────────────────────────
--
-- The QUOTE owns the policy pin. `quote_id` stays NOT NULL with ON DELETE
-- CASCADE and is unchanged by this migration — quote ownership is not
-- weakened, and a pin without a quote remains impossible.
--
-- The SNAPSHOT link answers a different, secondary question: which immutable
-- send artifact produced this pin. For a legacy quote where no artifact was
-- ever captured, NULL is the truthful answer. It is provenance, not identity.
--
-- The UNIQUE constraint on `quote_snapshot_id` is retained deliberately and
-- still does its job: Postgres treats NULLs as distinct in a plain UNIQUE, so
-- many legacy pins may carry NULL while it remains impossible for two pins to
-- claim the SAME snapshot. That was always the constraint's purpose — "which
-- pin belongs to this send" must have one answer.
--
-- ── WHY A REASON COLUMN RATHER THAN INFERENCE ─────────────────────────────
--
-- A NULL snapshot could mean "legacy freeze, no artifact ever existed" or
-- "something failed to write". Those are opposite facts and a reader cannot
-- tell them apart from a NULL. `backfill_reason` makes the row self-describing
-- at the row, without a join and without archaeology:
--
--   NULL         -- written by the live send path, snapshot-backed
--   non-NULL     -- written by a migration, and says which and why
--
-- Deliberately text rather than an enum: the next backfill will have a
-- different reason, and an enum would make recording it a migration.

ALTER TABLE "quote_commercial_settings_pins"
  ALTER COLUMN "quote_snapshot_id" DROP NOT NULL;

ALTER TABLE "quote_commercial_settings_pins"
  ADD COLUMN IF NOT EXISTS "backfill_reason" text;

COMMENT ON COLUMN "quote_commercial_settings_pins"."quote_snapshot_id" IS
  'Optional provenance: which immutable send artifact produced this pin. NULL means no artifact was ever captured for this quote (legacy pre-pin send), NOT missing data — see backfill_reason. The quote, not the snapshot, owns the pin.';

COMMENT ON COLUMN "quote_commercial_settings_pins"."backfill_reason" IS
  'NULL for pins written by the live send path. Non-NULL identifies the migration that wrote this pin and why, so a NULL quote_snapshot_id reads as a recorded fact rather than an omission.';
