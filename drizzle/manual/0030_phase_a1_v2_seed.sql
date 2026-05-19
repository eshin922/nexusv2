-- Phase A.1 v2 impl-1 — product_types seed + user role grants
--
-- Pairs with drizzle/0030_phase_a1_v2_schema_create.sql. Apply AFTER
-- the schema migration lands (the inserts depend on product_types +
-- users.can_edit_specs / users.can_create_leaves existing).
--
-- Data shape locked in docs/cc-phase-a1-v2-edward-dispositions.md
-- §15.1 (ASY taxonomy), §15.2 (LEAF taxonomy), §15.3 (RLS role
-- assignments).
--
-- Idempotent: ON CONFLICT (id) DO NOTHING on product_types so re-runs
-- are safe; user UPDATE statements key on stable emails.
--
-- Per CLAUDE.md "Single Supabase project" — applying locally writes
-- to shared dev/prod. Edward authorization required (matches
-- pricing_events seed posture from Pricing reframe).

begin;

-- ----------------------------------------------------------------
-- §15.1 — ASY-level Product Type taxonomy (9 categories)
-- ----------------------------------------------------------------

insert into product_types (id, name, scope, description, field_schema, placeholder, hidden) values
  ('asy_skincare',        'Skincare',                       'assembly', null, null, false, false),
  ('asy_supplement',      'Supplement (oral)',              'assembly', null, null, false, false),
  ('asy_haircare',        'Hair care',                      'assembly', null, null, false, false),
  ('asy_colorcosmetics',  'Color cosmetics',                'assembly', null, null, false, false),
  ('asy_body',            'Body care',                      'assembly', null, null, false, false),
  ('asy_beverage',        'Beverage / functional drink',    'assembly', null, null, false, false),
  ('asy_pet',             'Pet care',                       'assembly', null, null, false, false),
  ('asy_household',       'Household / cleaning',           'assembly', null, null, false, false),
  ('asy_other',           'Other',                          'assembly', null, null, false, false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------
-- §15.2 — LEAF-level Product Type taxonomy
-- ----------------------------------------------------------------

-- First-class (field_schema designed for v1; PP/SP starter schemas
-- finalize at SpecEntry design — left null here pending CD work).
-- TP field_schema seeded per Edward-approved starter (§15.2);
-- PP/SP fields land via a follow-up SpecEntry-side migration.

insert into product_types (id, name, scope, description, field_schema, placeholder, hidden) values
  ('leaf_primary_packaging',
    'Primary packaging (PP)',
    'leaf',
    'Bottles, jars, tubes + closures (caps, pumps, droppers).',
    null,
    false,
    false),
  ('leaf_secondary_packaging',
    'Secondary packaging (SP)',
    'leaf',
    'Cartons + labels + flexible packaging.',
    null,
    false,
    false),
  ('leaf_tertiary_packaging',
    'Tertiary packaging (TP)',
    'leaf',
    'Corrugated cases, master cases.',
    '{"fields":[{"key":"tp_description","label":"TP Description","type":"textarea","wide":true},{"key":"tp_type","label":"TP Type","type":"text"},{"key":"tp_outer_dims","label":"Outer Dimensions","type":"text"},{"key":"tp_inner_dims","label":"Inner Dimensions","type":"text"},{"key":"tp_flute","label":"Flute / Wall","type":"text"},{"key":"tp_ect_or_board","label":"ECT / Board Grade","type":"text"},{"key":"tp_units_per_case","label":"Units per Case","type":"number"},{"key":"tp_print","label":"Print / Finish","type":"text"},{"key":"tp_closure","label":"Closure / Construction","type":"text"},{"key":"tp_pallet_config","label":"Pallet Config","type":"text"}]}'::jsonb,
    false,
    false)
on conflict (id) do nothing;

-- Visible placeholder — picker shows, SpecEntry renders placeholder
-- treatment until field_schema is designed in v1.1+.

insert into product_types (id, name, scope, description, field_schema, placeholder, hidden) values
  ('leaf_soft_goods', 'Soft goods', 'leaf', null, null, true, false)
on conflict (id) do nothing;

-- Hidden (migration targets only; not surfaced in picker).

insert into product_types (id, name, scope, description, field_schema, placeholder, hidden) values
  ('leaf_component',     'Component / part',         'leaf', 'Legacy migration target.', null, false, true),
  ('leaf_assembly_sub',  'Assembly sub-component',   'leaf', 'Legacy migration target.', null, false, true),
  ('leaf_service',       'Service / labor',          'leaf', 'Legacy migration target.', null, false, true),
  ('leaf_other',         'Other',                    'leaf', 'Legacy migration target.', null, false, true)
on conflict (id) do nothing;

-- ----------------------------------------------------------------
-- §15.3 — Initial RLS role assignments (action-layer enforcement)
-- ----------------------------------------------------------------

-- Per Architect Gate 5 Path B: action-layer guards consult these
-- boolean flags. Existing users only — first-sign-in default for
-- new users stays `false` per migration default; promotion requires
-- explicit admin update.

-- Admins + PMs + Logistics — full grants on both flags.
update users
   set can_create_leaves = true,
       can_edit_specs    = true,
       updated_at        = now()
 where email in (
   'edward@thedps.co',
   'jackie@thedps.co',
   'aisha@thedps.co',
   'lexa@thedps.co',
   'andrea@thedps.co',
   'cally@thedps.co'
 );

-- Sales — can build quotes from existing library leaves but cannot
-- author spec data (drift-risk reduction per Edward disposition).
update users
   set can_create_leaves = true,
       can_edit_specs    = false,
       updated_at        = now()
 where email = 'jing@thedps.co';

commit;
