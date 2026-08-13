-- Product Library source-fidelity repair.
--
-- Persists HubSpot's `hs_product_type` as its RAW INTERNAL OPTION VALUE on
-- library leaves, so the Library's HubSpot-facing type filter can predicate on
-- the authoritative classification instead of on Nexus's own taxonomy — which
-- 1,051 of 1,077 leaves have no value for.
--
-- ADDITIVE and nullable, so it is safe to apply ahead of the code that reads it:
-- every currently deployed writer omits the column and Postgres supplies NULL,
-- which is a legal value here. (See CLAUDE.md "Migration deployment order is
-- determined by compatibility" — a tightening migration would need a
-- deployed-writer proof; this one does not.)
--
-- Deliberately NOT an enum. HubSpot may add options at any time and a database
-- enum would reject a legal upstream value at ingestion; fidelity to the source
-- outranks local validation. Deliberately NOT backfilled from
-- `product_type_id`: that is the other taxonomy, and inventing a value here
-- would destroy the distinction this column exists to preserve.
ALTER TABLE "leaves" ADD COLUMN "hubspot_product_type" text;

-- Filter predicate support. Partial: rows without a HubSpot classification are
-- reached through the "unclassified" branch, not through an equality match.
CREATE INDEX IF NOT EXISTS "leaves_hubspot_product_type_idx"
  ON "leaves" ("hubspot_product_type")
  WHERE "hubspot_product_type" IS NOT NULL;
