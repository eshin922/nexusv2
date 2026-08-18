-- The Production input `Testing / Micros` had no column.
--
-- ADDITIVE. One nullable numeric column. Safe ahead of the code that reads it.
--
-- ── THE CATCH ─────────────────────────────────────────────────────────────
--
-- The Stage 3 A disposition names exactly one governed Production input per
-- Direct Service identity:
--
--   Formulation          -> R&D / Formulation      rd_total             ✓
--   Filling / Blending   -> Filling / Blending     filling_blending_cost ✓
--   Pack-out / Assembly  -> CM Assembly / Pack-out cm_assembly_total     ✓
--   Testing / Micros     -> Testing / Micros       (no column)           ✗
--   Other Service        -> Other Service          other_service_total   ✓
--
-- Four resolved against `assembly_production_inputs`; the fifth did not. The
-- only occurrence of `testing_micros` in the schema was the enum value added
-- by 0079.
--
-- ── WHY NOT REUSE other_service_total ─────────────────────────────────────
--
-- It would have worked, and it would have been wrong. Two governed identities
-- writing one column makes them indistinguishable in the data, and they are
-- not the same thing downstream: BV-011 maps Testing and Other to DIFFERENT
-- accounting destinations. A column that means "testing, or something else,
-- depending on which leaf owns the row" cannot be projected onto a Sales Order
-- line without re-deriving the distinction the column threw away.
--
-- Same discipline as "exact reconciliation is necessary but not sufficient":
-- the totals would have been right and the attribution wrong.
--
-- ── SCOPE ─────────────────────────────────────────────────────────────────
--
-- The column lands on the shared table, so Item Groups gain it too. It is NOT
-- surfaced on the Item Group Production table in this slice — whether an Item
-- Group should author Testing separately is a BV-011 question, not a Stage 3 A
-- one. Unused there for now, exactly as `bulk_raw_cost` is unused for services.

ALTER TABLE "assembly_production_inputs"
  ADD COLUMN "testing_micros_total" numeric(12, 2);

COMMENT ON COLUMN "assembly_production_inputs"."testing_micros_total" IS
  'Testing / Micros. Its own column rather than a reuse of other_service_total: BV-011 maps Testing and Other to different accounting destinations, and one column carrying both would discard the distinction a Sales Order line needs. Not surfaced on the Item Group Production table in Stage 3 A.';
