-- The frozen recovery INSTRUCTION — what Accounting acts on.
--
-- ── WHY THE EXISTING SNAPSHOT TABLE IS NOT ENOUGH ────────────────────────
--
-- `quote_snapshot_charge_recovery` freezes the ELECTION: which mode an
-- operator chose, per charge. That is provenance, and it is worth keeping.
--
-- It cannot be the accounting instruction, for a reason that is easy to miss:
-- a LEGACY-placed charge has no election row at all. Absence of a row is the
-- load-bearing state of the whole model. So a table keyed on elections records
-- nothing for the great majority of charges — and Accounting would be unable
-- to distinguish "amortized under legacy pricing, do not invoice" from "this
-- charge does not exist on the quote".
--
-- Every live quote today is in exactly that state. Freezing only elections
-- would freeze nothing.
--
-- So this records the instruction for EVERY placed charge, elected or not.
--
-- ── GRANULARITY: PER (OWNER, TIER) ──────────────────────────────────────
--
-- Placement is decided per (owner, tier), and a quote can hold one charge at
-- several owners with different treatments — three real quotes carry
-- `allocate_service_fees_to_cost` ON and OFF simultaneously, one already sent.
-- One row per charge would have to pick a treatment for a quote that has two,
-- and picking would write a false instruction.
--
-- ── THE THREE QUANTITIES, EACH ITS OWN COLUMN ───────────────────────────
--
--   cost                     what DPS pays
--   governed_recovery        what DPS intends to recover
--   separate_invoice_amount  what Accounting bills as its own line
--
-- For an amortized charge the third is 0 while the second is not, and that
-- divergence IS the instruction. Collapsing them would either lose the intent
-- or tell Accounting to bill a charge the customer already paid in the rate.
--
-- `amortized_per_unit` and `tier_quantity` are the basis, present only for an
-- amortized charge — a separately-billed one was not spread over anything, and
-- a zero there would read as "amortized over nothing".
--
-- NOT a NetSuite instruction. Whether a zero-dollar OTC line is emitted is a
-- later Order Packet decision; this is the authority it will read.
--
-- ── DEPLOYMENT ORDER ────────────────────────────────────────────────────
--
-- ADDITIVE, and therefore safe ahead of the code that writes it: one new type
-- and one new table, no constraint on anything existing. Every current writer
-- of `quote_snapshots` continues to succeed without mentioning it.

CREATE TYPE "recovery_treatment" AS ENUM (
  'unit_price',
  'separate_line',
  'absorbed'
);
--> statement-breakpoint

CREATE TYPE "recovery_treatment_source" AS ENUM ('election', 'legacy');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quote_snapshot_recovery_instructions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_snapshot_id" uuid NOT NULL
    REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "charge_key" "recovery_charge" NOT NULL,
  -- The assembly or quote-leaf the charge was authored against, as text: the
  -- two are different tables and a single FK cannot address both. Recorded for
  -- traceability, not joined on by the accounting read.
  "owner_ref" text NOT NULL,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE CASCADE,

  "treatment" "recovery_treatment" NOT NULL,
  "treatment_source" "recovery_treatment_source" NOT NULL,

  -- What DPS pays. Never null: a charge without a cost is not a charge.
  "cost" numeric(14, 2) NOT NULL,
  -- What DPS intends to recover. NULL when no governed rate resolved — not 0,
  -- because 0 would say the charge recovers nothing and the truth is that
  -- nothing governs what it recovers (BV-013).
  --
  -- The GOVERNED figure. For a LEGACY unit-price placement it is not the
  -- realized one: an allocated fee flows into the sell ladder, so the
  -- quote-level adjustment marks it up — 1400 becomes 1400 x (1 + gpa),
  -- measured as +280 at 0.20 and +700 at 0.50. Those rows carry a NULL basis
  -- below precisely so no per-unit figure can be read off them.
  "governed_recovery" numeric(14, 2),
  -- What Accounting bills separately. 0 for an amortized charge, and that 0 is
  -- the instruction rather than an absence.
  "separate_invoice_amount" numeric(14, 2),
  -- The amortization basis, present only where the recovery is FIXED: an
  -- ELECTED unit-price placement, whose governed recovery is added after the
  -- pricing ladder. NULL for a separately-billed charge, which was not spread
  -- over anything, and NULL for a legacy allocated fee, whose recovered amount
  -- moves with the quote-level adjustment.
  --
  -- Which is the accounting substance of electing: it converts an amortization
  -- nobody can state into one that is frozen and reconcilable.
  "amortized_per_unit" numeric(14, 6),
  "tier_quantity" integer,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "quote_snapshot_recovery_instructions_unique"
    UNIQUE ("quote_snapshot_id", "charge_key", "owner_ref", "tier_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "quote_snapshot_recovery_instructions_snapshot_idx"
  ON "quote_snapshot_recovery_instructions" ("quote_snapshot_id");
