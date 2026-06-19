-- Slice 11.5.1 Step 4c — Archive snapshot of OLD-model tables.
--
-- Creates `_archive_*` snapshot tables capturing the full state of
-- the 5 OLD-model cost-data tables before the drizzle migration
-- drops them. Per Slice 11.5.1 brief §C4 (CA-banked safety net):
-- 5 minutes of work for queryable insurance vs. PITR ceremony if
-- anything surfaces Week 1 requiring OLD data.
--
-- **Sequencing (per Slice 11.5.1 brief §2 A2):**
-- 1-3. Publication migration (manual SQL files 0018 + 0019).
-- 4. **This file** — archive snapshots.
-- 5. drizzle-kit migrate — physical `DROP TABLE` on OLD schema.
--
-- **30-day cleanup:** UX_BACKLOG calendar-anchored follow-up drops
-- the `_archive_*` tables on 2026-07-19 (30 days post-Slice-11.5.1
-- merge). Single DROP TABLE × 5 migration; ~10-line schema cleanup
-- PR.
--
-- Per-environment, applied manually. NOT picked up by drizzle-kit
-- migrate.

CREATE TABLE _archive_quote_skus AS SELECT * FROM quote_skus;
CREATE TABLE _archive_packaging_inputs AS SELECT * FROM packaging_inputs;
CREATE TABLE _archive_production_inputs AS SELECT * FROM production_inputs;
CREATE TABLE _archive_quote_sku_tiers AS SELECT * FROM quote_sku_tiers;
CREATE TABLE _archive_quote_sku_tier_targets AS SELECT * FROM quote_sku_tier_targets;
