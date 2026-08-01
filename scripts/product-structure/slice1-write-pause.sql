-- Production-window database enforcement. Install before final preflight.
-- Existing writer transactions drain before the trigger installation commits.
-- Only the governed 0049/rollback session-local bypass may write.

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-backfill', 0));
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA IF NOT EXISTS product_structure_migration;
CREATE OR REPLACE FUNCTION product_structure_migration.reject_structure_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('nexus.product_structure_write_bypass', true)
      IS DISTINCT FROM 'migration-0049' THEN
    RAISE EXCEPTION 'Product Structure writes are paused for Slice 1 Backfill';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS slice1_write_pause ON assembly_leaves;
CREATE TRIGGER slice1_write_pause
BEFORE INSERT OR UPDATE OR DELETE ON assembly_leaves
FOR EACH ROW EXECUTE FUNCTION product_structure_migration.reject_structure_write();
DROP TRIGGER IF EXISTS slice1_write_pause ON quote_leaves;
CREATE TRIGGER slice1_write_pause
BEFORE INSERT OR UPDATE OR DELETE ON quote_leaves
FOR EACH ROW EXECUTE FUNCTION product_structure_migration.reject_structure_write();
COMMIT;
