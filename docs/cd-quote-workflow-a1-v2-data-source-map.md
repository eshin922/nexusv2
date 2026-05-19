# Quote Workflow A.1 v2 — Data-source map (ASY/LEAF model + library)

Every visible field traced to schema + phase. New v2 commitments marked **🆕**.

## Setup > SKUs page · tree view

### Tree summary

| UI element | Source | Phase |
|---|---|---|
| ASY all-complete count | 🔧 derived: ASYs where all leaves are complete | v1 |
| Partial count | 🔧 derived | v1 |
| Empty count | 🔧 derived | v1 |
| "N of M leaves complete" | 🔧 derived | v1 |

### ASY row

| UI element | Source | Phase |
|---|---|---|
| SKU pill | ✅ `assemblies.sku` | v1 |
| Name | ✅ `assemblies.name` | v1 |
| Pack label | ✅ `assemblies.pack_label` | v1 |
| ASY type tag | 🆕 `assemblies.product_type_id → product_types.name WHERE scope='assembly'` | v1 |
| Leaf count | 🔧 `count(assembly_leaves WHERE assembly_id = ?)` | v1 |
| Rollup chip | 🔧 aggregate of child leaf completeness | v1 |
| Context menu trigger | UI | v1 |

### Leaf row (nested)

| UI element | Source | Phase |
|---|---|---|
| Leaf SKU | 🆕 `leaves.sku` | v1 |
| Leaf name | 🆕 `leaves.name` | v1 |
| qty meta | 🆕 `assembly_leaves.quantity` | v1 |
| Cost meta | 🆕 `leaves.unit_cost` | v1 |
| Type tag | 🆕 `leaves.product_type_id → product_types.name WHERE scope='leaf'` | v1 |
| Reference count meta | 🔧 `count(assembly_leaves WHERE leaf_id = ?) - 1 (this ASY)` | v1 |
| Completeness chip | 🔧 derived per type's `field_schema` | v1 |
| Context menu trigger | UI | v1 |

### ASY context menu

| Item | Routes to |
|---|---|
| Edit product | ASY edit modal (commercial fields) |
| Duplicate ASY | scenario copy flow |
| Move position | `assemblies.position` reorder |
| Edit specs | **disabled** — explicit "leaves only" caption |
| Delete ASY · cascade | DELETE with referential cascade through assembly_leaves |

### Leaf context menu

| Item | Routes to |
|---|---|
| Edit specs (primary) | `SpecEntry` surface for this leaf |
| Move up / down | `assembly_leaves.position` reorder |
| Assign to parent ASY | `assembly_leaves.parent_assembly_leaf_id` (deeper nesting future) |
| View library record | Leaf library detail surface |
| Delete from this ASY | DELETE `assembly_leaves` (library leaf stays) |

## Spec entry surface (per leaf, type-aware)

### Header

| UI element | Source | Phase |
|---|---|---|
| Leaf name | 🆕 `leaves.name` | v1 |
| SKU + version + cost meta | 🆕 `leaves.sku`, `leaves.current_version`, `leaves.unit_cost` | v1 |
| Reference count | 🔧 `count(assembly_leaves)` joined to scenarios | v1 |
| FSC tag | 🆕 `leaves.fsc_claim`, `.fsc_status` (when claim is true) | v1 |
| Completeness chip | 🔧 derived | v1 |
| Type tag | 🆕 `leaves.product_type_id` | v1 |

### Type picker (no type set)

| UI element | Source | Phase |
|---|---|---|
| Type option name | 🆕 `product_types.name WHERE scope='leaf' AND hidden=false` | v1 |
| Option desc — field count | 🔧 `product_types.field_schema.length` or "fields TBD" if placeholder | v1 |

### Placeholder panel (type set, schema TBD)

Renders for `product_types WHERE placeholder = true`. Pattern is the same as worked-example types; content is the "fields TBD · pending schema · Edward provides iteratively" stub.

### Spec panel (PP / SP — worked examples)

| Field | Source | Phase |
|---|---|---|
| Field labels | 🆕 `product_types.field_schema[i].label` | v1 |
| Field values | 🆕 `leaf_specs.spec_values[field.key]` at current version | v1 |
| Field grid layout (4-column, wide-spans) | 🔧 derived from `field_schema[i].wide` | v1 |
| Filled count meta | 🔧 derived | v1 |

### Version history (per leaf)

| UI element | Source | Phase |
|---|---|---|
| Version chip | 🆕 `leaf_specs.version_number` | v1 |
| Timestamp | ✅ `audit_log.created_at WHERE action='leaf_spec_field_edit' or 'leaf_spec_version_pin'` | v1 |
| Actor | ✅ `audit_log.actor_name` | v1 |
| Action summary | 🔧 derived from `audit_log.diff_json` | v1 |
| Pinned-by quotes | 🆕 `quote_leaves.leaf_spec_version_id` reverse-lookup | v1 |

## Add Product modal · ASY/LEAF toggle

| UI element | Source | Phase |
|---|---|---|
| Mode toggle (ASY/LEAF) | UI state | v1 |
| ASY mode fields | ✅ `assemblies` columns | v1 |
| LEAF mode identity fields | 🆕 `leaves` columns | v1 |
| Leaf Product Type select | 🆕 `product_types WHERE scope='leaf' AND hidden=false` | v1 |
| Library-scope banner copy | UI copy reflecting global scope | v1 |
| Post-creation toast | UI state + `audit_log` write | v1 |
| Continue-to-specs CTA | Closes modal · opens Edit specs surface for new leaf | v1 |
| Defer specs CTA | Creates leaf with empty `leaf_specs` (no row yet) | v1 |

## Library browse

| UI element | Source | Phase |
|---|---|---|
| Search input | UI state · queries by `leaves.name`, `.sku`, joined factory fields | v1 |
| Type filter | `product_types WHERE scope='leaf'` | v1 |
| Scenario filter | `assembly_leaves` joined to scenarios | v1 |
| Reference count per row | 🔧 `count(assembly_leaves WHERE leaf_id = ?)` + `count(distinct scenario_id)` | v1 |
| `+ Add to {ASY}` CTA | Creates `assembly_leaves` row | v1 |
| In-scenario indicator | 🔧 `exists(assembly_leaves WHERE leaf_id = ? AND scenario_id = current_scenario)` | v1 |

## Cascade warning (edit widely-referenced leaf)

| UI element | Source | Phase |
|---|---|---|
| Reference list | 🔧 `assembly_leaves WHERE leaf_id = ?` joined to scenarios + ASYs + quote status | v1 |
| Sent/draft status per row | 🔧 derived from `quote_leaves.leaf_spec_version_id IS NOT NULL` | v1 |
| "Stays pinned" / "Will update" copy | 🔧 UI logic reading sent-vs-draft state | v1 |

## Replenishment view

| UI element | Source | Phase |
|---|---|---|
| Prior quote reference | 🆕 `quotes.predecessor_quote_id` or PM-supplied "compare against" | v1 |
| Per-leaf version-stamp pill | 🔧 compare `leaves.current_version` vs prior quote's pinned version | v1 |
| `View diff` CTA | Opens diff modal (v1.5+) | v1.5+ |

## PDF addendum (per-leaf, grouped by ASY)

| UI element | Source | Phase |
|---|---|---|
| Toggle (per quote) | 🆕 `quotes.include_spec_addendum` (carry-forward from iter 1) | v1 |
| Toggle meta — leaf count | 🔧 `count(leaves across all ASYs in quote)` | v1 |
| ASY block header | ✅ `assemblies.sku`, `.name` | v1 |
| ASY block leaf count | 🔧 derived | v1 |
| Leaf sub-block name | 🆕 `leaves.name` | v1 |
| Leaf sub-block type tag | 🆕 `leaves.product_type_id` | v1 |
| Leaf sub-block version stamp | 🆕 `quote_leaves.leaf_spec_version_id` (or current when draft) | v1 |
| Field rendering (PP/SP) | 🆕 `leaf_specs.spec_values` at pinned version | v1 |
| Empty field → `--` | UI render rule | v1 |
| Placeholder rendering | UI fallback when `product_types.placeholder = true` | v1 |
| Untyped rendering | UI fallback when `leaves.product_type_id IS NULL` | v1 |
| Suppress addendum (zero data) | 🔧 detect ALL leaves empty + render suppress message | v1 |

## Re-quote workflow

| UI element | Source | Phase |
|---|---|---|
| Out-of-sync indicator | 🔧 ANY `quote_leaves.leaf_spec_version_id != leaves.current_spec_version` | v1 |
| Leaf-delta count | 🔧 derived | v1 |
| Re-quote CTA | Creates new quote with current leaf versions + `predecessor_quote_id` | v1 |
| Superseded banner | 🆕 `quotes.superseded_by_quote_id IS NOT NULL` | v1 |
| New quote ID reference | 🆕 `quotes.superseded_by_quote_id` | v1 |

## Audit log export

### Per-quote (Completed sub-tab)

| Column | Source | Phase |
|---|---|---|
| timestamp | ✅ `audit_log.created_at` | v1 |
| actor_type | ✅ `audit_log.actor_type` | v1 |
| actor_name | ✅ `audit_log.actor_name` | v1 |
| action | ✅ `audit_log.action` (8 new actions added) | v1 |
| target_type | ✅ `audit_log.target_type` | v1 |
| target_id | ✅ `audit_log.target_id` | v1 |
| diff_json | 🆕 `audit_log.diff_json` (cascade pattern from iter 1) | v1 |
| audit_id | ✅ `audit_log.id` | v1 |
| caused_by_audit_id | 🆕 `audit_log.caused_by_audit_id` | v1 |

### Per-leaf (library audit)

Same shape, scoped to `target_type IN (leaf, leaf_spec) AND target_id LIKE 'leaf_*'`.

## Soft gate (Preview Quote)

| UI element | Source | Phase |
|---|---|---|
| Gate visibility | 🔧 ANY `leaf.spec_completeness != 'complete'` across all ASYs in quote | v1 |
| Per-leaf item · ASY + leaf | 🔧 joined from `assembly_leaves` | v1 |
| Status copy (type-aware) | 🔧 derived from leaf completeness rule | v1 |

## New schema commitments

```sql
-- Product type taxonomy
create table product_types (
  id text primary key,
  name text not null,
  scope text not null check (scope in ('assembly', 'leaf')),
  description text,
  field_schema jsonb,  -- null for assembly-scope; populated for leaf-scope (or null with placeholder flag)
  placeholder boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

-- Assemblies (per-scenario, quotable products)
create table assemblies (
  id uuid primary key,
  scenario_id uuid not null references scenarios,
  sku text not null,
  name text not null,
  pack_label text,
  product_type_id text references product_types,
  unit_price numeric, unit_cost numeric,
  margin_pct numeric, markup_pct numeric,
  tax_schedule_id uuid, owner_id uuid references users,
  fsc_claim boolean, fsc_status text, supplier_verified boolean,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Leaves (globally scoped library)
create table leaves (
  id uuid primary key,
  name text not null,
  sku text,
  url text, image_url text,
  product_type_id text references product_types,
  unit_cost numeric,
  fsc_claim boolean, fsc_status text, supplier_verified boolean,
  owner_id uuid references users,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Many-to-many association
create table assembly_leaves (
  id uuid primary key,
  assembly_id uuid not null references assemblies,
  leaf_id uuid not null references leaves,
  quantity numeric not null default 1,
  position int not null default 0,
  parent_assembly_leaf_id uuid references assembly_leaves(id),  -- nullable; supports deeper nesting
  created_at timestamptz not null default now(),
  unique(assembly_id, leaf_id, parent_assembly_leaf_id)
);

-- Leaf specs (polymorphic, versioned)
create table leaf_specs (
  id uuid primary key,
  leaf_id uuid not null references leaves,
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
create unique index on leaf_specs (leaf_id) where is_current = true;

-- Per-quote leaf pinning
create table quote_leaves (
  id uuid primary key,
  quote_id uuid not null references quotes,
  assembly_id uuid not null references assemblies,
  leaf_id uuid not null references leaves,
  leaf_spec_version_id uuid references leaf_specs,  -- null for drafts; populated at send
  pinned_at timestamptz,
  quantity numeric not null default 1,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS permissions
alter table users add column can_edit_specs boolean not null default false;
alter table users add column can_create_leaves boolean not null default false;

-- 8 new audit log actions (added to existing action enum/check):
-- leaf_spec_field_edit, leaf_spec_type_change, leaf_spec_create,
-- leaf_spec_version_pin, leaf_create, leaf_archive,
-- assembly_leaf_attach, assembly_leaf_detach
```

CA + Architect resolve exact constraint shapes and index strategy at impl-brief time.

## Cross-surface contracts

- **Phase A unchanged.** Quote umbrella 4+1 sub-tabs, persistent PDF panel, action cluster all stay.
- **R5 audit log carries forward** with cascade pattern (`caused_by_audit_id`) and 8 new actions.
- **R7a IA grammar** — every v2 surface uses the same eyebrow + page-head + action-cluster.
- **R7b Setup precedent** — tree view inherits Setup's card chrome + inline-edit register.
- **Pricing reframe `pricing_events`** — re-quote events that imply pricing changes write to both `pricing_events` and `audit_log` (different surface, same write).
- **Mark-Accepted snapshot** — when a quote completes, each leaf's pinned `leaf_spec_version_id` travels with the artifact. NetSuite SO push payload includes leaf-version references for downstream production traceability.

## Gaps deliberately flagged

| Gap | Resolution path |
|---|---|
| HubSpot deal-level → product-level migration | v1.1 (Edward Q2) |
| Time-range global audit export | v1.1 |
| Executive approval gating for spec changes | v1.5+ (Aisha 1:1) |
| Field-level diff modal on cascade warning | v1.5+ |
| Flat-leaves view on SKUs page | v1.1 candidate |
| "Private to scenario" leaf flag | v1.1 if accidental reuse becomes a problem |
| Leaf archive UX (soft-archive + browse-archived) | v1.1 |
| Bulk leaf-spec editing | v1.5+ |
| Side-by-side spec diff in replenishment | v1.5+ |
| Per-product default toggle for addendum | v1.5+ |
| Tamper-evident audit log signing | v2 if needed |

## Pattern 25 schema verification gate

Before CC writes any implementation:

1. **`product_types` table shape** — confirm single table with scope flag vs. separate `assembly_types` + `leaf_types`. Either works; design implies unified.
2. **`leaf_specs` versioning model** — `is_current` flag + JSONB approach vs. separate version-history table. Architect call.
3. **`assembly_leaves.parent_assembly_leaf_id`** — confirm self-referential FK is fine for v1 (currently unused; reserved for deeper nesting).
4. **NetSuite SO push payload extension** — include `leaf_spec_version_id` references per leaf for production traceability. Confirm at integration-spec time.
5. **RLS policy strategy** — `can_edit_specs` + `can_create_leaves` as separate flags vs. role-based pattern.
