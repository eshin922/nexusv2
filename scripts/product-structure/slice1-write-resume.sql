-- Run only after compatibility runtime deployment, reconciliation, and
-- mixed-version retirement are proven. Removing the guard reopens writes.

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-backfill', 0));
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER IF EXISTS slice1_write_pause ON assembly_leaves;
DROP TRIGGER IF EXISTS slice1_write_pause ON quote_leaves;
DROP FUNCTION IF EXISTS product_structure_migration.reject_structure_write();
COMMIT;
