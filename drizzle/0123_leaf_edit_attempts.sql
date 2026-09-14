-- #567 review · an edit's INTENT is durable before the remote call is made.
--
-- ADDITIVE ONLY. A new table and its indexes; no existing object is altered,
-- so deployed code that knows nothing about it continues to work unchanged.
--
-- WHY THIS EXISTS
--
-- A HubSpot write can fail without an answer. Reading the product back can
-- then establish that the requested state is NOT CONFIRMED -- which is not the
-- same as establishing that nothing changed. The write may have applied in
-- part, or the product may hold values something else put there.
--
-- Discarding the operator's edit at that point loses the only record of what
-- was attempted and leaves the next edit free to overwrite a remote state
-- nobody has looked at. This table keeps the attempt and what was observed, so
-- a recovery can replay THE RECORDED EDIT rather than re-PATCHing the same
-- product id with whatever happens to be on screen later.
--
-- WHY THE ROW IS WRITTEN *BEFORE* THE REMOTE CALL
--
-- Recording it afterwards is too late in two distinct ways, and neither is
-- rare enough to accept:
--
--   1. THE LOCK-RELEASE RACE. The edit's transaction rolls back, releasing its
--      advisory lock, and the attempt is written in a later transaction.
--      Between those two moments another edit acquires the lock, sees no open
--      attempt, and writes over the unconfirmed remote state -- which is
--      precisely what the attempt exists to prevent.
--
--   2. THE CRASH WINDOW. If the process dies after the request is issued and
--      before the record is written, there is no durable trace at all. HubSpot
--      may hold the new values and Nexus has nothing that says so.
--
-- So the row is INSERTed and COMMITTED while the lock is held and before the
-- request is issued. `outcome` starts at 'pending' and is settled afterwards.
-- A pending row that outlives its process is exactly the evidence an
-- interrupted edit should leave behind.

CREATE TABLE IF NOT EXISTS "leaf_edit_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "leaf_id" uuid NOT NULL REFERENCES "leaves"("id") ON DELETE CASCADE,
  "hubspot_product_id" text,

  -- What the operator asked for, in Nexus terms. This is what a recovery
  -- replays.
  "attempted" jsonb NOT NULL,
  -- What was sent to HubSpot, as properties. Kept separately because a
  -- recovery must reproduce the REQUEST, and the mapping from one to the other
  -- may change under it.
  "submitted" jsonb NOT NULL,
  -- What HubSpot held when it was read back, or NULL when the read-back could
  -- not be performed. NULL here means "not observed", never "absent" --
  -- distinguishing those is the whole point.
  "observed" jsonb,

  -- pending               — intent committed; the remote outcome is not known
  -- unconfirmed           — the write was not confirmed to have applied
  -- ordering_unresolved — an AMENDED recovery was accepted remotely, and the
  --                         earlier request may still land after it
  -- diverged              — the two catalogs are known to disagree
  "outcome" text NOT NULL DEFAULT 'pending',
  "reason" text,

  -- Claimed by whoever is working the attempt. A retry takes it, and every
  -- later write to the row carries it, so a worker whose claim has been taken
  -- over cannot resolve or alter it.
  "version" integer NOT NULL DEFAULT 1,

  -- REQUESTS DISPATCHED, AND REQUESTS ANSWERED.
  --
  -- An attempt has an unresolved request whenever dispatched > answered.
  --
  -- Counted rather than flagged, because a flag cannot preserve an EARLIER
  -- unresolved request when a later one is answered. A retry that returns 2xx
  -- answers itself and nothing else: (2,1) still has one request outstanding,
  -- which is exactly the case a boolean would clear.
  --
  -- `dispatched` is incremented BEFORE the request is sent, in the same
  -- committed transaction as the claim. Incrementing it afterwards would leave
  -- a process interrupted mid-call looking as though it had never dispatched
  -- anything -- so its attempt would read as fully answered and a retry would
  -- release it.
  --
  -- `answered` is incremented ONLY on a definitive response for that request:
  -- a 2xx, or a 4xx refusal. A read-back that happens to show the values
  -- present is evidence about the OBJECT, not about which request put them
  -- there or whether ours has finished, so it does not count.
  "dispatched_count" integer NOT NULL DEFAULT 0,
  "answered_count" integer NOT NULL DEFAULT 0,

  -- Set when an unanswered outcome is released anyway, by the documented
  -- support procedure, with the residual risk accepted explicitly.
  "released_with_risk_by" uuid,
  "released_with_risk_at" timestamptz,
  "released_with_risk_note" text,

  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  "resolution" text,

  CONSTRAINT "leaf_edit_attempts_outcome_values"
    CHECK ("outcome" IN ('pending', 'unconfirmed', 'diverged', 'converged_unknown'))
);

-- At most one OPEN attempt per product. A second unresolved attempt would mean
-- two competing records of what the product is supposed to be, and a recovery
-- could not say which one it was recovering. This index is also what makes the
-- pre-call insert a claim: a concurrent edit cannot open a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "leaf_edit_attempts_open_idx"
  ON "leaf_edit_attempts" ("leaf_id")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "leaf_edit_attempts_leaf_idx"
  ON "leaf_edit_attempts" ("leaf_id", "created_at" DESC);
