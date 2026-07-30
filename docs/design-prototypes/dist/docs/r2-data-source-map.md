# Round 2 — Data-source map

Every visible field maps back to either schema you've already built, a named upcoming slice (9.1–9.5), something in the backlog, or — flagged honestly — pure design wishfulness. If it's not on this list, I drew it from nothing and you should ask.

**Legend:**

- **EXISTING** — schema/code already shipped
- **SLICE 9.x** — scoped slice you'll build
- **BACKLOG** — in the backlog, not committed to a slice
- **WISHFUL** — design assumption · needs sign-off

---

## Cost Build · screen (22 elements)

| UI element | Source | Schema field / origin | Note |
|---|---|---|---|
| SKU label, name, pack | EXISTING | `quote_skus.label, .name, .pack` | Schema as defined. |
| Tier label, quantity | EXISTING | `quote_tiers.label, .quantity` | Schema. |
| Tier · client target price chip | SLICE 9.1 | `quote_tiers.client_target_price_per_unit` | Defined in 9.1, displayed here as small caption under each tier card. |
| Cost groups (Pkg / Prod / Frt) | EXISTING | `packaging_inputs / production_inputs / freight_inputs` | Three tables → three groups. Direct mapping. |
| Per-row markup % chip | EXISTING | `<table>_inputs.markup_pct + .markup_pct_source` | Override dot fired off `markup_pct_source === 'override'`. |
| '+5%' override marker (•) | EXISTING | `markup_pct_source = 'override'` | Visible signal for the overridden case (vs category default). Tooltip hints at the source field. |
| Allocated-fee meta line ('$5,250 ÷ 25k') | WISHFUL | *(none — display-only string in mock)* | Real implementation needs an `allocation_source` field on `production_inputs` OR a sibling table. Flagged: displaying provenance the schema doesn't capture yet. |
| Owner badge ('owned by Purchasing') | BACKLOG | `users.role + (assignment rule, TBD)` | Backlog: who-owns-which-cost-group. Maps cleanly to user roles. |
| Cost cell value + empty 'awaiting input' | EXISTING | `<table>_inputs.unit_cost` (NULL = empty) | NULL is the empty signal. Already in the schema. |
| Freight 'bundled vs pass-through' meta line | EXISTING | `freight_inputs.freight_treatment` | One of two enums per CLAUDE.md. |
| Internal zone — duty + tariff | EXISTING | `quote_skus.duty_pct, .tariff_pct` | Live on the SKU per CLAUDE.md ('NEVER customer-facing'). Visual ribbon enforces the never-leak rule. |
| Internal zone — CBM | EXISTING | `freight_inputs.sku_total_cbm` | Internal-only field; allocates container costs. Same zone. |
| Internal zone — landed freight w/ markup | EXISTING | `lib/costing.ts` → freight roll-up | Computed per the documented formula: `(containerFrt + duty + tariff) × (1 + markup)`. |
| Cost stack (Pkg \| Prod \| Frt \| Customs \| Markup \| Adj) | EXISTING | all of the above, summed | Visualization of contribution → required sell. Pure presentation; no new fields. |
| Required sell · per unit | EXISTING | `lib/costing.ts` → `required_sell` | Documented formula. |
| Margin verdict + range | EXISTING | `firm_settings.target_margin_pct, .floor_margin_pct` | Versioned firm settings; threshold colors keyed to those. |
| Tier comparison rail (mini margin meters) | EXISTING | `tierMath()` over each `tier_id` | Per-tier compute already implied by your tier-math. UI synthesis. |
| 'Live · 2 here' presence chip | BACKLOG | *(realtime presence — backlog)* | Marked BACKLOG in the UI as a chip. Design assumes it ships eventually; flow works without it. |
| 'Demo · focus aluminum collar' button | WISHFUL | *(deep-link semantics — design intent only)* | Stands in for: `/quote/Q.../build?focus=pkg-row-id`. URL contract not specified yet — flagged wishful. |
| 'Fresh' dot on rows updated since last visit | BACKLOG | `audit_log.updated_at + viewer.last_seen_at` | Backlog: per-row 'changed since X' diff. Not in any named slice. |
| 'Read-only' badge for non-owner roles | BACKLOG | `users.role + write-permission rule` | Backlog: role-based field permissions. Design degrades gracefully if everyone can edit everything. |
| Day 1 / Day 4 / Day 6 stage helper text | WISHFUL | *(none — design narrative)* | The states are real (NULL counts in the data drive them); the helper sentence is design copy I picked. |

## Costing Sheet · screen (20 elements)

| UI element | Source | Schema field / origin | Note |
|---|---|---|---|
| Blended margin · big number | EXISTING | `avg(margin) over (sku × tier) cells` | Computed from existing fields. |
| Quote target override chip | SLICE 9.2 | `quotes.target_margin_pct` (NULL → fall back to `firm_settings`) | 9.2 line item. Surfaced as a chip when set; absent when null. |
| Global price adjustment slider | EXISTING | `quotes.global_price_adj_pct` | Already in the schema. |
| System suggestion ('+8.5%') + Apply button | WISHFUL | *(optimization — design only)* | Computed live in the prototype by sweeping GPA. The suggestion math itself isn't a backlog item — proposing it as one. |
| Per-tier override slider + ↺ inherit | SLICE 9.2 | `quote_tiers.tier_price_adj_pct` (NULL → inherit) | 9.2 line item; UI exposes the NULL semantic via the inherit button. |
| Per-cell sell override (the 'OVR' badge) | SLICE 9.3 | `quote_sku_tiers.sell_price_override` (NULL = computed) | 9.3 — but pushed back: NOT a global mode toggle, a per-cell escape hatch. See designer notes. |
| ↺ Revert override button | SLICE 9.3 | setting `sell_price_override = NULL` | Same field, NULL signals 'use computed'. |
| Two-axis verdict pill (margin · client) | SLICE 9.4 | `margin_pct` vs floor + sell vs `client_target_price_per_unit` | 9.4 calls for client benchmarking; this surfaces both axes side-by-side. |
| 'COMPETITIVE / OVER CLIENT TARGET / NO TARGET' | SLICE 9.4 | derived from `client_target_price_per_unit` comparison | Three states; NO TARGET when the field is NULL on that tier. |
| '→ match target' inline action | SLICE 9.4 | writes `sell_price_override = client_target_price_per_unit` | Composes 9.3 + 9.4. Cheap to ship once both lands. |
| 'gap: $0.42' caption | SLICE 9.4 | `sell - client_target_price_per_unit` | Pure derivation. |
| Lines requiring review · panel | SLICE 9.5 | `quote_warnings` (filtered to `severity='high'`) | 9.5 explicitly defines this table. UI groups + sorts. |
| Warning row metadata (quote, tier, message) | SLICE 9.5 | `quote_warnings.*` (sku/tier/message/severity) | Direct field mapping. |
| 'Most headroom' card | EXISTING | `argmax(margin) over cells` | Derived presentation. |
| 'Headroom: 3.2pp above target' caption | EXISTING | `margin - target_margin_pct` | Pure derivation. |
| Per-SKU breakdown card · margin number | EXISTING | `lib/costing.ts` → `margin_pct per (sku, tier)` | Existing computation. |
| All-tiers sparkline (4 mini meters) | EXISTING | `tierMath()` across all 4 tiers | Just visualization. |
| 'UNDERPRICED' SKU badge | EXISTING | `margin < floor_margin_pct` | Threshold from `firm_settings`. |
| Mark Accepted (locked w/ admin override) | BACKLOG | `quotes.status` enum + acceptance gate rule | The schema for accepted/sent statuses isn't in the slices I've seen. Marked BACKLOG. UI shows the gated state regardless. |
| Preview customer quote button | BACKLOG | *(routes to customer-view — Round 3)* | Out of round-2 scope; affordance present. |

## Shell · chrome (6 elements)

| UI element | Source | Schema field / origin | Note |
|---|---|---|---|
| Sidebar nav | EXISTING | *(routing only — no DB)* | Pure UI. |
| Breadcrumbs | EXISTING | `projects.client + quotes.version_number` | Already in schema. |
| Top-bar presence chip | BACKLOG | realtime presence | Same as Cost Build presence — flagged backlog in chip itself. |
| ⌘K affordance | BACKLOG | *(global search — no slice yet)* | Sketched as a button only; full search is a separate effort. |
| User avatar bottom of sidebar | EXISTING | `users.name, .initials, .role` | Schema. |
| Tweaks panel (theme, scenario, viewer) | WISHFUL | *(prototype-only)* | Demo controls — not part of the product. |

## The honest count

| Source | Count | Sub |
|---|---|---|
| EXISTING | 27 | of 48 elements |
| SLICE 9.1–9.5 | 11 | across slices 9.1–9.5 |
| BACKLOG | 7 | named & ready to scope |
| WISHFUL | 3 | design-only · need sign-off |

Three wishful elements: the allocated-fee provenance string, the deep-link URL contract, and the system-suggested GPA computation. Of those, the GPA suggestion is the one I'd actually push to scope — it's a one-day add and changes how the costing sheet feels.

*(Note: all three WISHFUL items were subsequently committed in Round 2 sign-off — see designer notes.)*
