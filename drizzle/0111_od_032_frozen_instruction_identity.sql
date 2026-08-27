-- OD-032 P-3 · durable instance identity on the frozen recovery instruction
--
-- ADDITIVE, and nullable. No existing row changes, nothing is backfilled, and
-- no deployed writer is affected by a nullable column appearing — which is why
-- this may be applied before the code that reads it, per the compatibility
-- rule rather than by a fixed direction.
--
-- ── WHAT THIS FIXES ──────────────────────────────────────────────────────
--
-- `quote_snapshot_recovery_instructions` identifies a charge by
-- (charge_key, owner_ref, tier_id). OD-032 makes two charges of one type on one
-- component representable — and for that case all three columns are IDENTICAL,
-- so the two instructions differ only in their amounts.
--
-- An accountant reading the record Accounting bills from cannot tell which
-- instruction belongs to which charge. The record has to be able to represent
-- what the model can now express.
--
-- ── WHY NULLABLE, AND WHAT THE NULL MEANS ────────────────────────────────
--
-- The instruction covers EVERY PLACED charge, not every elected one. A legacy
-- charge placed by per-assembly resolution has no election, and therefore no
-- instance row to point at. Requiring an id would mean inventing one for the
-- great majority of live rows.
--
-- So the rule is narrower than the column type:
--
--     NULL     only for a legacy-placed charge with no election
--     NOT NULL for every component-owned charge, which cannot exist
--              without an instance
--
-- That is asserted in `tests/unit/od-032-freeze-integrity.test.ts` rather than
-- left as convention. A null on a component charge would mean identity was
-- lost between authoring and freeze.
--
-- ── NOT A DISCRIMINATOR ──────────────────────────────────────────────────
--
-- Phase 1's disposition forbids a permanent nullable discriminator preserving
-- two identity models, and this is not one: nothing reads the null to choose
-- behaviour. It records whether an instance existed, which is a fact about the
-- legacy model rather than a switch.
--
-- ── HISTORICAL ROWS ──────────────────────────────────────────────────────
--
-- Untouched, deliberately. A frozen instruction is the record of what
-- Accounting was told, and back-filling one would rewrite that record. The
-- Pattern 52 historical-snapshot exception governs: pre-migration rows keep
-- NULL, and no runtime behaviour branches on it.

ALTER TABLE "quote_snapshot_recovery_instructions"
  ADD COLUMN "charge_instance_id" uuid
  REFERENCES "quote_charge_instances"("id") ON DELETE SET NULL;

-- ON DELETE SET NULL, not CASCADE. A frozen instruction outlives the draft-side
-- charge it was projected from: deleting a charge on a later revision must not
-- delete the record of what a customer was already billed. The pointer is
-- traceability; the instruction is the fact.

CREATE INDEX "quote_snapshot_recovery_instructions_charge_instance_idx"
  ON "quote_snapshot_recovery_instructions" ("charge_instance_id");
