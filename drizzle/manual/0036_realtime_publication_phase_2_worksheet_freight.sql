-- PR-F — Realtime publication ADD for the Phase 2 worksheet Freight tables.
--
-- Adds the seven live worksheet tables created by drizzle migration
-- `0054_phase_2_worksheet_freight_expand.sql` to the supabase_realtime
-- publication, so postgres_changes events fire for the browser-side
-- subscriptions added in `costing-store-provider.tsx` (third channel,
-- `quote:<id>:freight-worksheet`).
--
-- Per-environment, applied manually. NOT picked up by drizzle-kit
-- migrate.
--
-- **Release position** (docs/release/PR-D-CONSTRUCTION-BRIEF.md):
--
--   PR-E → apply 0054-0055 → deploy worksheet code → verify
--   PR-F → apply 0036      → deploy realtime code  → Stage 4   ← this file
--   PR-G → apply 0056      → only after Stage 4 + operator validation
--
-- **Sequencing.** Apply this file FIRST, then deploy the PR-F code.
-- Both orders are safe, and neither can lose operator data:
--   - Publication before code: events fire with no subscriber. Nothing
--     listens; nothing breaks.
--   - Code before publication: subscriptions bind to tables that
--     publish nothing. Silent no-op — the worksheet simply keeps
--     behaving as it does under PR-E (RSC-prop authority, refreshed on
--     navigation), with no cross-tab propagation until this lands.
-- The failure mode of getting it wrong is a missing feature, not a
-- corrupted one.
--
-- **Why `quote_snapshot_freight_workbooks` is NOT included.** That
-- table (drizzle `0055`) is written once at send time and is frozen
-- thereafter under the Pattern 52 draft-lock invariant. Nothing edits
-- it live, so there is no cross-tab state to propagate. Adding it would
-- spend one of the ten per-channel binding slots on a table that can
-- never fire a meaningful event.
--
-- **Binding budget.** Supabase Realtime silently caps a channel at 10
-- postgres_changes bindings (banked in CLAUDE.md from the Slice 11.5.1
-- MIG-8 hotfix; the 11th+ binding kills the whole channel with no
-- error). These seven tables are therefore carried on their own third
-- channel rather than appended to an existing one:
--
--   quote:<id>:cost               6 bindings
--   quote:<id>:structure          7 bindings
--   quote:<id>:freight-worksheet  7 bindings   ← added by PR-F
--
-- **RLS.** All seven tables ship RLS-disabled, matching every other
-- table in the publication. Verified at authoring time via
-- pg_class.relrowsecurity. If RLS is ever enabled on any of them, the
-- anon-key browser client stops receiving their events silently and a
-- Clerk-Supabase JWT bridge becomes a prerequisite. See CLAUDE.md
-- "RLS-off latent dependency".
--
-- Verify with: scripts/verify/realtime-readiness.ts
--
-- Idempotent? No — re-running raises a duplicate error if any listed
-- table is already in the publication. If re-running for any reason,
-- comment out the lines that already applied.

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.freight_subcategories,
  public.freight_subcategory_items,
  public.freight_destinations,
  public.freight_destination_breaks,
  public.freight_customs_entries,
  public.freight_customs_breaks,
  public.freight_destination_tracking;
