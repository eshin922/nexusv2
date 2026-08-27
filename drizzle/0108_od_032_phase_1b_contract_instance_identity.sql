-- OD-032 phase 1b · contract the instance identity
--
-- Phase 1 expanded and backfilled. This tightens, and tightens ONLY what is
-- actually invariant. Everything here is behaviour-neutral: no placement, no
-- economics, no frozen row, no operator-visible change.
--
-- ── 1 · RE-BACKFILL FIRST, BECAUSE PHASE 1's BACKFILL NO LONGER HOLDS ────
--
-- Between 0107 applying and the new writer deploying, the OLD writer was live
-- against the expanded schema. That was deliberate and it worked — but its
-- INSERT path had no `charge_instance_id` to write, so any election created in
-- that window carries NULL. Observed, not theorised: clearing and re-electing
-- a charge on production during the window produced exactly such a row.
--
-- The window is closed, and the count was zero at authoring time. That is not
-- a reason to skip this: an operator electing between the check and the
-- migration would produce another, and a tightening that assumed the earlier
-- backfill still held would fail on their row with a constraint error naming a
-- column rather than a cause.
--
-- The derivation is identical to 0107's — `(quote_id, charge_key)` and a
-- literal owner. It never reads an anchor-coerced `owner_ref`, so OD-028 has
-- no reach here either.

INSERT INTO "quote_charge_instances" ("quote_id", "charge_key", "owner_ref")
SELECT DISTINCT r."quote_id", r."charge_key", '@quote'
  FROM "quote_charge_recovery" r
 WHERE r."charge_instance_id" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "quote_charge_recovery" r
   SET "charge_instance_id" = i."id"
  FROM "quote_charge_instances" i
 WHERE r."charge_instance_id" IS NULL
   AND i."quote_id"   = r."quote_id"
   AND i."charge_key" = r."charge_key"
   AND i."owner_ref"  = '@quote'
   AND i."label" IS NULL;

-- ── 2 · VALIDATE ONLY WHAT IS INVARIANT ─────────────────────────────────
--
-- 0107's validate block asserted zero orphan instances. That was correct at
-- migration time — nothing could yet have deleted an election — and it is
-- WRONG as a permanent invariant: an instance with no election is the governed
-- future `unplaced` state, and OD-032 depends on it being representable.
-- Carrying that assertion forward would fail on a legitimate row, and it very
-- nearly did: deleting an election on production during the window left
-- exactly one such orphan.
--
-- So this checks the four things that are actually true forever, and does not
-- check the one that is not.
DO $$
DECLARE missing int; shared int; dangling int; mismatched int;
BEGIN
  -- (a) every live election has an instance
  SELECT count(*) INTO missing
    FROM "quote_charge_recovery" WHERE "charge_instance_id" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1b: % election(s) still have no instance after re-backfill', missing;
  END IF;

  -- (b) identity is unique at the instance grain — no instance serves two
  --     elections, which is what makes it an identity rather than a label
  SELECT count(*) INTO shared FROM (
    SELECT "charge_instance_id" FROM "quote_charge_recovery"
     GROUP BY "charge_instance_id" HAVING count(*) > 1
  ) d;
  IF shared > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1b: % instance(s) claimed by more than one election', shared;
  END IF;

  -- (c) referenced instances exist. The FK enforces this going forward; the
  --     assertion covers the rows that already exist, before the constraint
  --     that would have caught them is added.
  SELECT count(*) INTO dangling
    FROM "quote_charge_recovery" r
    LEFT JOIN "quote_charge_instances" i ON i."id" = r."charge_instance_id"
   WHERE i."id" IS NULL;
  IF dangling > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1b: % election(s) reference a missing instance', dangling;
  END IF;

  -- (d) no mismatched migration: the instance agrees with the election about
  --     which quote and which charge it is
  SELECT count(*) INTO mismatched
    FROM "quote_charge_recovery" r
    JOIN "quote_charge_instances" i ON i."id" = r."charge_instance_id"
   WHERE i."quote_id" <> r."quote_id" OR i."charge_key" <> r."charge_key";
  IF mismatched > 0 THEN
    RAISE EXCEPTION 'od-032 phase 1b: % election(s) disagree with their instance', mismatched;
  END IF;

  -- DELIBERATELY NOT CHECKED: orphan instances. An instance with no election
  -- is `unplaced`, which is a governed state and must remain valid.
END $$;

-- ── 3 · CONTRACT ─────────────────────────────────────────────────────────

ALTER TABLE "quote_charge_recovery"
  ALTER COLUMN "charge_instance_id" SET NOT NULL;

ALTER TABLE "quote_charge_recovery"
  DROP CONSTRAINT "quote_charge_recovery_pk";

ALTER TABLE "quote_charge_recovery"
  ADD CONSTRAINT "quote_charge_recovery_pk" PRIMARY KEY ("charge_instance_id");

-- (quote_id, charge_key) KEEPS a unique constraint, and this is temporary.
--
-- Two reasons, and the second is the one that matters. First, it is still TRUE:
-- no component-owned charge exists yet, so a quote holds at most one charge of
-- each type. Second, the deployed writer's `onConflictDoUpdate` targets these
-- columns, and dropping the index it names would break every election the
-- moment this migration applied — the same shape as tightening ahead of code,
-- which is what phase 1 was split to avoid.
--
-- PHASE 2 DROPS IT, together with the writer change that stops needing it.
-- That is the migration where two cartons may each cause print plates, and
-- this constraint stops being true on the same day it stops being relied on.
ALTER TABLE "quote_charge_recovery"
  ADD CONSTRAINT "quote_charge_recovery_legacy_quote_charge_unique"
  UNIQUE ("quote_id", "charge_key");

-- Makes an inconsistent denormalisation unrepresentable rather than merely
-- discouraged — the same discipline as the generated `owner_commercial_kind`
-- column on assembly_production_inputs. The target index was created in 0107
-- so this is a pure constraint addition with no index build.
ALTER TABLE "quote_charge_recovery"
  ADD CONSTRAINT "quote_charge_recovery_instance_identity_fk"
  FOREIGN KEY ("charge_instance_id", "quote_id", "charge_key")
  REFERENCES "quote_charge_instances" ("id", "quote_id", "charge_key")
  ON DELETE CASCADE;

-- ── THE HISTORICAL SNAPSHOT EXCEPTION ───────────────────────────────────
--
-- `quote_snapshot_recovery_instructions` has no `charge_instance_id` column,
-- so the exception is currently VACUOUS — there is no null to preserve and no
-- runtime path that could branch on one.
--
-- It becomes live when phase 6 links freeze to instances. At that point the
-- column is nullable FOR PRE-MIGRATION ROWS ONLY: frozen instructions are the
-- record of what Accounting was told and may not be backfilled. Every row
-- written after that migration carries an instance, and no runtime path may
-- read the null to choose behaviour — a reader that did would preserve exactly
-- the two-identity split phase 1 existed to end.
