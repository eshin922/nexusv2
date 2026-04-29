# DPS Quoting Tool — Technical Requirements & Goals (v3)

**Status:** Final draft — this is the spec we build against
**Owner:** Edward Shin (The DPS)
**Last updated:** April 28, 2026
**Replaces:** v1 (April 28, 2026), v2 (April 28, 2026)

---

## What changed from v2

v2 adopted the hybrid workbook's multi-input architecture. v3 adds the product decisions made during the brainstorm session that followed:

- **Multi-tier is in v1, not deferred.** Volume tiers are configurable per quote, factory-driven (each quote can define its own tier structure based on supplier MOQs). The four input tables become per-(SKU, tier).
- **Markup model is finalized.** Per-category markups stay (encode commercial discipline). Global Price Adjustment % stays with an explicit purpose: tune blended quote margin toward a firm-level target. Two firm-policy benchmarks (target margin %, floor margin %) live at the org level. Three-state quote-level check (GOOD / BELOW TARGET soft warning / BELOW FLOOR hard block).
- **Deal Organizer is a v1 feature.** Project-centric list view, lazy creation (deals enter the tool when a PM imports them).
- **Scenarios.** Quotes have a `scenario_label`. Multiple scenarios per project, flip-between view, no side-by-side compare in v1.
- **Four create-quote actions** — New Version, New Scenario, Copy Scenario, Copy Quote to Project — each with explicit field-bucket semantics (cloneable / inherited / reset).
- **`copied_from_quote_id` traceability** on every copy operation.
- **Firm settings** as a new admin-managed concept (target margin, floor margin).
- **Mark-Accepted blocks now have two independent gates:** line-level UNDERPRICED, and quote-level BELOW FLOOR. Admin override required for either.

Sections 7, 8, 9 (Lifecycle, Non-Functional, Tech Stack) are unchanged from v2.

---

## 1. Project Overview

A custom internal web application that replaces The DPS's family of cost worksheets (360 packaging worksheet, turnkey workbook, hybrid workbook) with a structured, role-aware browser application. The app pulls deal context from HubSpot, lets multiple roles populate four cost-input surfaces (Packaging, Freight, Production, Inventory), derives a unified Costing Sheet with margin guardrails enforced against firm-level policy, supports volume tiers and parallel scenarios for negotiation, generates a customer-facing PDF, and writes structured line items (with COGS) back to HubSpot when a quote is accepted — feeding the existing HubSpot → NetSuite Sales Order sync unchanged.

The build is sliced for incremental delivery. **Slice 12 is the MVP cutline** — at that point the tool replaces Excel for net-new quote builds. Slices 13–17 add the workspace features (deal organizer, scenarios, copy operations, dashboard) that make the tool a real workspace rather than just a quote builder.

---

## 2. Goals & Non-Goals

### v1 Goals

1. Replace all existing cost worksheets as the canonical quote-build surface.
2. Structured, queryable record for every quote and every cost input in Postgres.
3. Pull deal/client/owner context from HubSpot on import; write structured line items + COGS back on accept.
4. Four input surfaces (Packaging, Freight, Production; Inventory schema in v1, UI in v2), role-aware pages.
5. Multi-tier volume pricing with per-(SKU, tier) cost data.
6. Auto-derived Costing Sheet, Quote view, Management Dashboard.
7. Margin guardrails enforced at line level (UNDERPRICED) and quote level (BELOW TARGET / BELOW FLOOR).
8. Project-centric Deal Organizer with lazy import.
9. Parallel scenarios per project with four create-quote actions.
10. Firm-level admin policy (target/floor margin %, markup defaults) editable without code changes.
11. Schema designed so v2 features (Inventory UI, NetSuite reconciliation, vendor master, formulation depth, AI retrieval) are additive.

### v1 Non-Goals (deferred to v2 or later)

- NetSuite integration (read or write).
- Quoted-vs-actual reconciliation against vendor invoices.
- Vendor / ingredient master with historical pricing.
- Turnkey formulation depth (ingredient % × fill weight × MOQ amortized cost).
- Inventory accounting *operational* features (schema in v1, UI in v2).
- Reorder workflow (cloning a locked quote with tooling stripped).
- Approval workflow as a multi-step state machine (v1 has gates and admin overrides; multi-approver workflow is v2).
- AI-powered retrieval, drafting, or suggestion features.
- Mobile-optimized UI.
- Side-by-side scenario comparison (flip-between only in v1).
- Save-as-template / templates library (the `copied_from_quote_id` field enables it; the explicit UI is v2).

---

## 3. Users, Roles & Access

| Role | Pages they own (write) | Pages they read |
|---|---|---|
| **PM / Sales Rep** | Quote header, Quote view (sell-price overrides), Mark-Accepted | All input pages, Costing Sheet, Mgmt Dashboard, Deal Organizer |
| **Purchasing** | Packaging Inputs page | Costing Sheet (own line context) |
| **Production** | Production Costs page | Packaging (read), Costing Sheet |
| **Accounting** | Inventory Movements (v2 UI; v1 is schema-only) | All pages (read), Costing Sheet, Mgmt Dashboard |
| **Admin** (Edward + 1 backup) | All of the above + Firm Settings + Markup Defaults + User Management + Audit Log + override authority | Everything |
| **Read-only / Leadership** | None | Costing Sheet, Mgmt Dashboard, Deal Organizer, Project Detail |

In practice, one human wears multiple roles. Permissions are role-based and apply at the page level, not per-project. v1 has no per-project visibility restrictions.

### Authentication

Google SSO via Clerk, restricted to `@thedps.co` email domain. 30-day sessions with refresh.

---

## 4. System Architecture

```
                                    [ HubSpot ]
                                    ↑          ↓
                                    │ (write   │ (read deal
                                    │  on      │  context, on
                                    │  accept) │  PM import)
                                    │          ↓
[ Purchasing ] ┐
[ Freight ]    │ → 4 input          │
[ Production ] │   surfaces  ──→ [ Costing Sheet ]  →  [ Quote ]  →  [ PDF ]
[ Inventory* ] ┘   (Postgres)      (derived view,        (derived       (out)
                                    per-tier cols)        view)
                                          │
                                          ↓
                                  [ Mgmt Dashboard ]
                                          ↑
                                  [ Firm Settings ]
                                  (target/floor margins)

[ NetSuite ]  ←  [ HubSpot ]  ← (existing sync, unchanged in v1)

* Inventory tables exist in v1 schema; UI is v2.
```

### Integration points (unchanged from v2)

HubSpot read on PM import. HubSpot write on Mark-Accepted (Quote object create/update, line items with `hs_cost_of_goods_sold`, deal-level `amount`, `est__revenue`, `costing_sheet`). v2 webhook on `dealstage` pre-authorized in OAuth scopes.

---

## 5. Data Model

### Layers

1. **Identity:** `users`, `projects`, `quotes`, `quote_skus`, `quote_tiers`.
2. **Inputs (the four surfaces):** `packaging_inputs`, `freight_inputs`, `production_inputs`, `inventory_movements`. Each is keyed by `(quote_sku_id, tier_id)`.
3. **Reference / policy:** `firm_settings`, `markup_defaults`, `audit_log`.
4. **Derived (views, not tables):** Costing Sheet, Quote, Management Dashboard.

---

### Identity layer

#### `users`
| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| clerk_user_id | text | unique |
| email | text | unique, must end `@thedps.co` |
| name | text | |
| role | enum | `admin` / `pm` / `purchasing` / `production` / `accounting` / `read_only` |
| hubspot_owner_id | text | nullable |
| created_at, updated_at | timestamptz | |

#### `projects`
One row per HubSpot deal that a PM has imported into the tool. **Lazy creation** — a deal does not appear in the tool until a PM explicitly imports it.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| hubspot_deal_id | text | unique, indexed |
| deal_name | text | snapshot from HubSpot at import; refreshable |
| client_name | text | snapshot from HubSpot company |
| sales_rep_user_id | uuid | FK → users; nullable |
| pm_user_id | uuid | FK → users; nullable |
| project_category | enum | `packaging` (v1 default) / `turnkey` / `soft_goods` / `secondary` / `other` |
| status | enum | `active` / `archived` |
| imported_at | timestamptz | when PM brought the deal into the tool |
| imported_by_user_id | uuid | FK → users |
| created_at, updated_at | timestamptz | |

#### `quotes`
One row per quote version. Multiple per scenario (linear versioning); multiple scenarios per project (parallel branches).

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| project_id | uuid | FK → projects |
| **scenario_label** | text | default `"Primary"` |
| **scenario_status** | enum | `active` / `dropped` / `accepted` |
| version_number | int | auto-increment within `(project_id, scenario_label)` |
| status | enum | `draft` / `sent` / `accepted` / `superseded` / `lost` |
| accepted_at, sent_at | timestamptz | nullable |
| accepted_by_user_id | uuid | FK → users; nullable |
| **accepted_tier_id** | uuid | FK → quote_tiers; the tier the customer accepted; nullable until accept |
| accept_source | enum | `manual_button` (v1) / `hubspot_stage_change` (v2) / `api` |
| pdf_url | text | nullable |
| hubspot_quote_id | text | nullable, populated after writeback |
| **global_price_adj_pct** | numeric(5,4) | per-quote markup tuning knob; default 0; can be negative |
| **copied_from_quote_id** | uuid | FK → quotes; nullable; recorded on all copy actions for traceability |
| customer_facing_notes | text | nullable, on PDF |
| internal_notes | text | nullable, never on PDF |
| valid_until | date | defaults to send_date + 30 days |
| accepted_snapshot_json | jsonb | nullable; immutable snapshot at accept time. v2 promotes to `locked_baselines` table |
| underpriced_override_user_id | uuid | FK → users; nullable; admin who overrode the gate |
| underpriced_override_reason | text | nullable; required if override is set |
| created_at, updated_at | timestamptz | |
| created_by_user_id | uuid | FK → users |

#### `quote_tiers`
Volume tiers per quote. Configurable per quote — each quote defines its own tier structure based on what factory MOQs support.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_id | uuid | FK → quotes |
| label | text | e.g., `"Tier 1 — 10k"` |
| qty | int | volume for this tier |
| sort_order | int | |

Presets dropdown for fast tier setup: "Packaging — Domestic" (5k/10k/25k/50k), "Packaging — Overseas" (25k/50k/100k/250k), "Soft Goods" (1k/5k/10k), "Single Volume," "Custom."

#### `quote_skus`
One row per SKU per quote.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_id | uuid | FK → quotes |
| sku_label | text | user-facing SKU code |
| product_name | text | |
| product_category | enum | from Lists |
| packaging_category | enum | from Lists |
| units_per_pack | int | default 1 |
| retail_benchmark | numeric(10,4) | nullable; customer's intended retail per unit |
| sort_order | int | |
| notes | text | nullable |

Note: `customer_qty` is **not** on `quote_skus` in v3 — qty lives on `quote_tiers`. The (sku, tier) pair determines volume.

---

### Input layer

Every input table is keyed by `(quote_sku_id, tier_id)`. v1 requires a row per active tier; copy-from-tier-N affordance in the UI for fast data entry when values are similar across tiers.

#### `packaging_inputs`
| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_sku_id | uuid | FK |
| tier_id | uuid | FK |
| supplier | text | free text in v1 |
| qty_per_sellable_unit | numeric | |
| purchase_qty | numeric | |
| unit_cost | numeric(10,4) | |
| markup_pct | numeric(5,4) | category default, override flagged |
| markup_pct_source | enum | `category_default` / `manual_override` |
| inventory_eligible | bool | |
| notes | text | |
| created_at, updated_at | timestamptz | |

#### `freight_inputs`
| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_sku_id | uuid | FK |
| tier_id | uuid | FK |
| shipment_id | text | optional reference |
| freight_mode | enum | from Lists |
| allocation_basis | enum | `weight` / `units` / `flat` |
| total_freight | numeric(12,2) | |
| markup_pct | numeric(5,4) | default 30% |
| units_in_shipment | int | |
| **freight_treatment** | enum | `pass_through` / `bundled` |
| notes | text | |
| created_at, updated_at | timestamptz | |

#### `production_inputs`
| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_sku_id | uuid | FK |
| tier_id | uuid | FK |
| customer_ships_raws | bool | |
| actual_units_produced | int | nullable, post-production |
| filling_blending_cost | numeric(12,2) | |
| cm_assembly_total | numeric(12,2) | |
| setup_fee_total | numeric(12,2) | |
| tooling_artwork_total | numeric(12,2) | |
| rd_total | numeric(12,2) | |
| other_service_total | numeric(12,2) | |
| bulk_raw_cost | numeric(12,2) | meaningful only if customer_ships_raws = false |
| **allocate_service_fees_to_cost** | bool | true → NRE amortizes into unit cost; false → carried separately |
| notes | text | |
| created_at, updated_at | timestamptz | |

#### `inventory_movements` *(schema in v1, UI in v2)*
| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| quote_sku_id | uuid | FK |
| tier_id | uuid | FK; nullable (project-level inventory may not be tier-specific) |
| movement_type | enum | `beginning` / `produced` / `sold` / `adjusted` |
| qty | int | |
| occurred_on | date | |
| notes | text | |
| created_at | timestamptz | |
| created_by_user_id | uuid | FK |

---

### Reference / policy layer

#### `firm_settings`
Org-level policy. Single row (or one row per active version with effective dates). Admin-only writes.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| **target_margin_pct** | numeric(5,4) | default 0.35 (35%) |
| **floor_margin_pct** | numeric(5,4) | default 0.25 (25%) |
| effective_from | date | |
| effective_until | date | nullable; null = current |
| updated_by_user_id | uuid | FK |
| updated_at | timestamptz | |

#### `markup_defaults`
| Field | Type | Notes |
|---|---|---|
| category | enum | PK |
| default_markup_pct | numeric(5,4) | |
| updated_by_user_id | uuid | FK |
| updated_at | timestamptz | |

Seed values from the 360 worksheet plus hybrid workbook additions (Co-Packing, Filling and Packout, Cards/Booklets, Logistics, One Time Charges, Passthrough, R&D / Testing, Raw Ingredients, Secondary - Cards/Booklets, Secondary - Corrugated, Secondary - Labels, Turnkey). Defaults for the new categories TBD with finance before Slice 9.

#### `audit_log`
Append-only forensic record.

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK |
| entity_type | text | `quote`, `packaging_input`, `firm_settings`, `markup_defaults`, etc. |
| entity_id | uuid | |
| action | text | `created`, `updated`, `accepted`, `gate_overridden`, `scenario_dropped`, etc. |
| diff_json | jsonb | |
| created_at | timestamptz | |

---

### Derived views

#### `costing_sheet_view`
Joins `quote_skus` × `quote_tiers` × the four input tables. Per (SKU, tier) row computes:

- `packaging_cost_per_unit`, `freight_cost_per_unit`, `cm_raws_cost_per_unit`, `allocated_service_fees_per_unit`
- `contribution_cost_per_unit` = sum of the four
- **`required_sell_per_unit`** = `contribution_cost × (1 + category_markup) × (1 + global_price_adj_pct)` (Stacking Model — see Section 6 FR-7)
- `gross_margin_pct` = `(actual_sell - contribution_cost) / actual_sell`
- `pricing_status` = `UNDERPRICED` if actual_sell < required_sell else `OK`
- `freight_policy_check`, `presentation_risk` (UNDERPRICED OR freight_policy_check set → `REVIEW`)
- `inventory_cost_per_unit` = packaging + cm_raws (only inventory-eligible)

Quote-level rollups:
- `blended_contribution_cost`, `blended_revenue`, `blended_margin_pct` (across all SKUs and the *active* tier)
- **`blended_margin_status`** — `GOOD` if ≥ firm_target, `BELOW_TARGET` if firm_floor ≤ x < firm_target, `BELOW_FLOOR` if < firm_floor
- `suggested_global_adj_pct` — the global adj that would push blended margin to firm_target, rounded to nearest 1%

#### `quote_view`
Customer-facing derived view. Renders pass-through freight as separate lines, bundled freight amortized into unit price. Includes internal-only columns (Required Sell, Price Variance, Quote Risk Flag) for PM eyes during review.

#### `management_dashboard_view`
Per-SKU: `margin_health` (LOSS / LOW / GOOD), `action_needed` (INCREASE PRICE / OK), `price_gap`. Per-quote: revenue, cost, blended margin, blended margin status, average retail gap, count of underpriced SKUs.

---

## 6. Functional Requirements

### FR-1: Deal Import (Lazy Project Creation)
PM clicks "Import Deal" on the Deal Organizer page. UI shows searchable HubSpot deal list (filtered by relevant pipeline stages). Selecting a deal creates `projects` row (if not already present) — does **not** auto-create a quote. Deal context populates the project record.

### FR-2: Project Detail Page
Lists all scenarios in the project as flip-between tabs. Within active scenario, shows the linear version chain (most recent first). Each scenario tab indicates `scenario_status` (active / dropped / accepted). Four create-quote actions visible:

- **New Version** — within current scenario, creates v(n+1) starting from a copy of v(n).
- **New Scenario** — creates a new scenario with an *empty* draft quote (deal context only).
- **Copy Scenario** (within project) — picks any existing quote in the project; deep-clones into a new scenario.
- **Copy Quote to Project** (cross-project) — picks any existing quote anywhere; clones the cost recipe into the *current* project.

On New Scenario or Copy Scenario, modal asks: "Drop current scenario, or keep both active?" (default: keep both). New Version does not prompt — it's a continuation, not a branch.

### FR-3: SKU Setup
PM creates SKUs on the quote with sku_label, product_name, categories, units_per_pack, retail_benchmark.

### FR-4: Tier Setup
PM defines tiers from a preset (with single-tier as the default for simple quotes) or custom. Each tier has a label and qty. Inputs are entered per (SKU, tier).

### FR-5: Packaging / Freight / Production Inputs
Three pages (one per role). Each entry is per (SKU, tier). Copy-from-tier-N affordance for fast data entry. Markup defaults from `markup_defaults` per category, with override flagged in UI.

### FR-6: Costing Sheet
Live derived view aggregating the three input surfaces per (SKU, tier). Columns and rollups per Section 5. Pricing Control Summary header shows Underpriced count, Freight Review count, Presentation Review count, plus blended margin and its status.

### FR-7: Markup Model — Stacking with Firm-Level Benchmarks

Math:
```
Required Sell per unit = Contribution Cost × (1 + category_markup) × (1 + global_price_adj_pct)
```

Both layers always apply. `category_markup` defaults from `markup_defaults` (per-line override allowed and flagged). `global_price_adj_pct` is a per-quote knob, default 0, can be negative.

**Quote-level blended margin check** runs against `firm_settings`:

- ≥ `target_margin_pct` → GOOD
- ≥ `floor_margin_pct` and < `target_margin_pct` → BELOW TARGET (soft warning, PM acknowledges)
- < `floor_margin_pct` → BELOW FLOOR (hard block on Mark-Accepted, admin override required)

**Suggested Global Adjustment** is computed live: the global_adj value that would produce blended margin equal to firm target. UI shows "Apply suggestion" one-click action.

**Two independent gates on Mark-Accepted:**

- *Line-level UNDERPRICED gate* — fires if any (SKU, tier) line has actual sell below required sell. Admin override required, reason logged.
- *Quote-level BELOW FLOOR gate* — fires if blended margin on the accepted tier is below firm floor. Admin override required, reason logged.

A quote can fail both gates simultaneously; both must be resolved or overridden.

### FR-8: Quote View
Customer-facing layout per tier. Per-tier view selector (PM toggles which tier they're showing the customer). Pass-through freight rendered as separate lines; bundled freight folded into unit price invisibly. PM-only columns visible during review (Required Sell, Price Variance, Quote Risk Flag, Lines Requiring Review count).

### FR-9: Mark Accepted
On a `sent` quote, PM clicks "Mark as Accepted" and selects which tier the customer accepted. System:

1. Validates both gates (FR-7). If either fails, requires admin override with reason.
2. Sets `status = accepted`, `accepted_tier_id`, `accepted_at`, `accepted_by_user_id`, `accept_source = manual_button`.
3. Marks `scenario_status = accepted` on this scenario; auto-marks any other `active` scenarios on the project as `dropped` (auditable).
4. Writes `accepted_snapshot_json`.
5. Triggers HubSpot writeback: creates/updates HubSpot Quote object with line items from the accepted tier only, populating `hs_cost_of_goods_sold` on each line item. Updates deal-level fields.
6. Locks the quote — no further edits.

> **Note on `hs_cost_of_goods_sold`.** This is *additive*, not preservation of existing functionality. DPS HubSpot Products do not carry `hs_cost_of_goods_sold` because COGS is a composite per-quote, per-tier value (packaging + freight + production + service fees) that varies by volume and supplier — it cannot be expressed as a single product-level number. Slice 12's writeback populating line-item-level COGS from Nexus is the first time HubSpot has had real margin data for DPS deals. This unlocks native HubSpot reporting via `hs_margin = amount - hs_cost_of_goods_sold` for the first time, so margin per deal/per line/per category is queryable in HubSpot itself, not only via Nexus's Management Dashboard. Backward compatibility with the existing HubSpot → NetSuite Sales Order sync is preserved — the sync owner needs to confirm it accepts populated COGS gracefully (verification tracked in `docs/UX_BACKLOG.md`).

### FR-10: PDF Generation
Customer-facing PDF derived from Quote view at the selected tier (or all tiers as a tiered-pricing PDF). Internal numbers never appear. Layout matches Estimate-tab style.

### FR-11: Quote Versioning
Editing a `sent` quote auto-creates a new draft version within the same scenario; prior `sent` version → `superseded`.

### FR-12: Copy Operations — Field Categorization

Three buckets enforced by the copy machinery:

**Cloneable** (carried from source): sku_label, product_name, product_category, packaging_category, units_per_pack, retail_benchmark, all `packaging_inputs` (supplier, unit_cost, markup, etc.), `freight_inputs` policy fields (freight_mode, freight_treatment, markup_pct), all `production_inputs` (CM fees, setup, tooling, R&D, allocate_service_fees toggle), `global_price_adj_pct`.

**Inherited** (from target project, never from source): project_id, hubspot_deal_id, deal_name, client_name, sales_rep_user_id, pm_user_id.

**Reset** (always cleared): id (new), version_number = 1, status = `draft`, accepted_at / sent_at / pdf_url / hubspot_quote_id all null, customer_facing_notes, internal_notes, valid_until, retail_benchmark, all `freight_inputs` shipment-specific fields (total_freight, shipment_id, units_in_shipment), `production_inputs.actual_units_produced`, scenario_label = "Primary", scenario_status = `active`. Tier qty values reset (qty is target-specific).

`copied_from_quote_id` set on every copy. Source picker for Copy Quote to Project: dropdown of active projects (toggle to show archived), search by project name / client / SKU label, source quote selected within the chosen project.

### FR-13: Deal Organizer (Project List)
Default view: project-centric, one row per imported project. Columns: Deal Name, Client, PM, Sales Rep, HubSpot Stage (live read with cache), Active Scenario(s), Latest Quote Status, Versions Count, Latest Quote $, Latest Margin %, Lines Requiring Review (rollup), Last Activity, Project Status. Default sort: Last Activity desc. Default filter: Project Status = active.

Filters: client, PM, sales rep, HubSpot Stage, latest quote status, has-lines-requiring-review (Y/N), date range.
Search: deal name, client name, HubSpot deal ID.
Bulk actions: Archive, Refresh from HubSpot.

### FR-14: Management Dashboard
Read-only exec view per quote (drill from project detail) and portfolio rollup across active projects.

### FR-15: Firm Settings & Markup Admin
Admin-only pages to edit `firm_settings` (target/floor margin %) and `markup_defaults` (per-category). All changes audit-logged. Changes to markup_defaults apply to *new* line items only — existing items keep their snapshotted markup.

### FR-16: Audit Log
Read-only admin view of all state-changing actions.

---

## 7. Quote Lifecycle (largely unchanged, with scenario layer added)

```
Within a scenario:
  draft ──► sent ──► accepted ──► (locked)
    │        │
    │        └──► superseded (PM edited a sent quote → new draft)
    │        └──► lost
    │
    └──► (deletable while still draft)

Across scenarios in a project:
  Multiple `active` scenarios may coexist during negotiation.
  Marking a quote `accepted` in scenario X sets scenario X to `accepted`
  and auto-drops other `active` scenarios.
  `dropped` scenarios remain readable forever, never deletable.
```

---

## 8. Non-Functional Requirements

Unchanged from v1/v2: standard internal-tool performance, reliability, security baselines. 12 concurrent users, ~10–20 active projects in any state. WCAG 2.1 AA color contrast, keyboard nav, Chrome/Safari/Firefox/Edge desktop.

---

## 9. Technology Stack

Unchanged from v2: Next.js (App Router) + TypeScript + Tailwind, Postgres on Supabase, Drizzle ORM, Clerk auth (Google SSO), Vercel hosting, `@hubspot/api-client`, React-PDF, React Hook Form + Zod.

---

## 10. v2 Pre-Wiring

These v1 design decisions preserve v2 optionality:

1. `accept_source` includes `hubspot_stage_change`.
2. HubSpot OAuth scopes include deal-stage read for the future webhook.
3. Locked-baseline snapshot exists in v1 as JSON; v2 promotes to `locked_baselines` table.
4. `inventory_movements` table created in v1 schema; UI ships in v2.
5. `packaging_inputs.supplier` is free-text in v1 but stored as a column for future normalization to a `vendors` master.
6. `quote_skus` granularity supports v2 reorder cloning (clone SKUs, strip tooling-only `production_inputs`, reflow consumables).
7. `production_inputs.actual_units_produced` populated manually in v1, from NetSuite read in v2.
8. Project category enum includes `turnkey` from day one — v2 adds the formulation card layer hanging off `quote_skus`.
9. `copied_from_quote_id` is the seed for a v2 explicit Templates Library (frequently-copied quotes get an `is_template` flag and a curated landing page).
10. `firm_settings` versioning via effective_from/until enables v2 historical "what was our floor margin in Q3" reporting without a migration.

---

## 11. Build Phases (Slice-by-Slice)

**~17 slices, ~12–15 weeks at 2–3 sessions per week.** Each slice ends with something working, deployed, and committed.

**MVP cutline is Slice 12** — at that point the tool replaces Excel for net-new quote builds and writes structured data to HubSpot. Slices 13–17 add workspace features.

### Slice 1 — Foundation (1 session)
Next.js scaffold, Supabase + Drizzle, Clerk auth (Google SSO, `@thedps.co` restricted), Vercel deploy. **End state:** log in, see "Hello, Edward."

### Slice 2 — HubSpot OAuth + Deal Search (2 sessions)
HubSpot OAuth flow, encrypted token storage, deal search/list (no project creation yet). **End state:** searchable list of real DPS HubSpot deals.

### Slice 3 — Project Import + Project Detail Skeleton (2 sessions)
`projects` table. "Import Deal" action creates project record. Project detail page placeholder. **End state:** import a real deal, see a project page with deal context populated.

### Slice 4 — Quotes + SKUs + Tiers Skeleton (2 sessions)
`quotes`, `quote_skus`, `quote_tiers` tables. PM creates a draft quote on a project, defines SKUs and tiers. **End state:** a draft quote with multiple SKUs and a tier structure (no costing yet).

### Slice 5 — Packaging Inputs (2 sessions)
`packaging_inputs` table, per-(SKU, tier) entry, copy-from-tier-N. Category markup defaults. **End state:** every (SKU, tier) has packaging cost.

### Slice 6 — Production Inputs (2 sessions)
`production_inputs` table with allocate_service_fees toggle. **End state:** every (SKU, tier) has production cost.

### Slice 7 — Freight Inputs (2 sessions)
`freight_inputs` table with pass_through / bundled treatment. **End state:** every (SKU, tier) has freight cost.

### Slice 8 — Costing Sheet Derived View (3 sessions)
`costing_sheet_view`. Per-(SKU, tier) Contribution Cost, Required Sell (basic — category markup only, global adj added in Slice 9). Pricing Control Summary header. Pricing Status / Presentation Risk live. **End state:** type a number anywhere → Costing Sheet recalculates instantly.

### Slice 9 — Markup Model + Firm Settings (2 sessions)
`firm_settings` table. Global Price Adjustment per quote. Stacking math in Required Sell. Blended margin computation, three-state status (GOOD / BELOW TARGET / BELOW FLOOR). Suggested Global Adj feature. Firm Settings admin page. **End state:** tune Global Adj → blended margin updates → status flag flips.

### Slice 10 — Quote View + Lines Requiring Review (2 sessions)
`quote_view`. Customer-facing layout per tier with tier selector. Pass-through vs bundled freight rendering. Lines Requiring Review count. **End state:** PM sees a customer-ready quote with quality gates active.

### Slice 11 — PDF Generation (2 sessions)
React-PDF template per tier. Send action transitions quote to `sent`. **End state:** real PDF in PM's hands.

### Slice 12 — Mark Accepted + HubSpot Writeback (3 sessions) — **MVP CUTLINE**
Mark-Accepted with tier selection. Both gates (line-level UNDERPRICED, quote-level BELOW FLOOR). Admin override flow with reason capture. Snapshot logic. HubSpot Quote create/update with `hs_cost_of_goods_sold`. Deal-field updates. Writeback failure handling and retry. **End state:** accept a quote → HubSpot has structured line items with margin populated. Tool now replaces Excel for net-new quote builds.

### Slice 13 — Deal Organizer (Project List) (2 sessions)
Project-centric list with all columns from FR-13. Filters, search, bulk actions. **End state:** Edward (and team) can find any project at a glance.

### Slice 14 — Scenarios + New Version + New Scenario (2 sessions)
`scenario_label`, `scenario_status` on quotes. New Version action. New Scenario action with branching prompt. Flip-between tabs on project detail page. Auto-drop on accept logic. **End state:** PMs can run parallel scenarios within a project.

### Slice 15 — Copy Operations (2 sessions)
Copy Scenario (within project) and Copy Quote to Project (cross-project) with full field-bucket enforcement. Source picker UI. `copied_from_quote_id` traceability. **End state:** PM can clone a Beija Flor reorder template into a new project in one minute.

### Slice 16 — Management Dashboard + Markup Admin + Audit Log (2 sessions)
`management_dashboard_view`. Markup Defaults admin page. Audit log read view. **End state:** leadership has portfolio visibility, admins have governance.

### Slice 17 — Polish + Real-User Test (2 sessions)
Bug fixes from internal testing. Onboard one or two PMs to use the tool on real new packaging quotes in parallel with Excel. Iterate.

---

## 12. Open Questions (must resolve before specific slices)

1. **Subdomain.** `app.thedps.co` / `quotes.thedps.co` / `tools.thedps.co`. Before Slice 1.
2. **HubSpot sandbox.** Provision before Slice 2. Production HubSpot is not written until Slice 12.
3. **PDF reference template.** Pick canonical Estimate-tab output to model. Before Slice 11.
4. **Markup default values for new categories** the hybrid workbook adds (Co-Packing, Filling and Packout, Cards/Booklets, etc.). Finance to provide before Slice 8.
5. **Underpriced override authority.** Recommendation: admin-only, with one-click override that captures reason. Confirm before Slice 12.
6. **Repo + accounts.** GitHub private repo, Supabase project, Vercel project, Clerk org, HubSpot developer account. Before Slice 1.
7. **Backup admin.** Bus-factor for admin-role.
8. **Retail benchmark — required or optional on quote_skus?** Spec has it nullable. Confirm.

---

## 13. Success Criteria for v1

v1 ships when:

1. ≥80% of new packaging quotes (over 2 consecutive weeks) are built in the new tool, not Excel.
2. 100% of accepted quotes produce a HubSpot Quote object with `hs_cost_of_goods_sold` populated on every line item from the accepted tier.
3. PM-reported quote build time reduced ≥30% from baseline (baseline measured in the 2 weeks before Slice 1).
4. Existing HubSpot → NetSuite Sales Order sync continues without regression.
5. Zero quotes shipped in `accepted` state with un-overridden UNDERPRICED or BELOW FLOOR gates.
6. No data loss, no security incidents, audit log complete.

---

## 14. Acknowledgment

This spec adopts the data architecture and quality-gate logic from the team's internal "Hybrid Costing Workbook v1" (4/22/26 build, not in production). The architectural separation — Purchasing / Freight / Production / Costing / Quote / Management Dashboard — and the guardrail vocabulary (UNDERPRICED, REVIEW BEFORE SENDING, Pricing Status, Presentation Risk) come directly from that workbook's design. The webapp implements those decisions in a medium that doesn't break when someone inserts a row.

The product decisions in v3 — multi-tier as v1, the stacking markup model with firm-level benchmarks, the four create-quote actions with field-bucket semantics, project-centric Deal Organizer with scenarios, lazy import — were finalized during the brainstorm session on April 28, 2026.
