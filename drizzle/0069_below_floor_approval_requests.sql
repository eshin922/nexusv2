-- Below-floor approval request lifecycle + Slack identity/configuration.
--
-- Purely ADDITIVE: one new table, two new nullable columns. Nothing existing is
-- altered or dropped, so applying this ahead of the code is safe and is the
-- required order on a database shared with production.
--
-- `below_floor_authorizations` is deliberately UNTOUCHED. It remains the only
-- thing the Send/Accept gates read; a request authorizes nothing.

-- 1 · Durable Slack↔Nexus identity binding.
--     UNIQUE so two Slack accounts cannot claim one Nexus user.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slack_user_id" text;
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_slack_user_id_unique" UNIQUE ("slack_user_id");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- 2 · Governed approval channel. Configuration, not a secret — versioned with
--     the rest of firm policy so an admin can change it without a deploy.
ALTER TABLE "firm_settings" ADD COLUMN IF NOT EXISTS "slack_approval_channel_id" text;

-- 3 · The request lifecycle.
CREATE TABLE IF NOT EXISTS "below_floor_approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "quote_id" uuid NOT NULL REFERENCES "quotes"("id") ON DELETE cascade,
  "quote_version_number" integer NOT NULL,
  "tier_id" uuid NOT NULL REFERENCES "quote_tiers"("id") ON DELETE cascade,

  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "justification" text NOT NULL,

  "state_fingerprint" text NOT NULL,
  "margin_at_request" numeric(9, 6) NOT NULL,
  "floor_at_request" numeric(5, 4) NOT NULL,

  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_user_id" uuid REFERENCES "users"("id"),
  "decided_at" timestamp with time zone,
  "decision_reason" text,
  "authorization_id" uuid REFERENCES "below_floor_authorizations"("id"),

  "slack_channel_id" text,
  "slack_message_ts" text,
  "delivery_status" text DEFAULT 'pending' NOT NULL,
  "delivery_error" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- At most ONE live request per governed commercial scope.
--
-- Partial unique, matching the `netsuite_so_pushes` precedent: duplicate
-- pending requests competing to authorize one tier become unreachable rather
-- than merely discouraged. Decided rows accumulate freely as history.
CREATE UNIQUE INDEX IF NOT EXISTS "below_floor_request_pending_idx"
  ON "below_floor_approval_requests" ("quote_id", "quote_version_number", "tier_id")
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "below_floor_request_quote_idx"
  ON "below_floor_approval_requests" ("quote_id");
