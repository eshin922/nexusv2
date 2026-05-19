# CC Impl Brief — Phase A.1 v2 — ASY/LEAF/Library Spec Model

**Audience:** CC (Claude Code)
**Slice:** Phase A.1 v2 — product specs IA migration + Quote umbrella spec surfaces + library + replenishment + PDF addendum + audit log export
**Predecessor:** Pricing reframe v1 (currently in impl)
**Successor:** Microsoft OAuth + pre-launch review
**Estimated effort:** 3-4 weeks CC time, sequenced as 8 phases
**Branch strategy:** Feature-per-phase, merged sequentially into main with smoke tests between

---

## 0. Context

### Where this slice fits

This is the **major v1 deliverable** Edward promoted from Aisha's 1:1 backlog. Originally scoped as "product specs storage + Quote PDF toggle" — through CD design rounds + Edward dispositions, it expanded into:

- Product specs IA migration (HubSpot deal-level → leaf-level with library reuse)
- ASY/LEAF model (the core architectural shift)
- Globally-reusable leaf library
- Type-aware spec entry across 3 surfaces (leaf context menu, Add Product modal LEAF mode, SKUs page browse)
- Quote PDF addendum (per-leaf, grouped by ASY)
- Audit log export (defensibility evidence — Edward Q4 disposition)
- NetSuite SO push payload extension
- Soft gate at Preview Quote
- RLS permissions for spec editing + leaf creation

### Sequencing

```
[Pricing reframe wraps]  →  [Pre-impl §0.5 gates]  →  [Phase A.1 v2 impl (8 phases)]  →  [Pre-launch review]
       ~now                    1-2 days                3-4 weeks                      1-2 weeks
```

Pricing reframe v1 is currently in impl on `slice-pricing-reframe-impl`. CC does NOT open the Phase A.1 v2 branch until Pricing reframe is merged to main and smoke-tested.

### Source artifacts

- **CA brief (canonical scope):** `docs/cd-quote-workflow-recalibration-brief.md` — 17 sections, all dispositions locked
- **CD designer notes:** `docs/cd-quote-workflow-a1-v2-designer-notes.md` — design decisions, rationale, pushbacks
- **CD data-source map:** `docs/cd-quote-workflow-a1-v2-data-source-map.md` — schema commitments, Pattern 25 verification gates
- **CD prototype:** `dist/Nexus_Quote_Workflow_A_1_v2.html` (bundled + unbundled at `app/qw_a1_v2/`)
- **Iter 1 prototype** (visual reference, no longer canonical): `dist/Nexus_Quote_Workflow_A_1.html`

All dispositions referenced in §11 of CA brief; Q1-Q8 + Q-Type1-6 + Q-ASY1-5 locked.

---

## 1. Pre-impl §0.5 verification gates (Pattern 25 — mandatory)

Architect runtime BEFORE any impl branch opens. CD flagged five verification items in the data-source map; impl waits on all five.

### Gate 1 — `product_types` table shape

CD shipped a unified table with `scope` enum (`assembly` | `leaf`) + `field_schema` JSONB + `placeholder` + `hidden` flags. Architect verifies:
- Single table with scope flag vs. separate `assembly_types` + `leaf_types` tables
- If unified: query patterns scoped by `scope` flag must be efficient (indexed)
- `placeholder` + `hidden` flag interactions with type-picker logic
- Migration of any existing Product Type dropdown values into the new taxonomy

**Resolution:** Architect commits in `docs/architect/phase-a1-v2-schema-commit.md` before impl-1 opens.

### Gate 2 — `leaf_specs` versioning model

CD shipped `is_current` boolean + JSONB approach with partial unique index `(leaf_id) where is_current = true`. Architect verifies:
- Single-row-per-leaf with is_current vs. separate `leaf_spec_versions` history table
- How version_number bumps interact with cascade audit pattern
- Historical pinned versions reconstructable via audit_log alone (no separate version-history table for v1)
- Performance characteristics of JSONB validation on every save

**Resolution:** Architect commits in same file as Gate 1.

### Gate 3 — `assembly_leaves.parent_assembly_leaf_id` self-referential FK

CD shipped this column as a forward-compatibility hook for nested-leaves-under-leaves (currently unused; flat 2-level only). Architect verifies:
- Self-referential FK shape (NULL allowed, ON DELETE behavior)
- Unique constraint on `(assembly_id, leaf_id, parent_assembly_leaf_id)` works correctly with NULLs
- v1 enforcement: parent_assembly_leaf_id ALWAYS NULL (or app-side guard) to prevent accidental nesting before the workflow is designed

**Resolution:** Architect commits constraint shape + v1 enforcement strategy.

### Gate 4 — NetSuite SO push payload extension

CD flagged: `quote_leaves.leaf_spec_version_id` should travel with the NetSuite SO push payload for production traceability. This is an **integration-spec concern** that crosses to the NetSuite integration team's scope.

Architect verifies:
- Current SO push payload shape
- How leaf_spec_version_id references are best represented in the payload (full version object vs. reference ID + lookup)
- Coordination with Aisha / NetSuite integration team on contract change

**Resolution:** Architect coordinates with Aisha. If NetSuite payload changes are out-of-scope for v1, the leaf_spec_version_id reference can be carried in our DB only (no NetSuite push for v1; v1.1+ adds the integration extension). Decision committed before impl-7 (audit log export).

### Gate 5 — RLS policy strategy

CD shipped `can_edit_specs` + `can_create_leaves` as separate boolean flags on `users`. Architect verifies:
- Separate flags vs. role-based pattern (e.g., a `spec_editor` role that bundles both)
- Existing RLS pattern in the tool (how other permissions are modeled)
- Backwards compatibility for existing users (defaults: both false until granted)

**Resolution:** Architect commits RLS policy shape with example policy SQL.

**Impl branch does NOT open until all 5 gates resolve.** If gates surface schema changes that affect CD's prototype, CA + CD coordinate on visual implications before CC starts.

---

## 2. Scope summary

### What ships in this slice

**Schema:**
- 7 new tables (`product_types`, `assemblies`, `leaves`, `assembly_leaves`, `leaf_specs`, `quote_leaves`, audit_log namespace additions)
- RLS additions (`can_edit_specs`, `can_create_leaves`)
- 8 new audit log actions
- Migration from existing data model to ASY/LEAF/library model

**Setup surface:**
- SKUs page becomes a tree view (ASY → nested LEAFs)
- Type chips per row (ASY filled blue / LEAF outline)
- Nested components view (expandable per ASY)
- Per-SKU internal notes textarea with HAS NOTE chip
- Drag-to-reorder
- Tiers section moves BELOW SKUs (DOM order change)

**Spec entry surface (per leaf, type-aware):**
- SpecEntry component reading `leaf.product_type`
- Type-picker empty state for untyped leaves
- Type change confirmation modal
- Completeness chip + field-count meta
- Version-pinning header ("v4 · pinned by 2 active quotes")
- Reference count ("Used in N ASYs across M quotes")
- Cascade warning modal on widely-referenced edit
- RLS read-only treatment

**Add Product modal:**
- ASY/LEAF mode toggle (card-style segmented control)
- ASY mode: current modal scope minus specs (single-step)
- LEAF mode: identity + type + Continue-to-specs OR defer-specs choice
- Library-scope copy + post-creation toast

**Library + replenishment:**
- Library browse affordance on SKUs page
- Library search (name / SKU / type / factory)
- Reference count + quote filter
- + Add to {ASY} CTA for unreferenced leaves
- Replenishment view with three-state version stamps (unchanged / changed / new)

**PDF addendum:**
- Per-leaf rendering grouped under ASY headers
- Type-aware sub-block layouts (PP + SP as worked examples)
- Placeholder treatment for TBD types ("fields TBD")
- Untyped leaf treatment ("No Product Type set · specs cannot render")
- Empty-data suppression (when all leaves empty, addendum doesn't render)
- Toggle on Preview Quote with leaf-count meta

**Audit log export:**
- CSV export endpoint (per-quote scope on Completed sub-tab)
- CSV export endpoint (per-leaf scope on library)
- Export scoping modal (event type / actor / date filters)
- `caused_by_audit_id` cascade pattern carries forward from Pricing reframe

**NetSuite integration extension:**
- SO push payload includes `leaf_spec_version_id` references per leaf (per Architect Gate 4 resolution)

**Soft gate:**
- Preview Quote surfaces incomplete-leaf-spec warning
- Per-leaf detail with type-aware status copy
- Non-blocking; PMs proceed with confirmation

### What does NOT ship in this slice

Explicit out-of-scope per dispositions:
- HubSpot deal-level → product-level migration (v1.1, Edward Q2)
- Time-range global audit export (v1.1)
- Executive approval gating for spec changes (v1.5+, Aisha 1:1)
- Field-level diff modal on cascade warning (v1.5+)
- Flat-leaves view on SKUs page (v1.1 candidate, CD pushback 3)
- "Private to quote" leaf flag (v1.1 if accidental reuse becomes a problem, CD pushback 1)
- Leaf archive UX (v1.1)
- Bulk leaf-spec editing (v1.5+)
- Side-by-side spec diff in replenishment (v1.5+)
- Per-product default toggle for addendum (v1.5+)
- Tamper-evident audit log signing (v2 if needed)

---

## 3. Schema commitments

### 3.1 `product_types` (taxonomy)

```sql
create table product_types (
  id text primary key,
  name text not null,
  scope text not null check (scope in ('assembly', 'leaf')),
  description text,
  field_schema jsonb,
  placeholder boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index product_types_scope_idx on product_types (scope) where hidden = false;
```

**Initial seed data (Edward to provide exact list before impl-1):**

| id | name | scope | placeholder |
|---|---|---|---|
| asy_skincare | Skincare | assembly | false |
| asy_supplement | Supplement | assembly | false |
| asy_body | Body | assembly | false |
| ... | ... | assembly | false |
| leaf_primary_packaging | Primary packaging | leaf | false (field_schema populated) |
| leaf_secondary_packaging | Secondary packaging | leaf | false (field_schema populated) |
| leaf_soft_goods | Soft goods | leaf | true (field_schema null) |
| leaf_tertiary_packaging | Tertiary packaging | leaf | true (field_schema null) |
| leaf_component | Component / part | leaf | true (hidden: true) |
| leaf_assembly_sub | Assembly sub-component | leaf | true (hidden: true) |
| leaf_service | Service / labor | leaf | true (hidden: true) |
| leaf_other | Other | leaf | true (hidden: true) |

**PP `field_schema` (worked example):**

```json
{
  "fields": [
    {"key": "pp_description", "label": "PP Description", "type": "textarea", "wide": true},
    {"key": "pp_component_type", "label": "PP Component Type", "type": "text"},
    {"key": "pp_quantities", "label": "PP Quantities", "type": "text"},
    {"key": "pp_size", "label": "PP Size", "type": "text"},
    {"key": "pp_material", "label": "PP Material", "type": "text"},
    {"key": "pp_deco", "label": "PP Deco", "type": "text"},
    {"key": "pp_additional_details", "label": "PP Additional Details", "type": "textarea", "wide": true},
    {"key": "pp_factory_1", "label": "PP Factory 1", "type": "text"},
    {"key": "pp_factory_2", "label": "PP Factory 2", "type": "text"},
    {"key": "pp_packout_details", "label": "PP Packout Details", "type": "textarea", "wide": true}
  ]
}
```

**SP `field_schema`** mirrors with SP fields (11 fields per data-source map).

### 3.2 `assemblies` (per-quote, quotable SKUs)

Per Architect §0.5 verification: assemblies key directly on `quote_id`, not on a phantom intermediate "scenarios" table. The conceptual "scenario" CD's data-source map referenced maps cleanly to the existing `quotes` parent.

```sql
create table assemblies (
  id uuid primary key,
  quote_id uuid not null references quotes on delete cascade,
  sku text not null,
  name text not null,
  pack_label text,
  product_type_id text references product_types,
  description text,
  url text,
  image_url text,
  unit_price numeric,
  unit_cost numeric,
  margin_pct numeric,
  markup_pct numeric,
  tax_schedule_id uuid,
  owner_id uuid references users,
  fsc_claim boolean,
  fsc_status text,
  supplier_verified boolean,
  internal_notes text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, sku)
);

create index assemblies_quote_position_idx on assemblies (quote_id, position);
```

**`internal_notes`** is the per-SKU notes field surfaced in the Setup tree view's HAS NOTE chip.

### 3.3 `leaves` (globally scoped library)

```sql
create table leaves (
  id uuid primary key,
  name text not null,
  sku text,
  url text,
  image_url text,
  product_type_id text references product_types,
  unit_cost numeric,
  fsc_claim boolean,
  fsc_status text,
  supplier_verified boolean,
  owner_id uuid references users,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leaves_product_type_idx on leaves (product_type_id) where archived = false;
create index leaves_sku_idx on leaves (sku) where archived = false;
```

**No `quote_id`** — leaves are globally scoped (library-shared across quotes). References tracked via `assembly_leaves` (which keys on `assembly_id` → which keys on `quote_id`).

### 3.4 `assembly_leaves` (many-to-many junction)

```sql
create table assembly_leaves (
  id uuid primary key,
  assembly_id uuid not null references assemblies on delete cascade,
  leaf_id uuid not null references leaves on delete restrict,
  quantity numeric not null default 1,
  position int not null default 0,
  parent_assembly_leaf_id uuid references assembly_leaves(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (assembly_id, leaf_id, parent_assembly_leaf_id)
);

create index assembly_leaves_assembly_position_idx on assembly_leaves (assembly_id, position);
create index assembly_leaves_leaf_idx on assembly_leaves (leaf_id);
```

**`ON DELETE RESTRICT` on `leaf_id`** prevents accidental library leaf deletion when references exist. Soft archive via `leaves.archived = true` is the recommended path.

**v1 enforcement:** `parent_assembly_leaf_id` is ALWAYS NULL (Architect Gate 3 resolution). App-side guard prevents deeper nesting until that workflow is designed.

### 3.5 `leaf_specs` (polymorphic, versioned)

```sql
create table leaf_specs (
  id uuid primary key,
  leaf_id uuid not null references leaves on delete cascade,
  spec_values jsonb not null default '{}',
  version_number int not null default 1,
  is_current boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references users,
  updated_by uuid references users
);

create unique index leaf_specs_current_idx on leaf_specs (leaf_id) where is_current = true;
create index leaf_specs_leaf_version_idx on leaf_specs (leaf_id, version_number);
```

**App-side validation:** `spec_values` JSONB validated against the leaf's `product_type.field_schema`. Unknown keys rejected; required fields enforced (when type schema declares `required: true`).

**Versioning behavior:**
- New row created on initial spec entry (`version_number = 1`, `is_current = true`)
- Subsequent edits update the current row's `spec_values` in place (NOT a new row)
- When a quote pins this leaf via `quote_leaves.leaf_spec_version_id`, version_number increments AT pin time (creating effective_to on current row + new is_current row with bumped version_number)
- Historical pinned versions queryable by `version_number`; current always has `is_current = true`

### 3.6 `quote_leaves` (per-quote pinning)

```sql
create table quote_leaves (
  id uuid primary key,
  quote_id uuid not null references quotes on delete cascade,
  assembly_id uuid not null references assemblies on delete cascade,
  leaf_id uuid not null references leaves on delete restrict,
  leaf_spec_version_id uuid references leaf_specs,
  pinned_at timestamptz,
  quantity numeric not null default 1,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index quote_leaves_quote_idx on quote_leaves (quote_id);
create index quote_leaves_leaf_version_idx on quote_leaves (leaf_id, leaf_spec_version_id);
```

**`leaf_spec_version_id` is NULL for draft quotes; populated at send time.** Sent quotes stay pinned; draft quotes auto-update.

### 3.7 `audit_log` namespace additions

8 new actions added to existing audit_log action enum:

```sql
-- Spec lifecycle
'leaf_spec_field_edit'      -- single-field update (most common)
'leaf_spec_type_change'     -- Product Type changed on a leaf (rare; discards prior values)
'leaf_spec_create'          -- first spec values on a leaf
'leaf_spec_version_pin'     -- version_number bumped on quote send (system event)

-- Leaf library lifecycle
'leaf_create'               -- new leaf added to library
'leaf_archive'              -- leaf soft-archived

-- ASY-leaf association lifecycle
'assembly_leaf_attach'      -- leaf added to an ASY
'assembly_leaf_detach'      -- leaf removed from an ASY (library leaf stays)
```

**`diff_json.source` values** per Slice 9.2 namespace convention — each action prefixes the source field for downstream queryability.

**`caused_by_audit_id` cascade pattern** from Pricing reframe carries forward:
- A single PM action (e.g., "edit specs with N field changes") writes one root audit_log row + N derived rows with `caused_by_audit_id` pointing to root
- Audit export reconstructs the cascade via the FK

### 3.8 Permission flags + action-layer enforcement

Per Architect Gate 5 resolution (Path B), Nexus's existing access-control pattern uses **boolean flags on users + server-action guards**, NOT Postgres RLS policies. Phase A.1 v2 aligns with the existing pattern.

**Schema:** add two flags to `users` table.

```sql
alter table users add column can_edit_specs boolean not null default false;
alter table users add column can_create_leaves boolean not null default false;
```

**Enforcement:** server actions check guards at the top of write operations.

```typescript
// example: updateLeafSpec action
export async function updateLeafSpec(input: UpdateLeafSpecInput) {
  await assertCanEditSpecs(currentUserId());
  // ... proceed with update
}

// example: createLeaf action
export async function createLeaf(input: CreateLeafInput) {
  await assertCanCreateLeaves(currentUserId());
  // ... proceed with insert
}
```

**Read access:** scoped by leaf/quote visibility upstream (existing pattern); no permission gate on read.

**Denial behavior:** Pattern 47 optimistic-update + denial-revert handles cleanly. Failed permission check on action throws `PermissionDeniedError`; client reverts optimistic state + surfaces denial toast.

**Why action-layer guards, not Postgres RLS:** the initial brief proposed Postgres RLS policies as the enforcement layer. Architect Gate 5 verification confirmed Nexus's existing access-control pattern uses action-layer guards, not Postgres RLS. CA brief amendment aligns with existing pattern; Architect's commit captures the canonical decision.

---

## 4. Migration plan

### 4.1 Existing data shape

Current tool has:
- `quotes` table (existing) — top-level container
- `quote_skus` table (existing) — per-(quote, SKU) rows; flat product list scoped to quote
- `products` table (existing) — supporting structure with cost-stack tree (some flat, some with hierarchy)
- `quote_tiers` table (existing) — tier definitions per quote
- Tiers + pricing data linked to products via quote_skus / quote_tiers
- HubSpot deal-level specs (legacy; out of scope per Q2)

**Schema introduction approach: Path A — parallel structure** (per Architect lean, Edward confirmed).

New ASY/LEAF/library tables (`assemblies`, `leaves`, `assembly_leaves`, `leaf_specs`, `quote_leaves`) sit **alongside** existing `quote_skus`. Existing quotes continue using `quote_skus`; new quotes use the new model. Migration backfills `quote_leaves` from `quote_skus` for sent quotes. The existing cost-stack engine continues to function on `quote_skus`; new quotes consume `assemblies` + `assembly_leaves`.

Path B (full cost-stack refactor replacing `quote_skus`) was rejected for v1 — +2-3 weeks impl with no v1 driver. Banked for v2 cost-stack consolidation if it becomes valuable.

### 4.2 Migration steps (impl-1)

**Step 1: Schema create** — Architect's commit goes first; all new tables (`product_types`, `assemblies`, `leaves`, `assembly_leaves`, `leaf_specs`, `quote_leaves`) created with constraints, indexes, permission flags on `users`.

**Step 2: Backfill `assemblies` from existing `quote_skus`** — for each existing `quote_skus` row that should be available in the new model:
- INSERT a new `assemblies` row with `quote_id` from the parent quote (joining `products` → `quote_skus` → `quotes` to resolve `quote_id`)
- Same SKU, name, commercial fields copied from `products`
- Assign default `product_type_id` (best-guess from existing categorization, or NULL for backfill later)
- Copy `position` from existing tree position

**Step 3: Extract leaves from existing cost-stack tree** — for each child node under a product:
- INSERT a new `leaves` row (one per unique component; deduplicate by name + supplier where possible)
- INSERT `assembly_leaves` row linking the new assembly to the new leaf
- Set `quantity`, `position` from existing tree data
- Leave `product_type_id` NULL initially (PMs assign via Edit specs flow)

**Step 4: Quote_leaves backfill (sent quotes)** — for each existing sent quote:
- Extract per-leaf composition at send time
- INSERT `quote_leaves` row per leaf with `leaf_spec_version_id = NULL` (no pinning for legacy data; specs were never captured)
- Mark with audit_log entry indicating legacy backfill

**Step 5: New quote write path activates** — new server actions for quote creation, ASY add, Leaf add now write to the new tables. Existing quotes continue to render from `quote_skus` (legacy read path); new quotes render from `assemblies` + `assembly_leaves` (new read path).

**Step 6: Read-path branching** — server queries for quote rendering check which schema the quote uses (presence of `assemblies` rows for that quote_id determines new vs legacy path). Pattern parallels existing read-path branching for HubSpot deal-level vs quote-level specs.

**Step 7: HubSpot deal-level specs stay** — no migration in v1 per Q2 disposition. They remain in HubSpot as historical reference; v1.1 handles reconciliation.

**Step 8: Legacy `quote_skus` table preserved** — NOT dropped in v1 per Path A. Continues to serve existing-quote rendering. Future v2 cost-stack consolidation slice may unify the model; bank for v2 planning.

### 4.3 Migration risk mitigation

- **Dry-run migration** in staging environment first; smoke test all surfaces against migrated data (both legacy `quote_skus` quotes + new `assemblies` quotes)
- **Parallel-rendering verification** — confirm existing quote rendering identical pre/post migration; confirm new-quote rendering correct
- **Audit log entries** for migration actions (using `migration_*` action namespace; visible in audit export for transparency)
- **Edward approval gate** — Edward signs off on dry-run results before production migration runs
- **No legacy drop** — Path A preserves `quote_skus` indefinitely in v1; no rollback risk on legacy data

---

## 5. Phase sequencing

8 phases, each its own feature branch off main. Each phase merges to main with smoke tests + visual verification against CD prototype before the next opens.

### Phase 1 — Schema + foundational tables

**Branch:** `slice-phase-a1-v2-impl-1-schema`

**Scope:**
- All 7 tables + indexes + constraints
- RLS policies
- 8 audit_log action namespace additions
- Migration scripts (steps 1-6 from §4.2)
- Existing-data backfill in staging

**Gates before merge:**
- Architect §0.5 verification (all 5 gates resolved)
- Dry-run migration in staging executes cleanly
- Smoke test: existing quotes load without error using new schema

**Estimated effort:** 4-5 days

### Phase 2 — Setup IA shift (SKUs page tree view)

**Branch:** `slice-phase-a1-v2-impl-2-setup-ia`

**Scope:**
- DOM-order change on Setup surface: SKUs section moves to top; Tiers section moves below
- SKUs page renders ASY tree view (ASY parent rows with nested LEAF children, one indent level)
- Type chips per row (ASY filled blue / LEAF outline)
- ASY context menu (Edit product / Duplicate / Move position / Edit specs disabled with caption / Delete cascade)
- LEAF context menu (Edit specs primary / Move up-down / Assign to parent / View library record / Delete from this ASY with library-stays caption)
- Per-SKU notes textarea with HAS NOTE chip (computed from `assemblies.internal_notes`)
- Drag-to-reorder (Pattern 47 applies for focus-stability)
- Header counter: "N SKUs · M assemblies"
- + Add product button + Pull from HubSpot button (no Pull from inventory per Edward disposition)

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ①-④ matches
- Smoke test: tree expand/collapse + drag-reorder work correctly
- Audit log entries fire on attach/detach actions

**Estimated effort:** 5-6 days

### Phase 3 — Spec entry surface (per-leaf, type-aware)

**Branch:** `slice-phase-a1-v2-impl-3-spec-entry`

**Scope:**
- `SpecEntry` component reading `leaf.product_type` and rendering matching field set
- Type-picker empty state for untyped leaves (per §4.3 of CA brief)
- Type change confirmation modal (per §4.10 of CA brief)
- Completeness chip + field-count meta per panel
- Version-pinning header ("v4 · pinned by 2 active quotes")
- Reference count surface ("Used in N ASYs across M quotes")
- Cascade warning modal on widely-referenced edit (per §4.5 of CA brief)
- RLS read-only treatment per CD's lock-banner pattern
- App-side `spec_values` validation against type's `field_schema`

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ⑤-⑩ matches
- Smoke test: PP + SP field sets render correctly per type
- Placeholder treatment for Soft goods + Tertiary packaging renders correctly
- RLS: unauthorized PM sees read-only state; authorized PM sees editable
- Audit log entries: `leaf_spec_create`, `leaf_spec_field_edit`, `leaf_spec_type_change` fire correctly
- Cascade audit pattern (root + derived rows via `caused_by_audit_id`) works for multi-field saves

**Estimated effort:** 5-6 days

### Phase 4 — Add Product modal mode toggle

**Branch:** `slice-phase-a1-v2-impl-4-add-product`

**Scope:**
- ASY/LEAF mode toggle (card-style segmented control per CD design)
- ASY mode: current modal scope minus specs (single-step "Add product" CTA)
- LEAF mode: identity + Product Type + Continue-to-specs OR defer-specs choice
- Library-scope copy + post-creation toast
- Modal-closes-into-Edit-specs surface pattern (Q-Type6 disposition)

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ⑪-⑯ matches
- Smoke test: both modes create correct entities (assembly vs. leaf)
- LEAF mode "Continue to specs" closes modal + opens Edit specs surface for new leaf
- Audit log: `leaf_create` fires correctly with creator metadata
- Library-scope toast surfaces on creation

**Estimated effort:** 3-4 days

### Phase 5 — Library browse + replenishment

**Branch:** `slice-phase-a1-v2-impl-5-library-replenishment`

**Scope:**
- Library browse affordance on SKUs page
- Library search (name / SKU / type / factory)
- Reference count per row + quote filter
- "+ Add to {ASY}" CTA for unreferenced leaves
- Replenishment view with three-state version stamps (unchanged / changed / new — per CD's design addition)
- Replenishment view: per-leaf version-stamp pill + comparison anchor (prior quote)

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ⑰-㉒ matches
- Smoke test: library search returns correct results
- Reference count accurate across quotes
- Replenishment three-state logic: unchanged / changed / new render correctly per leaf state
- Audit log: `assembly_leaf_attach` fires when leaf added from library

**Estimated effort:** 4-5 days

### Phase 6 — PDF addendum (per-leaf, grouped by ASY)

**Branch:** `slice-phase-a1-v2-impl-6-pdf-addendum`

**Scope:**
- Toggle on Preview Quote ("Include spec addendum") with leaf-count meta
- PDF addendum rendering: ASY block headers with nested per-leaf sub-blocks
- Type-aware sub-block layouts (PP + SP as worked examples; placeholder for TBD types)
- Untyped leaf treatment ("No Product Type set · specs cannot render")
- Empty-data suppression (all leaves empty → addendum doesn't render + preview note)
- Inner card chrome (paper-2) per leaf sub-block

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ㉓-㉘ matches
- Smoke test: addendum renders correctly across all type combinations
- Empty-data suppression works correctly
- Toggle state persists per quote
- Page footer accurate ("PAGE 1 OF N · SPEC ADDENDUM FOLLOWS")

**Estimated effort:** 4-5 days

### Phase 7 — Audit log export

**Branch:** `slice-phase-a1-v2-impl-7-audit-export`

**Scope:**
- CSV export endpoint (per-quote scope on Completed sub-tab)
- CSV export endpoint (per-leaf scope on library)
- Export scoping modal (event type / actor / date filters)
- Defensibility evidence export shape per data-source map
- 8 new audit log actions surfaced in export
- `caused_by_audit_id` cascade pattern represented in CSV (parent + derived rows)

**Gates before merge:**
- Visual diff vs. CD prototype scenarios ㉝-㉟ matches
- Smoke test: CSV export downloads correctly + opens in Excel/Sheets
- All 8 new actions present in export when filtered
- Cascade pattern visible (parent + derived rows linkable via `caused_by_audit_id`)
- Scope filters work correctly (per-quote, per-leaf, by-date-range)

**Estimated effort:** 3-4 days

### Phase 8 — Soft gate + NetSuite integration

**Branch:** `slice-phase-a1-v2-impl-8-softgate-netsuite`

**Scope:**
- Soft gate at Preview Quote: surfaces incomplete-leaf-spec warning
- Per-leaf detail with type-aware status copy
- Non-blocking (PM proceeds with confirmation)
- NetSuite SO push payload extension (per Architect Gate 4 resolution)
- `leaf_spec_version_id` references travel with payload per leaf

**Gates before merge:**
- Visual diff vs. CD prototype scenario ㊱ matches
- Smoke test: soft gate fires when ANY leaf has incomplete specs
- Type-aware completeness rule: a leaf is complete when its type's required fields are filled
- Untyped leaves don't fire soft gate (already covered by "no type set" warning surface)
- NetSuite push contract test: payload includes leaf_spec_version_id references correctly
- End-to-end smoke: create ASY → add leaves → enter specs → send quote → NetSuite payload contains pinned version refs

**Estimated effort:** 3-4 days

### Total estimated effort

| Phase | Effort | Cumulative |
|---|---|---|
| Phase 1 — Schema | 4-5 days | 1 week |
| Phase 2 — Setup IA | 5-6 days | 2 weeks |
| Phase 3 — Spec entry | 5-6 days | 3 weeks |
| Phase 4 — Add Product | 3-4 days | 3.5 weeks |
| Phase 5 — Library + replenishment | 4-5 days | 4 weeks |
| Phase 6 — PDF addendum | 4-5 days | 4.5-5 weeks |
| Phase 7 — Audit export | 3-4 days | 5 weeks |
| Phase 8 — Soft gate + NetSuite | 3-4 days | 5.5 weeks |

**Realistic total: 5-6 weeks of CC time** (revised up from initial 3-4 week estimate — the schema + migration work is more substantive than originally scoped, and the phase-by-phase smoke tests add time).

---

## 6. Branch + PR strategy

### Pattern

- **One feature branch per phase** off main (8 branches total)
- **Sequential merge** — each phase merges to main + smoke-tested + visual-verified before the next phase branch opens
- **Standard PR comm pattern** — each merge gets a PR comm doc at `docs/cc-comm-phase-a1-v2-impl-N.md` summarizing what landed

### PR comm shape (per phase)

```
1. Summary of scope shipped
2. Schema changes (if any)
3. Visual diff verification against CD prototype
4. Smoke test results
5. Known issues / follow-ups
6. Next phase prerequisites
```

### Smoke test pattern

Each phase merge requires:
- ✅ All gates from phase's "Gates before merge" pass
- ✅ Existing quotes still load and behave correctly (regression check)
- ✅ Visual diff against CD prototype matches (within reasonable design-system tolerance)
- ✅ No new audit_log integrity issues
- ✅ RLS policies enforce correctly (test with both authorized + unauthorized roles)

---

## 7. Audit log namespace conventions

### 8 new actions (full list)

```
leaf_spec_field_edit       diff_json.source: leaf_spec
leaf_spec_type_change      diff_json.source: leaf_spec
leaf_spec_create           diff_json.source: leaf_spec
leaf_spec_version_pin      diff_json.source: leaf_spec  (system event)

leaf_create                diff_json.source: leaf
leaf_archive               diff_json.source: leaf

assembly_leaf_attach       diff_json.source: assembly_leaves
assembly_leaf_detach       diff_json.source: assembly_leaves
```

### `caused_by_audit_id` cascade pattern

Inherited from Pricing reframe Disposition B. Single PM action that triggers multiple audit_log writes:

- **Root row:** the user-facing action (e.g., "Edit specs saved with 5 field changes")
- **Derived rows:** the individual field changes, each with `caused_by_audit_id` = root row's id

Audit export reconstructs the cascade via FK; CSV columns include `caused_by_audit_id` for downstream queryability.

### `diff_json` shape

Per Slice 9.2 namespace convention. Each action prefixes its `source` field for queryability:

```json
{
  "source": "leaf_spec_field_edit",
  "before": { "pp_material": "Type II glass" },
  "after": { "pp_material": "Type III soda-lime glass" },
  "field_key": "pp_material",
  "version_number": 4
}
```

---

## 8. Permission enforcement details

### Permission flags

| Flag | Grants | Default |
|---|---|---|
| `can_edit_specs` | INSERT/UPDATE on `leaf_specs`; UPDATE on `leaves` (identity fields) | false |
| `can_create_leaves` | INSERT on `leaves`; INSERT on `assembly_leaves` (when creating new leaf) | false |

### Initial role assignments (locked per Edward disposition)

| User | Role | `can_create_leaves` | `can_edit_specs` |
|---|---|---|---|
| Edward | admin | true | true |
| Jackie King | admin | true | true |
| Aisha | PM | true | true |
| Lexa Yerges | PM | true | true |
| Andrea McKibben | PM | true | true |
| Cally Hou | Logistics | true | true |
| Jing Santos | Sales | true | false |

Migration applies explicit per-user SQL at impl-1 schema-create time. No post-migration cleanup needed.

```sql
-- example migration shape (impl-1 schema migration)
update users set can_create_leaves = true, can_edit_specs = true
  where email in (
    'edward@thedps.co', 'jackie@thedps.co', 'aisha@thedps.co',
    'lexa@thedps.co', 'andrea@thedps.co', 'cally@thedps.co'
  );
update users set can_create_leaves = true, can_edit_specs = false
  where email = 'jing@thedps.co';
```

### Action-layer guard pattern

Per Architect Gate 5 (Path B) — CC implements `assertCanEditSpecs` + `assertCanCreateLeaves` helpers per existing Nexus access-control reference pattern. Apply at the top of these actions:

| Action | Guard |
|---|---|
| `updateLeafSpec` | `assertCanEditSpecs` |
| `createLeafSpec` | `assertCanEditSpecs` |
| `updateLeafIdentity` (name, sku, product_type) | `assertCanEditSpecs` |
| `createLeaf` | `assertCanCreateLeaves` |
| `createLeafViaAssemblyAdd` (creating leaf as part of "Add Leaf to ASY" flow) | `assertCanCreateLeaves` |

Guards throw `PermissionDeniedError` which surfaces as denial toast in the optimistic-update path.

### Edge case: PM loses permission mid-session

Optimistic-update pattern (Pattern 47 from autosave sweep) handles gracefully:
- Save attempt → guard denies → revert local state + surface denial toast
- App-side cache invalidation on permission changes (admin updates flag → other sessions see updated state on next action)

---

## 9. NetSuite integration extension

Per Architect Gate 4 resolution.

### Current SO push payload

Pre-Phase A.1 v2 payload includes:
- ASY (product) commercial data
- Tier pricing
- Quote metadata

### Extension for Phase A.1 v2

Payload gains per-leaf references:

```json
{
  "quote_id": "...",
  "assemblies": [
    {
      "assembly_id": "...",
      "sku": "GLW-30",
      "leaves": [
        {
          "leaf_id": "...",
          "leaf_name": "30ml Glass Dropper - Type III soda-lime",
          "leaf_spec_version_id": "...",
          "version_number": 4,
          "spec_values": { ... }
        }
      ]
    }
  ]
}
```

### v1 ships Path A — full NetSuite extension (Edward disposition locked)

**v1 ships full NetSuite extension.** Production traceability ready at v1 launch.

Phase 8 (impl-8) scope:
- Full payload extension as shown above (per-leaf objects with `leaf_id`, `leaf_name`, `leaf_spec_version_id`, `version_number`, `spec_values`)
- NetSuite team contract change negotiated by Aisha
- Receiver-side build on NetSuite side
- End-to-end smoke: create ASY → add leaves → enter specs → send quote → NetSuite payload contains pinned version refs
- Contract test: payload includes `leaf_spec_version_id` references correctly

**Aisha coordination in flight** — paste-ready ping drafted; Aisha standing by. Aisha confirms NetSuite team capacity for v1-window contract change before impl-8 starts.

**Cheap fallback if NetSuite team can't deliver** — Path B (v1.1 ships extension; v1 captures DB-side only) is available. Our DB writes correct in either path; v1.1 follow-up adds NetSuite contract extension. Fallback decision committed by impl-8 start (~5-6 weeks from now); allows for late-stage downgrade without rework.

**Architect Gate 4 commit doc update note:** Architect committed Gate 4 with default Path (ii) during the runtime because §15 dispositions weren't in Architect's context at run time. CA brief amendment captures Path A as canonical; CC notes in impl-8 PR comm that Architect Gate 4 commit doc should be updated retroactively with Path A (or banked as historical reference if Architect runtime isn't re-dispatched).

---

## 10. Pre-launch review hooks (Pattern 45)

### Customer-facing surfaces

- **PDF addendum** — specs visible if toggled on. Pattern 45 verification: customer sees what we expect them to see (no PII leakage, internal-only data not exposed)
- **Quote PDF** generally — ASY commercial fields visible; LEAF commercial fields (unit_cost) NOT visible to customer (only on addendum if toggled)

### Internal-only data

- **Per-SKU notes** (`assemblies.internal_notes`) — MUST NOT render on customer-facing Quote PDF
- **Audit log export** — accessible only to authorized PMs; not shared with customers without explicit authorization

### Pattern 45 verification check items (impl-time)

1. PDF render with addendum off — no spec data leaks
2. PDF render with addendum on — only intended spec fields appear; unit_cost / internal_notes / margin / markup do not appear
3. Audit log CSV export — actor_type column correctly differentiates 'user' / 'system' / 'external'
4. RLS read-only treatment correctly enforced when permissions absent

---

## 11. Standing concerns from CD pushbacks

### Pushback 1: Cross-quote library reuse measurement

CD flagged risk: PMs creating "one-off" leaves may not realize they're globally available; accidental reuse could surface.

**v1 instrumentation:**
- Audit log entries for `leaf_create` include `created_in_quote_id` (the quote where it was created)
- After v1 ships, query: "how many leaves created in quote X are later referenced in quote Y?"
- If pattern suggests accidental reuse > 5% of leaves, v1.1 ships "private to quote" flag

### Pushback 2: Cascade warning dismissal measurement

CD flagged risk: PMs dismissing cascade warning without reviewing referencing ASYs.

**v1 instrumentation:**
- Audit log entries for cascade-warning interactions: `leaf_spec_edit_cascade_warning_shown` + `leaf_spec_edit_cascade_warning_dismissed`
- After v1 ships, measure dismissal frequency
- If high (>50%), v1.5+ executive-approval gating activates

### Pushback 3: Tree-only IA flat-view as v1.1 candidate

CD flagged: PMs comparing across SKUs need to expand-and-scan in tree view.

**No v1 instrumentation needed** — CD flagged this as observe-then-decide. Edward + Aisha will hear from PMs during early usage if the gap is real.

---

## 12. Out-of-scope explicit reminders

Things NOT to build in this slice (per dispositions):

- ❌ HubSpot deal-level → product-level migration (v1.1, Q2)
- ❌ Time-range global audit export (v1.1)
- ❌ Executive approval gating (v1.5+, Aisha 1:1)
- ❌ Field-level diff modal on cascade warning (v1.5+)
- ❌ Flat-leaves view on SKUs page (v1.1 candidate)
- ❌ "Private to quote" leaf flag (v1.1 if measurement shows need)
- ❌ Leaf archive UX (soft-archive workflow surfaces; v1.1)
- ❌ Bulk leaf-spec editing (v1.5+)
- ❌ Side-by-side spec diff in replenishment (v1.5+)
- ❌ Per-product default toggle for addendum (v1.5+)
- ❌ Tamper-evident audit log signing (v2)
- ❌ Pull from inventory button (Edward disposition: drop entirely)
- ❌ Deeper nesting (`parent_assembly_leaf_id` is reserved for future; v1 app-side guards against)

---

## 13. Operational notes

### Architect coordination

- **First step:** Architect runtime for all 5 Pattern 25 §0.5 gates. Output committed at `docs/architect/phase-a1-v2-schema-commit.md`.
- **Mid-impl questions** — if CC discovers schema needs adjustment during impl, surface to Architect via comm doc; CA reviews; brief amendments published if needed.

### CD coordination

- **Visual verification gates** — each phase merge requires visual diff against CD prototype. CC opens visual-review thread per phase; CD signs off or surfaces deviation.
- **Mid-impl design discoveries** — if CC surfaces UX questions during impl, surface via designer notes comm; CA + CD respond.

### Edward dispositions

- **Pre-impl-1:** Edward provides exact `product_types` seed data (ASY-level types + LEAF-level types) before schema migration runs.
- **Pre-impl-3:** Edward confirms initial RLS role assignments (which roles get which permissions).
- **Pre-impl-7:** Edward confirms NetSuite payload extension path (v1 vs. v1.1) via Architect Gate 4 resolution + Aisha coordination.
- **Pre-impl-8:** Edward signs off on staging migration dry-run before production rollout.

### Aisha coordination

- **NetSuite payload contract** — Aisha coordinates with NetSuite integration team; output committed before impl-8 opens.

### Pricing reframe interaction

- **Independent** — Phase A.1 v2 doesn't touch Pricing surface beyond soft gate copy borrowing the warning callout register.
- **Sequential** — Pricing reframe wraps first; Phase A.1 v2 follows.
- **Schema isolation** — pricing_events table unchanged; leaf_specs is separate; no cross-contamination.

### Pattern 47 (autosave focus-stability)

- **Drag-to-reorder** on SKUs page tree uses Pattern 47 conventions — optimistic UI updates with server confirmation; focus stability maintained during reorder.
- **Spec field edits** use the same Pattern 47 autosave + focus-stability pattern.

### Slice 11 (PDF customer-facing) interaction

- **Explicit scope expansion** — Phase A.1 v2 absorbs the PDF addendum work. Slice 11's original scope (data bindings for customer-facing PDF) now includes per-leaf spec rendering.
- **Schema bindings:** PDF templates query `quote_leaves` for pinned versions; render against `leaf_specs.spec_values` at the pinned version.

---

## 14. Pre-impl checklist for CC

Before opening `slice-phase-a1-v2-impl-1-schema`:

- [ ] Pricing reframe wrapped + merged + smoke-tested on main (in flight; this week)
- [x] All 5 Architect §0.5 gates resolved (commit at `docs/architect/phase-a1-v2-schema-commit.md` — landed via PR #39; brief amendments capture two material deviations from initial proposal: phantom `scenarios` → `quote_id`, Postgres RLS → action-layer guards)
- [x] Edward provides exact `product_types` seed data (locked in §15.1 + §15.2)
- [x] Edward confirms initial RLS role assignments (locked in §8 + §15.3)
- [x] CA brief at `docs/cd-quote-workflow-recalibration-brief.md` confirmed as canonical scope reference
- [ ] Aisha confirms NetSuite team capacity for v1-window contract change (Path A) — in flight; fallback to Path B available if needed
- [ ] PR comm template ready at `docs/cc-comm-phase-a1-v2-impl-1.md` (will be filled in upon merge)

Once checklist passes, CC opens impl-1 branch and migration work begins.

---

## 15. Locked dispositions (recorded from CA-Edward exchange)

All four questions from the prior brief draft have been dispositioned. Recording here for canonical reference; Architect Gate 4 NetSuite Path (ii) default supersedes per §15.4.

### 15.1 ASY-level Product Type taxonomy

```
asy_skincare       | Skincare
asy_supplement     | Supplement (oral)
asy_haircare       | Hair care
asy_colorcosmetics | Color cosmetics
asy_body           | Body care
asy_beverage       | Beverage / functional drink
asy_pet            | Pet care
asy_household      | Household / cleaning
asy_other          | Other
```

Plus: admin-path for adding categories banked v1.1+.

### 15.2 LEAF-level Product Type taxonomy

**First-class (field_schema designed for v1):**
- `leaf_primary_packaging` (PP) — bottles, jars, tubes + closures (caps, pumps, droppers)
- `leaf_secondary_packaging` (SP) — cartons + labels + flexible packaging
- `leaf_tertiary_packaging` (TP) — corrugated cases, master cases (**NEW: elevated to v1 first-class** — corrugated support driver)

**Visible placeholder (field_schema null, v1.1+ design):**
- `leaf_soft_goods`

**Hidden (migration targets only):**
- `leaf_component`, `leaf_assembly_sub`, `leaf_service`, `leaf_other`

**TP field_schema starter** (Edward approved; CD refines at SpecEntry design time):

```json
{
  "fields": [
    {"key": "tp_description", "label": "TP Description", "type": "textarea", "wide": true},
    {"key": "tp_type", "label": "TP Type", "type": "text"},
    {"key": "tp_outer_dims", "label": "Outer Dimensions", "type": "text"},
    {"key": "tp_inner_dims", "label": "Inner Dimensions", "type": "text"},
    {"key": "tp_flute", "label": "Flute / Wall", "type": "text"},
    {"key": "tp_ect_or_board", "label": "ECT / Board Grade", "type": "text"},
    {"key": "tp_units_per_case", "label": "Units per Case", "type": "number"},
    {"key": "tp_print", "label": "Print / Finish", "type": "text"},
    {"key": "tp_closure", "label": "Closure / Construction", "type": "text"},
    {"key": "tp_pallet_config", "label": "Pallet Config", "type": "text"}
  ]
}
```

**Flagged for CD at SpecEntry design time:** `pp_component_type` + `sp_component_type` discriminator fields should render as **selects**, not free-text — drives consistency now that closures fold into PP and labels + flexible fold into SP. Suggested option sets:
- PP component_type: `bottle | jar | tube | cap | pump | dropper | dispenser | other`
- SP component_type: `carton | label | flexible | sleeve | other`

### 15.3 Initial RLS role assignments

See §8 for the full assignment table. Migration applies via explicit per-user SQL at impl-1 schema-create.

### 15.4 NetSuite payload path

**Path A locked — v1 ships full NetSuite extension.** See §9 for full scope.

Aisha coordination in flight for v1-window NetSuite team contract change confirmation. Cheap fallback to Path B available if NetSuite team can't deliver in v1-window.

**Architect Gate 4 note:** Architect committed Gate 4 with default Path (ii) during runtime because §15 dispositions weren't in Architect's context at run time. Path A as recorded here supersedes. Updated reference: `docs/cc-phase-a1-v2-impl-brief.md` §9 + §15.4 are canonical; Architect commit doc historical.

---

**Standing by.** Once Pricing reframe lands and §0.5 gates resolve, CC opens impl-1 and we're in motion.
