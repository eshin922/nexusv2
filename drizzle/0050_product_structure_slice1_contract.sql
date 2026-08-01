-- Product Structure Slice 1 / Migration D (DRAFT — intentionally absent
-- from drizzle/meta/_journal.json until production rollout approval).
-- Requires the database-enforced Product Structure write pause and a fully
-- reconciled Migration 0049 result. One transaction; any invariant aborts all.

BEGIN;
--> statement-breakpoint
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SELECT pg_advisory_xact_lock(hashtextextended('nexus.product-structure.slice1-contract', 0));
--> statement-breakpoint
LOCK TABLE assembly_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE quote_leaves IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TEMP TABLE slice1_contract_invariants (
  invariant text PRIMARY KEY,
  violations bigint NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO slice1_contract_invariants
SELECT 'legacy_missing_mapping', count(*) FROM assembly_leaves WHERE quote_leaf_id IS NULL
UNION ALL
SELECT 'mapped_identity_mismatch', count(*)
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
  WHERE ql.quote_id <> a.quote_id
     OR ql.assembly_id IS DISTINCT FROM al.assembly_id
     OR ql.leaf_id <> al.leaf_id
UNION ALL
SELECT 'mapped_quantity_mismatch', count(*)
  FROM assembly_leaves al
  JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
  WHERE al.quantity <> ql.quantity
UNION ALL
SELECT 'mapped_position_mismatch', count(*)
  FROM assembly_leaves al
  JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
  WHERE al.position <> ql.position
UNION ALL
SELECT 'duplicate_legacy_mapping', count(*)
  FROM (
    SELECT quote_leaf_id FROM assembly_leaves
    WHERE quote_leaf_id IS NOT NULL
    GROUP BY quote_leaf_id HAVING count(*) > 1
  ) d
UNION ALL
SELECT 'cross_quote_product_reference', count(*)
  FROM quote_leaves ql
  JOIN assemblies a ON a.id = ql.assembly_id
  WHERE ql.assembly_id IS NOT NULL AND ql.quote_id <> a.quote_id
UNION ALL
SELECT 'grouped_canonical_orphan', count(*)
  FROM quote_leaves ql
  WHERE ql.assembly_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM assembly_leaves al WHERE al.quote_leaf_id = ql.id
    )
UNION ALL
SELECT 'duplicate_direct_membership', count(*)
  FROM (
    SELECT quote_id, leaf_id FROM quote_leaves
    WHERE assembly_id IS NULL
    GROUP BY quote_id, leaf_id HAVING count(*) > 1
  ) d
UNION ALL
SELECT 'duplicate_grouped_membership', count(*)
  FROM (
    SELECT quote_id, assembly_id, leaf_id FROM quote_leaves
    WHERE assembly_id IS NOT NULL
    GROUP BY quote_id, assembly_id, leaf_id HAVING count(*) > 1
  ) d
UNION ALL
SELECT 'pinned_spec_leaf_mismatch', count(*)
  FROM quote_leaves ql
  JOIN leaf_specs ls ON ls.id = ql.leaf_spec_version_id
  WHERE ql.leaf_id <> ls.leaf_id;
--> statement-breakpoint
DO $$
DECLARE
  blocker_count bigint;
  blocker_detail text;
BEGIN
  SELECT coalesce(sum(violations), 0),
         string_agg(invariant || '=' || violations, ', ' ORDER BY invariant)
    INTO blocker_count, blocker_detail
  FROM slice1_contract_invariants
  WHERE violations <> 0;
  IF blocker_count <> 0 THEN
    RAISE EXCEPTION 'Slice 1 Contract reconciliation failed: %', blocker_detail;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE assembly_leaves
  ADD CONSTRAINT assembly_leaves_quote_leaf_id_contract_nn
  CHECK (quote_leaf_id IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE assembly_leaves
  VALIDATE CONSTRAINT assembly_leaves_quote_leaf_id_contract_nn;
--> statement-breakpoint
ALTER TABLE assembly_leaves
  ALTER COLUMN quote_leaf_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE assembly_leaves
  DROP CONSTRAINT assembly_leaves_quote_leaf_id_contract_nn;
--> statement-breakpoint
COMMIT;
