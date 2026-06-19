-- Slice 11.5.1 Step 4a (part 1) — Realtime publication ADD NEW tables.
--
-- Adds the NEW-model cost-data tables (Slice 11.5 Step 2 schema + the
-- two sparse-row override + target tables that Slice 8.5 originally
-- omitted) to the supabase_realtime publication so postgres_changes
-- events fire for browser-side subscriptions.
--
-- Per-environment, applied manually. NOT picked up by drizzle-kit
-- migrate.
--
-- **Sequencing (per Slice 11.5.1 brief §2 A2):**
-- 1. Apply this file (ADD NEW) FIRST — idempotent in the sense that
--    subscribers don't exist yet for these tables; no consumer to
--    confuse during transition.
-- 2. Merge + deploy code change updating
--    `costing-store-provider.tsx` subscription targets to NEW tables.
-- 3. Apply `0019_realtime_publication_drop_old_slice_11_5_1.sql`
--    (DROP OLD) — only safe after subscribers have stopped using
--    OLD tables.
-- 4. Apply `0020_slice_11_5_1_archive_old_tables.sql` (archive
--    snapshot) + drizzle migration `DROP TABLE` (publication must
--    be cleared first; can't `DROP TABLE` while in publication).
--
-- **Bonus catch (banked in Slice 11.5.1 §A2):**
-- `assembly_leaf_overrides` + `assembly_leaf_targets` realtime
-- subscriptions never existed in OLD model (Slice 8.5 omitted the
-- sparse sister tables). Slice 11.5.1 brings per-cell sell-price
-- override + client-target cross-tab propagation online for the
-- first time.
--
-- Verify with: scripts/verify/realtime-readiness.ts
--
-- Idempotent? No — re-running raises a duplicate error if any
-- listed table is already in the publication. If re-running for
-- any reason, comment out lines that already applied.

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.assemblies,
  public.assembly_leaves,
  public.assembly_leaf_inputs,
  public.assembly_production_inputs,
  public.assembly_leaf_overrides,
  public.assembly_leaf_targets,
  public.quote_leaves;
