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
  -- Amendments an operator supplied while recovering. Persisted rather than
  -- held in memory: they are part of the intent from the moment they are
  -- accepted, and an interruption after the remote call must not lose them.
  -- The SKU is never amendable and never appears here.
  "amended" jsonb,
  -- What HubSpot held when it was read back, or NULL when the read-back could
  -- not be performed. NULL here means "not observed", never "absent" --
  -- distinguishing those is the whole point.
  "observed" jsonb,

  -- pending               — intent committed; the remote outcome is not known
  -- unconfirmed           — the write was not confirmed to have applied
  -- awaiting_confirmation — an AMENDED recovery was accepted remotely, and the
  --                         earlier request may still land after it
  -- diverged              — the two catalogs are known to disagree
  "outcome" text NOT NULL DEFAULT 'pending',
  "reason" text,
  -- What HubSpot is expected to hold once everything has settled. Written when
  -- an amended recovery is accepted, and compared against on confirmation.
  --
  -- WHY AN AMENDED RECOVERY CANNOT DECLARE ITSELF SETTLED
  --
  -- The original request may still be in flight. If it lands AFTER the
  -- recovery, HubSpot ends up holding the original values while Nexus holds
  -- the amended ones -- and no local locking prevents that, because the
  -- ordering is decided on the far side. HubSpot CRM offers no If-Match, no
  -- ETag and no documented ordering guarantee, so there is nothing here to
  -- rely on.
  --
  -- A recovery that re-sends the SAME values is unaffected: a late original
  -- carrying identical values is harmless. Only an AMENDED one creates the
  -- hazard, and only it is held open for confirmation.
  "expected" jsonb,

  -- Bumped on every amendment. A recovery names the version it was composed
  -- against, so two operators amending the same attempt cannot silently
  -- overwrite one another -- the same discipline the edit itself uses against
  -- the product row.
  "version" integer NOT NULL DEFAULT 1,

  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz,
  "resolution" text,

  CONSTRAINT "leaf_edit_attempts_outcome_values"
    CHECK ("outcome" IN ('pending', 'unconfirmed', 'awaiting_confirmation', 'diverged'))
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
