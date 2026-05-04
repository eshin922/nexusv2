-- Slice 9.5 — Add quote_warnings to the supabase_realtime publication
-- so postgres_changes events fire for browser-side subscriptions.
--
-- Per CLAUDE.md "Realtime ↔ optimistic store contract (Slice 8.5)":
-- the realtime sync is the rope. quote_warnings extends the rope —
-- when one PM accepts/fixes, other PMs viewing the same quote see
-- the warning state update via the same coalesce + reconcile pipe.
--
-- Per CLAUDE.md "Single Supabase project — dev and prod share one DB":
-- this ALTER applies to BOTH dev and prod simultaneously. Idempotent
-- check via existing realtime-readiness verification script.
--
-- RLS posture: quote_warnings stays RLS-off matching the other
-- subscribed tables. If RLS is later turned on, browser anon-key
-- subscriptions silently stop receiving events for this table.
-- Diagnose via scripts/verify/realtime-readiness.ts.
--
-- Mutation volume awareness (per architect Q-F): persistence runs on
-- action commit only (not per keystroke). 250ms+800ms Slice 8.5
-- coalesce window remains adequate for this trigger frequency. If
-- real PM use surfaces churn issues, revisit.
--
-- Verify with: scripts/verify/realtime-readiness.ts (after applying
-- this script — verify script extended in same commit to include
-- quote_warnings).

ALTER PUBLICATION supabase_realtime ADD TABLE
  public.quote_warnings;
