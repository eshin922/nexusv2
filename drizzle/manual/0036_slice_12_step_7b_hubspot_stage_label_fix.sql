-- Slice 12 Step 7b — firm_settings.hubspot_deal_stage_on_accept
-- label fix.
--
-- The Step 3 schema defaulted this column to 'Closed Won' per v3
-- brief §4.6. Pre-implementation pipeline probe (Step 7b prep)
-- revealed the actual DPS Sales pipeline (id 108896657) has NO
-- stage with label "Closed Won" — the closest analog is
-- "Won - In production" (internal stage id 195607084).
--
-- Label-based lookup in the Step 7b updateDealStage helper won't
-- work until this row's value matches a real pipeline stage.
-- Applied same-PR as a manual migration (data-only, no DDL) so the
-- HubSpot integration ships against a working default.
--
-- Idempotent: only updates the active (non-superseded) row, and
-- only if the value is still the Step-3 default 'Closed Won'.
-- Re-runnable safely.
--
-- Bank: §0.5 catch — brief-vs-reality pipeline label mismatch.
-- Discovery pattern for future integration-work slice briefs:
-- probe the target external system's pipeline shape BEFORE
-- migrating config defaults. Update the CLAUDE.md ledger
-- alongside slice close.
--
-- Applied 2026-07-28 during Step 7b implementation.

UPDATE firm_settings
SET hubspot_deal_stage_on_accept = 'Won - In production'
WHERE effective_until IS NULL
  AND hubspot_deal_stage_on_accept = 'Closed Won';
