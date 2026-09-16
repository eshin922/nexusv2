-- Permit `formulated` as a stored spec-schema pin. JOURNALED and PENDING.
--
-- Journaled as part of the reviewed commit, for the same reason as 0129: the
-- release step is `npm run db:migrate` and nothing else. NOT APPLIED to
-- production.
--
-- Runs SECOND, and both run BEFORE the activation code deploys.
--
-- ── WHY THIS IS REQUIRED, NOT OPTIONAL ───────────────────────────────────
--
-- `leaf_specs.spec_schema` carries a CHECK naming every permitted stored pin:
--
--   primary | secondary | tertiary | no_schema | schema_pending | unmapped | no_type
--
-- `formulated` is not among them. Adding it to `SpecSchemaId` in TypeScript is
-- not sufficient on its own: the FIRST attachment of an Ingestibles or Topicals
-- product would be rejected by the database as a constraint violation at write
-- time -- not by a guard with a message an operator could act on.
--
-- ── ORDERING: THIS IS A WIDENING, AND SAFE AHEAD OF CODE ─────────────────
--
-- It ADDS a value to an allowed set. Every deployed writer today emits one of
-- the seven existing values and is unaffected, so there is no deployed-writer
-- compatibility proof owed -- the classification that governs tightening
-- migrations does not apply to a widening.
--
-- The converse does NOT hold. Deploying the activation code before this is
-- applied leaves the write path broken for the two new types, which is why the
-- release sequence puts both migrations first and creates the HubSpot options
-- last.
--
-- ── THE SNAPSHOT TABLE NEEDS NOTHING ─────────────────────────────────────
--
-- `quote_snapshot_leaf_specs.disposition` has its own CHECK
-- (`specified | no_schema | unmapped | no_type`), and `dispositionOf` returns
-- `specified` for any schema id it does not name specially. A `formulated` pin
-- therefore freezes as `specified`, which is already permitted. Checked
-- against the live constraint rather than assumed.

ALTER TABLE "leaf_specs"
  DROP CONSTRAINT IF EXISTS "leaf_specs_spec_schema_values";
--> statement-breakpoint
ALTER TABLE "leaf_specs"
  ADD CONSTRAINT "leaf_specs_spec_schema_values" CHECK (
    "spec_schema" IS NULL OR "spec_schema" IN (
      'primary',
      'secondary',
      'tertiary',
      'formulated',
      'no_schema',
      'schema_pending',
      'unmapped',
      'no_type'
    )
  );
