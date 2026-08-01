-- Rehearsal/operator-approved rollback for one Slice 1 Backfill run.
-- psql must supply: -v run_id='<uuid>'
-- Selection uncertainty fails closed and leaves additive rows in place.

BEGIN;
SET LOCAL nexus.product_structure_write_bypass = 'migration-0049';
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-backfill', 0));
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE slice1_rollback_run (run_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO slice1_rollback_run VALUES (:'run_id'::uuid);

DO $$
DECLARE
  selected_run uuid := (SELECT run_id FROM slice1_rollback_run);
  expected_count bigint;
  verified_count bigint;
BEGIN
  SELECT source_count INTO expected_count
  FROM product_structure_migration.slice1_backfill_runs
  WHERE id = selected_run AND completed_at IS NOT NULL AND rolled_back_at IS NULL;
  IF expected_count IS NULL THEN
    RAISE EXCEPTION 'Backfill run is absent, incomplete, or already rolled back';
  END IF;

  SELECT count(*) INTO verified_count
  FROM product_structure_migration.slice1_backfill_manifest m
  JOIN assembly_leaves al ON al.id = m.assembly_leaf_id
  JOIN assemblies a ON a.id = al.assembly_id
  JOIN quote_leaves ql ON ql.id = m.quote_leaf_id
  WHERE m.run_id = selected_run
    AND al.quote_leaf_id = m.quote_leaf_id
    AND a.quote_id = m.quote_id
    AND al.assembly_id = m.assembly_id
    AND al.leaf_id = m.leaf_id
    AND al.quantity = m.quantity
    AND al.position = m.position
    AND al.created_at = m.original_created_at
    AND ql.quote_id = m.quote_id
    AND ql.assembly_id = m.assembly_id
    AND ql.leaf_id = m.leaf_id
    AND ql.quantity = m.quantity
    AND ql.position = m.position
    AND (
      (m.action_classification = 'created' AND ql.created_at = m.original_created_at)
      OR (ql.leaf_spec_version_id IS NOT DISTINCT FROM m.original_leaf_spec_version_id
        AND ql.pinned_at IS NOT DISTINCT FROM m.original_pinned_at)
    );
  IF verified_count <> expected_count THEN
    RAISE EXCEPTION 'Rollback selection uncertain: verified % of % rows', verified_count, expected_count;
  END IF;
END $$;

UPDATE assembly_leaves al SET quote_leaf_id = NULL
FROM product_structure_migration.slice1_backfill_manifest m
WHERE m.run_id = (SELECT run_id FROM slice1_rollback_run) AND al.id = m.assembly_leaf_id;

DELETE FROM quote_leaves ql
USING product_structure_migration.slice1_backfill_manifest m
WHERE m.run_id = (SELECT run_id FROM slice1_rollback_run)
  AND m.action_classification = 'created'
  AND NOT m.original_canonical_row_existed
  AND ql.id = m.quote_leaf_id;

UPDATE product_structure_migration.slice1_backfill_runs
SET rolled_back_at = clock_timestamp()
WHERE id = (SELECT run_id FROM slice1_rollback_run);
COMMIT;
