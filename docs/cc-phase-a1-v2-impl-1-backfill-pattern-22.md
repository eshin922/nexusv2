# Phase A.1 v2 impl-1 — Pattern 22 finding on §4.2 backfill

**Branch:** `slice-phase-a1-v2-impl-1-schema`
**Status:** Surfaced; awaiting Edward + CA disposition
**Date:** 2026-05-19
**Author:** CC

## Finding

Brief §4.2 (Migration steps 2-4) describes the backfill source data
shape in terms that don't match the current schema. The brief
references a `products` table joined into `quote_skus` and `quotes`
to resolve `quote_id`. That table does not exist; `quote_skus` is
both the product-tree and the per-quote scoping layer.

This is the 8th Pattern 22 instance and the second one on this
slice (the first set was resolved in Architect's §0.5 commit;
this one surfaced now that I'm authoring the actual backfill SQL).

## Evidence

Brief §4.2 Step 2 (lines 460-464):

> **Step 2: Backfill `assemblies` from existing `quote_skus`** —
> for each existing `quote_skus` row that should be available in
> the new model:
> - INSERT a new `assemblies` row with `quote_id` from the parent
>   quote (joining `products` → `quote_skus` → `quotes` to resolve
>   `quote_id`)
> - Same SKU, name, commercial fields copied from `products`
> ...

Actual schema (`src/db/schema.ts:455-500`):

```ts
export const quoteSkus = pgTable("quote_skus", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id, ...),
  // ...
  skuLabel: text("sku_label").notNull(),
  productName: text("product_name").notNull(),
  // ...
  parentSkuId: uuid("parent_sku_id").references(...),
  skuRole: skuRole("sku_role").notNull().default("leaf"),
  qtyPerParent: numeric("qty_per_parent", { precision: 10, scale: 4 }),
  // ...
});
```

Per CLAUDE.md "Assembly rules (added Slice 5.5)":

> `quote_skus` is a tree, not a flat list. Each SKU has a `sku_role`:
> - `leaf` — terminal. Cannot have children. Usually HubSpot-anchored.
> - `assembly` — holds child SKUs. Can also be a child of another
>   assembly (assembly nesting is supported). Often Nexus-local.

So:
- `quote_skus.quote_id` is the direct FK to `quotes.id` (no
  intermediate join required)
- The "products table" referenced in brief §4.2 is conceptually
  represented INSIDE `quote_skus` (rows with `sku_role IN ('leaf',
  'assembly')` and `parent_sku_id` self-references for the tree
  shape)
- Commercial fields (`skuLabel`, `productName`, `unitsPerPack`,
  `retailBenchmark`, etc.) live on `quote_skus` directly

## Proposed translation

Rewrite §4.2 Steps 2-4 against the real shape:

**Step 2 (revised) — Backfill `assemblies` from `quote_skus` where
`sku_role = 'assembly'` (or `parent_sku_id IS NULL` if `sku_role`
defaulted to 'leaf' on legacy rows):**

```sql
insert into assemblies (
  id, quote_id, sku, name, product_type_id, position,
  unit_price, unit_cost, internal_notes,
  created_at, updated_at
)
select
  gen_random_uuid(),
  qs.quote_id,
  qs.sku_label,
  qs.product_name,
  null,                         -- product_type_id assigned later by PMs
  qs.sort_order,
  null, null,                   -- price/cost computed from cost-stack post-migration
  qs.notes,
  qs.created_at,
  now()
from quote_skus qs
where qs.sku_role = 'assembly'
   or (qs.sku_role = 'leaf' and qs.parent_sku_id is null);
   -- the OR-leg catches legacy quotes pre-Slice-5.5 where everything
   -- was flat-rendered as leaf; treat each top-level leaf as a degenerate
   -- single-component assembly to preserve quote rendering
```

**Step 3 (revised) — Backfill `leaves` + `assembly_leaves` from
`quote_skus` where `parent_sku_id IS NOT NULL`:**

For each child quote_skus row, the matching library leaf gets
created (deduplicate by `(sku_label, supplier)` where supplier is
discoverable from `packaging_inputs`; otherwise per-row create).

```sql
-- Library leaves — one row per unique (sku_label, supplier) tuple
-- (or per child quote_skus row if no supplier signal — accept
-- per-quote duplication for v1; library de-dup is a v1.1 polish).
insert into leaves (id, sku, name, product_type_id, archived, created_at)
select
  gen_random_uuid(),
  qs.sku_label,
  qs.product_name,
  null,                         -- PMs assign product_type via Edit specs
  false,
  qs.created_at
from quote_skus qs
where qs.parent_sku_id is not null;

-- Junction rows — link leaves to the assemblies created in Step 2
-- via the original parent_sku_id chain.
insert into assembly_leaves (id, assembly_id, leaf_id, quantity, position, parent_assembly_leaf_id)
select
  gen_random_uuid(),
  a.id,
  l.id,
  qs.qty_per_parent,
  qs.sort_order,
  null                          -- v1 doesn't backfill nested ASY structure
from quote_skus qs
join quote_skus parent on parent.id = qs.parent_sku_id
join assemblies a on a.quote_id = parent.quote_id and a.sku = parent.sku_label
join leaves l on l.sku = qs.sku_label and l.created_at = qs.created_at;
```

Note: this approach creates per-quote-scoped leaves (one library
row per child `quote_skus`); the library concept is satisfied
structurally but the dedup is left for v1.1 polish. PMs can merge
duplicate library leaves manually post-migration via a future admin
tool, OR Phase A.1 v3 ships a one-time dedup migration.

**Step 4 (revised) — `quote_leaves` backfill for sent quotes:**

```sql
insert into quote_leaves (id, quote_id, leaf_id, leaf_spec_version_id, created_at)
select
  gen_random_uuid(),
  q.id,
  l.id,
  null,                         -- no pinning; legacy quotes didn't have specs
  q.updated_at
from quotes q
join assemblies a on a.quote_id = q.id
join assembly_leaves al on al.assembly_id = a.id
join leaves l on l.id = al.leaf_id
where q.status in ('sent', 'accepted');
```

## Disposition options

**(a) Patch the brief inline + carve backfill SQL to a follow-up
sub-commit on this branch.** I author `drizzle/manual/0030_phase_a1_v2_backfill.sql`
matching the translated shape above; Edward applies it AFTER the
schema migration lands. CA optionally amends the brief retroactively
to reflect the real schema shape (Pattern 31 brief-patch discipline).

**(b) Carve the backfill to a separate impl-1b commit and merge
schema-only first.** Smaller blast radius per merge; backfill SQL
gets its own review cycle. Same end-state as (a); slower.

**(c) Defer backfill entirely to impl-2.** Schema lands; new quotes
write to new tables; existing quotes continue rendering from
quote_skus via the read-path branching (Step 6). Backfill becomes
non-blocking v1 work; can land any time before sent-quote PDF
regeneration becomes a v1 requirement.

## CC recommendation

**(c)** — backfill is a one-shot historical-data exercise with no
read path dependency in impl-1. Steps 5 + 6 (new write path + read-
path branching) are the load-bearing impl-1 work; backfill is
strictly additive context for legacy quote rendering AGAINST the
new schema, which neither impl-1 nor impl-2 actually needs.

Per Pattern 32 pre-production engineering tolerance: the orphan
legacy quotes don't have a UI path that surfaces them in the new
schema (the read path branches on `assemblies` row presence per
quote_id; absence routes to the legacy quote_skus renderer). No
PM workflow breaks. Backfill becomes an artifact of v1.1 polish OR
the future v2 cost-stack consolidation slice (where it might be
unnecessary entirely if the consolidation collapses both schemas
into one).

**If (c):** strike Step 2-4 from impl-1 scope; impl-1 closes after
Step 1 (schema) + Step 5 (new write path) + Step 6 (read-path
branching). Brief §4.2 gets a `→ moved to v1.1+ backlog` note.

**If (a) or (b):** I author the translated backfill SQL above as
a follow-up sub-commit on this branch; Edward + Aisha smoke test
against a copy of prod data; apply after sign-off.

## Standing protocol reminder

Pattern 22 §0.5 (pre-approval schema verification) caught the
first set of mismatches on this slice (resolved in Architect's
§0.5 commit PR #39). This 8th instance surfaced at backfill SQL
authoring time — one step downstream from the schema-create
work that §0.5 verified. Architect's §0.5 didn't cover the
backfill data-source shape because the focus was on the new
tables' DDL, not the legacy-data extraction queries.

**Refinement candidate:** when §0.5 verification covers a slice
that includes backfill/migration steps, the verification scope
should extend to the LEGACY data shape, not just the new tables'
DDL. Banking as a candidate refinement; promote if a third
backfill-shape mismatch lands the same way on a future slice.
