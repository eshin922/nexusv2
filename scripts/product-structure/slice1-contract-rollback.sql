-- Slice 1 Contract rollback. Schema-only and data-preserving.
-- Runtime rollback to temporary compatibility tolerance occurs separately.

BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-contract', 0));
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE assembly_leaves ALTER COLUMN quote_leaf_id DROP NOT NULL;
COMMIT;
