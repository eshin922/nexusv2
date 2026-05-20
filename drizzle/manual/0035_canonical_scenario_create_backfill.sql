-- canonical-scenario-create-flow — first-scenario-per-project
-- backfill for `quotes.is_recommended`
--
-- Pairs with drizzle/0031_canonical_scenario_create_schema.sql
-- (DDL) + drizzle/manual/0034_canonical_scenario_create_storage.sql
-- (Storage). Apply AFTER both.
--
-- Per CA Q4 disposition: mark the first scenario (earliest
-- `created_at`) per project as `is_recommended = true`. Steady
-- state: exactly one recommended row per project; future scenario
-- creates that flip the flag will atomically unset siblings via
-- the setScenarioRecommended action (impl Step 4).
--
-- DISTINCT ON (project_id) with ORDER BY (project_id, created_at
-- asc) deterministically picks the earliest row per project. The
-- partial unique index on (project_id) WHERE is_recommended = true
-- is satisfied because exactly one row per project flips to TRUE.
--
-- Idempotent: re-running is safe because no row currently has
-- is_recommended = true (pre-backfill state); after backfill,
-- re-running would find the same first row per project and
-- attempt to set it to true again (no-op + no unique-constraint
-- violation since it's already the only true row).

begin;

with first_per_project as (
  select distinct on (project_id) id
    from quotes
   order by project_id, created_at asc
)
update quotes
   set is_recommended = true,
       updated_at = now()
 where id in (select id from first_per_project)
   and is_recommended = false;  -- guard: don't re-update already-true rows

commit;
