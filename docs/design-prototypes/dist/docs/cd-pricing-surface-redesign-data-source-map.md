# Pricing Surface Redesign · Data-source map

**Purpose:** Trace every visible field on the redesigned Pricing surface back to schema. The redesign is reorganization — most fields exist today; this map identifies (a) what's already in the schema, (b) what's a derived view, and (c) what's genuinely new.

**No new schema fields.** All "new" entries are derived/computed at render — they don't need DB migrations.

---

## Reading this map

| Column | Meaning |
|---|---|
| **Surface** | Where on the page the field appears |
| **Field** | The user-visible label |
| **Source** | `schema:...` (DB field) · `derived:...` (computed in classifier) · `policy:...` (firm-level setting) · `policy+classifier` (both) |
| **Status** | `existing` · `derived-new` (new derivation over existing data) · `new` (none today) |

---

## STATE zone

### State line · always rendered

| Field | Source | Status |
|---|---|---|
| `pill.status` (sendable/review/blocked/provisional) | `derived: PSR.classify(quote).state_line.status` | derived-new |
| `pill.dot` color | `derived: state.mode` | derived-new |
| `lead` ("All tiers above target" / "1 tier below floor" / etc.) | `derived: classifier composes from below_floor / below_target sets` | derived-new |
| `qualifier` ("2 SKUs over client target" / "1 cell awaiting raws" / "mixed status") | `derived: classifier composes from over_client_target + data_incomplete + per-SKU rollup` | derived-new |

**Note:** `state_line` is a value type computed by `classify()`. No surface composes the string independently.

### State callout (suggestion-led only)

| Field | Source | Status |
|---|---|---|
| `head` (`Tier N at X%`) | `derived: classifier picks worst-tier from below_target` | derived-new |
| `sub.blended_margin_pct` | `schema: quote.blended_margin_pct` | existing |
| `meta.target_margin_pct` | `policy: firm_settings.target_margin_pct` | existing |
| `meta.floor_margin_pct` | `policy: firm_settings.floor_margin_pct` | existing |

### State card (blocked only)

| Field | Source | Status |
|---|---|---|
| `pill` ("Cannot send") | `derived: state.mode === "blocked"` | derived-new |
| `lead` (`Tier N at X%`) | `derived: classifier picks worst-floor tier from below_floor` | derived-new |
| `sub.gap_pp` (Y pp below floor) | `derived: floor_margin_pct - worst_tier.min_margin_pct` | derived-new |
| `sub.affected_count` | `derived: state.below_floor.length` | derived-new |
| `right.blended_margin_pct` | `schema: quote.blended_margin_pct` | existing |
| `meta.target` | `policy: firm_settings.target_margin_pct` | existing |
| `meta.floor` | `policy: firm_settings.floor_margin_pct` | existing |
| `meta.over_client_target_count` (conditional) | `derived: state.flags.over_client_target_count` | derived-new |
| `meta.override_applied` (conditional) | `derived: tiers.some(t => t.has_override)` | derived-new |

---

## ACTION zone

### Sendable summary card (mode === sendable)

| Field | Source | Status |
|---|---|---|
| `scope.sku_count` | `schema: quote.skus.length` | existing |
| `scope.tier_count` | `schema: quote.tiers.length` | existing |
| `recommended_tier.id` | `schema: quote.recommended_tier_id` | existing |
| `recommended_tier.qty` | `schema: quote.tiers[recommended].qty` | existing |
| `order_value` | `derived: sum of (sell_unit × qty) across SKUs at recommended tier` | derived-new |
| `blended_margin_pct` | `schema: quote.blended_margin_pct` | existing |
| `target / floor reference` | `policy: firm_settings.{target, floor}_margin_pct` | existing |

**Component:** `SendableSummary` — flagged as **new component** in CC scope. Schema requirements are all existing fields.

### Action cards (all modes)

| Field | Source | Status |
|---|---|---|
| `action.kind` | `derived: classifier.actions[].kind` | derived-new |
| `action.label`, `action.sublabel` | `derived: classifier composes per mode + suggestion availability` | derived-new |
| `action.recommended` | `derived: classifier ranks per heuristic (designer notes §4.5)` | derived-new |
| `action.disabled` (provisional sendable) | `derived: state.flags.data_incomplete && mode === "sendable"` | derived-new |
| `action.disabled_reason` | `derived: cell-count + reason string` | derived-new |

### Suggestion card (suggestion-led)

| Field | Source | Status |
|---|---|---|
| `surgical.tier_id` | `schema: quote.suggestions.surgical.tier_id` | existing |
| `surgical.lift_pct` | `schema: quote.suggestions.surgical.lift_pct` | existing |
| `surgical.new_margin` | `schema: quote.suggestions.surgical.new_margin` (precomputed by suggestion engine) | existing |
| `global.lift_pct` | `schema: quote.suggestions.global.lift_pct` | existing |
| `global.new_blended` | `schema: quote.suggestions.global.new_blended` | existing |
| `preview.blended_after_apply` | `derived: classifier projects post-apply blended` | derived-new |

### Accept-risk banner (blocked + policy.allow_accept_risk === false)

| Field | Source | Status |
|---|---|---|
| `visibility` | `policy: firm_settings.allow_accept_risk` + `derived: mode === "blocked"` | existing |
| Banner copy | static | n/a |

---

## DETAIL zone (collapsed by default)

### Global price adjustment

| Field | Source | Status |
|---|---|---|
| `lift_pct` (input) | `schema: quote.global_lift_pct` (writable) | existing |
| Preview action | calls existing `recompute()` endpoint | existing |

### Per-tier compliance table

| Field | Source | Status |
|---|---|---|
| `tier.id`, `tier.qty` | `schema: quote.tiers[].id, qty` | existing |
| `tier.min_margin_pct` | `derived: classifier per-tier rollup` | derived-new |
| `tier.blended_margin_pct` | `derived: classifier per-tier blended` | derived-new |
| `tier.status` (above/below target/below floor/unknown) | `derived: classifier comparator vs policy` | derived-new |
| `tier.has_override` (OVR chip) | `schema: quote.cells[*].override_applied` aggregated to tier | existing |

### Cost stack (per-tier × per-component)

| Field | Source | Status |
|---|---|---|
| `cost_stack.pkg`, `prod`, `frt`, `dt` (per cell) | `schema: quote.cells[sku × tier].cost_stack` | existing |
| Per-tier rollup (averaged across SKUs) | `derived: simple mean` | derived-new |
| `unit_cost` per tier | `derived: sum of components` | derived-new |
| `sell_unit` per tier | `schema: quote.cells[*].sell_unit` (averaged) | existing |
| `margin` per tier | `derived: (sell - cost) / sell` | derived-new |

### Per-SKU breakdown

| Field | Source | Status |
|---|---|---|
| `sku.id`, `sku.name` | `schema: quote.skus[]` | existing |
| `sku.min_margin_pct` | `derived: classifier per-SKU rollup` | derived-new |
| `sku.status` | `derived: classifier per-SKU comparator` | derived-new |
| `sku.over_client_target` | `derived: any tier's sell_unit > client_target_unit` | derived-new |
| `sku.all_tiers[].margin_pct` (mini bars) | `schema: quote.cells[sku × tier].margin_pct` | existing |
| `sku.client_target_unit` (in meta line) | `schema: quote.skus[].client_target_unit` | existing |

### Reference tiles (DETAIL bottom)

| Field | Source | Status |
|---|---|---|
| `most_headroom_tier` | `derived: tier with highest min_margin_pct` | derived-new |
| `client_benchmark_count` | `derived: count of SKUs with non-null client_target_unit` | derived-new |

---

## Classifier output contract

The classifier (`PSR.classify(quote)`) returns a single value type consumed by every surface. CC handoff: model this as `QuoteState` in TS / Python; do not derive state in components.

```ts
interface Cell {
  sku_id: string
  tier_id: number
  margin_pct: number | null
  sell_unit: number | null
  cost_unit: number | null
  cost_stack: { pkg: number; prod: number; frt: number; dt: number } | null
  client_target_unit: number | null
  client_target_delta: number | null    // sell_unit - client_target_unit
  over_client_target: boolean
  missing: boolean
  status: "above_target" | "below_target" | "below_floor" | "unknown"
  override_applied: boolean
}

interface Action {
  kind: "preview_pdf" | "apply_surgical" | "apply_global"
      | "request_override" | "override_unavailable" | "tighten_to_target"
      | "calculating_suggestion"
  label: string
  sublabel: string | null
  recommended: boolean
  primary: boolean
  demoted?: boolean
  soft?: boolean
  disabled?: boolean
  disabled_reason?: string
  projected_blended_after_apply?: number | null  // populated on apply_surgical / apply_global
}

interface QuoteState {
  mode: "sendable" | "suggestion_led" | "blocked"
  mode_label: string
  blended_margin_pct: number | null
  state_line: { lead: string; status: "sendable"|"review"|"blocked"|"provisional"; qualifiers: string[] }
  summary_card: SummaryCard | null  // populated when mode === "sendable"
  flags: {
    over_client_target: boolean
    over_client_target_count: number
    data_incomplete: boolean
    missing_count: number
    override_applied: boolean
    accept_risk_unavailable: boolean
    override_unavailable: boolean   // mode === "blocked" && !policy.allow_override
  }
  tiers: TierRollup[]      // per-tier: min_margin, blended_margin, status, has_override
  skus: SkuRollup[]        // per-SKU: min_margin, status, over_client_target, all_tiers[]
  cells: Cell[]            // flat (sku × tier) cells — each carries classifier-assigned status
  below_floor: Cell[]
  below_target: Cell[]
  over_client_target: Cell[]
  actions: Action[]        // ranked; exactly one carries recommended: true (when multi)
  policy: Policy
  quote: Quote             // raw input retained for callbacks
}
```

**§3 source-of-truth rule (codified, post-ship review):**
- `cell.status` is classifier-owned. No component re-derives floor / target / above-target.
- `action.projected_blended_after_apply` is classifier-owned. SuggestionCard reads, never computes.
- `state_line.qualifiers` is classifier-owned. State line never composes copy from flags directly.
- Missing-suggestion case emits `kind: "calculating_suggestion"` so render path never depends on fabricated data.
- `allow_override: false` emits `kind: "override_unavailable"` so the PM sees the policy reality, not a missing button.

---

## Net new schema

**None.** Every visible field traces to existing schema or a classifier-side derivation. The redesign ships without DB changes — only impl changes to the parent Pricing surface composition.

The one *new component* (`SendableSummary`) reads only existing schema fields; it's new chrome, not new data.

---

## Mode-aware logic queries

For CC reference — what changes per render based on `mode`:

- `STATE zone` — adds StateCallout (suggestion-led) or StateCard (blocked)
- `ACTION zone` — switches between SendableSummary, SuggestionCard, RankedActions
- `DETAIL zone` — content identical across modes; only the collapsed default changes (always collapsed v1)
- `actions[].recommended` — classifier ranks differently per mode (see designer notes §4.5)
- `state_line.qualifiers` — compose differently per mode + flag composition

All of these are pure functions of `(quote, policy)` — same input → same output. No persistent per-PM preference in v1.
