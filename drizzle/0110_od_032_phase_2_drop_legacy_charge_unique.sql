-- OD-032 phase 2 · drop the temporary (quote_id, charge_key) uniqueness
--
-- ── DRAFT · DELIBERATELY ABSENT FROM _journal.json ───────────────────────
--
-- This file is a recorded DRAFT and is NOT journaled, so `db:migrate` will not
-- apply it. That is the mechanism, not an oversight: it drops the unique index
-- the DEPLOYED writer's ON CONFLICT names, so applying it while that writer is
-- still live breaks every election. It is journaled — in its own change — once
-- phase 2's code is deployed and the new writer conflicts on the primary key.
--
-- APPLIED AFTER PHASE 2's CODE DEPLOYS. Same expand-then-contract discipline
-- as 0107/0108, for the same reason: the constraint being dropped is the
-- unique index the previous writer's `onConflictDoUpdate` named, so dropping it
-- ahead of the writer change breaks every election the moment it applies.
--
-- ── WHY IT EXISTED, AND WHY IT STOPS ─────────────────────────────────────
--
-- 0108 kept `UNIQUE (quote_id, charge_key)` on `quote_charge_recovery` for two
-- reasons, and both expire here:
--
--   1. It was still TRUE. No component-owned charge existed, so a quote held
--      at most one charge of each type. Phase 2 makes two cartons each able to
--      cause print plates, and the constraint stops being true on the same day
--      it stops being relied on — which is the only honest time to drop it.
--
--   2. The deployed writer's ON CONFLICT named those columns. Phase 2's writer
--      conflicts on `charge_instance_id`, the primary key since 0108, which
--      exists both before and after this migration.
--
-- What replaces it is not a weaker guarantee but a correctly-grained one:
-- business uniqueness lives on `quote_charge_instances` as
-- `(quote_id, charge_key, owner_ref, label)`, so "one Print plates per carton,
-- unless labelled differently" is still enforced — at the grain where it is
-- true, rather than at a quote-wide grain where it never was.

DO $$
DECLARE offending int;
BEGIN
  -- Nothing should currently violate the finer constraint. If something does,
  -- the instance table's own UNIQUE would already have refused it — this
  -- reports rather than assumes, because dropping a constraint is the moment
  -- to know what it was holding.
  SELECT count(*) INTO offending FROM (
    SELECT "quote_id", "charge_key", "owner_ref", "label"
      FROM "quote_charge_instances"
     GROUP BY 1, 2, 3, 4 HAVING count(*) > 1
  ) d;
  IF offending > 0 THEN
    RAISE EXCEPTION 'od-032 phase 2: % duplicate charge instance(s) — the finer constraint is not holding', offending;
  END IF;
END $$;

ALTER TABLE "quote_charge_recovery"
  DROP CONSTRAINT "quote_charge_recovery_legacy_quote_charge_unique";

-- The composite identity FK added in 0108 is UNAFFECTED and stays:
--   (charge_instance_id, quote_id, charge_key)
--     → quote_charge_instances (id, quote_id, charge_key)
-- It is what keeps the election's denormalised columns from drifting, and it
-- is not a uniqueness constraint on the election table.
