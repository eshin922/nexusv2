-- Canonical attachment repair.
--
-- WHY THIS EXISTS AND NOT 0049
-- ---------------------------------------------------------------------------
-- `drizzle/0049_product_structure_slice1_backfill.sql` was authored to do this
-- work and is correct, but it was deliberately withheld from
-- drizzle/meta/_journal.json pending a production review gate that never
-- opened. Meanwhile the runtime resolver that REQUIRES the canonical pointer
-- shipped anyway, so 129 of 137 assembly_leaves rows have no pointer and any
-- operator edit against them fails. See docs/costs-certification-handover.md
-- section 0.5 for the full archaeology.
--
-- 0049 is not journalled unchanged because it (a) carries its own
-- BEGIN/COMMIT, which conflicts with Drizzle's own transaction, (b) assumes a
-- governed external write pause that was never arranged, and (c) is followed
-- by 0050, which applies a NOT NULL constraint that must NOT ride along
-- implicitly. This migration takes 0049's authoritative classification logic
-- verbatim and drops everything else.
--
-- WHAT THIS DOES AND DOES NOT TOUCH
-- ---------------------------------------------------------------------------
-- This is structural identity repair. It creates missing `quote_leaves` rows
-- and links `assembly_leaves.quote_leaf_id`. It runs across draft, sent,
-- accepted and complete quotes, because a quote being frozen does not make a
-- broken identity pointer acceptable -- but that is permission to repair
-- identity, NOT to alter frozen commitments.
--
-- It does not write: quote status, accepted tier, quantities, prices, markups,
-- costs, freight terms, snapshots, or any customer-visible value. It does not
-- create or modify specification pins -- created rows get NULL
-- leaf_spec_version_id and NULL pinned_at, and 'reused' rows are not written
-- to at all, so existing pins are preserved by never being touched.
--
-- It does not apply 0050's NOT NULL constraint. Enforcement is a separate
-- decision that requires auditing every creation, cloning, revision and import
-- path first.
--
-- Commercial neutrality is proved, not asserted:
-- scripts/verify/canonical-repair-digest.mjs captures commercial, structural
-- and pointer digests per quote before and after. Commercial and structural
-- digests must be byte-identical; only the pointer digest may change.
--
-- IDEMPOTENCE
-- ---------------------------------------------------------------------------
-- Eligibility is `quote_leaf_id IS NULL`, and the UPDATE is guarded on the
-- same predicate, so a second run finds nothing to do and exits as a no-op.
-- The expected-count assertion only applies when there IS work to do.

CREATE SCHEMA IF NOT EXISTS product_structure_repair;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_structure_repair.canonical_attachment_repair_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  source_count integer NOT NULL,
  eligible_count integer NOT NULL,
  created_count integer NOT NULL,
  reused_count integer NOT NULL,
  before_counts jsonb NOT NULL,
  after_counts jsonb,
  quote_status_breakdown jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_structure_repair.canonical_attachment_repair_manifest (
  run_id uuid NOT NULL REFERENCES product_structure_repair.canonical_attachment_repair_runs(id),
  assembly_leaf_id uuid NOT NULL,
  quote_leaf_id uuid NOT NULL,
  action_classification text NOT NULL,
  quote_id uuid NOT NULL,
  quote_status text NOT NULL,
  assembly_id uuid NOT NULL,
  leaf_id uuid NOT NULL,
  quantity numeric NOT NULL,
  position integer NOT NULL,
  original_created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, assembly_leaf_id),
  UNIQUE (run_id, quote_leaf_id)
);
--> statement-breakpoint
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Classification, carried over verbatim from 0049. Categories 3-8 are
-- blockers: any one of them means the data is not in a shape this repair
-- understands, and guessing is worse than stopping.
CREATE TEMP TABLE repair_classification ON COMMIT DROP AS
WITH legacy_candidates AS (
  SELECT
    al.id AS assembly_leaf_id,
    a.quote_id,
    al.assembly_id,
    al.leaf_id,
    al.quantity,
    al.position,
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
CREATE TEMP TABLE repair_stage ON COMMIT DROP AS
SELECT
  al.id AS assembly_leaf_id,
  a.quote_id,
  q.status::text AS quote_status,
  al.assembly_id,
  al.leaf_id,
  al.quantity,
  al.position,
  al.created_at,
  ql.id AS existing_quote_leaf_id,
  COALESCE(ql.id, gen_random_uuid()) AS final_quote_leaf_id,
  CASE WHEN ql.id IS NULL THEN 'created' ELSE 'reused' END AS action_classification
FROM assembly_leaves al
JOIN assemblies a ON a.id = al.assembly_id
JOIN quotes q ON q.id = a.quote_id
LEFT JOIN quote_leaves ql
  ON ql.quote_id = a.quote_id
 AND ql.assembly_id = al.assembly_id
 AND ql.leaf_id = al.leaf_id
WHERE al.parent_assembly_leaf_id IS NULL
  AND al.quote_leaf_id IS NULL;
--> statement-breakpoint
CREATE TEMP TABLE repair_run (
  run_id uuid PRIMARY KEY,
  is_noop boolean NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
DO $$
DECLARE
  eligible_count bigint;
  created_count bigint;
  reused_count bigint;
  blocker_count bigint;
  ambiguous_count bigint;
  unresolved_count bigint;
BEGIN
  SELECT count(*) INTO eligible_count FROM repair_stage;
  SELECT count(*) INTO created_count FROM repair_stage WHERE action_classification = 'created';
  SELECT count(*) INTO reused_count  FROM repair_stage WHERE action_classification = 'reused';

  SELECT count(*) INTO ambiguous_count
  FROM repair_classification WHERE classification = 'duplicate_canonical_candidates';

  SELECT count(*) INTO unresolved_count
  FROM repair_classification WHERE classification = 'invalid_required_reference';

  SELECT count(*) INTO blocker_count
  FROM repair_classification
  WHERE classification IN (
    'value_conflict', 'duplicate_canonical_candidates', 'orphan_canonical_grouped_row',
    'cross_quote_product_reference', 'nested_legacy_membership', 'invalid_required_reference'
  );

  -- Rerun against already-repaired data: nothing eligible, nothing to assert.
  IF eligible_count = 0 THEN
    INSERT INTO repair_run VALUES (gen_random_uuid(), true);
    RAISE NOTICE 'Canonical attachment repair: no eligible rows, no-op.';
    RETURN;
  END IF;

  IF ambiguous_count <> 0 THEN
    RAISE EXCEPTION 'Canonical attachment repair aborted: % ambiguous mappings', ambiguous_count;
  END IF;
  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION 'Canonical attachment repair aborted: % unresolved mappings', unresolved_count;
  END IF;
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'Canonical attachment repair aborted: % blocked rows', blocker_count;
  END IF;
  IF created_count <> 120 OR reused_count <> 9 THEN
    RAISE EXCEPTION
      'Canonical attachment repair aborted: expected 120 created / 9 reused, found % / %',
      created_count, reused_count;
  END IF;

  INSERT INTO repair_run VALUES (gen_random_uuid(), false);
END $$;
--> statement-breakpoint
INSERT INTO product_structure_repair.canonical_attachment_repair_runs (
  id, source_count, eligible_count, created_count, reused_count,
  before_counts, quote_status_breakdown
)
SELECT
  r.run_id,
  (SELECT count(*)::integer FROM assembly_leaves),
  (SELECT count(*)::integer FROM repair_stage),
  (SELECT count(*)::integer FROM repair_stage WHERE action_classification = 'created'),
  (SELECT count(*)::integer FROM repair_stage WHERE action_classification = 'reused'),
  jsonb_build_object(
    'assembly_leaves_total', (SELECT count(*) FROM assembly_leaves),
    'assembly_leaves_orphaned', (SELECT count(*) FROM assembly_leaves WHERE quote_leaf_id IS NULL),
    'quote_leaves_total', (SELECT count(*) FROM quote_leaves)
  ),
  COALESCE((
    SELECT jsonb_object_agg(k, v) FROM (
      SELECT quote_status || ':' || action_classification AS k, count(*) AS v
      FROM repair_stage GROUP BY 1
    ) s
  ), '{}'::jsonb)
FROM repair_run r
WHERE NOT r.is_noop;
--> statement-breakpoint
INSERT INTO product_structure_repair.canonical_attachment_repair_manifest (
  run_id, assembly_leaf_id, quote_leaf_id, action_classification,
  quote_id, quote_status, assembly_id, leaf_id, quantity, position, original_created_at
)
SELECT
  r.run_id, s.assembly_leaf_id, s.final_quote_leaf_id, s.action_classification,
  s.quote_id, s.quote_status, s.assembly_id, s.leaf_id, s.quantity, s.position, s.created_at
FROM repair_run r CROSS JOIN repair_stage s
WHERE NOT r.is_noop;
--> statement-breakpoint
-- Created rows carry NO specification pin. 'reused' rows are absent from this
-- INSERT entirely, so their existing pins are preserved by never being written.
INSERT INTO quote_leaves (
  id, quote_id, assembly_id, leaf_id, leaf_spec_version_id, pinned_at,
  quantity, position, created_at
)
SELECT
  final_quote_leaf_id, quote_id, assembly_id, leaf_id, NULL, NULL,
  quantity, position, created_at
FROM repair_stage
WHERE action_classification = 'created';
--> statement-breakpoint
UPDATE assembly_leaves al
SET quote_leaf_id = s.final_quote_leaf_id
FROM repair_stage s
WHERE al.id = s.assembly_leaf_id
  AND al.quote_leaf_id IS NULL;
--> statement-breakpoint
-- Postcondition. Every root-level legacy row must now resolve to exactly one
-- canonical attachment whose identity matches it. This is the same assertion
-- the runtime resolver makes, run once over the whole table.
DO $$
DECLARE
  violation_count bigint;
  orphan_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  LEFT JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
  WHERE al.parent_assembly_leaf_id IS NULL
    AND (
      ql.id IS NULL
      OR ql.quote_id <> a.quote_id
      OR ql.assembly_id IS DISTINCT FROM al.assembly_id
      OR ql.leaf_id <> al.leaf_id
      OR ql.quantity IS DISTINCT FROM al.quantity
      OR ql.position IS DISTINCT FROM al.position
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Canonical attachment repair postcondition failed for % rows', violation_count;
  END IF;

  SELECT count(*) INTO orphan_count
  FROM assembly_leaves WHERE quote_leaf_id IS NULL;
  IF orphan_count <> 0 THEN
    RAISE EXCEPTION 'Canonical attachment repair left % rows without a pointer', orphan_count;
  END IF;
END $$;
--> statement-breakpoint
UPDATE product_structure_repair.canonical_attachment_repair_runs r
SET completed_at = clock_timestamp(),
    after_counts = jsonb_build_object(
      'assembly_leaves_total', (SELECT count(*) FROM assembly_leaves),
      'assembly_leaves_orphaned', (SELECT count(*) FROM assembly_leaves WHERE quote_leaf_id IS NULL),
      'quote_leaves_total', (SELECT count(*) FROM quote_leaves)
    )
FROM repair_run current_run
WHERE r.id = current_run.run_id AND NOT current_run.is_noop;
