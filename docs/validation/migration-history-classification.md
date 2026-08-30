# Migration-history classification

**Generated evidence. READ-ONLY — no metadata was repaired and no migration executed.**

Produced by `scripts/gate-1b/migration-history-classify.ts`. Regenerate rather than hand-edit.

## The rule that decides `verdict`

`drizzle-kit migrate` delegates to drizzle-orm's `migrate()`, which reads **one** row —
`order by created_at desc limit 1` — and executes every journal entry whose `when` exceeds
that single value. **`hash` is written on insert and never read.** So the verdict below is
the migrator's own rule, not a set-difference over the table.

- journal entries: **114**
- `__drizzle_migrations` rows: **110**
- `max(created_at)`: **1788165120000**
- would execute on a bare `db:migrate`: **4**

## Column meanings

- **journal identity** — `idx` / `when` from `_journal.json`, and whether a `.sql` file exists.
- **DB identity** — whether a row carries the file's hash (`LF` = only after CRLF→LF
  normalisation, which is a checkout artifact and has no operational effect), and whether a
  row carries the journal's `when` as its `created_at`.
- **object/data evidence** — a **direct probe** for the six entries the metadata cannot
  reconcile. For every other row it reports the recorded row, which is evidence the migrator
  applied the file and wrote the row in one transaction — *not* a probe of the schema.
- **verdict** — `applied` / `pending` / `ambiguous`.

| migration | journal identity | DB identity | object/data evidence | verdict |
|---|---|---|---|---|
| `0000_glorious_gateway` | idx 0 · when 1777418416754 · file ✓ · snapshot | hash ✓ · id 1 · when ✓ | recorded row (migrator-written) | applied |
| `0001_lush_dreadnoughts` | idx 1 · when 1777420073129 · file ✓ · snapshot | hash ✓ · id 2 · when ✓ | recorded row (migrator-written) | applied |
| `0002_futuristic_shiva` | idx 2 · when 1777421846907 · file ✓ · snapshot | hash ✓ · id 3 · when ✓ | recorded row (migrator-written) | applied |
| `0003_exotic_mandrill` | idx 3 · when 1777424001015 · file ✓ · snapshot | hash ✓ · id 4 · when ✓ | recorded row (migrator-written) | applied |
| `0004_productive_blur` | idx 4 · when 1777432221330 · file ✓ · snapshot | hash ✓ · id 5 · when ✓ | recorded row (migrator-written) | applied |
| `0005_fat_hitman` | idx 5 · when 1777481268021 · file ✓ · snapshot | hash ✓ (LF) · id 6 · when ✓ | recorded row (migrator-written) | applied |
| `0006_ambitious_gravity` | idx 6 · when 1777484652314 · file ✓ · snapshot | hash ✓ (LF) · id 7 · when ✓ | recorded row (migrator-written) | applied |
| `0007_amazing_zuras` | idx 7 · when 1777578607193 · file ✓ · snapshot | hash ✓ (LF) · id 8 · when ✓ | recorded row (migrator-written) | applied |
| `0008_daily_moon_knight` | idx 8 · when 1777581099438 · file ✓ · snapshot | hash ✓ (LF) · id 9 · when ✓ | recorded row (migrator-written) | applied |
| `0009_chemical_salo` | idx 9 · when 1777585797788 · file ✓ · snapshot | hash ✓ (LF) · id 10 · when ✓ | recorded row (migrator-written) | applied |
| `0010_orange_brother_voodoo` | idx 10 · when 1777586069556 · file ✓ · snapshot | hash ✓ (LF) · id 11 · when ✓ | recorded row (migrator-written) | applied |
| `0011_absurd_tomorrow_man` | idx 11 · when 1777589624141 · file ✓ · snapshot | hash ✓ (LF) · id 12 · when ✓ | recorded row (migrator-written) | applied |
| `0012_colossal_lenny_balinger` | idx 12 · when 1777591195211 · file ✓ · snapshot | hash ✓ (LF) · id 13 · when ✓ | recorded row (migrator-written) | applied |
| `0013_wide_cassandra_nova` | idx 13 · when 1777613325846 · file ✓ · snapshot | hash ✓ · id 14 · when ✓ | recorded row (migrator-written) | applied |
| `0014_illegal_jane_foster` | idx 14 · when 1777696937888 · file ✓ · snapshot | hash ✓ (LF) · id 15 · when ✓ | recorded row (migrator-written) | applied |
| `0015_clammy_next_avengers` | idx 15 · when 1777781927404 · file ✓ · snapshot | hash ✓ (LF) · id 16 · when ✓ | recorded row (migrator-written) | applied |
| `0016_lethal_silk_fever` | idx 16 · when 1777791340537 · file ✓ · snapshot | hash ✓ (LF) · id 17 · when ✓ | recorded row (migrator-written) | applied |
| `0017_cloudy_infant_terrible` | idx 17 · when 1777921443560 · file ✓ · snapshot | hash ✓ (LF) · id 18 · when ✓ | recorded row (migrator-written) | applied |
| `0018_pullback_client_target` | idx 18 · when 1777940000000 · file ✓ · snapshot | hash ✓ (LF) · id 21 · when ✓ | recorded row (migrator-written) | applied |
| `0019_ri_1_workspace_scenarios_audit_bulkraw` | idx 19 · when 1777942644265 · file ✓ · snapshot | hash ✓ (LF) · id 22 · when ✓ | recorded row (migrator-written) | applied |
| `0020_ri_7_state_machine_admin_extension` | idx 20 · when 1778534914411 · file ✓ · snapshot | hash ✓ (LF) · id 23 · when ✓ | recorded row (migrator-written) | applied |
| `0021_quote_number_backfill` | idx 21 · when 1778538000000 · file ✓ · snapshot | **no row** | **probe:** column present; **39 quotes carry a non-null quote_number** — the backfill demonstrably ran | applied |
| `0022_careful_ogun` | idx 22 · when 1778632906911 · file ✓ · snapshot | hash ✓ (LF) · id 25 · when ✓ | recorded row (migrator-written) | applied |
| `0023_tier_recommended` | idx 23 · when 1778651054196 · file ✓ · snapshot | hash ✓ · id 26 · when ✓ | recorded row (migrator-written) | applied |
| `0024_leaf_detach_auto_migrate_artifact` | idx 24 · when 1778830000000 · file ✓ · snapshot | hash ✓ (LF) · id 27 · when ✓ | recorded row (migrator-written) | applied |
| `0025_drop_auto_migrate_artifact` | idx 25 · when 1778840000000 · file ✓ · snapshot | hash ✓ (LF) · id 28 · when ✓ | recorded row (migrator-written) | applied |
| `0026_r6_2_freight_legs_additive` | idx 26 · when 1778820829302 · file ✓ · snapshot | hash ✓ (LF) · id 29 · when ✗ (row 1778864705203) | **probe:** `freight_legs` table present (1) | applied |
| `0027_r6_2_drop_freight_inputs` | idx 27 · when 1778873124706 · file ✓ · snapshot | hash ✓ (LF) · id 30 · when ✓ | recorded row (migrator-written) | applied |
| `0028_r6_2_vessel_eta_actual_delivery` | idx 28 · when 1778873717908 · file ✓ · snapshot | hash ✓ (LF) · id 31 · when ✓ | recorded row (migrator-written) | applied |
| `0029_pricing_events_table` | idx 29 · when 1779083401356 · file ✓ · snapshot | hash ✓ (LF) · id 32 · when ✓ | recorded row (migrator-written) | applied |
| `0030_phase_a1_v2_schema_create` | idx 30 · when 1779212886053 · file ✓ · snapshot | hash ✓ (LF) · id 33 · when ✓ | recorded row (migrator-written) | applied |
| `0031_canonical_scenario_create_schema` | idx 31 · when 1779235056466 · file ✓ · snapshot | hash ✓ (LF) · id 34 · when ✓ | recorded row (migrator-written) | applied |
| `0032_hubspot_product_id_on_leaves` | idx 32 · when 1779301704664 · file ✓ · snapshot | hash ✓ (LF) · id 35 · when ✓ | recorded row (migrator-written) | applied |
| `0033_firm_settings_policy_gates` | idx 33 · when 1781654940321 · file ✓ · snapshot | hash ✓ (LF) · id 36 · when ✓ | recorded row (migrator-written) | applied |
| `0034_slice_11_5_assembly_cost_extension_tables` | idx 34 · when 1781808949489 · file ✓ · snapshot | hash ✓ (LF) · id 37 · when ✓ | recorded row (migrator-written) | applied |
| `0035_slice_11_5_1_drop_old_cost_tables` | idx 35 · when 1781852367023 · file ✓ · snapshot | hash ✓ · id 38 · when ✓ | recorded row (migrator-written) | applied |
| `0036_slice_11_step_4_pdf_layout` | idx 36 · when 1784071301906 · file ✓ · snapshot | hash ✓ · id 39 · when ✓ | recorded row (migrator-written) | applied |
| `0037_slice_12_step_2_quote_status_complete` | idx 37 · when 1785197236090 · file ✓ · snapshot | hash ✓ (LF) · id 40 · when ✓ | recorded row (migrator-written) | applied |
| `0038_slice_12_step_3_schema` | idx 38 · when 1785197940633 · file ✓ · snapshot | hash ✓ (LF) · id 41 · when ✓ | recorded row (migrator-written) | applied |
| `0039_slice_12_step_5a_quote_snapshots` | idx 39 · when 1785199070627 · file ✓ · snapshot | hash ✓ (LF) · id 42 · when ✓ | recorded row (migrator-written) | applied |
| `0040_slice_12_step_7b_pending_hubspot_from_stage` | idx 40 · when 1785205996429 · file ✓ · snapshot | hash ✓ · id 43 · when ✓ | recorded row (migrator-written) | applied |
| `0041_slice_12_step_7b_pending_hubspot_from_stage_version` | idx 41 · when 1785208722357 · file ✓ · snapshot | hash ✓ · id 44 · when ✓ | recorded row (migrator-written) | applied |
| `0042_slice_12_step_8a_customer_response_channel` | idx 42 · when 1785221147712 · file ✓ · snapshot | hash ✓ (LF) · id 45 · when ✓ | recorded row (migrator-written) | applied |
| `0043_slice_12_step_8c1_netsuite_item_groups` | idx 43 · when 1785268696127 · file ✓ · snapshot | hash ✓ (LF) · id 46 · when ✓ | recorded row (migrator-written) | applied |
| `0044_slice_12_step_8c2_hubspot_deals_cache_ext` | idx 44 · when 1785270878086 · file ✓ · snapshot | hash ✓ · id 48 · when ✓ | recorded row (migrator-written) | applied |
| `0045_slice_12_step_8c3_schema` | idx 45 · when 1785273641128 · file ✓ · snapshot | hash ✓ · id 49 · when ✓ | recorded row (migrator-written) | applied |
| `0046_slice_12_step_10_reconcile_and_fk` | idx 46 · when 1785309854907 · file ✓ · snapshot | hash ✓ · id 50 · when ✓ | recorded row (migrator-written) | applied |
| `0047_slice_13_pricing_vendor_identity` | idx 47 · when 1785462682183 · file ✓ · snapshot | hash ✓ · id 51 · when ✓ | recorded row (migrator-written) | applied |
| `0048_product_structure_slice1_expand` | idx 48 · when 1785543095436 · file ✓ · snapshot | hash ✓ · id 52 · when ✓ | recorded row (migrator-written) | applied |
| `0051_phase_1_commercial_settings_pins` | idx 49 · when 1785787200000 · file ✓ · hand-authored | hash ✓ · id 53 · when ✓ | recorded row (migrator-written) | applied |
| `0052_phase_1_sales_order_snapshot_identity` | idx 50 · when 1785789000000 · file ✓ · hand-authored | hash ✓ · id 54 · when ✓ | recorded row (migrator-written) | applied |
| `0053_phase_2_component_freight_expand` | idx 51 · when 1785790800000 · file ✓ · hand-authored | hash ✓ · id 55 · when ✓ | recorded row (migrator-written) | applied |
| `0054_phase_2_worksheet_freight_expand` | idx 52 · when 1785792600000 · file ✓ · hand-authored | hash ✓ · id 56 · when ✓ | recorded row (migrator-written) | applied |
| `0055_phase_2_worksheet_freight_snapshots` | idx 53 · when 1785880800000 · file ✓ · hand-authored | hash ✓ · id 57 · when ✓ | recorded row (migrator-written) | applied |
| `0056_canonical_attachment_repair` | idx 54 · when 1785999600000 · file ✓ · hand-authored | hash ✓ (LF) · id 58 · when ✓ | recorded row (migrator-written) | applied |
| `0057_action_idempotency` | idx 55 · when 1786039200000 · file ✓ · hand-authored | hash ✓ (LF) · id 59 · when ✓ | recorded row (migrator-written) | applied |
| `0058_packaging_materialization_backfill` | idx 56 · when 1786042800000 · file ✓ · hand-authored | hash ✓ (LF) · id 60 · when ✓ | recorded row (migrator-written) | applied |
| `0059_audit_actor_snapshots` | idx 57 · when 1786051800000 · file ✓ · hand-authored | hash ✓ (LF) · id 61 · when ✓ | recorded row (migrator-written) | applied |
| `0060_audit_actor_backfill` | idx 58 · when 1786052400000 · file ✓ · hand-authored | hash ✓ (LF) · id 62 · when ✓ | recorded row (migrator-written) | applied |
| `0061_audit_actor_kind` | idx 59 · when 1786056000000 · file ✓ · hand-authored | hash ✓ (LF) · id 63 · when ✓ | recorded row (migrator-written) | applied |
| `0062_audit_actor_enforcement` | idx 60 · when 1786060800000 · file ✓ · hand-authored | hash ✓ · id 64 · when ✓ | recorded row (migrator-written) | applied |
| `0063_pricing_lift_persistence` | idx 61 · when 1786320000000 · file ✓ · hand-authored | hash ✓ (LF) · id 65 · when ✓ | recorded row (migrator-written) | applied |
| `0064_below_floor_authorization` | idx 62 · when 1786320001000 · file ✓ · hand-authored | hash ✓ (LF) · id 66 · when ✓ | recorded row (migrator-written) | applied |
| `0065_durable_attempt_lifecycle` | idx 63 · when 1786320002000 · file ✓ · hand-authored | hash ✓ (LF) · id 67 · when ✓ | recorded row (migrator-written) | applied |
| `0066_direct_component_cost_identity` | idx 64 · when 1786320003000 · file ✓ · hand-authored | hash ✓ (LF) · id 68 · when ✓ | recorded row (migrator-written) | applied |
| `0067_freight_container_not_assembly_owned` | idx 65 · when 1786320004000 · file ✓ · snapshot | hash ✓ (LF) · id 69 · when ✓ | recorded row (migrator-written) | applied |
| `0068_freight_identity_guard_canonical` | idx 66 · when 1786320005000 · file ✓ · hand-authored | hash ✓ (LF) · id 70 · when ✓ | recorded row (migrator-written) | applied |
| `0069_below_floor_approval_requests` | idx 67 · when 1786320006000 · file ✓ · hand-authored | hash ✓ (LF) · id 71 · when ✓ | recorded row (migrator-written) | applied |
| `0070_leaf_hubspot_product_type` | idx 68 · when 1786320007000 · file ✓ · hand-authored | hash ✓ (LF) · id 72 · when ✓ | recorded row (migrator-written) | applied |
| `0071_quote_owned_spec_authority` | idx 69 · when 1786320008000 · file ✓ · hand-authored | hash ✓ (LF) · id 73 · when ✓ | recorded row (migrator-written) | applied |
| `0072_product_type_label_trim` | idx 70 · when 1786320009000 · file ✓ · hand-authored | hash ✓ (LF) · id 74 · when ✓ | recorded row (migrator-written) | applied |
| `0073_pinned_spec_schema` | idx 71 · when 1786320010000 · file ✓ · hand-authored | hash ✓ (LF) · id 75 · when ✓ | recorded row (migrator-written) | applied |
| `0074_item_group_categories` | idx 72 · when 1786320011000 · file ✓ · hand-authored | hash ✓ (LF) · id 76 · when ✓ | recorded row (migrator-written) | applied |
| `0075_drop_retired_product_type_authorities` | idx 73 · when 1786320012000 · file ✓ · hand-authored | hash ✓ · id 77 · when ✓ | recorded row (migrator-written) | applied |
| `0076_od_023_snapshot_artifacts` | idx 74 · when 1786320013000 · file ✓ · hand-authored | hash ✓ (LF) · id 78 · when ✓ | recorded row (migrator-written) | applied |
| `0077_client_target_authority` | idx 75 · when 1786320014000 · file ✓ · hand-authored | hash ✓ (LF) · id 79 · when ✓ | recorded row (migrator-written) | applied |
| `0078_legacy_commercial_pin_provenance` | idx 76 · when 1786320015000 · file ✓ · hand-authored | hash ✓ (LF) · id 80 · when ✓ | recorded row (migrator-written) | applied |
| `0079_leaf_commercial_kind` | idx 77 · when 1786320016000 · file ✓ · hand-authored | hash ✓ (LF) · id 81 · when ✓ | recorded row (migrator-written) | applied |
| `0080_canonical_direct_services` | idx 78 · when 1786320017000 · file ✓ · hand-authored | hash ✓ (LF) · id 82 · when ✓ | recorded row (migrator-written) | applied |
| `0081_netsuite_service_item_map` | idx 79 · when 1786320018000 · file ✓ · hand-authored | hash ✓ (LF) · id 83 · when ✓ | recorded row (migrator-written) | applied |
| `0082_production_ownership_xor` | idx 80 · when 1786320019000 · file ✓ · hand-authored | hash ✓ (LF) · id 84 · when ✓ | recorded row (migrator-written) | applied |
| `0083_testing_micros_production_input` | idx 81 · when 1786320020000 · file ✓ · hand-authored | hash ✓ (LF) · id 85 · when ✓ | recorded row (migrator-written) | applied |
| `0084_quote_leaves_commercial_kind_default` | idx 82 · when 1786320021000 · file ✓ · hand-authored | hash ✓ (LF) · id 86 · when ✓ | recorded row (migrator-written) | applied |
| `0085_bv013_backfill_production_pins` | idx 83 · when 1786320022000 · file ✓ · hand-authored | hash ✓ (LF) · id 87 · when ✓ | recorded row (migrator-written) | applied |
| `0086_bv013_production_default` | idx 84 · when 1786320023000 · file ✓ · hand-authored | hash ✓ (LF) · id 88 · when ✓ | recorded row (migrator-written) | applied |
| `0087_frozen_commercial_line_set` | idx 85 · when 1786320024000 · file ✓ · hand-authored | hash ✗ · when ✓ (id 89) | **probe:** `quote_snapshot_lines` table present (1) | applied |
| `0088_bv011_destination_map_and_tooling_split` | idx 86 · when 1786320036000 · file ✓ · hand-authored | hash ✓ (LF) · id 90 · when ✓ | recorded row (migrator-written) | applied |
| `0089_frozen_line_legacy_unresolved` | idx 87 · when 1786320048000 · file ✓ · hand-authored | hash ✓ (LF) · id 91 · when ✓ | recorded row (migrator-written) | applied |
| `0090_per_line_other_service_item` | idx 88 · when 1786320060000 · file ✓ · hand-authored | hash ✓ (LF) · id 92 · when ✓ | recorded row (migrator-written) | applied |
| `0091_frozen_rate_precision_8dp` | idx 89 · when 1786320072000 · file ✓ · hand-authored | hash ✓ (LF) · id 93 · when ✓ | recorded row (migrator-written) | applied |
| `0092_user_role_logistics_sales` | idx 90 · when 1786320084000 · file ✓ · hand-authored | hash ✓ (LF) · id 94 · when ✓ | recorded row (migrator-written) | applied |
| `0093_pre_authorized_first_signin_binding` | idx 91 · when 1786320096000 · file ✓ · hand-authored | hash ✓ (LF) · id 95 · when ✓ | recorded row (migrator-written) | applied |
| `0094_ordered_spec_freeze` | idx 92 · when 1786320108000 · file ✓ · hand-authored | hash ✓ (LF) · id 96 · when ✓ | recorded row (migrator-written) | applied |
| `0095_ordered_spec_delete_guard` | idx 93 · when 1786320120000 · file ✓ · hand-authored | hash ✓ (LF) · id 97 · when ✓ | recorded row (migrator-written) | applied |
| `0096_snapshot_artifact_identity` | idx 94 · when 1786320132000 · file ✓ · hand-authored | hash ✓ (LF) · id 98 · when ✓ | recorded row (migrator-written) | applied |
| `0097_projects_is_test` | idx 95 · when 1786320144000 · file ✓ · hand-authored | hash ✓ · id 99 · when ✓ | recorded row (migrator-written) | applied |
| `0098_commercial_recovery_profile` | idx 96 · when 1786320156000 · file ✓ · hand-authored | hash ✓ (LF) · id 100 · when ✓ | recorded row (migrator-written) | applied |
| `0099_withdraw_two_axis_recovery` | idx 97 · when 1786320168000 · file ✓ · hand-authored | hash ✓ (LF) · id 101 · when ✓ | recorded row (migrator-written) | applied |
| `0100_quote_charge_recovery` | idx 98 · when 1786320180000 · file ✓ · hand-authored | hash ✓ (LF) · id 102 · when ✓ | recorded row (migrator-written) | applied |
| `0101_frozen_recovery_instruction` | idx 99 · when 1786320181000 · file ✓ · hand-authored | hash ✓ (LF) · id 103 · when ✓ | recorded row (migrator-written) | applied |
| `0102_presentation_profile` | idx 100 · when 1787643000000 · file ✓ · hand-authored | hash ✓ · id 104 · when ✓ | recorded row (migrator-written) | applied |
| `0103_customer_note_snapshot` | idx 101 · when 1787643060000 · file ✓ · hand-authored | hash ✓ (LF) · id 105 · when ✓ | recorded row (migrator-written) | applied |
| `0104_accounting_instruction` | idx 102 · when 1787643120000 · file ✓ · hand-authored | hash ✓ (LF) · id 106 · when ✓ | recorded row (migrator-written) | applied |
| `0105_customer_identity_snapshot` | idx 103 · when 1787729520000 · file ✓ · hand-authored | hash ✓ (LF) · id 107 · when ✓ | recorded row (migrator-written) | applied |
| `0106_customer_contact_and_address` | idx 104 · when 1787733120000 · file ✓ · hand-authored | hash ✓ (LF) · id 108 · when ✓ | recorded row (migrator-written) | applied |
| `0107_od_032_phase_1_charge_instance_identity` | idx 105 · when 1787819520000 · file ✓ · hand-authored | hash ✓ (LF) · id 109 · when ✓ | recorded row (migrator-written) | applied |
| `0108_od_032_phase_1b_contract_instance_identity` | idx 106 · when 1787905920000 · file ✓ · hand-authored | hash ✓ (LF) · id 110 · when ✓ | recorded row (migrator-written) | applied |
| `0109_od_032_phase_2_component_owned_charges` | idx 107 · when 1787992320000 · file ✓ · hand-authored | hash ✓ (LF) · id 111 · when ✓ | recorded row (migrator-written) | applied |
| `0110_od_032_phase_2_drop_legacy_charge_unique` | idx 108 · when 1788078720000 · file ✓ · hand-authored | hash ✓ (LF) · id 112 · when ✓ | recorded row (migrator-written) | applied |
| `0111_od_032_frozen_instruction_identity` | idx 109 · when 1788165120000 · file ✓ · hand-authored | hash ✓ (LF) · id 113 · when ✓ | recorded row (migrator-written) | applied |
| `0112_od_032_manual_all_in_sell_provenance` | idx 110 · when 1788251520000 · file ✓ · hand-authored | **no row** | **probe:** `manual_all_in_sell` column present (1) | applied |
| `0113_od_028_frozen_owner_kind` | idx 111 · when 1788337920000 · file ✓ · hand-authored | **no row** | **probe:** `recovery_owner_kind` type + `owner_kind` column present (1) | applied |
| `0114_od_028_item_group_commercial_line` | idx 112 · when 1788424320000 · file ✓ · hand-authored | **no row** | **probe:** enum label `item_group` present (1) | applied |
| `0115_component_charge_samples_key` | idx 113 · when 1788510720000 · file ✓ · hand-authored | **no row** | **probe:** enum label `samples` present (1) | applied |

**Totals — applied 114 · pending 0 · ambiguous 0.**

## Every row reconciled to a file

A row is explained when its hash matches a migration file (after CRLF→LF
normalisation). Where the row's `created_at` then differs from that file's journal
`when`, the row was written before the journal entry took its final value — the
journal was regenerated or hand-edited after the migration had already run.

**This drift is the only thing that made those entries look pending under a
set-difference, and it is invisible to the migrator**, which reads `max(created_at)`
and never matches rows to entries.

- rows total: **110**
- rows whose hash matches a file: **109**
- of those, `created_at` drifted from the journal `when`: **2**
- rows whose hash matches NO file: **1**

| id | created_at | journal `when` | delta | migration |
|---|---|---|---|---|
| 29 | 1778864705203 | 1778820829302 | +731 min | `0026_r6_2_freight_legs_additive` |
| 47 | 1785269864715 | 1785270878086 | −17 min | `0044_slice_12_step_8c2_hubspot_deals_cache_ext` |

Rows whose hash matches no current file — the file was **edited after it was applied**,
which changes the digest and nothing else. Identified by `created_at`, which still
carries the journal `when`:

| id | created_at | identified as |
|---|---|---|
| 89 | 1786320024000 | `0087_frozen_commercial_line_set` |

## Snapshot chain

- snapshots present: **50**, covering `0000`–`0065`.
- journal entries with no snapshot: **64**.
- `db:generate` no longer generates: it runs `scripts/verify/schema-drift.mjs`, a drift
  detector that never writes into `drizzle/`, and `db:push` is hard-blocked by OD-012. The
  chain stopping is therefore residue of a deliberate move to hand-authored migrations, not
  a broken dependency — but it is why snapshot generation must not be reintroduced without
  rebuilding the chain first.
