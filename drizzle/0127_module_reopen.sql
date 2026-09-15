-- Mark incomplete, on all three modules.
--
-- ADDITIVE ONLY: four nullable columns on `freight_handoffs`. Nothing is
-- tightened and nothing is dropped, so deployed code cannot notice this
-- migration and no deployed-writer proof is owed.
--
-- Production needs nothing here: `production_completions` (0126) already
-- carries `status`, `reopened_by_user_id` and `reopened_at`, which is exactly
-- what marking it incomplete records. Reused rather than duplicated.
--
-- ── TWO DIFFERENT REOPENS, WHICH IS WHY THERE ARE TWO PAIRS ──────────────
--
-- A handoff has two ends and they are now independently reversible, so one
-- pair of columns could not say which end was pulled back.
--
--   packaging_reopened_*  the QUOTE side took its completion back AFTER
--                         logistics had finished. The freight work really was
--                         done, so the row stays `completed` and its history
--                         is untouched; this pair records only that Packaging
--                         is no longer claiming to be finished. Marking
--                         Packaging complete again inserts a NEW handoff --
--                         the partial unique index is on `status = 'open'`,
--                         so a completed row does not block it -- and that
--                         new handoff notifies logistics through the same
--                         path as the first one.
--
--   reopened_*            LOGISTICS reopened the task itself. The row goes
--                         back to `open` and is the live request again.
--
-- The two are mutually exclusive by construction: reopening the freight task
-- is refused once the packaging side has been pulled back, because the
-- request that task belonged to is no longer being made.

ALTER TABLE "freight_handoffs"
  ADD COLUMN IF NOT EXISTS "packaging_reopened_by_user_id" uuid;
ALTER TABLE "freight_handoffs"
  ADD COLUMN IF NOT EXISTS "packaging_reopened_at" timestamptz;

ALTER TABLE "freight_handoffs"
  ADD COLUMN IF NOT EXISTS "reopened_by_user_id" uuid;
ALTER TABLE "freight_handoffs"
  ADD COLUMN IF NOT EXISTS "reopened_at" timestamptz;

-- Packaging's completion is now "the latest handoff, unless its packaging end
-- was pulled back". Reading that needs the latest row per quote, which this
-- index already serves (0124):
--
--   freight_handoffs_quote_idx ON (quote_id, requested_at DESC)
--
-- No new index. Recorded here so the next reader does not add a duplicate.
