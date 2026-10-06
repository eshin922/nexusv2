-- Permit `schema_pending` as a frozen ordered-spec disposition. JOURNALED and
-- PENDING: not applied to the shared database by the commit that adds it.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- DEFECT-2026-09-15: `dispositionOf` in `ordered-spec-freeze.ts` ended in a
-- bare `return "specified"`, so a quote-owned spec pinned `schema_pending`
-- ("a schema is owed here") froze into the order record as `specified` ("this
-- item had a specification and here it is"). The frozen record then asserted
-- something nobody stated, and a NetSuite projection reading it would export
-- an empty specification as a governed one.
--
-- The classifier is now exhaustive (`ordered-spec-disposition.ts`) and returns
-- `schema_pending` for that pin. This CHECK must permit it, or the first send
-- containing such a product fails at write time.
--
-- ── ORDERING: A WIDENING, SAFE AHEAD OF CODE ─────────────────────────────
--
-- It ADDS one value to an allowed set. Every deployed writer emits one of the
-- four existing values and is unaffected, so no deployed-writer compatibility
-- proof is owed. The converse does not hold: deploying the classifier before
-- this is applied breaks the send for any quote containing a `schema_pending`
-- product (4 live quote/library specs carried that pin on 2026-10-05).
--
-- ── HISTORICAL ROWS ──────────────────────────────────────────────────────
--
-- Measured 2026-10-05: 0 rows in `quote_snapshot_leaf_specs` carry
-- `spec_schema = 'schema_pending'`. No already-frozen record is reinterpreted,
-- and the table is immutable by trigger, so none could be.

ALTER TABLE "quote_snapshot_leaf_specs"
  DROP CONSTRAINT IF EXISTS "qsls_disposition_known";
--> statement-breakpoint
ALTER TABLE "quote_snapshot_leaf_specs"
  ADD CONSTRAINT "qsls_disposition_known" CHECK (
    "disposition" IN ('specified','no_schema','schema_pending','unmapped','no_type')
  );
