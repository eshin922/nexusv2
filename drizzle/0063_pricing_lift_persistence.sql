-- Phase 3 · Package 1 — persistence for applied surgical lifts.
--
-- Hand-written. `db:generate` is unusable until OD-012 is repaired; its
-- baseline stops at 0048 and it emits confident destructive SQL against the
-- database that also serves production.
--
-- ── IDENTITY ──────────────────────────────────────────────────────────────
--
-- Keyed on `quote_leaf_id` — the CANONICAL commercial attachment (OD-014) —
-- and NOT on `assembly_leaf_id`. Every existing cost-input table
-- (`assembly_leaf_inputs`, `assembly_leaf_overrides`, `assembly_leaf_targets`)
-- keys on the legacy junction, which is exactly the condition OD-017 records
-- as blocking ASY-optional authoring: a direct attachment
-- (`quote_leaves.assembly_id IS NULL`) has no junction row, so nothing can be
-- authored against it.
--
-- `CostingLift.quoteLeafId` is already canonical by design, so this table is
-- the one place where the persisted row and the engine's expectation agree
-- without translation. A row loads straight into a `CostingLift`. There is no
-- crossing to get wrong, which matters because getting that crossing wrong is
-- the defect this surface has now produced twice.
--
-- ── ROW EXISTENCE IS THE FACT ─────────────────────────────────────────────
--
-- `lift_pct` is NOT NULL and strictly positive, so a row means "a lift is in
-- effect on this cell" and its absence means there is none. Same sparse
-- posture as `assembly_leaf_overrides`. A nullable value would introduce a
-- third state — a row asserting no lift — which the staging model has no way
-- to represent and the operator has no way to reach.
--
-- Zero is excluded deliberately: a lift that raises nothing is not a lift, and
-- storing one would make `appliedCount` report an adjustment the operator
-- cannot see in any price.
--
-- ── WHAT IS DELIBERATELY NOT ENFORCED HERE ────────────────────────────────
--
-- A lift and a direct price on the same cell are mutually exclusive
-- commercially — the engine refuses the lift with the `overridden` rejection,
-- because a lift would silently overturn a price someone set on purpose.
-- That rule is NOT duplicated as a constraint, for two reasons: the override
-- lives on the legacy junction, so enforcing it in SQL would require exactly
-- the identity crossing this table exists to avoid; and the refusal is a
-- commercial verdict the engine states with a reason the operator can read,
-- which a constraint violation is not.
--
-- Additive only. Nothing existing is read or modified, and no runtime consumes
-- this table until the action layer starts writing to it.

CREATE TABLE IF NOT EXISTS "quote_leaf_lifts" (
  "quote_leaf_id" uuid NOT NULL REFERENCES "quote_leaves"("id") ON DELETE cascade,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE cascade,
  "lift_pct" numeric(6,4) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quote_leaf_lifts_pkey" PRIMARY KEY ("quote_leaf_id","tier_id"),
  CONSTRAINT "quote_leaf_lifts_pct_positive" CHECK (lift_pct > 0)
);--> statement-breakpoint

-- Per-tier sweeps: "what is lifted at this tier" is how the staging bar and
-- the tier rollup both read the set.
CREATE INDEX IF NOT EXISTS "quote_leaf_lifts_tier_id_idx" ON "quote_leaf_lifts" ("tier_id");--> statement-breakpoint

-- Both FKs are independently valid while naming different Quotes, and the
-- resulting row would price a cell that does not exist. Same shape, and the
-- same remedy, as `enforce_component_freight_same_quote` on
-- `freight_leg_component_tier_costs`.
CREATE FUNCTION enforce_quote_leaf_lift_same_quote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE leaf_quote uuid; tier_quote uuid;
BEGIN
  SELECT quote_id INTO leaf_quote FROM quote_leaves WHERE id = NEW.quote_leaf_id;
  SELECT quote_id INTO tier_quote FROM quote_tiers WHERE id = NEW.tier_id;
  IF leaf_quote IS NULL OR tier_quote IS NULL OR leaf_quote <> tier_quote THEN
    RAISE EXCEPTION 'a pricing lift must resolve exactly one Quote';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

CREATE TRIGGER "quote_leaf_lifts_same_quote" BEFORE INSERT OR UPDATE ON "quote_leaf_lifts" FOR EACH ROW EXECUTE FUNCTION enforce_quote_leaf_lift_same_quote();
