-- Formulated spec schema (DRAFT — intentionally absent from
-- drizzle/meta/_journal.json until the field set is approved and the
-- Ingestibles / Topicals options are agreed).
--
-- NOT APPLIED. Reviewable only. Applying this before the field set is
-- confirmed would put a labelled form in front of operators that nobody has
-- agreed reads correctly for a gummy, a lubricant and a cream at once — which
-- is the open question this migration exists to make concrete rather than to
-- settle.
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
-- Form is therefore a FIELD, not three schemas. A gummy leaves viscosity
-- empty; a cologne leaves flavour empty. Packaging already works this way --
-- a rigid box leaves `sp_coating` empty -- and splitting on emptiness would
-- multiply schemas without adding a single guarantee.
--
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
      { "key": "fm_appearance",         "label": "Appearance / colour" },
      { "key": "fm_actives",            "label": "Actives / reference formula" },
      { "key": "fm_flavor_fragrance",   "label": "Flavour / fragrance" },
      { "key": "fm_ph",                 "label": "pH" },
      { "key": "fm_viscosity",          "label": "Viscosity / density" },
      { "key": "fm_allergens",          "label": "Allergens" },
      { "key": "fm_shelf_life",         "label": "Shelf life" },
      { "key": "fm_storage",            "label": "Storage conditions" },
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
