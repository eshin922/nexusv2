-- Product Structure Slice 1 / Migration B (DRAFT — intentionally absent
-- from drizzle/meta/_journal.json until the production review gate opens).
--
-- The migration is one transaction under Drizzle. It takes a transaction-
-- scoped advisory lock and table locks so no legacy membership writer can
-- cross the classification/mutation boundary. The release procedure still
-- requires the governed external Product Structure write pause.

BEGIN;
--> statement-breakpoint
SET LOCAL nexus.product_structure_write_bypass = 'migration-0049';
--> statement-breakpoint
CREATE TEMP TABLE slice1_backfill_timing (
  started_at timestamptz NOT NULL,
  locks_acquired_at timestamptz
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO slice1_backfill_timing VALUES (clock_timestamp(), NULL);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS product_structure_migration;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_structure_migration.slice1_backfill_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  source_count integer NOT NULL,
  expected_reused_count integer NOT NULL,
  expected_created_count integer NOT NULL,
  maximum_row_ceiling integer NOT NULL,
  preflight_counts jsonb NOT NULL,
  lock_wait_ms numeric NOT NULL,
  CHECK (source_count >= 0),
  CHECK (expected_reused_count >= 0),
  CHECK (expected_created_count >= 0),
  CHECK (source_count = expected_reused_count + expected_created_count)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_structure_migration.slice1_backfill_manifest (
  run_id uuid NOT NULL REFERENCES product_structure_migration.slice1_backfill_runs(id),
  assembly_leaf_id uuid NOT NULL,
  quote_leaf_id uuid NOT NULL,
  action_classification text NOT NULL CHECK (action_classification IN ('reused', 'created')),
  original_canonical_row_existed boolean NOT NULL,
  quote_id uuid NOT NULL,
  assembly_id uuid NOT NULL,
  leaf_id uuid NOT NULL,
  quantity numeric NOT NULL,
  position integer NOT NULL,
  original_created_at timestamptz NOT NULL,
  original_leaf_spec_version_id uuid,
  original_pinned_at timestamptz,
  specification_pin_preservation_status text NOT NULL CHECK (
    specification_pin_preservation_status IN ('preserved', 'not_present', 'not_applicable')
  ),
  PRIMARY KEY (run_id, assembly_leaf_id),
  UNIQUE (run_id, quote_leaf_id)
);
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-backfill', 0));
--> statement-breakpoint
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
UPDATE slice1_backfill_timing SET locks_acquired_at = clock_timestamp();
--> statement-breakpoint
CREATE TEMP TABLE slice1_backfill_classification ON COMMIT DROP AS
WITH legacy_candidates AS (
  SELECT
    al.id AS assembly_leaf_id,
    a.quote_id,
    al.assembly_id,
    al.leaf_id,
    al.quantity,
    al.position,
    al.created_at,
    al.parent_assembly_leaf_id,
    al.quote_leaf_id AS mapped_quote_leaf_id,
    (a.id IS NOT NULL AND q.id IS NOT NULL AND l.id IS NOT NULL) AS refs_valid,
    count(ql.id) AS candidate_count,
    (min(ql.id::text) FILTER (WHERE ql.id IS NOT NULL))::uuid AS candidate_id,
    min(ql.quantity) FILTER (WHERE ql.id IS NOT NULL) AS candidate_quantity,
    min(ql.position) FILTER (WHERE ql.id IS NOT NULL) AS candidate_position
  FROM assembly_leaves al
  LEFT JOIN assemblies a ON a.id = al.assembly_id
  LEFT JOIN quotes q ON q.id = a.quote_id
  LEFT JOIN leaves l ON l.id = al.leaf_id
  LEFT JOIN quote_leaves ql
    ON ql.quote_id = a.quote_id
   AND ql.assembly_id = al.assembly_id
   AND ql.leaf_id = al.leaf_id
  GROUP BY al.id, a.id, a.quote_id, q.id, l.id
), legacy_classified AS (
  SELECT
    assembly_leaf_id,
    CASE
      WHEN parent_assembly_leaf_id IS NOT NULL THEN 'nested_legacy_membership'
      WHEN quote_id IS NULL OR NOT refs_valid THEN 'invalid_required_reference'
      WHEN candidate_count > 1 THEN 'duplicate_canonical_candidates'
      WHEN candidate_count = 0 AND mapped_quote_leaf_id IS NOT NULL THEN 'invalid_required_reference'
      WHEN candidate_count = 0 THEN 'missing_canonical_row'
      WHEN mapped_quote_leaf_id IS NOT NULL AND mapped_quote_leaf_id <> candidate_id
        THEN 'invalid_required_reference'
      WHEN quantity IS DISTINCT FROM candidate_quantity
        OR position IS DISTINCT FROM candidate_position THEN 'value_conflict'
      ELSE 'exact_existing_match'
    END AS classification
  FROM legacy_candidates
), canonical_classified AS (
  SELECT
    NULL::uuid AS assembly_leaf_id,
    CASE
      WHEN a.id IS NULL OR q.id IS NULL OR l.id IS NULL THEN 'invalid_required_reference'
      WHEN a.quote_id <> ql.quote_id THEN 'cross_quote_product_reference'
      ELSE 'orphan_canonical_grouped_row'
    END AS classification
  FROM quote_leaves ql
  LEFT JOIN assemblies a ON a.id = ql.assembly_id
  LEFT JOIN quotes q ON q.id = ql.quote_id
  LEFT JOIN leaves l ON l.id = ql.leaf_id
  WHERE ql.assembly_id IS NOT NULL
    AND (
      a.id IS NULL OR q.id IS NULL OR l.id IS NULL
      OR a.quote_id <> ql.quote_id
      OR NOT EXISTS (
        SELECT 1 FROM assembly_leaves al
        WHERE al.parent_assembly_leaf_id IS NULL
          AND al.assembly_id = ql.assembly_id
          AND al.leaf_id = ql.leaf_id
      )
    )
)
SELECT * FROM legacy_classified
UNION ALL
SELECT * FROM canonical_classified;
--> statement-breakpoint
DO $$
DECLARE
  source_count bigint;
  blocker_count bigint;
  approved_maximum_row_ceiling constant integer := 250;
BEGIN
  SELECT count(*) INTO source_count FROM assembly_leaves;
  IF source_count > approved_maximum_row_ceiling THEN
    RAISE EXCEPTION 'Slice 1 Backfill exceeds approved maximum-row ceiling: % > %',
      source_count, approved_maximum_row_ceiling;
  END IF;

  SELECT count(*) INTO blocker_count
  FROM slice1_backfill_classification
  WHERE classification IN (
    'value_conflict',
    'duplicate_canonical_candidates',
    'orphan_canonical_grouped_row',
    'cross_quote_product_reference',
    'nested_legacy_membership',
    'invalid_required_reference'
  );
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'Slice 1 Backfill blocked by % category 3-8 rows', blocker_count;
  END IF;
END $$;
--> statement-breakpoint
CREATE TEMP TABLE slice1_backfill_stage ON COMMIT DROP AS
WITH eligible AS (
  SELECT
    al.id AS assembly_leaf_id,
    a.quote_id,
    al.assembly_id,
    al.leaf_id,
    al.quantity,
    al.position,
    al.created_at,
    ql.id AS existing_quote_leaf_id,
    ql.leaf_spec_version_id,
    ql.pinned_at
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  LEFT JOIN quote_leaves ql
    ON ql.quote_id = a.quote_id
   AND ql.assembly_id = al.assembly_id
   AND ql.leaf_id = al.leaf_id
  WHERE al.parent_assembly_leaf_id IS NULL
    AND al.quote_leaf_id IS NULL
), prior_created_mapping AS (
  SELECT DISTINCT ON (m.assembly_leaf_id)
    m.assembly_leaf_id,
    m.quote_leaf_id,
    m.quote_id,
    m.assembly_id,
    m.leaf_id,
    m.quantity,
    m.position,
    m.original_created_at
  FROM product_structure_migration.slice1_backfill_manifest m
  JOIN product_structure_migration.slice1_backfill_runs r ON r.id = m.run_id
  WHERE m.action_classification = 'created'
    AND r.rolled_back_at IS NOT NULL
  ORDER BY m.assembly_leaf_id, r.started_at DESC
)
SELECT
  e.*,
  COALESCE(e.existing_quote_leaf_id, p.quote_leaf_id, gen_random_uuid()) AS final_quote_leaf_id,
  CASE WHEN e.existing_quote_leaf_id IS NULL THEN 'created' ELSE 'reused' END AS action_classification
FROM eligible e
LEFT JOIN prior_created_mapping p
  ON p.assembly_leaf_id = e.assembly_leaf_id
 AND p.quote_id = e.quote_id
 AND p.assembly_id = e.assembly_id
 AND p.leaf_id = e.leaf_id
 AND p.quantity = e.quantity
 AND p.position = e.position
 AND p.original_created_at = e.created_at;
--> statement-breakpoint
CREATE TEMP TABLE slice1_backfill_run (run_id uuid PRIMARY KEY) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO slice1_backfill_run VALUES (gen_random_uuid());
--> statement-breakpoint
INSERT INTO product_structure_migration.slice1_backfill_runs (
  id, source_count, expected_reused_count, expected_created_count,
  maximum_row_ceiling, preflight_counts, lock_wait_ms
)
SELECT
  r.run_id,
  (SELECT count(*)::integer FROM slice1_backfill_stage),
  (SELECT count(*)::integer FROM slice1_backfill_stage WHERE action_classification = 'reused'),
  (SELECT count(*)::integer FROM slice1_backfill_stage WHERE action_classification = 'created'),
  250,
  (
    SELECT jsonb_object_agg(names.classification, COALESCE(counts.row_count, 0))
    FROM (VALUES
      ('missing_canonical_row'), ('exact_existing_match'), ('value_conflict'),
      ('duplicate_canonical_candidates'), ('orphan_canonical_grouped_row'),
      ('cross_quote_product_reference'), ('nested_legacy_membership'),
      ('invalid_required_reference')
    ) names(classification)
    LEFT JOIN (
      SELECT classification, count(*) AS row_count
      FROM slice1_backfill_classification GROUP BY classification
    ) counts USING (classification)
  ),
  (SELECT extract(epoch FROM (locks_acquired_at - started_at)) * 1000
   FROM slice1_backfill_timing)
FROM slice1_backfill_run r;
--> statement-breakpoint
INSERT INTO product_structure_migration.slice1_backfill_manifest (
  run_id, assembly_leaf_id, quote_leaf_id, action_classification,
  original_canonical_row_existed, quote_id, assembly_id, leaf_id, quantity,
  position, original_created_at, original_leaf_spec_version_id,
  original_pinned_at, specification_pin_preservation_status
)
SELECT
  r.run_id, s.assembly_leaf_id, s.final_quote_leaf_id,
  s.action_classification, s.existing_quote_leaf_id IS NOT NULL,
  s.quote_id, s.assembly_id, s.leaf_id, s.quantity, s.position, s.created_at,
  s.leaf_spec_version_id, s.pinned_at,
  CASE
    WHEN s.action_classification = 'created' THEN 'not_applicable'
    WHEN s.leaf_spec_version_id IS NULL AND s.pinned_at IS NULL THEN 'not_present'
    ELSE 'preserved'
  END
FROM slice1_backfill_run r CROSS JOIN slice1_backfill_stage s;
--> statement-breakpoint
INSERT INTO quote_leaves (
  id, quote_id, assembly_id, leaf_id, leaf_spec_version_id, pinned_at,
  quantity, position, created_at
)
SELECT
  final_quote_leaf_id, quote_id, assembly_id, leaf_id, NULL, NULL,
  quantity, position, created_at
FROM slice1_backfill_stage
WHERE action_classification = 'created';
--> statement-breakpoint
UPDATE assembly_leaves al
SET quote_leaf_id = s.final_quote_leaf_id
FROM slice1_backfill_stage s
WHERE al.id = s.assembly_leaf_id
  AND al.quote_leaf_id IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  violation_count bigint;
  pin_violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  LEFT JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
  LEFT JOIN product_structure_migration.slice1_backfill_manifest m
    ON m.assembly_leaf_id = al.id
   AND m.run_id = (SELECT run_id FROM slice1_backfill_run)
  WHERE al.parent_assembly_leaf_id IS NULL
    AND (
      ql.id IS NULL OR ql.quote_id <> a.quote_id
      OR ql.assembly_id IS DISTINCT FROM al.assembly_id
      OR ql.leaf_id <> al.leaf_id
      OR ql.quantity IS DISTINCT FROM al.quantity
      OR ql.position IS DISTINCT FROM al.position
      OR (m.action_classification = 'created' AND ql.created_at IS DISTINCT FROM al.created_at)
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Slice 1 Backfill postcondition failed for % rows', violation_count;
  END IF;

  SELECT count(*) INTO pin_violation_count
  FROM product_structure_migration.slice1_backfill_manifest m
  JOIN slice1_backfill_run r ON r.run_id = m.run_id
  JOIN quote_leaves ql ON ql.id = m.quote_leaf_id
  WHERE m.action_classification = 'reused'
    AND (ql.leaf_spec_version_id IS DISTINCT FROM m.original_leaf_spec_version_id
      OR ql.pinned_at IS DISTINCT FROM m.original_pinned_at);
  IF pin_violation_count <> 0 THEN
    RAISE EXCEPTION 'Slice 1 Backfill changed % reused specification pins', pin_violation_count;
  END IF;
END $$;
--> statement-breakpoint
UPDATE product_structure_migration.slice1_backfill_runs r
SET completed_at = clock_timestamp()
FROM slice1_backfill_run current_run
WHERE r.id = current_run.run_id;
--> statement-breakpoint
COMMIT;
