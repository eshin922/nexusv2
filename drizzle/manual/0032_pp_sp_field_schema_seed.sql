-- Phase A.1 v2 impl-3 patch — PP + SP field_schema seed (Bug #J)
--
-- The 0030 canonical seed deliberately left PP/SP field_schema null
-- pending "SpecEntry design" (per its header comment); impl-3 smoke
-- surfaced the gap (SpecPanel falls back to "Product type has no
-- field schema configured" because the schema_null=true rows can't
-- render fields).
--
-- Field schemas authored verbatim from the CD canonical source:
--   docs/design-prototypes/dist/qw_data.js
-- - PP: 10 fields (pp_description wide / pp_component_type /
--       pp_quantities / pp_size / pp_material / pp_deco /
--       pp_additional_details wide / pp_factory_1 / pp_factory_2 /
--       pp_packout_details wide)
-- - SP: 11 fields (sp_description wide / sp_material / sp_size /
--       sp_color / sp_coating / sp_finishing / sp_quantities /
--       sp_additional_details wide / sp_factory_1 / sp_factory_2 /
--       sp_packout_details wide)
--
-- Idempotent — UPDATE clauses are safe to re-apply; placeholder
-- flag stays false since both are first-class per §15.2.

begin;

update product_types
   set field_schema = '{
     "fields": [
       {"key": "pp_description",        "label": "Description",         "wide": true},
       {"key": "pp_component_type",     "label": "Component type"},
       {"key": "pp_quantities",         "label": "Quantities"},
       {"key": "pp_size",               "label": "Size"},
       {"key": "pp_material",           "label": "Material"},
       {"key": "pp_deco",               "label": "Deco"},
       {"key": "pp_additional_details", "label": "Additional details",  "wide": true},
       {"key": "pp_factory_1",          "label": "Factory 1"},
       {"key": "pp_factory_2",          "label": "Factory 2"},
       {"key": "pp_packout_details",    "label": "Packout details",     "wide": true}
     ]
   }'::jsonb
 where id = 'leaf_primary_packaging';

update product_types
   set field_schema = '{
     "fields": [
       {"key": "sp_description",        "label": "Description",         "wide": true},
       {"key": "sp_material",           "label": "Material"},
       {"key": "sp_size",               "label": "Size"},
       {"key": "sp_color",              "label": "Color"},
       {"key": "sp_coating",            "label": "Coating"},
       {"key": "sp_finishing",          "label": "Finishing"},
       {"key": "sp_quantities",         "label": "Quantities"},
       {"key": "sp_additional_details", "label": "Additional details",  "wide": true},
       {"key": "sp_factory_1",          "label": "Factory 1"},
       {"key": "sp_factory_2",          "label": "Factory 2"},
       {"key": "sp_packout_details",    "label": "Packout details",     "wide": true}
     ]
   }'::jsonb
 where id = 'leaf_secondary_packaging';

commit;
