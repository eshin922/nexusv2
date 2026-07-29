# Local Database Migration Compatibility

## Status

**Current verdict: COMPATIBLE in two clean local runs.**

Docker Desktop and `postgres:16-alpine` now run locally. The first Drizzle
attempt stopped before migration because Docker Desktop suppressed the host
port when the service's only network was marked internal:
`ECONNREFUSED 127.0.0.1:55432`. PostgreSQL itself was healthy.

The Compose topology now retains the explicit loopback-only host binding while
using a normal bridge network. The PostgreSQL container contains no integration
credentials. Application and browser outbound denial remain independent
containment layers.

All 47 journaled migrations then applied from empty PostgreSQL without an SQL
failure. PostgreSQL emitted only expected notices for guarded missing-column
drops and identifier truncation.

The first post-migration assertion was not valid: Windows shell argument
splitting caused `psql` to ignore the query tail. The CLI now uses direct
argument passing and fails unless it reads exactly `47` and `schema-ready`.

The corrected assertion passed. The guarded `reset` command then removed only
the named validation volume, recreated PostgreSQL from empty, reapplied all 47
migrations, and passed the same assertion a second time.

The executed compatibility gate covered:

1. PostgreSQL starts locally;
2. the database is empty;
3. all journaled migrations run in order with stop-on-error behavior;
4. the migration count and Slice 12 schema assertions pass;
5. teardown and repetition from a fresh volume.

All five checks passed locally on 2026-07-29.

## Local Database Target

| Property | Value |
|---|---|
| Engine | PostgreSQL 16 |
| Container image | `postgres:16-alpine` |
| Service | `nexus-validation-db` |
| Bound address | `127.0.0.1:55432` |
| Database | `nexus_validation_test` |
| User | `nexus_validation` |
| Network | Docker bridge; host publication restricted to loopback |
| Required extension | `pg_trgm` |
| Persistence | Named disposable validation volume |

## Classification Definitions

- **Canonical / expected compatible** — journaled Drizzle migration using PostgreSQL features expected locally; execution not yet proven.
- **Supabase-specific / excluded** — manual publication, Storage, or Auth schema operation that does not belong in plain PostgreSQL harness setup.
- **Manual data/fixture operation / excluded from schema bootstrap** — intentionally separate operational SQL, not part of the Drizzle journal.
- **Order-sensitive** — relies on a prior migration/table/data shape; must run only in journal order.
- **Defective** — fails from a valid empty prior migration state. None may be labeled defective until executed.

## Canonical Journaled Migrations

All 47 entries below are present in `drizzle/meta/_journal.json` and are included in local migration execution.

| Migration | Static classification | Notes |
|---|---|---|
| `0000_glorious_gateway` | Canonical / expected compatible | Base schema; uses `gen_random_uuid()` |
| `0001_lush_dreadnoughts` | Canonical / expected compatible | Additive schema |
| `0002_futuristic_shiva` | Canonical / expected compatible | Additive/alter |
| `0003_exotic_mandrill` | Canonical / expected compatible | Additive/alter |
| `0004_productive_blur` | Canonical / expected compatible | Additive schema |
| `0005_fat_hitman` | Canonical / expected compatible | Additive/alter |
| `0006_ambitious_gravity` | Canonical / expected compatible | Additive schema |
| `0007_amazing_zuras` | Canonical / expected compatible | Additive/alter |
| `0008_daily_moon_knight` | Canonical / expected compatible | Additive schema |
| `0009_chemical_salo` | Canonical / expected compatible | Additive/alter |
| `0010_orange_brother_voodoo` | Canonical / expected compatible | Additive schema |
| `0011_absurd_tomorrow_man` | Canonical / expected compatible | Additive schema |
| `0012_colossal_lenny_balinger` | Canonical / expected compatible | Additive/alter |
| `0013_wide_cassandra_nova` | Canonical / expected compatible | Small alter |
| `0014_illegal_jane_foster` | Canonical / expected compatible | Additive/alter |
| `0015_clammy_next_avengers` | Canonical / expected compatible | Additive/alter |
| `0016_lethal_silk_fever` | Canonical / expected compatible | Additive/alter |
| `0017_cloudy_infant_terrible` | Canonical / expected compatible | Additive schema |
| `0018_pullback_client_target` | Canonical / order-sensitive | Pullback after prior client-target migration |
| `0019_ri_1_workspace_scenarios_audit_bulkraw` | Canonical / expected compatible | Explicitly creates `pg_trgm` |
| `0020_ri_7_state_machine_admin_extension` | Canonical / expected compatible | State-machine/admin extension |
| `0021_quote_number_backfill` | Canonical / order-sensitive | Data backfill and sequence behavior |
| `0022_careful_ogun` | Canonical / expected compatible | Additive schema |
| `0023_tier_recommended` | Canonical / expected compatible | Small alter |
| `0024_leaf_detach_auto_migrate_artifact` | Canonical / order-sensitive | Historical auto-migrate artifact |
| `0025_drop_auto_migrate_artifact` | Canonical / order-sensitive | Removes prior artifact |
| `0026_r6_2_freight_legs_additive` | Canonical / expected compatible | Additive freight schema |
| `0027_r6_2_drop_freight_inputs` | Canonical / order-sensitive | Drops superseded table |
| `0028_r6_2_vessel_eta_actual_delivery` | Canonical / expected compatible | Additive columns |
| `0029_pricing_events_table` | Canonical / expected compatible | Additive table |
| `0030_phase_a1_v2_schema_create` | Canonical / expected compatible | Additive Phase A.1 schema |
| `0031_canonical_scenario_create_schema` | Canonical / expected compatible | Additive quote attachment/schema fields |
| `0032_hubspot_product_id_on_leaves` | Canonical / expected compatible | Additive external reference |
| `0033_firm_settings_policy_gates` | Canonical / expected compatible | Additive settings |
| `0034_slice_11_5_assembly_cost_extension_tables` | Canonical / expected compatible | NEW-model cost tables |
| `0035_slice_11_5_1_drop_old_cost_tables` | Canonical / order-sensitive | Drops OLD-model tables |
| `0036_slice_11_step_4_pdf_layout` | Canonical / expected compatible | PDF layout fields |
| `0037_slice_12_step_2_quote_status_complete` | Canonical / order-sensitive | Quote enum/status transition |
| `0038_slice_12_step_3_schema` | Canonical / expected compatible | Slice 12 columns/tables/constraints |
| `0039_slice_12_step_5a_quote_snapshots` | Canonical / expected compatible | Snapshot table |
| `0040_slice_12_step_7b_pending_hubspot_from_stage` | Canonical / expected compatible | Pending stage field |
| `0041_slice_12_step_7b_pending_hubspot_from_stage_version` | Canonical / expected compatible | Version-scoped pending field |
| `0042_slice_12_step_8a_customer_response_channel` | Canonical / expected compatible | Acceptance channel |
| `0043_slice_12_step_8c1_netsuite_item_groups` | Canonical / expected compatible | Item-group cache |
| `0044_slice_12_step_8c2_hubspot_deals_cache_ext` | Canonical / expected compatible | Deal-cache SO fields |
| `0045_slice_12_step_8c3_schema` | Canonical / expected compatible | SO push ledger/mirrors |
| `0046_slice_12_step_10_reconcile_and_fk` | Canonical / order-sensitive | Reconciliation plus accepted-tier FK |

## Manual Migrations and Operational SQL

| File | Classification | Local treatment |
|---|---|---|
| `manual/0001_supabase_realtime_publication.sql` | Supabase-specific | Exclude |
| `manual/0002_supabase_realtime_r6_2_freight.sql` | Supabase-specific | Exclude |
| `manual/0003_supabase_realtime_drop_freight_inputs.sql` | Supabase-specific | Exclude |
| `manual/0017_warnings_realtime_publication.sql` | Supabase-specific | Exclude |
| `manual/0018_realtime_publication_add_new_slice_11_5_1.sql` | Supabase-specific | Exclude |
| `manual/0019_realtime_publication_drop_old_slice_11_5_1.sql` | Supabase-specific | Exclude |
| `manual/0020_slice_11_5_1_archive_old_tables.sql` | Manual archive/data operation | Exclude from schema bootstrap |
| `manual/0030_phase_a1_v2_impl2_smoke_fixtures.sql` | Historical fixture data | Exclude |
| `manual/0030_phase_a1_v2_seed.sql` | Historical seed data | Exclude |
| `manual/0031_phase_a1_v2_impl3_smoke_fixtures.sql` | Historical fixture data | Exclude |
| `manual/0032_pp_sp_field_schema_seed.sql` | Manual schema/seed operation | Exclude pending separate compatibility review |
| `manual/0033_impl3_smoke_revert.sql` | Historical fixture rollback | Exclude |
| `manual/0034_canonical_scenario_create_storage.sql` | Supabase Storage/Auth-specific | Exclude |
| `manual/0035_canonical_scenario_create_backfill.sql` | Manual production backfill | Exclude from empty isolated fixture DB |

## Required Execution Evidence

- Docker image ID and PostgreSQL version
- Empty-volume identifier
- Full Drizzle migration log
- Migration count
- `pg_trgm` presence
- `quotes.netsuite_so_tranid` presence
- `netsuite_so_pushes.accepted_tier_id` FK presence
- fresh-volume second-run result
- deterministic teardown result

## Known Blocker

The Docker daemon must be started and the PostgreSQL image made available. Image acquisition is infrastructure setup, not an application test, but it requires explicit network availability if the image is not already cached. No compatibility PASS is permitted until the image and empty-database run are available.

