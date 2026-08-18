-- BV-013 Step 1 · give every existing pin an explicit historical `Production`
-- rate, BEFORE anything asks for one.
--
-- ADDITIVE. Inserts rows; alters and deletes nothing.
--
-- ── WHY THIS GATES THE CODE CHANGE ────────────────────────────────────────
--
-- A pinned quote resolves against its OWN defaults map, built from these rows.
-- No pin carries `Production`, so the moment the engine asks for it:
--
--   • today's ladder falls through to the pin's `Other` (0.30) — coincidentally
--     the historical rate, and silently wrong the day it is not;
--   • the FAIL-VISIBLE ladder BV-013 requires has no rung to fall to, so every
--     one of the 26 pinned quotes stops resolving at all.
--
-- The second is why this runs first. It is not a tidy-up that could follow the
-- cutover; the cutover breaks every sent quote without it.
--
-- ── WHERE THE HISTORICAL RATE COMES FROM ──────────────────────────────────
--
-- `Manufacturing` — the category that actually priced the production section
-- when the pin was taken.
--
-- Under BV-013 `Production` must also serve BULK RAW, which historically
-- resolved `Raw ingredients` (recorded in these rows with
-- `chosen_rung = 'Other'`, because no `Raw ingredients` default has ever
-- existed). One backfilled row can only serve both if the two never disagreed.
--
-- Measured across the live population: 0 divergent, 270 rows, no pin missing
-- either category, none already carrying `Production`.
--
-- They agree by COINCIDENCE, not construction — `Manufacturing` is 0.30 and
-- `Raw ingredients` lands on `Other`, also 0.30. So the census is asserted
-- BELOW, at run time, rather than trusted from that measurement. If a
-- divergent pin ever exists, one `Production` row cannot represent both and
-- this migration STOPS rather than choosing a value.
--
-- ── WHAT IS DELIBERATELY NOT DONE ─────────────────────────────────────────
--
-- The `Manufacturing` and `Raw ingredients` rows are RETAINED. They are the
-- record of what was actually pinned and the evidence this backfill was
-- derived from; deleting them would destroy the only account of how each
-- `Production` rate was arrived at.
--
-- `chosen_rung` on the new rows says where the value came from rather than
-- restating the category, so a later reader can tell a backfilled rate from
-- one a live resolution produced.

DO $$
DECLARE
  divergent integer;
  already   integer;
  orphaned  integer;
BEGIN
  -- 1 · the two historical authorities must agree, per pinned coordinate.
  SELECT count(*) INTO divergent
    FROM "quote_commercial_markup_pins" m
    JOIN "quote_commercial_markup_pins" r
      ON  r."pin_id"        =              m."pin_id"
      AND r."quote_leaf_id" IS NOT DISTINCT FROM m."quote_leaf_id"
      AND r."tier_id"       IS NOT DISTINCT FROM m."tier_id"
      AND r."category"      = 'Raw ingredients'
   WHERE m."category" = 'Manufacturing'
     AND m."markup_pct" <> r."markup_pct";

  IF divergent > 0 THEN
    RAISE EXCEPTION
      'BV-013 pin backfill STOPPED: % pinned coordinate(s) have Manufacturing <> Raw ingredients. One Production rate cannot represent both. Resolve the divergence explicitly — do not pick a value.',
      divergent;
  END IF;

  -- 2 · nothing may already carry Production, or this would double-insert and
  --     the pin resolver's consistency tripwire would then throw at read time.
  SELECT count(*) INTO already
    FROM "quote_commercial_markup_pins" WHERE "category" = 'Production';
  IF already > 0 THEN
    RAISE EXCEPTION
      'BV-013 pin backfill STOPPED: % row(s) already carry Production. This migration is not idempotent by design — re-running it would create a second, possibly conflicting rate for the same coordinate.',
      already;
  END IF;

  -- 3 · every pin that has a Raw ingredients row must have a Manufacturing row
  --     to copy from. A pin with only the former would silently receive no
  --     Production rate and fail at the cutover, which is the failure this
  --     whole migration exists to prevent.
  SELECT count(*) INTO orphaned
    FROM "quote_commercial_markup_pins" r
   WHERE r."category" = 'Raw ingredients'
     AND NOT EXISTS (
       SELECT 1 FROM "quote_commercial_markup_pins" m
        WHERE m."pin_id"        =              r."pin_id"
          AND m."quote_leaf_id" IS NOT DISTINCT FROM r."quote_leaf_id"
          AND m."tier_id"       IS NOT DISTINCT FROM r."tier_id"
          AND m."category"      = 'Manufacturing');
  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'BV-013 pin backfill STOPPED: % coordinate(s) have Raw ingredients with no Manufacturing to derive Production from.',
      orphaned;
  END IF;

  RAISE NOTICE 'BV-013 pin backfill census clear: 0 divergent, 0 pre-existing Production, 0 orphaned.';
END $$;

INSERT INTO "quote_commercial_markup_pins"
  ("pin_id", "quote_leaf_id", "tier_id", "category", "chosen_rung",
   "markup_pct", "source_user_id", "source_set_at")
SELECT
  m."pin_id",
  m."quote_leaf_id",
  m."tier_id",
  'Production',
  -- Provenance, not a restatement of the category: this rate was NOT resolved
  -- as Production at pin time. It is the Manufacturing rate that priced the
  -- section, carried forward so the pin can answer a question it predates.
  'Manufacturing (BV-013 backfill)',
  m."markup_pct",
  m."source_user_id",
  m."source_set_at"
  FROM "quote_commercial_markup_pins" m
 WHERE m."category" = 'Manufacturing';
