-- Frozen ordered-item specification, one row per (sent offer, ordered item).
--
-- WHY THIS EXISTS. `leaf_specs` holds ONE quote-owned authority per
-- (quote, leaf) and nothing freezes it: no draft-lock, no version succession
-- for quote scope (all 167 rows sit at version_number = 1, is_current = false),
-- and the PDF addendum reads current values at render time. So Nexus could say
-- what a spec IS, never what was ORDERED.
--
-- KEYED TO THE SNAPSHOT, NOT THE QUOTE. A quote can be sent more than once and
-- each send is a distinct offer. Keying to the quote would let a later revision
-- overwrite the specification an earlier revision was ordered under, which is
-- the exact history this table exists to keep.
--
-- NO FK ON quote_leaf_id, deliberately, matching quote_snapshot_lines. The
-- working structure may be edited or deleted after a send; historical authority
-- must survive that. A cascading FK would delete the record of what was ordered
-- because someone tidied the quote afterwards.
CREATE TABLE "quote_snapshot_leaf_specs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_snapshot_id" uuid NOT NULL
    REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "quote_leaf_id" uuid NOT NULL,
  -- Provenance: which live row this was taken from, and when it last moved.
  -- Explains the frozen row; never resolves it.
  "source_leaf_spec_id" uuid,
  "source_updated_at" timestamp with time zone,
  "spec_values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "product_type_id" text,
  "spec_schema" text,
  "schema_derived_from_type" text,
  -- sha256 over canonical values + product type + pinned schema. Identical
  -- values under a different schema are a different specification.
  "content_hash" text NOT NULL,
  -- EVERY ordered leaf gets a row, including those with no applicable spec.
  -- Absence then means "not ordered" and can never mean "spec unknown", which
  -- is the ambiguity an omitted row would create.
  --   specified  a schema applies and values are frozen
  --   no_schema  specifications intentionally do not apply — an ANSWER
  --   unmapped   classified, no governed disposition — NOT an answer
  --   no_type    no authoritative Product Type
  "disposition" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "qsls_snapshot_leaf_unique" UNIQUE ("quote_snapshot_id", "quote_leaf_id"),
  CONSTRAINT "qsls_disposition_known" CHECK (
    "disposition" IN ('specified','no_schema','unmapped','no_type')
  )
);--> statement-breakpoint

CREATE INDEX "qsls_by_snapshot" ON "quote_snapshot_leaf_specs" ("quote_snapshot_id");--> statement-breakpoint
CREATE INDEX "qsls_by_leaf" ON "quote_snapshot_leaf_specs" ("quote_leaf_id");--> statement-breakpoint
CREATE INDEX "qsls_by_hash" ON "quote_snapshot_leaf_specs" ("content_hash");--> statement-breakpoint

-- IMMUTABLE AFTER CREATION, enforced rather than intended.
--
-- "The snapshot is immutable historical authority" is the whole value of the
-- table, and a convention held only by the absence of an UPDATE in today's code
-- is one careless writer away from being false. DELETE stays permitted so the
-- snapshot FK can cascade; UPDATE has no legitimate caller.
CREATE FUNCTION "qsls_forbid_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'quote_snapshot_leaf_specs is immutable: row % belongs to a sent offer. Later revisions create a NEW snapshot rather than editing this one.',
    OLD.id;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "qsls_no_update"
  BEFORE UPDATE ON "quote_snapshot_leaf_specs"
  FOR EACH ROW EXECUTE FUNCTION "qsls_forbid_update"();
