-- Allow `schema_pending` as a pinned spec schema.
--
-- WHY. `resolveSpecSchema` gained a fourth disposition: a category that DOES
-- carry product specifications for which Nexus has not built the field set.
-- It is distinct from `no_schema` ("specifications legitimately do not apply —
-- nothing is missing") and from `unmapped` ("nobody has dispositioned this
-- category"). Bulk formulated material is the case that forced it: saying
-- nothing is missing about a product with viscosity, grade and density is a
-- false statement wearing the shape of a finished one.
--
-- Without this the distinction dies at the storage boundary. A quote would pin
-- "a schema is owed here" and the CHECK would refuse the write.
--
-- CLASSIFICATION: RELAXING, not tightening. It widens an allowed set, so every
-- currently-deployed writer already satisfies it — they emit only the six
-- existing values. Per the deployment-order rule in CLAUDE.md, that makes it
-- safe to apply before the code that writes the new value, and it needs no
-- deployed-writer compatibility proof beyond that observation.
--
-- HISTORICAL PINS ARE NOT REWRITTEN. Rows already pinned `no_schema` for
-- `Raw ingredients` stay exactly as they are. A pin records what the
-- classification resolved to AT THE MOMENT OF ATTACHMENT; re-deriving it now
-- would rewrite what a quote is recorded as having been built from, which is
-- the property the pin exists to protect. Quotes attached after this ships
-- pick up `schema_pending` naturally, and the two coexist — correctly, because
-- they describe two different moments.
--
-- `quote_snapshot_leaf_specs.spec_schema` carries no CHECK constraint and
-- needs no change.

ALTER TABLE "leaf_specs" DROP CONSTRAINT IF EXISTS "leaf_specs_spec_schema_values";

ALTER TABLE "leaf_specs" ADD CONSTRAINT "leaf_specs_spec_schema_values"
  CHECK (
    "spec_schema" IS NULL
    OR "spec_schema" IN (
      'primary', 'secondary', 'tertiary',
      'no_schema', 'schema_pending', 'unmapped', 'no_type'
    )
  );
