-- OD-032 phase 2 · drop the temporary (quote_id, charge_key) uniqueness
--
-- ── HELD AS A DRAFT UNTIL THE WRITER SHIPPED · JOURNALED 2026-08-27 ──────
--
-- This file was deliberately absent from _journal.json until phase 2's code
-- was deployed, because it drops the unique index the DEPLOYED writer's ON
-- CONFLICT named — applying it while that writer was live would have broken
-- every election. Expand-then-contract, same as 0107/0108.
--
-- Journaled once the following were established against DEPLOYED code, not
-- branch code:
--
--   * Production served commit 224130a, the merge that shipped the new writer.
--   * Every writer of `quote_charge_recovery` was enumerated across the whole
--     repository — src/, scripts/ and tests/ — because a previous sweep of
--     src/ alone missed a third writer in scripts/. Three exist:
--       - commercial-recovery-persist.ts  ON CONFLICT (charge_instance_id) ✔
--       - quotes.ts copy path             plain INSERT into a fresh quote ✔
--       - verify-scenario-copy.ts         plain INSERT (a script) ✔
--     None names (quote_id, charge_key).
--   * No FOREIGN KEY references this table, so no FK depends on the unique
--     being dropped. No triggers exist on it or on any table referencing it —
--     the check OD-017 skipped, which cost that slice a false claim.
--   * Zero duplicate charge instances, so the finer constraint holds on live
--     data before the coarser one is removed.
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
