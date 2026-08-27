-- OD-032 phase 2 · component-owned charge storage, vocabulary and economics
--
-- ADDITIVE. No existing row changes meaning, no legacy charge moves, and
-- nothing renders differently — there is no UI in this phase by design.
--
-- ── STORAGE REUSES THE PHASE 1 IDENTITY TABLE ────────────────────────────
--
-- The implementation plan proposed a parallel `quote_leaf_charges` table. That
-- was written before `quote_charge_instances` existed. Now that it does, a
-- second table would be a second charge model: two places a charge can live,
-- two identities, two things recovery and freeze must learn to address.
--
-- A component-owned charge is the same thing as a quote-owned one with a
-- different owner. So it is the same table, and `owner_ref` carries the
-- difference — which is what "ownership answers what caused the charge" means
-- expressed as a schema rather than as a comment.
--
-- ── owner_quote_leaf_id MAKES ORPHANING UNREPRESENTABLE ──────────────────
--
-- `owner_ref` is text because the owner is polymorphic, and text cannot carry a
-- foreign key. A component charge whose leaf was deleted would then be an
-- orphan pointing at a uuid that resolves to nothing — attribution to a cause
-- that no longer exists, which is the exact failure the design rejects.
--
-- So the leaf owner ALSO travels as a real FK column, and a CHECK ties the two
-- together so they cannot disagree. Deleting a component now cascades to the
-- charges it caused rather than stranding them.

-- ── 1 · vocabulary ───────────────────────────────────────────────────────
--
-- Two new governed types. The other three V1 component types reuse existing
-- values, per the disposition:
--
--   Print plates        NEW — plate and cylinder making
--   Tooling & dies      `tooling`        — cutting dies, moulds, collars
--   Artwork & prepress  `artwork_plate`  — design and adaptation labour.
--                       NOT renamed: it appears in frozen instructions, which
--                       are the record of what Accounting was told. Once
--                       `print_plates` exists, `artwork_plate` on a NEW
--                       component charge means only the labour half, because
--                       the making half has somewhere else to go.
--   Samples & proofs    NEW — pre-production samples of this component
--   Other · labelled    `other_service`  — label required, already per-line
--
--   Project setup       `project_setup`  — quote-owned, UNCHANGED
--   Run setup           DEFERRED — no governed NetSuite destination yet.
--                       Not a blocker; arrives via Other · labelled in V1.
ALTER TYPE "recovery_charge" ADD VALUE IF NOT EXISTS 'print_plates';
ALTER TYPE "recovery_charge" ADD VALUE IF NOT EXISTS 'samples_proofs';

-- ── 2 · the causal owner, as a real reference ───────────────────────────
ALTER TABLE "quote_charge_instances"
  ADD COLUMN "owner_quote_leaf_id" uuid
  REFERENCES "quote_leaves"("id") ON DELETE CASCADE;

-- The two owner columns cannot disagree. `'@quote'` has no leaf; a component
-- owner's text IS its leaf id. Any other combination is unrepresentable rather
-- than merely discouraged.
ALTER TABLE "quote_charge_instances"
  ADD CONSTRAINT "quote_charge_instances_owner_agrees"
  CHECK (
    ("owner_ref" = '@quote' AND "owner_quote_leaf_id" IS NULL)
    OR ("owner_quote_leaf_id" IS NOT NULL AND "owner_ref" = "owner_quote_leaf_id"::text)
  );

CREATE INDEX "quote_charge_instances_owner_leaf_idx"
  ON "quote_charge_instances" ("owner_quote_leaf_id");

-- ── 3 · per-tier economics ───────────────────────────────────────────────
--
-- One row per (charge instance, tier). Both amounts are OPERATOR-ENTERED and
-- nothing is derived: per `costs-page-layout` §1, "one-time costs are entered
-- per tier, explicitly, by the operator... Division is the operator's
-- statement, not a calculation."
--
-- There is no `basis` column. Every component-owned charge is `one_time` —
-- "no exceptions, and the sheet never asks" — and a column that can hold only
-- one value can one day hold another.
CREATE TABLE "quote_charge_instance_tiers" (
  "charge_instance_id" uuid NOT NULL
    REFERENCES "quote_charge_instances"("id") ON DELETE CASCADE,
  "tier_id" uuid NOT NULL
    REFERENCES "quote_tiers"("id") ON DELETE CASCADE,

  /** What DPS pays. Cost truth: invariant under every recovery election. */
  "cost_amount" numeric(12, 2) NOT NULL DEFAULT 0,
  /**
   * What DPS intends to recover. NULL is not zero: zero says the charge
   * recovers nothing, and NULL says nothing governs what it recovers (BV-013).
   */
  "recovery_ask" numeric(12, 2),

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "quote_charge_instance_tiers_pk"
    PRIMARY KEY ("charge_instance_id", "tier_id")
);

-- ── 4 · what is NOT here ─────────────────────────────────────────────────
--
-- The temporary UNIQUE (quote_id, charge_key) on `quote_charge_recovery`
-- stays until 0110, which drops it in the same change that makes two same-type
-- component charges representable AND after the writer that names it has been
-- deployed. Dropping it here would break every election the moment this
-- applied, because the deployed writer's ON CONFLICT targets those columns.
--
-- 0110 is applied AFTER this phase's code deploys. Same expand-then-contract
-- discipline as phase 1/1b, for the same reason.
