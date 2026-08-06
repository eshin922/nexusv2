-- Packaging materialization backfill — DRAFT QUOTES ONLY.
--
-- DELIBERATELY ABSENT FROM drizzle/meta/_journal.json until execution is
-- authorized. Journalling this file IS the authorization step.
--
-- Unlike 0049, nothing in the application depends on this migration having
-- run: src/lib/packaging-materialization.ts handles every new attach and tier
-- creation from now on. This backfill exists only to repair rows that were
-- never created while fan-out ran on the tier axis alone. Code and data do not
-- disagree if it never runs -- one quote simply keeps an empty Packaging
-- section until a tier is re-saved.
--
-- WHAT IT DOES
--   For every DRAFT quote, ensures active leaf x active tier x line group has
--   exactly one assembly_leaf_inputs row:
--     · a leaf with no line group receives one, spanning every tier
--     · an existing line group receives rows for any tiers it is missing,
--       inheriting that group's supplier/category/markup/vendor shape
--   New rows carry NULL unit_cost and purchase_qty. Only structure is
--   materialized; pricing stays the operator's.
--
-- WHAT IT DOES NOT DO
--   · No sent, accepted or complete quote is touched. Three rows are missing
--     on two SENT quotes (180e6410 x2, 9de0a19d x1). Creating authoritative
--     cost inputs after send would change an input to derived customer-facing
--     output on a quote whose terms were already issued -- the F-7 concern,
--     and the reason F-5 refuses frozen quotes despite freight being absent
--     from the freeze-column list. Those three are recorded as frozen legacy
--     exceptions requiring separate commercial disposition.
--   · No existing row, value or line group is modified or removed. The three
--     multi-line-group leaves on SMOKE-CB-STEP10 (status complete) are legacy
--     shape from before Setup owned this structure and are preserved as-is.
--     The one-group rule governs what is CREATED, not what already exists.
--
-- IDEMPOTENT: every insert is gated on NOT EXISTS at (leaf, tier, group).

-- Precondition: refuse to run if the duplicate invariant is already violated,
-- rather than adding rows on top of an inconsistent base.
DO $$
DECLARE
  duplicate_count bigint;
BEGIN
  SELECT count(*) INTO duplicate_count FROM (
    SELECT assembly_leaf_id, tier_id, line_group_id
    FROM assembly_leaf_inputs
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  ) d;
  IF duplicate_count <> 0 THEN
    RAISE EXCEPTION
      'Packaging backfill aborted: % duplicate (leaf, tier, line_group) triples already exist',
      duplicate_count;
  END IF;
END $$;
--> statement-breakpoint
-- Pass 1 — leaves with no line group at all: seed one group across every tier.
WITH bare_leaves AS (
  SELECT al.id AS assembly_leaf_id, gen_random_uuid() AS line_group_id, a.quote_id
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  JOIN quotes q ON q.id = a.quote_id
  WHERE q.status = 'draft'
    AND al.parent_assembly_leaf_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM assembly_leaf_inputs ali WHERE ali.assembly_leaf_id = al.id
    )
)
INSERT INTO assembly_leaf_inputs (
  assembly_leaf_id, tier_id, line_group_id, sort_order, inventory_eligible
)
SELECT b.assembly_leaf_id, t.id, b.line_group_id, 0, false
FROM bare_leaves b
JOIN quote_tiers t ON t.quote_id = b.quote_id;
--> statement-breakpoint
-- Pass 2 — existing line groups missing a tier: fill the gap, inheriting the
-- group's own shape so the new tier reproduces it rather than a blank row.
WITH groups AS (
  SELECT DISTINCT ON (ali.assembly_leaf_id, ali.line_group_id)
    ali.assembly_leaf_id, ali.line_group_id, a.quote_id, ali.sort_order,
    ali.supplier, ali.qty_per_sellable_unit, ali.category, ali.markup_pct,
    ali.markup_pct_source, ali.inventory_eligible, ali.notes,
    ali.pricing_vendor_hubspot_company_id, ali.pricing_vendor_name_snapshot
  FROM assembly_leaf_inputs ali
  JOIN assembly_leaves al ON al.id = ali.assembly_leaf_id
  JOIN assemblies a ON a.id = al.assembly_id
  JOIN quotes q ON q.id = a.quote_id
  WHERE q.status = 'draft'
  ORDER BY ali.assembly_leaf_id, ali.line_group_id, ali.created_at
)
INSERT INTO assembly_leaf_inputs (
  assembly_leaf_id, tier_id, line_group_id, sort_order, supplier,
  qty_per_sellable_unit, category, markup_pct, markup_pct_source,
  inventory_eligible, notes, pricing_vendor_hubspot_company_id,
  pricing_vendor_name_snapshot
)
SELECT g.assembly_leaf_id, t.id, g.line_group_id, g.sort_order, g.supplier,
       g.qty_per_sellable_unit, g.category, g.markup_pct, g.markup_pct_source,
       g.inventory_eligible, g.notes, g.pricing_vendor_hubspot_company_id,
       g.pricing_vendor_name_snapshot
FROM groups g
JOIN quote_tiers t ON t.quote_id = g.quote_id
WHERE NOT EXISTS (
  SELECT 1 FROM assembly_leaf_inputs ali
  WHERE ali.assembly_leaf_id = g.assembly_leaf_id
    AND ali.tier_id = t.id
    AND ali.line_group_id = g.line_group_id
);
--> statement-breakpoint
-- Postcondition: every draft leaf x tier now resolves to at least one row.
DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT count(*) INTO remaining
  FROM assembly_leaves al
  JOIN assemblies a ON a.id = al.assembly_id
  JOIN quotes q ON q.id = a.quote_id
  JOIN quote_tiers t ON t.quote_id = q.id
  WHERE q.status = 'draft'
    AND al.parent_assembly_leaf_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM assembly_leaf_inputs ali
      WHERE ali.assembly_leaf_id = al.id AND ali.tier_id = t.id
    );
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'Packaging backfill postcondition failed: % draft leaf x tier gaps remain', remaining;
  END IF;
END $$;
