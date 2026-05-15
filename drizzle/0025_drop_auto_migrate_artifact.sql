-- Leaf-detach micro-slice simplification (2026-05-14):
-- Smart-migrate auto-child machinery removed entirely per Edward
-- disposition. Replaced with destructive leaf → assembly conversion
-- (type "yes" to confirm; deletes cost rows; strips HubSpot link).
-- The is_auto_migrate_artifact column was added in 0024 to flag
-- auto-created -CMP children; with the refactor removing that
-- creation path, the column has no consumers.
--
-- Existing rows with isAutoMigrateArtifact=true (auto-children
-- from earlier smoke + the legacy 12345-CMP / 12345-CMP-CMP)
-- become regular SKU rows post-drop. They're Nexus-local leaves
-- without HubSpot links — banked as cleanup items per the
-- new constraint that every leaf must have a HubSpot link, but
-- they're not creating ongoing churn.

ALTER TABLE "quote_skus" DROP COLUMN "is_auto_migrate_artifact";
