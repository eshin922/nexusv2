-- Leaf-detach micro-slice Sub-item 3 follow-up (May 2026):
-- Add is_auto_migrate_artifact flag to quote_skus.
--
-- Marks SKUs created by `convertLeafToAssemblyWithMigrate` (the
-- auto-named -CMP children that hold reparented cost data after a
-- leaf → assembly conversion). Two consumers:
--
-- 1. UI: sku-row.tsx disables the Type badge for these rows so PMs
--    can't re-toggle them, which previously created nested
--    -CMP-CMP-... chains (Edward smoke 2026-05-14).
-- 2. Slice 12 Mark-Accepted writeback: filters these rows when
--    pushing to HubSpot/NetSuite — they're internal artifacts, not
--    catalog products.
--
-- Existing rows (pre-slice) default to false. Backward-compatible.

ALTER TABLE "quote_skus"
  ADD COLUMN "is_auto_migrate_artifact" boolean NOT NULL DEFAULT false;
