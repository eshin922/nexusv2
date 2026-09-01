-- The frozen ELECTION table collapsed two elections of one charge type.
--
-- `quote_snapshot_charge_recovery` was keyed `(snapshot_id, charge_key)`, so a
-- quote electing the SAME charge type on two different components could freeze
-- only one of them. The second insert raised
--
--   23505  duplicate key value violates unique constraint
--          "quote_snapshot_charge_recovery_pk"
--   Key (snapshot_id, charge_key)=(..., print_plates) already exists.
--
-- and the whole send transaction rolled back. Every quote in that shape was
-- unsendable, and nothing said so until one existed.
--
-- The two tables either side of it are already at the right grain:
--
--   quote_charge_recovery                  PK (charge_instance_id)
--   quote_snapshot_recovery_instructions   UNIQUE (snapshot, key, owner, tier)
--
-- Only the freeze of the election was narrower than the thing it freezes.
--
-- ── COMPATIBILITY ────────────────────────────────────────────────────────
--
-- RELAXING, not tightening: the deployed writer inserts no instance id, so its
-- rows land with `charge_instance_id IS NULL` and remain bound by the partial
-- unique below, which reproduces the OLD key exactly. The migration is
-- therefore safe to apply ahead of the code that fills the column, and the
-- application order is migration-then-code.
--
-- NULL is history, never a fourth state. Rows frozen before this migration
-- cannot be given an instance retroactively -- the election they froze may
-- since have been superseded, and inventing an id would dress a guess as a
-- record. The two partial uniques let both eras keep their own guarantee.

ALTER TABLE "quote_snapshot_charge_recovery"
  ADD COLUMN "charge_instance_id" uuid;

ALTER TABLE "quote_snapshot_charge_recovery"
  ADD CONSTRAINT "quote_snapshot_charge_recovery_instance_fk"
  FOREIGN KEY ("charge_instance_id") REFERENCES "quote_charge_instances"("id")
  ON DELETE SET NULL;

-- A frozen election outlives the draft-side instance it was projected from:
-- deleting a charge on a later revision must not delete the record of what a
-- customer was already quoted. SET NULL, never CASCADE -- the same disposition
-- `quote_snapshot_recovery_instructions.charge_instance_id` already carries.

ALTER TABLE "quote_snapshot_charge_recovery"
  DROP CONSTRAINT "quote_snapshot_charge_recovery_pk";

ALTER TABLE "quote_snapshot_charge_recovery"
  ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid();

-- Post-migration rows: one row per elected INSTANCE per snapshot. This is the
-- contract the live table has always had.
CREATE UNIQUE INDEX "quote_snapshot_charge_recovery_instance_uq"
  ON "quote_snapshot_charge_recovery" ("snapshot_id", "charge_instance_id")
  WHERE "charge_instance_id" IS NOT NULL;

-- Pre-migration rows: one row per charge KEY per snapshot, exactly as the old
-- primary key guaranteed. Stated rather than dropped, so history keeps the
-- invariant it was written under and a stray backfill cannot violate it.
CREATE UNIQUE INDEX "quote_snapshot_charge_recovery_legacy_uq"
  ON "quote_snapshot_charge_recovery" ("snapshot_id", "charge_key")
  WHERE "charge_instance_id" IS NULL;
