-- Slice 8.5 — Add the 8 quote-affecting tables to the supabase_realtime
-- publication so postgres_changes events fire for browser-side
-- subscriptions.
--
-- Per-environment, applied manually. NOT picked up by drizzle-kit
-- migrate. Run against dev once, prod once before deploy.
--
-- Idempotent? No — ADD TABLE on a table already in the publication
-- raises a duplicate error. If re-running for any reason, comment
-- out lines that already applied, or drop + re-add the publication
-- (heavy-handed, only if the publication is in a known-bad state).
--
-- Verify with: scripts/verify/realtime-readiness.ts

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.quote_skus,
  public.quote_tiers,
  public.packaging_inputs,
  public.production_inputs,
  public.freight_inputs,
  public.quotes,
  public.firm_settings,
  public.markup_defaults;
