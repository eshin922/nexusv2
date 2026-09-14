-- #567 review · an unconfirmed edit is preserved, not discarded.
--
-- ADDITIVE ONLY. A new table and its indexes; no existing object is altered,
-- so deployed code that knows nothing about it continues to work unchanged.
--
-- WHY THIS EXISTS
--
-- When a HubSpot write fails without an answer, the product is read back to
-- adjudicate it. A read-back that does not match the requested state
-- establishes exactly one thing: THE REQUESTED STATE IS NOT CONFIRMED. It does
-- not establish that nothing changed -- the write may have applied in part, or
-- the product may hold values put there by something else entirely.
--
-- Discarding the operator's edit at that point loses the only record of what
-- was attempted, and leaves the next edit free to overwrite a remote state
-- nobody has looked at. This table keeps the attempt and what was observed, so
-- a retry can replay THE RECORDED EDIT rather than re-PATCHing the same
-- product id with whatever happens to be on screen later.

CREATE TABLE IF NOT EXISTS "leaf_edit_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "leaf_id" uuid NOT NULL REFERENCES "leaves"("id") ON DELETE CASCADE,
  "hubspot_product_id" text,

  -- What the operator asked for, in Nexus terms. This is what a retry
  -- replays.
  "attempted" jsonb NOT NULL,
  -- What was actually sent to HubSpot, as properties. Kept separately because
  -- the retry must be able to reproduce the REQUEST, and the mapping from one
  -- to the other may change under it.
  "submitted" jsonb NOT NULL,
  -- What HubSpot held when it was read back, or NULL when the read-back could
  -- not be performed. NULL here means "not observed", never "absent" --
  -- distinguishing those is the whole point.
  "observed" jsonb,

  -- unconfirmed — the write was not confirmed to have applied
  -- diverged    — HubSpot applied it and the local write then failed
  "outcome" text NOT NULL,
  "reason" text NOT NULL,

  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  "resolution" text,

  CONSTRAINT "leaf_edit_attempts_outcome_values"
    CHECK ("outcome" IN ('unconfirmed', 'diverged'))
);

-- At most one OPEN attempt per product. A second unresolved attempt would mean
-- two competing records of what the product is supposed to be, and a retry
-- could not say which one it was recovering.
CREATE UNIQUE INDEX IF NOT EXISTS "leaf_edit_attempts_open_idx"
  ON "leaf_edit_attempts" ("leaf_id")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "leaf_edit_attempts_leaf_idx"
  ON "leaf_edit_attempts" ("leaf_id", "created_at" DESC);
