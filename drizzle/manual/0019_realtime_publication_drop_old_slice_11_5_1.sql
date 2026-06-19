-- Slice 11.5.1 Step 4a (part 2) — Realtime publication DROP OLD tables.
--
-- Drops the OLD-model cost-data tables from the supabase_realtime
-- publication. **Must run BEFORE the drizzle DROP TABLE migration**
-- — Postgres rejects `DROP TABLE` while a table is in a publication.
--
-- **Sequencing (per Slice 11.5.1 brief §2 A2):**
-- 1. `0018_realtime_publication_add_new_slice_11_5_1.sql` — already
--    applied (NEW tables in publication, no subscribers yet).
-- 2. Code change merged + deployed — subscribers point at NEW tables.
-- 3. This file — DROP OLD-table membership.
-- 4. `0020_slice_11_5_1_archive_old_tables.sql` — archive snapshot
--    BEFORE drop.
-- 5. drizzle-kit migrate — physical `DROP TABLE` on OLD schema.
--
-- Note: `quote_sku_tiers` + `quote_sku_tier_targets` are NOT in this
-- DROP because they were never added to the publication (Slice 8.5
-- only subscribed to packaging/production/skus directly; the sparse
-- override + target tables relied on the quotes.updated_at coalesce
-- pattern). They cascade-drop with `quote_skus` in the drizzle
-- migration; no separate publication step needed.

ALTER PUBLICATION supabase_realtime DROP TABLE
  public.quote_skus,
  public.packaging_inputs,
  public.production_inputs;
