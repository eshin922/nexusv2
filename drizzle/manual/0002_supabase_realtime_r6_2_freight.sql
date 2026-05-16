-- Slice R6.2 commit 2 — add the four new freight model tables to the
-- supabase_realtime publication so the costing-store provider's
-- postgres_changes subscriptions fire on every freight edit.
--
-- The legacy `freight_inputs` row stays in the publication for now
-- (table still exists post-additive-commit; cleanup migration drops
-- it in a follow-up). Removing `freight_inputs` from the publication
-- before the table is dropped would silently break any pre-cutover
-- code still listening to it — not worth the risk.
--
-- Per-environment, applied manually (per Slice 8.5 0001 precedent).
-- NOT picked up by drizzle-kit migrate.
--
-- Idempotent? No — ADD TABLE on a table already in the publication
-- raises a duplicate error. Comment out individual lines if any of
-- the four tables have already been added.
--
-- Verify with: scripts/verify/realtime-readiness.ts (extended in this
-- commit to include the four new tables).

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.freight_leg_groups,
  public.freight_legs,
  public.freight_leg_tiers,
  public.freight_customer_arranges_meta;
