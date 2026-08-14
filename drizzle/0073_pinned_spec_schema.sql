-- Step 4.1 · explicit Spec Schema representation on the quote-owned authority.
--
-- Product Type is HubSpot's `hs_product_type` and is live authority: the
-- Library and Setup both read it, and a reclassification in HubSpot is
-- immediately true everywhere. Spec Schema is Nexus BEHAVIOUR derived from it,
-- and it is PINNED at attachment.
--
-- WHY PINNED. The schema is what `spec_values` are validated against. If it
-- tracked HubSpot live, a reclassification would silently reinterpret values an
-- operator already authored -- fields would appear, disappear, or start failing
-- validation with no record of the schema they were entered under. That is the
-- same defect B-3 removed one level up, so it gets the same answer: the quote
-- owns it from the moment of attachment.
--
-- ADDITIVE AND REVERSIBLE. Both columns are new and nullable, so no deployed
-- writer can violate the CHECK -- none of them writes these columns at all.
-- `leaf_specs.product_type_id` and `leaves.product_type_id` are UNTOUCHED here;
-- their removal is the separate, last, destructive step.

ALTER TABLE "leaf_specs" ADD COLUMN "spec_schema" text;

-- Provenance, NEVER display. The authoritative HubSpot internal value the pin
-- was derived from. Recording it is what makes the pin explicable: after a
-- later HubSpot reclassification this row can still say what it resolved from,
-- and an `unmapped` pin is recoverable rather than being a dead sentinel.
--
-- Display always reads the LIVE value on `leaves.hubspot_product_type`, in the
-- Library and in Setup alike. A reader that shows this column instead would
-- reintroduce exactly the divergence this architecture removes.
ALTER TABLE "leaf_specs" ADD COLUMN "schema_derived_from_type" text;

-- The permitted states, structurally. A future writer cannot invent a fourth.
--
--   primary | secondary | tertiary  -- a schema applies
--   no_schema                       -- specifications intentionally do not apply
--   unmapped                        -- classified, but the authoritative value has
--                                      no governed disposition. NEVER silently
--                                      folded into no_schema: one is a finished
--                                      answer, the other is an unanswered question
--   no_type                         -- authoritative Product Type is missing
--   NULL                            -- NOT PINNED. Legitimate for Library-scope
--                                      rows, which are templates and defer. On a
--                                      quote-owned row after backfill it means a
--                                      writer failed to pin, which is a bug and is
--                                      meant to be visible as one
--
-- `no_type` is stored explicitly rather than as NULL precisely so that "the
-- product has no authoritative classification" and "nothing has pinned this
-- row yet" cannot look identical in the table.
ALTER TABLE "leaf_specs" ADD CONSTRAINT "leaf_specs_spec_schema_values"
  CHECK (
    "spec_schema" IS NULL
    OR "spec_schema" IN ('primary', 'secondary', 'tertiary', 'no_schema', 'unmapped', 'no_type')
  );
