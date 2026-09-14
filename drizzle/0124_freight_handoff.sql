-- Packaging → logistics handoff.
--
-- ADDITIVE ONLY: one new table, plus two nullable columns on the versioned
-- firm-settings table. No existing object is altered in a way deployed code
-- can notice.
--
-- ── WHY A TABLE AND NOT COLUMNS ON `quotes` ──────────────────────────────
--
-- Withdrawing a request clears the active task and KEEPS its history, and
-- marking ready again starts a NEW handoff. Columns on the quote would hold
-- one handoff and overwrite it, so the second request would erase the record
-- of the first. A row per handoff is what makes "retain its history" true.

CREATE TABLE IF NOT EXISTS "freight_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,

  -- Who decided packaging was ready, and when. The decision is an OPERATOR
  -- ACT: nothing here is computed from whether the packaging tiers happen to
  -- be costed.
  "requested_by_user_id" uuid NOT NULL,
  "requested_at" timestamptz DEFAULT now() NOT NULL,

  -- The configured logistics recipient AS AT the moment of the request.
  -- Snapshotted rather than resolved at read time: who the task belongs to
  -- must not change under the person holding it because a setting was edited
  -- later. Quote ownership is untouched -- `quotes.created_by_user_id` is not
  -- read or written by any of this.
  "assigned_to_user_id" uuid NOT NULL,

  -- open      — logistics has it
  -- completed — logistics said "Freight complete". The ONLY thing that
  --             completes a handoff. Not the first shipment, not the quote
  --             status; neither of those is logistics saying they are done.
  -- withdrawn — packaging reopened and the request was pulled back
  --
  -- Past participle throughout, matching `withdrawn`. It also keeps the
  -- literal `status: "complete"` out of this subsystem, which belongs to
  -- `quotes.status` and its single-writer guard -- a freight handoff closing
  -- is not a quote completing, and the two should not read alike.
  "status" text NOT NULL DEFAULT 'open',
  "completed_by_user_id" uuid,
  "completed_at" timestamptz,
  "withdrawn_by_user_id" uuid,
  "withdrawn_at" timestamptz,

  -- Slack delivery, recorded rather than assumed. The Nexus task exists
  -- whatever happens here: a notification that did not arrive is a reason to
  -- say so, not a reason to withhold the work.
  "slack_channel_id" text,
  "slack_message_ts" text,
  "notification_status" text NOT NULL DEFAULT 'pending',
  "notification_error" text,

  "updated_at" timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT "freight_handoffs_status_values"
    CHECK ("status" IN ('open', 'completed', 'withdrawn')),
  CONSTRAINT "freight_handoffs_notification_values"
    CHECK ("notification_status" IN ('pending', 'delivered', 'failed', 'not_configured'))
);

-- AT MOST ONE OPEN HANDOFF PER QUOTE.
--
-- This is what makes repeated clicks harmless: the second insert cannot
-- succeed while the first is open, so there is no second task and no second
-- notification. Enforced here rather than by a check-then-insert in the
-- action, which is a race.
CREATE UNIQUE INDEX IF NOT EXISTS "freight_handoffs_one_open_idx"
  ON "freight_handoffs" ("quote_id")
  WHERE "status" = 'open';

CREATE INDEX IF NOT EXISTS "freight_handoffs_assignee_open_idx"
  ON "freight_handoffs" ("assigned_to_user_id")
  WHERE "status" = 'open';

CREATE INDEX IF NOT EXISTS "freight_handoffs_quote_idx"
  ON "freight_handoffs" ("quote_id", "requested_at" DESC);

-- Configuration. Both carry forward through `versionedFirmSettingsUpdate`
-- per the versioned-table rule -- a margin edit inserts a new row, and an
-- unchanged column that is not carried forward silently becomes NULL.
ALTER TABLE "firm_settings"
  ADD COLUMN IF NOT EXISTS "logistics_recipient_user_id" uuid;
ALTER TABLE "firm_settings"
  ADD COLUMN IF NOT EXISTS "slack_logistics_channel_id" text;
