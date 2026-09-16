-- Formulated spec schema. JOURNALED and PENDING.
--
-- Journaled deliberately, as part of the reviewed commit rather than by an
-- edit during release: `npm run db:migrate` applies it with no ad-hoc change
-- to the journal or to any verifier allowlist. NOT APPLIED to production.
--
-- Runs FIRST of the two, and both run BEFORE the activation code deploys. The
-- code maps Ingestibles and Topicals to the `formulated` schema, which resolves
-- to the row this inserts; deploying ahead of it leaves that id pointing at a
-- `product_types` row that does not exist.
--
-- ── WHAT THIS ADDS ───────────────────────────────────────────────────────
--
-- One `product_types` row carrying the field set for formulated goods. It adds
-- no column, no table and no constraint; `product_types` already holds the
-- three packaging schemas in exactly this shape.
--
-- ── WHY ONE ROW AND NOT THREE ────────────────────────────────────────────
--
-- The existing schemas are LABELLED FREE-TEXT FIELDS, not typed or validated
-- ones -- `pp_material`, `sp_coating`, `tp_flute` are captions on text boxes.
-- Nothing parses, ranges or rejects a value. So "does one schema fit three
-- product families" is not a data-integrity question at all: it is whether one
-- label set reads correctly to an operator filling it in.
--
-- Form is therefore a FIELD, not three schemas.
--
-- EVERY FIELD HERE IS OPTIONAL, and this migration asserts nothing about which
-- ones a given product records. An earlier draft said a gummy "has no
-- meaningful pH" and a lubricant always has one. That was an invented
-- scientific default: whether pH, viscosity or density applies depends on the
-- formulation and on the measurement method, and neither this schema nor any
-- code around it is entitled to decide that for an operator.
--
-- Nothing validates, ranges, requires or rejects a value. An empty field means
-- "not recorded", which is the same thing it means on every packaging schema
-- and is not a claim that the property does not exist.
--
-- That is also the strongest argument for ONE schema rather than three: if
-- applicability varies by formulation rather than by family, a per-family
-- split would encode a distinction that is not there.
--
-- ── EIGHT FIELDS: THE MINIMUM, NOT THE PROPOSAL ──────────────────────────
--
-- An earlier draft carried seventeen, after splitting Flavour from Fragrance
-- and Viscosity from Density as instructed. This is the narrowed set: the four
-- fields every existing leaf schema already has -- Description, Additional
-- details, Factory 1 and 2, Packout details -- plus the four that carry a
-- formulated product's identity: Form, Net content, Actives.
--
-- NINE FIELDS ARE HELD BACK, not rejected:
--
--   Appearance / colour   Flavour   Fragrance   pH
--   Viscosity   Density   Allergens   Shelf life   Storage conditions
--
-- Each is plausibly useful and none is needed to make the two new types
-- usable. `product_types.field_schema` is JSONB, so adding any of them later
-- is an additive migration appending to an array -- cheap enough that shipping
-- them speculatively buys nothing, and an unused caption on an operator's form
-- is a real cost paid every time the form is opened.
--
-- EVERY FIELD IS OPTIONAL. Which ones a product records depends on the
-- formulation and the measurement method, and this schema decides none of it.

-- ── SEQUENCING ───────────────────────────────────────────────────────────
--
-- `spec-schema-mapping.ts` maps Ingestibles and Topicals to SCHEMA_PENDING
-- today, deliberately: a schema id resolving to a `product_types` row that
-- does not exist would be worse than an honest "a schema is owed here". When
-- this migration is approved and applied, those two entries change to
-- "formulated" in a follow-up PR. Neither step reclassifies a product and
-- neither touches a pinned quote spec.

INSERT INTO product_types (id, name, scope, description, field_schema, placeholder, hidden)
VALUES (
  'leaf_formulated',
  'Formulated',
  'leaf',
  'A formulated product — ingestible, topical or intimate care. The form is a field, not a separate type.',
  '{
    "fields": [
      { "key": "fm_description",        "label": "Description",                  "wide": true },
      { "key": "fm_form",               "label": "Form" },
      { "key": "fm_net_content",        "label": "Net content / fill" },
      { "key": "fm_actives",            "label": "Actives / reference formula" },
      { "key": "fm_additional_details", "label": "Additional details",           "wide": true },
      { "key": "fm_factory_1",          "label": "Factory 1" },
      { "key": "fm_factory_2",          "label": "Factory 2" },
      { "key": "fm_packout_details",    "label": "Packout details",              "wide": true }
    ]
  }'::jsonb,
  false,
  false
)
ON CONFLICT (id) DO NOTHING;
