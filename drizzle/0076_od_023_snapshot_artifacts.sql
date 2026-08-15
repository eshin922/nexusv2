-- OD-023 · the sent version's rendered representation.
--
-- THE HISTORICAL INVARIANT
--
--   A sent version must be reconstructable from immutable data, without
--   depending on future costing, pricing, Library, firm-settings or live quote
--   behaviour.
--
-- `quote_snapshots` already froze commercial terms, prepared-by, the three PDF
-- axes and `pdf_url`. It froze no product content at all — the leaf set, Direct
-- vs Item Group, membership, display order, tiers, spec values, printed prices
-- and service-fee lines were re-derived from live rows on every historical
-- read. This table closes that.
--
-- It stores the CUSTOMER-RENDER INPUTS THEMSELVES rather than the graph that
-- produces them. Snapshotting the graph and recomputing would look more
-- normalised and would fail the invariant: it freezes an input set the engine
-- has to keep interpreting identically forever, so a later change to the math
-- silently re-prices quotes that were already sent.
--
-- HAND-AUTHORED, not generated. `drizzle-kit generate` prompts on unrelated
-- pre-existing snapshot drift (`assemblies.item_group_category_id`), and
-- answering that prompt would fold a schema decision nobody asked for into a
-- migration whose whole point is to be additive. This file therefore contains
-- exactly one statement.
--
-- MIGRATION CLASS: additive. New table only — no column tightened, no data
-- rewritten, nothing dropped. Safe to apply ahead of the code that reads it,
-- because every currently deployed writer trivially satisfies "does not write
-- this table". No backfill: reconstructing structure for already-sent versions
-- from today's live rows would record current state as historical sent state,
-- which is the exact class of false evidence this work exists to prevent.

CREATE TABLE IF NOT EXISTS "quote_snapshot_artifacts" (
        -- 1:1 with the version. The snapshot id IS the key: a surrogate would
        -- permit two artifacts for one version, and then "which one did the
        -- customer actually receive" has no answer.
        "quote_snapshot_id" uuid PRIMARY KEY NOT NULL
                REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,

        -- A payload shape is a contract with every future reader. One that
        -- meets an unknown version must REFUSE rather than guess.
        "schema_version" integer NOT NULL,

        -- The full `CpdfData` the artifact rendered from: vendor, customer,
        -- quote header, tiers, recommended tier, products with their printed
        -- per-tier prices, service fees, freight lines.
        "cpdf_data" jsonb NOT NULL,

        -- `QuoteAddendumData`. NULL means the addendum was OFF at send, which
        -- is a different fact from an addendum that was on and empty.
        "addendum_data" jsonb,

        -- Governed product structure, held apart from the render payload so it
        -- is queryable rather than only printable: canonical `quote_leaves.id`
        -- per product, Direct vs grouped, group identity, explicit ordinals.
        "structure" jsonb NOT NULL,

        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
