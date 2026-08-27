-- OD-032 phase 1 · one charge-instance identity regime — EXPAND ONLY
--
-- Recovery elections gain a generated `charge_instance_id`. Nothing else
-- changes: no placement, no economics, no frozen row, no operator-visible
-- behaviour. The phase succeeds if the population harness reports that nothing
-- moved.
--
-- ── THIS MIGRATION IS DELIBERATELY ADDITIVE, AND THAT IS THE WHOLE POINT ─
--
-- The contract half — SET NOT NULL, move the primary key onto
-- `charge_instance_id`, add the composite identity FK — is NOT here. It ships
-- as phase 1b, after this migration and its code are deployed.
--
-- Splitting it is not caution, it is the rule. The deployed writer
-- (`commercial-recovery-persist.ts`) inserts without `charge_instance_id` and
-- uses `onConflictDoUpdate` targeting `(quote_id, charge_key)`. Tightening
-- ahead of that code would break BOTH: a NOT NULL it cannot satisfy, and an
-- ON CONFLICT whose unique index the PK move removes. On a shared dev/prod
-- database that is the 0066 outage shape exactly — a dormant incompatibility
-- becoming a 500 the moment the permissiveness absorbing it is withdrawn.
--
-- Compatibility in the interval, established rather than assumed:
--
--   deployed code + this schema   nullable column it never mentions  → works
--   new code      + this schema   writes the column, old PK intact   → works
--
-- ── WHY THE SYNTHESISED IDENTITY NEVER READS owner_ref ───────────────────
--
-- Today `quote_snapshot_recovery_instructions.owner_ref` is populated from the
-- anchor-leaf coercion, and its own schema comment says what it is:
-- "Traceability, not a join key." The anchor is decided by physical row order
-- when `position` ties (OD-028), so it can differ between a quote and its copy.
--
-- OD-032 makes owner attribution load-bearing. If synthesis derived an instance
-- id from that anchor, an anchor that moved would move an election's identity,
-- and OD-028 would stop being a display concern and become a commercial one.
--
-- So synthesis reads `(quote_id, charge_key)` and NOTHING ELSE, and every
-- synthesised row is `owner_ref = '@quote'`. Legacy charges are causally
-- Project-owned for OD-032 purposes, which is what they already meant.
--
-- ── '@quote' IS A SENTINEL, NOT A NULL ───────────────────────────────────
--
-- Owner is never nullable. A nullable owner is the state the design explicitly
-- rejects, and it is what makes freight/duty attribution guesswork today.
-- '@quote' cannot collide with a uuid, so "owned by the engagement" and "owned
-- by an entity that happens to have this id" stay distinguishable.

-- ── 1 · the instance table ───────────────────────────────────────────────
CREATE TABLE "quote_charge_instances" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quote_id"    uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "charge_key"  "recovery_charge" NOT NULL,
  -- '@quote' for engagement-owned; a quote_leaves id for component-owned once
  -- phase 2 introduces them. NEVER null.
  "owner_ref"   text NOT NULL,
  -- Required when charge_key = 'other'; an optional override otherwise. Empty
  -- string is not a label — the CHECK refuses it rather than storing a blank
  -- that reads as "unlabelled" in one place and "labelled ''" in another.
  "label"       text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "quote_charge_instances_label_not_blank"
    CHECK ("label" IS NULL OR btrim("label") <> ''),

  -- Business uniqueness, NOT the identity. The identity is `id`, so renaming a
  -- label cannot repoint an election, a frozen instruction or a NetSuite memo
  -- at a row that no longer exists under that name.
  --
  -- NULLS NOT DISTINCT because two unlabelled charges of one type on one owner
  -- are the duplicate this constraint exists to catch. Postgres' default treats
  -- NULLs as distinct, which would let both through — the constraint silently
  -- not applying to the entire synthesised population, which is every row here.
  CONSTRAINT "quote_charge_instances_business_unique"
    UNIQUE NULLS NOT DISTINCT ("quote_id", "charge_key", "owner_ref", "label")
);

CREATE INDEX "quote_charge_instances_quote_idx"
  ON "quote_charge_instances" ("quote_id");

-- Target of the composite identity FK that phase 1b adds. Created here so 1b
-- is a pure constraint addition with no index build against live rows.
CREATE UNIQUE INDEX "quote_charge_instances_identity_idx"
  ON "quote_charge_instances" ("id", "quote_id", "charge_key");

-- ── 2 · expand ───────────────────────────────────────────────────────────
ALTER TABLE "quote_charge_recovery"
  ADD COLUMN "charge_instance_id" uuid REFERENCES "quote_charge_instances"("id") ON DELETE CASCADE;

-- ── 3 · backfill: one instance per existing election, exactly once ───────
--
-- One row in, one row out. The INSERT reads only (quote_id, charge_key) — the
-- election's own primary key — so it cannot produce two instances for one
-- election or one instance for two.
INSERT INTO "quote_charge_instances" ("quote_id", "charge_key", "owner_ref")
SELECT "quote_id", "charge_key", '@quote'
  FROM "quote_charge_recovery";

UPDATE "quote_charge_recovery" r
   SET "charge_instance_id" = i."id"
  FROM "quote_charge_instances" i
 WHERE i."quote_id"   = r."quote_id"
   AND i."charge_key" = r."charge_key"
   AND i."owner_ref"  = '@quote';

-- ── 4 · validate, here rather than at contract time ──────────────────────
--
-- Phase 1b tightens over this backfill. A tightening that discovered an
-- incomplete backfill would fail with a constraint error naming a column
-- rather than a cause; these fail now, in their own words, while the schema is
-- still permissive enough to fix.
DO $$
DECLARE missing int; dup int; orphan int;
BEGIN
  SELECT count(*) INTO missing
    FROM "quote_charge_recovery" WHERE "charge_instance_id" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1: % election(s) did not receive an instance', missing;
  END IF;

  -- Exactly once, in both directions.
  SELECT count(*) INTO dup FROM (
    SELECT "charge_instance_id" FROM "quote_charge_recovery"
     GROUP BY "charge_instance_id" HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1: % instance(s) claimed by more than one election', dup;
  END IF;

  SELECT count(*) INTO orphan
    FROM "quote_charge_instances" i
    LEFT JOIN "quote_charge_recovery" r ON r."charge_instance_id" = i."id"
   WHERE r."charge_instance_id" IS NULL;
  IF orphan > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1: % synthesised instance(s) claimed by no election', orphan;
  END IF;
END $$;

-- Phase 1b (separate migration, after this code deploys):
--   ALTER TABLE quote_charge_recovery ALTER COLUMN charge_instance_id SET NOT NULL;
--   ALTER TABLE quote_charge_recovery DROP CONSTRAINT quote_charge_recovery_pk;
--   ALTER TABLE quote_charge_recovery ADD CONSTRAINT quote_charge_recovery_pk
--     PRIMARY KEY (charge_instance_id);
--   ALTER TABLE quote_charge_recovery ADD CONSTRAINT
--     quote_charge_recovery_instance_identity_fk
--     FOREIGN KEY (charge_instance_id, quote_id, charge_key)
--     REFERENCES quote_charge_instances (id, quote_id, charge_key) ON DELETE CASCADE;
