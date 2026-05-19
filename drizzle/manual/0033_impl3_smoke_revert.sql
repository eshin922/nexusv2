-- Phase A.1 v2 impl-3 smoke revert — restore canonical pre-walk leaf states
--
-- CB's first impl-3 smoke walk mutated two seed leaves via the actual
-- impl-3 surfaces (TypePicker + ChangeTypeModal). To re-smoke against
-- the canonical fixtures, revert the two affected leaves back to their
-- 0031-seeded state.
--
-- LEAF-GLW-30-PP (11111111-...01) — was scenario ⑤ target (PP-complete
-- 10-field rendering). CB exercised the type-change modal (PP→TP) which
-- (a) updated leaves.product_type_id to leaf_tertiary_packaging, and
-- (b) cleared the leaf_spec.spec_values jsonb to '{}'.
--
-- LEAF-GLW-UNK (11111111-...04) — was scenario ⑨ target (TypePicker
-- empty state). CB used the picker to assign Soft goods which set
-- leaves.product_type_id to leaf_soft_goods. No leaf_spec row was
-- created (TypePicker just sets the type column; spec entry follows
-- as a separate workflow).
--
-- Idempotent UPDATE; safe to re-apply. Re-running re-asserts the
-- canonical state regardless of current values.
--
-- Audit trail: the revert SQL itself doesn't emit audit rows (it's
-- a smoke-cleanup, not a PM action). The original mutations remain
-- in audit_log (CB's `leaf_spec_type_change` + `leaf_product_type_assigned`
-- rows from the walk; useful as the cascade-pattern verification
-- evidence per smoke guide).

begin;

-- LEAF-GLW-30-PP — restore PP type
update leaves
   set product_type_id = 'leaf_primary_packaging',
       updated_at = now()
 where id = '11111111-1111-1111-1111-111111111101';

-- LEAF-GLW-30-PP spec values — restore the original 10-field PP-complete
-- shape from drizzle/manual/0030_phase_a1_v2_impl2_smoke_fixtures.sql.
update leaf_specs
   set spec_values = jsonb_build_object(
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
       updated_at = now()
 where id = '22222222-2222-2222-2222-222222222201';

-- LEAF-GLW-UNK — restore no-type empty state
update leaves
   set product_type_id = null,
       updated_at = now()
 where id = '11111111-1111-1111-1111-111111111104';

commit;
