-- Phase A.1 v2 impl-2 smoke fixtures — seeds an existing draft
-- quote with ASY/LEAF tree data so the Setup surface renders the
-- new tree (scenarios ①-④).
--
-- Idempotency: re-running this file is SAFE for the same quote
-- because of the ON CONFLICT clauses. Re-running with a different
-- quote_id seeds additional fixtures alongside the prior ones.
--
-- To use:
--   1. Pick a draft quote_id from the shared DB. For Edward's dev
--      DB on 2026-05-19, the most-recent draft is:
--        f84334bd-afa1-4016-9511-71f7d5600e35 (scenario "Alt 1")
--      Any other draft quote works the same.
--   2. Substitute the placeholder TARGET_QUOTE_ID below.
--   3. Apply via:
--        node --env-file=.env.local scripts/apply-manual-sql.mjs \
--          drizzle/manual/0030_phase_a1_v2_impl2_smoke_fixtures.sql
--   4. Navigate to /projects/<project_id>/quotes/<quote_id> →
--      the Setup surface renders the new ASY/LEAF tree.

-- ============================================================
-- TARGET QUOTE
-- ============================================================
-- Edit this literal if you want to point at a different draft
-- quote. The `\set` psql meta-command isn't supported by the
-- postgres-js applier, so we inline the literal across the file.

-- ============================================================
-- LEAVES (library — globally scoped; idempotent on sku)
-- ============================================================

-- 4 fixture leaves spanning the spec-completeness states for
-- scenario ④ rollup demonstration:
--   • a PP leaf with full spec values → "complete"
--   • a PP leaf with partial spec values → "partial"
--   • a TP leaf without any specs → "empty"
--   • a leaf with NO product_type → "no_type"

insert into leaves (id, sku, name, product_type_id, unit_cost, archived)
values
  ('11111111-1111-1111-1111-111111111101',
    'LEAF-GLW-30-PP',
    '30ml Glass Dropper Bottle · Type III soda-lime · matte black',
    'leaf_primary_packaging',
    '1.85',
    false),
  ('11111111-1111-1111-1111-111111111102',
    'LEAF-GLW-FCT',
    'Folding carton · 200gsm SBS · matte lamination · embossed logo',
    'leaf_secondary_packaging',
    '0.55',
    false),
  ('11111111-1111-1111-1111-111111111103',
    'LEAF-GLW-TP',
    'Master carton · ECT-32 · 12-up · holds 12 units',
    'leaf_tertiary_packaging',
    '0.32',
    false),
  ('11111111-1111-1111-1111-111111111104',
    'LEAF-GLW-UNK',
    'Unknown component (no Product Type set — drives type-picker on Edit specs)',
    null,
    '0.20',
    false)
on conflict (id) do nothing;

-- ============================================================
-- LEAF_SPECS (versioned; is_current=true)
-- ============================================================

-- created_by points at Edward's user row in the dev DB. If running
-- against a different DB, substitute another existing user UUID.
insert into leaf_specs (id, leaf_id, spec_values, version_number, is_current, effective_from, created_by)
values
  ('22222222-2222-2222-2222-222222222201',
    '11111111-1111-1111-1111-111111111101',
    jsonb_build_object(
      'pp_description',        '30ml dropper bottle for serum',
      'pp_component_type',     'bottle',
      'pp_quantities',         '10000',
      'pp_size',               '30ml',
      'pp_material',           'Type III soda-lime glass',
      'pp_deco',               'matte black',
      'pp_additional_details', 'frosted finish; child-resistant cap',
      'pp_factory_1',          'Hangzhou Sealwell',
      'pp_factory_2',          'Bormioli Luigi (backup)',
      'pp_packout_details',    '20 per inner; 240 per master'
    ),
    1, true, now(),
    '029e5318-9991-4b26-90cb-6710e892f743'::uuid),

  -- SP leaf — 6 of 11 fields filled → "partial"
  ('22222222-2222-2222-2222-222222222202',
    '11111111-1111-1111-1111-111111111102',
    jsonb_build_object(
      'sp_description',  'Folding carton w/ holographic stamp',
      'sp_material',     '200gsm SBS',
      'sp_size',         '85 × 35 × 110mm',
      'sp_color',        'pantone 282 C',
      'sp_coating',      'matte lamination',
      'sp_finishing',    'embossed logo + holographic stamp'
    ),
    1, true, now(),
    '029e5318-9991-4b26-90cb-6710e892f743'::uuid)
on conflict (id) do nothing;

-- ============================================================
-- ASSEMBLIES (per-quote; bound to target_quote_id)
-- ============================================================

-- 4 ASYs for the target quote covering scenarios ④ rollup states:
--   • Hydra-Glow 30ml — all leaves complete → "✓ All N leaves complete"
--   • Hydra-Glow 50ml — mixed states → "⚠ N of M leaves pending"
--   • Glow Capsule    — no leaves → "— No leaves"
--   • Replenish 200ml — mixed with placeholder + untyped

insert into assemblies (id, quote_id, sku, name, pack_label, product_type_id, position, internal_notes)
values
  ('33333333-3333-3333-3333-333333333301',
    'f84334bd-afa1-4016-9511-71f7d5600e35'::uuid, 'GLW-30',
    'Hydra-Glow Vitamin C Serum 30ml',
    'pack of 12', 'asy_skincare', 0,
    'Sourcing dependency: Hangzhou Sealwell confirmed lead time 12 weeks. Customer requested expedite — see phone call 2026-05-15.'),

  ('33333333-3333-3333-3333-333333333302',
    'f84334bd-afa1-4016-9511-71f7d5600e35'::uuid, 'GLW-50',
    'Hydra-Glow Vitamin C Serum 50ml',
    'pack of 12', 'asy_skincare', 1, null),

  ('33333333-3333-3333-3333-333333333303',
    'f84334bd-afa1-4016-9511-71f7d5600e35'::uuid, 'CAP-60',
    'Glow Capsule 60ct',
    'pack of 6', 'asy_supplement', 2, null),

  ('33333333-3333-3333-3333-333333333304',
    'f84334bd-afa1-4016-9511-71f7d5600e35'::uuid, 'RPL-200',
    'Replenish Body Lotion 200ml',
    'pack of 6', 'asy_body', 3, null)
on conflict (id) do nothing;

-- ============================================================
-- ASSEMBLY_LEAVES (junction; per-ASY positioned children)
-- ============================================================

-- GLW-30: complete PP leaf only
insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position)
values
  ('44444444-4444-4444-4444-444444444401',
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111101',
    '1', 0)
on conflict (id) do nothing;

-- GLW-50: PP (complete) + SP (partial) + TP (empty) → mixed
insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position)
values
  ('44444444-4444-4444-4444-444444444402',
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111101',
    '1', 0),
  ('44444444-4444-4444-4444-444444444403',
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111102',
    '1', 1),
  ('44444444-4444-4444-4444-444444444404',
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111103',
    '1', 2)
on conflict (id) do nothing;

-- CAP-60: no leaves attached → "— No leaves" rollup

-- RPL-200: SP (partial) + TP (empty placeholder) + untyped → mixed with placeholders + untyped
insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position)
values
  ('44444444-4444-4444-4444-444444444405',
    '33333333-3333-3333-3333-333333333304',
    '11111111-1111-1111-1111-111111111102',
    '1', 0),
  ('44444444-4444-4444-4444-444444444406',
    '33333333-3333-3333-3333-333333333304',
    '11111111-1111-1111-1111-111111111103',
    '1', 1),
  ('44444444-4444-4444-4444-444444444407',
    '33333333-3333-3333-3333-333333333304',
    '11111111-1111-1111-1111-111111111104',
    '1', 2)
on conflict (id) do nothing;

-- ============================================================
-- Verification query (run separately if needed):
--
-- select
--   a.sku, a.name, a.position, count(al.id) as leaf_count
-- from assemblies a
-- left join assembly_leaves al on al.assembly_id = a.id
-- where a.quote_id = 'f84334bd-afa1-4016-9511-71f7d5600e35'::uuid
-- group by a.id, a.sku, a.name, a.position
-- order by a.position;
-- ============================================================
