-- Slice 12 Step 7b fix-pass (CA review Item #2) — switch runtime
-- stage key in firm_settings from label to internal stage id.
--
-- Rationale (CA verdict):
--   > Labels are editable in the HubSpot UI — a rename silently
--   > breaks a live accept path, and unknown-label rejection
--   > becomes a hard block.
--   > Store stage ID in firm_settings.hubspot_deal_stage_on_accept.
--   > Keep label as display + validation only.
--   > Resolve-by-label is correct for the migration; wrong as the
--   > runtime key.
--
-- Migration 0036 (earlier this PR) fixed the value to match the
-- real pipeline LABEL. This migration switches to the internal ID
-- (the stable key that survives label renames in the HubSpot UI).
--
-- `updateDealStage` helper already handles both label and id inputs
-- (detects id-shape via /^\d+$/ regex), so no code change needed;
-- only the stored config value flips.
--
-- Idempotent: only updates the active row when its current value
-- matches the intermediate label 'Won - In production'. Won't
-- clobber a value that's already an id or has been changed elsewhere.
--
-- Applied 2026-07-28 alongside Step 7b fix pass.

UPDATE firm_settings
SET hubspot_deal_stage_on_accept = '195607084'
WHERE effective_until IS NULL
  AND hubspot_deal_stage_on_accept = 'Won - In production';
