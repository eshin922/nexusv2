# BOM / Assembly model

Slice 5.5 added minimal viable assembly support to `quote_skus`. This file
captures the implementation detail; high-level rules live in `CLAUDE.md`
("Assembly rules"); the v2 NetSuite-master direction lives in
`STRATEGIC_VISION.md`.

## Schema (v4)

`quote_skus` gained three columns:

- `parent_sku_id uuid REFERENCES quote_skus(id) ON DELETE CASCADE` — self-FK,
  nullable. Top-level SKUs have NULL.
- `sku_role sku_role NOT NULL DEFAULT 'leaf'` — enum (`leaf | assembly`).
- `qty_per_parent numeric(10,4)` — nullable. Required when `parent_sku_id`
  is set; null otherwise.

Plus: `hubspot_product_id` was relaxed from NOT NULL to nullable so that
Nexus-local assemblies (no HubSpot product) can exist.

Indexes: `parent_sku_id`, `sku_role`. Tree traversal is in-memory after a
single SELECT; recursive CTEs are not needed at DPS scale.

## Roles

- **`leaf`** — terminal SKU. The typical orderable item. Cannot have
  children. Almost always anchored to a HubSpot Product.
- **`assembly`** — a SKU that holds child SKUs. Can also be a child of
  another assembly (assembly nesting is supported). Often Nexus-local
  (designed in the tool, not in HubSpot).

**Whether an assembly represents a "formulation," "kit," "gift set," or
finished-goods bundle is captured by `cost_category`** (Slice 9 — pulled
from HubSpot's `hs_product_type` or its successor schedule), **not by
`sku_role`**. A premade-bought formulation is a leaf with
`cost_category='Formulation'`. A DPS-formulated assembly is
`sku_role='assembly'` with `cost_category='Formulation'` and child SKUs
whose own `cost_category` is `'Raw ingredients'` or similar.

This separation came out of the Slice 5.5 architecture revision: the
earlier `umbrella` / `formulation_assembly` split was a category error —
it conflated *tree structure* with *cost classification*. Migration `0006`
collapses the enum to two values.

## Transition rules

Enforced by `validateAssemblyOperation` in `src/lib/sku-tree.ts`.

| from → to              | Allowed?                          | Why                          |
|------------------------|-----------------------------------|------------------------------|
| `leaf` → `assembly`    | Always (parent state preserved)   |                              |
| `assembly` → `leaf`    | Only if SKU has no children       | No auto-detach               |

Both leaves and assemblies can have parents. Assembly nesting (assembly
as a child of another assembly) is supported and is the typical shape
for nested BOMs.

## Cascade-aware audit

`deleteSku` snapshots the full subtree (root + all descendants) plus a
count of cascading `packaging_inputs` rows BEFORE the FK CASCADE wipes
them. Single audit row per user action; `diff_json` shape:

```json
{
  "deleted_sku":      { full snapshot },
  "cascaded_descendants": [ { snapshot per descendant }, ... ],
  "cascaded_descendant_count": N,
  "cascaded_packaging_inputs_count": M
}
```

This enables forensic reconstruction of accidental cascade deletes from
the audit log alone.

## Validation error codes

Returned in `ActionResult.error.code`:

- `HAS_CHILDREN` — demoting assembly → leaf while children attached
- `PARENT_NOT_FOUND`, `PARENT_DIFFERENT_QUOTE`, `PARENT_NOT_ASSEMBLY`
- `CYCLE_SELF`, `CYCLE_DESCENDANT`
- `QTY_REQUIRED`, `QTY_WITHOUT_PARENT`

## Packaging interaction

Packaging inputs are per-leaf-SKU. Assemblies render as read-only summary
rows on the packaging page; their leaf descendants get the full
per-(line, tier) cost-cell UI. The "Add line" button is disabled with a
tooltip on assembly rows.

Rationale: packaging cost is a property of physical packaging, which
exists at the leaf level. Assemblies aggregate their leaves'
packaging — that aggregation logic lives in the costing sheet (Slice 8).

## Forward compat (Slice 12 writeback)

Slice 12's HubSpot writeback must:

1. Skip any `quote_sku` where `hubspot_product_id IS NULL` (Nexus-local
   assemblies don't appear as HubSpot Quote line items).
2. Write only leaf SKUs as line items. Assemblies are structural; their
   pricing rolls up into their leaf descendants' COGS.
3. Defensive guard: refuse to push any leaf SKU missing
   `hubspot_product_id` (shouldn't happen given the typical creation
   path but the schema allows it).
