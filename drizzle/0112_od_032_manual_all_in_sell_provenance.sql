-- OD-032 · the frozen instruction records WHY its recovery figures are null.
--
-- Disposition, Edward 2026-08-28: a manual sell-price override IS the final
-- all-in customer unit price. An `included` charge on such a cell is a real
-- statement — the operator asserts the charge is inside the price they typed —
-- but how much of that price is recovery is not a fact Nexus holds, and the
-- pricing engine says so by returning `embeddedRecoveryTotal = null`.
--
-- The freeze was asserting a figure anyway. Measured on production 2026-08-28,
-- quote 2f29af72 Tier 3: it told Accounting `governed_recovery = 1400,
-- amortized_per_unit = 0.07` on a cell whose own pricing layer declines to say
-- whether any recovery is embedded at all.
--
-- Those two columns now go NULL there. This one records why, because the reader
-- cannot otherwise tell the two absences apart:
--
--   governed_recovery IS NULL, manual_all_in_sell = false
--     -> nothing governs what this charge recovers (BV-013)
--
--   governed_recovery IS NULL, manual_all_in_sell = true
--     -> the operator priced the unit themselves, charge included, and the
--        embedded amount is not a fact anyone holds
--
-- Both are null. They are not the same absence, and an accountant acting on one
-- would act differently on the other.
--
-- ADDITIVE, and deliberately so: a new nullable-by-default column, no
-- tightening, no drop. Safe to apply before the code that reads it, per the
-- deployment-order rule — every currently deployed writer omits it and gets the
-- default, which is the correct value for every row written under the old
-- behaviour on a computed price.
--
-- DEFAULT false is honest for the backfill. Every existing frozen row predates
-- this contract, and the only way one of them could have been written from an
-- overridden cell is the defect this repairs — in which case its recovery
-- figures are already wrong and the flag would not make them right. Those rows
-- are identified by the audit trail, not by a backfill guess.

ALTER TABLE "quote_snapshot_recovery_instructions"
  ADD COLUMN IF NOT EXISTS "manual_all_in_sell" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "quote_snapshot_recovery_instructions"."manual_all_in_sell" IS
  'The cell''s unit sell was a manual all-in override, so embedded recovery is unknowable. Distinguishes that absence from BV-013 no-governed-rate.';
