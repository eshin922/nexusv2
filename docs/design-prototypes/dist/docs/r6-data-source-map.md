# Round 6 — Data-source map

**Surface:** Cost Build redesign — single page replacing the legacy four
concept-tab IA (Packaging Setup, Cost Setup, Production Setup, Freight Calc)
and the dual cost-stack widget.

This document is one-line-per-rendered-thing: every visible value, where it
comes from, what shape it has, and what makes it null.

---

## Page-level identity

| Visible thing | Source | Shape | Null when |
|---|---|---|---|
| Project / client name | `projects.client_name` | string | never (required at project create) |
| Deal name | `projects.deal_name` (HubSpot synced) | string | never |
| HubSpot stage chip | `projects.hubspot_stage` | enum | HubSpot disconnected → "—" |
| HubSpot synced timestamp | `projects.hubspot_synced_at` | timestamp | never (defaults to project creation) |
| Scenario label · version | `scenarios.label` + `scenarios.version` | string + int | label inherited from "Primary" if not renamed |
| Anchor SKU code | `quote_skus.sku_code WHERE is_anchor = true` | string | never (every scenario has exactly one anchor) |
| Anchor SKU name | `skus.name` (joined) | string | never |
| "Units total committed" | `SUM(quote_tiers.units) WHERE scenario_id = ?` | int | 0 → renders as "0 units" |

---

## Cost stack header

The cost stack is a per-tier rollup. Each tier column is one row in
`quote_tiers`, joined to its rolled-up component costs.

### Per-tier column

| Visible thing | Source | Shape | Null when |
|---|---|---|---|
| Tier label | `quote_tiers.label` | string | inherited from "Tier N" if user didn't rename |
| Tier units | `quote_tiers.units` | int (≥1) | required; row insertion blocked otherwise |
| Active tier highlight | `quote_tiers.is_focused` (UI state, not persisted long-term) | bool | only one tier is active at a time |

### Per-component bar within a tier

Component rollups are derived, not stored. Each row is an aggregation:

```
PKG  = SUM(packaging_lines.{tier}_unit_cost) WHERE scenario_id = ?
PROD = SUM(production_lines.{tier}_unit_cost) WHERE scenario_id = ?
       + bulk_raw_cost_per_unit (if entered)
FRT  = SUM(freight_lines.tier_breakdown[tier].per_unit)
       WHERE freight_lines.treatment = 'bundled'
D+T  = derived margin uplift (target_margin × subtotal) — internal only
PASS = SUM(freight_lines.tier_breakdown[tier].per_unit)
       WHERE freight_lines.treatment = 'pass_through'
       + any other passthrough adjustments
```

Each row in the cost-stack header pulls:

| Visible thing | Source | Null when |
|---|---|---|
| Component cost segment width | derived from sum above | sum is 0 OR no rows present at this tier |
| Markup segment width | `SUM(line.{tier}_unit_cost × line.markup_pct)` | as above |
| Per-component price label | cost + markup | when either is null, render "—" |

`null` cascades up: if any one of (PKG, PROD, FRT) is null at a tier, the
**Sell** number is null and the margin pip is `incomplete`. We don't compose
a partial number — that's how legacy spreadsheets shipped wrong quotes.

### Per-tier subtotal cluster

| Visible thing | Source | Null when |
|---|---|---|
| Subtotal | `SUM(component prices ex. PASS)` | any component null |
| Adjustment | `quote_tiers.adjustment_per_unit` | always 0 in fixtures; non-null in real |
| Sell | `subtotal + adjustment + PASS` | any input null |
| Margin % | `1 - (cost+markup) / sell` (gross) | any input null |
| Margin state | bucketed: ≥ target = "good", ≥ floor = "below_target", < floor = "bad", null = "incomplete" | — |

---

## Packaging section

### Section row (always-visible summary)

| Visible thing | Source | Null when |
|---|---|---|
| Status chip | derived: empty (0 lines) / in_progress (any line missing tier cost) / complete (all lines have all tiers) | always derivable |
| Owner | `quote_section_assignments.owner` for section='packaging' | defaults to project lead — never null |
| Line count | `COUNT(packaging_lines)` | 0 → status = empty |
| Sublabel — inventory-eligible count | `COUNT WHERE inventory_eligible = true` | 0 → omit phrase |
| Sublabel — supplier count | `COUNT(DISTINCT supplier_id)` | 0 → omit phrase |
| Mini-stack per-tier | section-level rollup: `SUM(packaging_lines.{tier}_unit_cost)` | as above |

### Drill-down line table

| Visible thing | Source | Null when |
|---|---|---|
| Component name | `packaging_lines.name` | required |
| Notes | `packaging_lines.notes` | optional, free text |
| Inventory-eligible badge | `packaging_lines.inventory_eligible` | derived from supplier + product type; reusable across projects |
| Category | `packaging_lines.category_id` → `markup_categories.name` | required |
| Supplier | `packaging_lines.supplier_id` → `suppliers.name` | required |
| Markup % | `packaging_lines.markup_pct` (per-line override of category default) | falls back to category default |
| Per-tier unit cost | `packaging_lines.{T1..Tn}_unit_cost` | NULL = no quote at that tier (NOT inherited from another tier) |
| Per-tier total (foot) | `SUM` across rows | empty when all rows null |

---

## Production section

### Section row

Same shape as packaging, plus:

| Visible thing | Source | Null when |
|---|---|---|
| Sublabel — bulk raw | `production_meta.bulk_raw_cost_per_unit` | omit phrase if null |
| Sublabel — fee mode | `production_meta.allocate_service_fees_to_unit_cost` (bool) | always present (defaults true) |
| Sublabel — run locked | `production_meta.yield_locked` | omit phrase if false |

### Drill-down toggles

Both toggles persist to `production_meta` per-scenario:

| Toggle | Field | Effect |
|---|---|---|
| Customer ships raws | `production_meta.customer_ships_raws` | when true: PKG section sum is excluded from cost-stack PKG row |
| Allocate fees to unit cost | `production_meta.allocate_service_fees_to_unit_cost` | when true: NRE lines amortize per-unit; when false, they emit as separate `order_charges` rows post-quote |

### Drill-down line table

| Visible thing | Source | Null when |
|---|---|---|
| Line name | `production_lines.name` | required |
| Kind | `production_lines.kind` enum {per_unit, amortized_nre} | required |
| NRE total | `production_lines.nre_total` | required when kind=amortized_nre, null otherwise |
| Per-tier unit cost | `production_lines.{T1..Tn}_unit_cost` | for amortized_nre, this is the NRE total ÷ tier units (computed at write time, not display time, to avoid drift) |
| Markup % | `production_lines.markup_pct` | falls back to category default |

### Bulk-raw sub-section

| Visible thing | Source | Null when |
|---|---|---|
| Bulk raw cost per unit | `production_meta.bulk_raw_cost_per_unit` | optional — null = no formula entered yet |

### Post-production reconcile sub-section

| Visible thing | Source | Null when |
|---|---|---|
| Actual units produced | `production_runs.actual_units_produced` | null until run completes |
| Yield delta on NRE | derived: `nre_total / actual_units − nre_total / quoted_units` | null when actual_units null |
| Margin impact | derived: same delta projected onto sell price | null when actual_units null |
| Run locked | `production_runs.yield_locked` | bool, defaults false until accountant signs off |

The reconcile section is the only place where actuals overwrite the quote
math. It does not re-quote — it emits a `quote_reconciliation` record that
shows up in the audit log and (optionally) on the customer's final invoice.

---

## Freight section

### Section row

| Visible thing | Source | Null when |
|---|---|---|
| Status chip | derived: empty (0 lines) / in_progress (any line missing tier cost) / complete | always derivable |
| Owner | `quote_section_assignments.owner` for section='freight' | required |
| Mini-stack per-tier | `SUM(freight_lines.tier_breakdown[tier].per_unit) WHERE treatment = 'bundled'` (passthrough lines do NOT roll into the FRT row) | empty when no bundled lines |

### Drill-down — per-line

Each freight line is a row in `freight_lines`:

| Visible thing | Source | Null when |
|---|---|---|
| Label | `freight_lines.label` | required |
| Mode | `freight_lines.mode` enum {Ocean FCL, Ocean LCL, Air, LTL, Truckload, Direct} | required |
| Supplier | `freight_lines.supplier_id` → `suppliers.name` | required |
| Incoterm | `freight_lines.incoterm` enum {DDP, DAP, FOB, EXW} | required |
| Treatment | `freight_lines.treatment` enum {bundled, pass_through} | required (default bundled) |

### Per-tier within a line

`freight_lines.tier_breakdown` is a `jsonb` keyed by tier_id:

```jsonc
{
  "T1": { "total_freight": 1820, "per_unit": 0.36 },
  "T2": { "total_freight": 3200, "per_unit": 0.32 },
  "T4": { "total_freight": null, "per_unit": null }
}
```

`per_unit` is **stored**, not computed at display time. `total_freight` is
the carrier's quote; per_unit is total ÷ tier units. We persist both so
audit log can show the carrier's number even after tier units change.

### Customs sub-card

Only renders when `freight_lines.incoterm = 'DDP'`. Source: `freight_lines.customs` jsonb:

| Visible thing | Source | Null when |
|---|---|---|
| CBM / unit | `customs.cbm_per_unit` | required for DDP |
| Duty rate | `customs.duty_pct` | derived from HTS code lookup; manually overridable |
| Tariff (Section 301) | `customs.tariff_pct` | derived from country-of-origin × HTS; null for non-China origins |

For non-DDP incoterms the customs card does not render; duty + tariff move
to the customer's books.

---

## Status / chip cross-reference

| Chip | Source rule |
|---|---|
| `empty` | section has zero lines AND zero metadata |
| `in_progress` | section has lines but at least one tier × line cell is null |
| `complete` | every line has every tier filled |
| Margin: `good` | tier_subtotal ≥ firm.target_margin |
| Margin: `below_target` | tier_subtotal between firm.floor_margin and firm.target_margin |
| Margin: `bad` | tier_subtotal < firm.floor_margin (override token required to send) |
| Margin: `incomplete` | any cost-stack input null at this tier |

Firm-level `target_margin` and `floor_margin` come from the firm settings
surface (Round 5).

---

## Cross-surface contracts

- **Markup defaults** (Round 5) — packaging/production lines default
  `markup_pct` from `markup_categories.markup_pct`. Per-line overrides
  persist as `null` in `markup_pct` if untouched (so a category change
  cascades) or a concrete value if user typed one in.
- **Audit log** (Round 5) — every line edit, toggle flip, treatment change,
  and reconcile entry posts to `audit_events` with the section + line + diff.
- **Inventory** (TBD, post-MVP) — `inventory_eligible` packaging lines
  surface in the inventory pool for cross-project reuse. The flag is
  computed; the inventory pool is the destination, not the source.
- **HubSpot** (existing) — project metadata only. Cost stack does not sync.
