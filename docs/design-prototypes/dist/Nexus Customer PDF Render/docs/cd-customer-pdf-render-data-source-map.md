# CD — Customer-Facing PDF Render Layer · Data-source map

Every rendered block traced to its brief-§4 source, so CC can wire the render without guessing (Pattern 45). The customer-view projection is the only input; no costing-surface field reaches this tree (boundary guard, brief §1).

**Source legend:** `§4` = field named in the brief's locked data shape · `LOCKED` = vendor identity strings fixed in brief §4 · `DERIVED` = composed from §4 fields at render · `TREATMENT` = render-only flag, not a stored customer field · `PREVIEW` = prototype chrome, not in the artifact.

Prototype data object: `window.NXCPDF` (`app/cpdf/data.js`).

---

## Page chrome — every page

| Rendered element | Source | Field / note |
|---|---|---|
| Vendor name `The DPS` | LOCKED | `vendor.name` |
| Vendor tagline | LOCKED | `vendor.sub` — "Turnkey product development & manufacturing…" |
| Vendor address | LOCKED | `vendor.address` — 3943 Irvine Blvd, #1129, Irvine, CA 92602 |
| Vendor contact (prepared-by) | §4 | `vendor.{contact_name, contact_email, contact_phone}` |
| Quotation number `DPS-2418` | §4 | `quote.quote_number` — friendly id. **Never** `version_number` / `scenario_label`. |
| Issued date | §4 | `quote.issued_date` |
| Valid until | §4 | `quote.valid_until` |
| Footer · vendor + quote # + Page X of Y | DERIVED | `vendor.name` + `quote.quote_number` + react-pdf `pageNumber`/`totalPages`. `fixed` on every page. |
| Running header (continuation) | DERIVED | `vendor.name` + `quote.quote_number` + "continued". `fixed` on pages 2+ only. |

## Parties block — first page only

| Rendered element | Source | Field / note |
|---|---|---|
| Prepared-for name | §4 | `customer.name` (HubSpot projection) |
| Prepared-for contact / role | §4 | `customer.{contact, role}` |
| Prepared-for email / address | §4 | `customer.{email, address}` |
| Prepared-by block | §4 / LOCKED | `vendor.*` (as above) |

## Pricing table

| Rendered element | Source | Field / note |
|---|---|---|
| Per-SKU row (name, code, pack) | §4 | `skus[i].{name, code, pack}` — customer-visible subset only |
| Per-tier unit price | §4 | `skus[i].tier_prices[t]` |
| Tier column header + qty | §4 | `tiers[t].{label, full, quantity}` |
| Recommended-tier treatment | §4 | `tiers[t].recommended` (one tier flagged) → bracket + ★ + weight + tint |
| "quote on request" cell | §4 | `tier_prices[t] == null` → NULL-as-signal. Never `$0.00`. |
| Flat-pricing treatment | TREATMENT | `skus[i].shape === "flat"` → price in first tier, em-dash rest, "Flat across all volume tiers" caption. (Drives render; mirrors `is_flat_pricing`.) |
| Partial-completeness treatment | TREATMENT | `skus[i].shape === "partial"` → at least one NULL tier; triggers inline sub-header copy + legend |
| Continued-table caption | DERIVED | "Tiered pricing · continued — {quote_number}" on overflow pages |
| Layout (`tier_table` / `single_tier`) | §1 / Slice 11 | `pdf_layout` — PM picks at send; both render from one tree. `single_tier` shows the recommended tier column only. |

> **Not rendered:** `skus[i].retail_benchmark` exists in the projection but is intentionally omitted — not in the brief §4 customer field list (see designer notes §6). Held as a future per-quote toggle.

## Charges block — state B only (visible when fees/freight non-empty)

| Rendered element | Source | Field / note |
|---|---|---|
| Project-scope service fee | §4 | `service_fees[i] where scope='project'` — `{label, sub, amount, qty_label}` |
| SKU-scope service fee | §4 | `service_fees[i] where scope='sku'` |
| Pass-through freight line | §4 | `freight_lines[i].{label, sub, qty_label}` + `tier_amounts[recommendedTierIdx]` (recommended tier shown; per-tier on request) |
| "Charges shown for {tier}" sub-line | DERIVED | composed from `tiers[recommendedTierIdx]` |

## Commercial terms

| Rendered element | Source | Field / note |
|---|---|---|
| Valid until | §4 | `quote.valid_until` |
| Payment terms | §4 | `quote.payment_terms` |
| Lead time | §4 | `quote.lead_time` |
| Incoterms | §4 | `quote.incoterms_bundled` (state A/C) or `quote.incoterms_passthrough` (state B) — derived from freight treatment |
| Customer-facing notes | §4 | `quote.customer_facing_notes` (distinct from internal notes — separate field) |
| "How to accept" copy | DERIVED | static customer-facing instruction; no field dependency |

## State selectors

| State | Source | Production trigger |
|---|---|---|
| A · Pure tier-pricing | §1 | `freight_treatment='bundled'` AND `allocate_service_fees_to_cost=TRUE` → no charges block, single page |
| B · Pass-through + fees | §1 | `freight_treatment='pass_through'` OR `allocate_service_fees_to_cost=FALSE` → charges block, spills to page 2 |
| C · Partial completeness | §1 | `tier_prices[t] == null` for ≥1 SKU → "quote on request" cells + inline sub-header |
| State strip / layout toggle / theme | PREVIEW | prototype navigation only — production renders one state + the sent `pdf_layout` |

## Forbidden fields — asserted absent (brief §1 boundary guard)

None of the following exists anywhere in `window.NXCPDF` or the `.pp-*` tree: `margin_pct` · `markup_pct` · cost components / cost stack · supplier names · `duty_pct` · `tariff_pct` · `sku_total_cbm` · `version_number` · `scenario_label` · audit fields · presence indicators · internal notes · any QA/debug affordance. Enforcement is a build-time import assertion on `<PdfPage>` and descendants (R3 commitment #3); this prototype demonstrates a tree that satisfies it.

---

## Addendum 1 — totals & turnkey-only (sell-price derived; no schema change)

| Rendered element | Source | Field / formula |
|---|---|---|
| Line total (per priced cell) | DERIVED | `skus[i].tier_prices[t] × tiers[t].quantity` — ASY (finished-good) sell price only, never component/BOM math |
| Grand turnkey total (per tier) | DERIVED | `Σ line totals for tier t` `+ allocated/bundled service fees` (state B only). **Pass-through freight excluded** — rendered as a separate "plus freight at cost" note. |
| Turnkey per-unit (per tier) | DERIVED | `grand total ÷ (priced SKU count × tiers[t].quantity)` — blended all-in unit price; shown under every turnkey figure (grand row, cards, hero) |
| Folded service-fee amount | §4 | `Σ service_fees[i].amount` (= $14,400) — folded into the total in state B; itemized in the charges block; "all-in / included in unit price" in states A & C |
| Held-out freight note | §4 | `freight_lines[*]` exist → "plus outbound freight, billed at cost" (state B) |
| "from $X" grand (itemized) | DERIVED | tier has ≥1 NULL line → sum of priced lines, prefixed "from", + pending-line footnote |
| "total on request" (turnkey-only) | DERIVED | tier has ≥1 NULL line → no figure shown; "total on request" + pending-line note |
| `detail_level` (`itemized` / `turnkey_only`) | §3 (addendum) | orthogonal to `pdf_layout`; `turnkey_only` suppresses SKU rows + itemized charges block |
| Turnkey "what's included" scope | DERIVED | `skus[*].code` list + freight/fee inclusion flags composed from state |

**Pagination note:** `turnkey_only` carries no itemized charges block, so the pass-through state collapses 2 pages → 1. Footers reflect the actual page count.

**Boundary reaffirmed:** every Addendum-1 number is a sum or product of customer-visible sell prices and quantities. No cost, margin, markup, or BOM figure is read or derivable from this tree.
