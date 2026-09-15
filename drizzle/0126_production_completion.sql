-- Production module completion.
--
-- ADDITIVE ONLY: one new table. Nothing existing is altered, so the deployed
-- code cannot notice this migration at all until the code that reads the
-- table ships. Classified additive per the migration-ordering rule -- there is
-- no tightening here and therefore no deployed-writer proof to establish.
--
-- ── WHY PRODUCTION NEEDS ITS OWN STATE AND PACKAGING/FREIGHT DO NOT ──────
--
-- Packaging completion and Freight completion are the two ends of ONE
-- existing fact: the packaging → logistics handoff. `freight_handoffs`
-- already records who asked, who holds it, whether Slack was told, and who
-- closed it. Adding a second record of either would be a second source of
-- truth for a thing that already has one.
--
-- Production hands nothing to anyone. It has no handoff to borrow, so the
-- only way to record that someone finished it is to record it -- and the ONLY
-- thing recorded here is who completed it and when, which is the whole of
-- what completion means.
--
-- ── WHY A ROW PER COMPLETION AND NOT A COLUMN ON `quotes` ────────────────
--
-- Reopening is supported, and a reopened module can be completed again. A
-- column would hold the latest completion and overwrite the previous one, so
-- the second completion would erase the record of the first. Same shape, and
-- the same reason, as `freight_handoffs`.

CREATE TABLE IF NOT EXISTS "production_completions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,

  -- Who said Production was finished, and when. An OPERATOR DECISION, the
  -- same class as marking packaging ready: nothing here is derived from
  -- whether the production tiers happen to be costed, and the control is
  -- never disabled on that basis. A person judged it done; this is the record
  -- that they did.
  "completed_by_user_id" uuid NOT NULL,
  "completed_at" timestamptz DEFAULT now() NOT NULL,

  -- completed — someone marked Production finished
  -- reopened  — it was pulled back, and the row is KEPT so that what was
  --             claimed, by whom, and that it was withdrawn stays readable.
  --             Completing again mints a NEW row, which is why the unique
  --             index below is on `status = 'completed'` and not on the quote.
  --
  -- Past participle, matching `freight_handoffs`, and deliberately not the
  -- literal `"complete"`: that word belongs to `quotes.status` and its
  -- single-writer guard, and a module finishing is not a quote completing.
  "status" text NOT NULL DEFAULT 'completed',
  "reopened_by_user_id" uuid,
  "reopened_at" timestamptz,

  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "production_completions_status_values"
    CHECK ("status" IN ('completed', 'reopened'))
);

-- AT MOST ONE STANDING COMPLETION PER QUOTE.
--
-- What makes a repeated click harmless: the second insert cannot land while
-- the first stands, so two operators pressing Mark complete together produce
-- one record rather than two. Enforced by the database, not by a
-- check-then-insert in the action, which is a race READ COMMITTED does not
-- serialize.
CREATE UNIQUE INDEX IF NOT EXISTS "production_completions_one_open_idx"
  ON "production_completions" ("quote_id")
  WHERE "status" = 'completed';

CREATE INDEX IF NOT EXISTS "production_completions_quote_idx"
  ON "production_completions" ("quote_id", "completed_at" DESC);
