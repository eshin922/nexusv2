# Round 7b — Setup redesign · Data-source map

R7b reads + writes from the existing Setup schema (`quote_skus`, `quote_skus_components`, `quote_tiers`, `quote_meta`) plus one new column commitment (`display_order`). The Add-new-product modal touches HubSpot product registry via the Slice 12 writeback path.

## Page-level identity

| Visible | Source |
|---|---|
| Eyebrow `{client} · {scenario} · v{N} draft` | `projects.client_name`, `scenarios.label`, `quotes.version_number` |
| Page title "Setup" | static |
| YOUR NEXT MOVE → "Continue to Cost build" | R7a surface-routes table; route = `/projects/:id/quotes/:qid/cost-build` |

## SKU table

### Per-row visible fields

| Field | Source | Mutable? |
|---|---|---|
| Grip glyph | n/a (UI) | drag → writes `quote_skus.display_order` |
| Type badge (LEAF / ASY) | `quote_skus.sku_role` | yes — click-to-toggle |
| Label (e.g., `GLW-30`) | `quote_skus.label` | yes — drawer textfield |
| Product name | `quote_skus.product_name` | yes — drawer textfield |
| Pack | `quote_skus.pack` | yes — drawer textfield |
| Pack `has note` chip | derived from `quote_skus.notes IS NOT NULL` | indicator only |
| Category | `quote_skus.category` (constrained enum from `sku_categories`) | yes — drawer select |
| Retail benchmark | `quote_skus.retail_benchmark` | yes — drawer numeric |
| Components count (assemblies only) | `COUNT(quote_skus_components WHERE sku_id = ?)` | indicator; opens drawer |

### Drawer · nested component table (assemblies only)

| Field | Source | Mutable? |
|---|---|---|
| Component name | `quote_skus_components.product_name` | yes — inline input |
| Supplier | `quote_skus_components.supplier` | yes — inline input |
| Category | `quote_skus_components.category` | yes — inline select (writes `category_id` → `markup_categories`) |
| Unit cost | `quote_skus_components.unit_cost` | yes — inline numeric |
| Qty | `quote_skus_components.qty` | yes — inline numeric |
| Markup | `quote_skus_components.markup_pct` (defaults from category) | yes — inline numeric |

Inline edit saves on blur or Enter (R6 Blur+Enter pattern). Markup default sourced from `markup_categories` (R5 carry-forward) when component is added with no explicit override.

### Drawer · per-SKU notes

| Field | Source | Mutable? |
|---|---|---|
| Per-SKU notes textarea | `quote_skus.notes` (text, nullable) | yes — autosave on blur |

Per-SKU notes are **internal-only** by spec. They never propagate to customer-facing surfaces (Quote PDF, Mark-Accepted snapshot, Customer view).

### Add product modal

| Field | Source / target |
|---|---|
| Product name | writes `quote_skus.product_name` |
| Type (leaf / assembly) | writes `quote_skus.sku_role` |
| Pack | writes `quote_skus.pack` |
| Category | writes `quote_skus.category` |
| Units per pack | writes `quote_skus.units_per_pack` |
| HubSpot writeback toggle | controls Slice 12 writeback behavior |

**Writeback path (toggle ON, default):**
1. Insert into Nexus `quote_skus` immediately. Row appears.
2. Async job writes to HubSpot product registry.
3. On HubSpot success, update `quote_skus.hubspot_product_id` with the canonical ID.
4. On HubSpot failure, log + surface a non-blocking notification; product remains Nexus-local until retry.

**Nexus-local path (toggle OFF):**
1. Insert into Nexus `quote_skus`. `hubspot_product_id` stays NULL.
2. Never syncs to HubSpot.

## Tier table

### Per-row visible fields

| Field | Source | Mutable? |
|---|---|---|
| Tier label | `quote_tiers.label` (defaults to "Tier N") | yes |
| Recommended star | `quote_tiers.recommended` (bool, one per quote) | yes — click sets, unsets siblings |
| Qty | `quote_tiers.qty` | yes — inline numeric |
| Price adjustment % | `quote_tiers.price_adj_pct` | yes — inline numeric |

### Empty-state preset picker

| Preset | Effect |
|---|---|
| `3-tier step` | Creates tiers 5k/10k/25k; T2 recommended |
| `4-tier step` | Creates tiers 5k/10k/25k/50k; T2 recommended |
| `First-PO` | Creates single tier at 10k; T1 recommended |
| `Volume break` | Creates tiers 10k/50k/100k; T2 recommended |

Picker renders only when `COUNT(quote_tiers) = 0`. Adding a 4th tier to a 3-tier preset does not re-show the picker.

## Notes section (quote-level)

### Internal zone

| Field | Source | Audience |
|---|---|---|
| Internal notes textarea | `quote_meta.internal_notes` (text, nullable) | PM-only; never customer-visible |

### Customer-facing zone

| Field | Source | Audience |
|---|---|---|
| Customer-facing notes textarea | `quote_meta.customer_facing_notes` (text, nullable) | renders on Quote PDF + Mark-Accepted snapshot |
| "Preview on Quote →" link | jumps to Customer view (R7a surface-routes) | n/a |

## Schema commitments

R7b confirms or adds:

| Column / table | Status |
|---|---|
| `quote_skus.display_order INTEGER` | **NEW** — drives drag-and-drop ordering |
| `quote_skus.sku_role ENUM('leaf', 'assembly')` | Already exists; no change |
| `quote_skus.notes TEXT NULL` | Already exists; authoring moves from inline column to drawer |
| `quote_skus.hubspot_product_id TEXT NULL` | Already exists; populated by writeback |
| `quote_skus_components` | Already exists; inline-editable in drawer |
| `quote_meta.internal_notes TEXT NULL` | Already exists; UI surfaces separately from customer-facing |
| `quote_meta.customer_facing_notes TEXT NULL` | Already exists; UI surfaces separately from internal |
| `quote_tiers.recommended BOOL` | Already exists (R4 commitment); UI surfaces star + toggle |
| `quote_tiers.price_adj_pct NUMERIC` | Already exists |

## Cross-surface contracts honored

- **R5 markup defaults.** New components added inside an assembly drawer default `markup_pct` from `markup_categories.markup_pct`. Editable per-line on Cost build.
- **R5 audit log.** Every SKU add/remove/role-toggle, every component add/edit/remove, every tier add/remove/qty-change, every notes-textarea blur-save writes `audit_log`.
- **R4 inner rail.** Setup is one of five quote-scoped surfaces; the rail shows it as active, scenario context above, surface links below.
- **R7a IA grammar.** Eyebrow line is always present (non-navigable). Breadcrumb is suppressed (rail visible). YOUR NEXT MOVE banner is present. Action cluster: primary right (Save draft), secondary middle (+ Add SKU), no back-direction.

## Nothing wishful

Every UI element here maps to either existing schema, an R7b commitment (`display_order`), or a Slice 12 writeback path that's already on the roadmap. The visual register and interaction patterns reuse R5 / R6 / R7a primitives.
