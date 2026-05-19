-- Phase A.1 v2 impl-3 smoke fixtures — adds a Soft goods leaf
-- under the target quote's RPL-200 ASY so scenario ⑦ (Soft goods
-- placeholder) has a target. The impl-2 smoke seed already covers
-- scenarios ⑤/⑥/⑨ (PP complete / SP partial / no-type); scenario
-- ⑧ (Tertiary "placeholder") is superseded by Edward §15.2
-- dispositions making TP first-class; scenario ⑩ (RLS read-only)
-- exercises by signing in as a non-admin user without can_edit_specs.
--
-- Idempotent via ON CONFLICT DO NOTHING; targets quote
-- f84334bd-afa1-4016-9511-71f7d5600e35 + ASY RPL-200
-- (33333333-3333-3333-3333-333333333304) seeded in impl-2.

begin;

-- LEAF: Soft goods (placeholder type → renders PlaceholderPanel)
insert into leaves (id, sku, name, product_type_id, unit_cost, archived)
values
  ('11111111-1111-1111-1111-111111111105',
    'LEAF-GLW-SG',
    'Soft goods insert · velvet pouch w/ ribbon tie',
    'leaf_soft_goods',
    '0.45',
    false)
on conflict (id) do nothing;

-- Attach the Soft goods leaf to RPL-200 (the multi-leaf scenario
-- ASY from impl-2 smoke).
insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position)
values
  ('44444444-4444-4444-4444-444444444408',
    '33333333-3333-3333-3333-333333333304',
    '11111111-1111-1111-1111-111111111105',
    '1', 3)
on conflict (id) do nothing;

commit;
