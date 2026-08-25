-- The authored instruction to Accounting.
--
-- ── WHAT IT IS ──────────────────────────────────────────────────────────
--
-- Card 3's third block: free text an operator writes for whoever books this
-- quote. The card's own subtitle states its two properties — "Inherited on
-- acceptance. Never printed for the customer."
--
-- It is INTERNAL. It must never reach the customer document, and the boundary
-- verifier already enforces that structurally: the customer render tree may not
-- import from the schema, and `CustomerView` has no field for this. There is
-- nowhere for it to leak to.
--
-- ── WHY TWO COLUMNS AGAIN ───────────────────────────────────────────────
--
-- The same two-store shape as every other quote fact, and for the same reason:
--
--   quotes.accounting_instruction            the AUTHORED value, edited while
--                                            the quote is a draft
--   quote_snapshots.accounting_instruction   the FROZEN copy, written in the
--                                            send transaction, keyed
--                                            (quote_id, version_number)
--
-- Frozen with the quote and its version, per Edward's disposition. Accounting
-- acts on this after acceptance, and an instruction that could still be edited
-- then would let the booking instruction drift from the quote it was written
-- for — the same defect as the customer note, one audience over.
--
-- The consequence, stated rather than discovered: an instruction cannot be
-- added to a quote that has already been sent. Revising the quote is the path,
-- which is the same answer every other frozen field gives.
--
-- ── CLASSIFICATION: ADDITIVE ────────────────────────────────────────────
--
-- Two nullable columns. Nothing tightened, nothing dropped, no backfill needed
-- — an absent instruction is a quote nobody wrote one for, which is every
-- quote today and is correctly NULL rather than empty.

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "accounting_instruction" text;

ALTER TABLE "quote_snapshots"
  ADD COLUMN IF NOT EXISTS "accounting_instruction" text;
