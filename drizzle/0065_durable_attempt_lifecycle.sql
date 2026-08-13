-- Lifecycle-aware durable attempt election.
--
-- A terminal, side-effect-free validation rejection must not permanently own
-- a snapshot's future retry payload. Before this, the attempt row was unique
-- per snapshot regardless of status, and mark-complete elected the oldest row
-- with a payload regardless of status — so a validation failure pinned its own
-- invalid body forever and no later code repair could reach NetSuite.
--
-- Only `failed + validation` is released, because only that state is
-- conclusively terminal AND measured side-effect-free (explicit 4xx rejection,
-- no internal id returned, zero Sales Orders on the deal afterwards). Every
-- other failure — server, network, unknown, rate_limit, auth, forbidden,
-- not_found — still holds the snapshot, because its outcome is not
-- conclusively known and a duplicate order is far worse than a stuck payload.
--
-- This predicate MUST remain identical to the durable-payload selector in
-- src/lib/netsuite/mark-complete.ts. They are one rule expressed twice: an
-- attempt that no longer pins the payload must also release the snapshot, or
-- the re-elected attempt has nowhere to be written.
--
-- Strictly more permissive than the index it replaces: no existing row can
-- violate it, and no read changes. Historical attempt rows are untouched.

DROP INDEX IF EXISTS "netsuite_so_pushes_snapshot_attempt_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_so_pushes_snapshot_attempt_unique_idx"
  ON "netsuite_so_pushes" ("quote_snapshot_id")
  WHERE quote_snapshot_id IS NOT NULL
    AND NOT (status = 'failed' AND error_class = 'validation');
