# R6.2 Freight Panel — Data-source map (rev 1)

> **Revision 1** schema. Field-level deltas against the original 6.2 captured below; full table is the rev-1 truth.

## Legend

- ✅ **existing** — already in schema or directly derived from existing data
- 🆕 **new (P1)** — schema addition committed in rev 1
- 🆕 **new (P2)** — schema addition committed for v1.1
- 🔧 **derived** — computed in code from other fields
- ❌ **dropped from P1** — was in original 6.2, removed in rev 1

## Page-level

| UI element | Source | Phase |
|---|---|---|
| Eyebrow (`{client} · {scenario} · v{N} draft`) | ✅ `projects.client_name`, `scenarios.label`, `quotes.version_number` | v1 |
| Mode chooser (4 modes) | UI state | v1 |
| `+ Add leg` (page head action cluster) | opens add-leg drawer | v1 |
| `Save draft` | writes drafts to `freight_legs` + `freight_leg_groups` | v1 |

## Leg-group wrapper

| UI element | Source | Phase |
|---|---|---|
| Group label (e.g., `Outbound · Shenzhen → Busan → Long Beach`) | 🆕 `freight_leg_groups.label` (P1) | v1 |
| Leg count | 🔧 `count(legs WHERE leg_group_id = ?)` | v1 |
| **Journey transit caption** (`· 4.5w total transit`) | 🔧 `max(legs.vessel_etd) − min(legs.cargo_ready_date)` converted to weeks | v1 |
| `+ Add leg` button | ✅ active in P1 (no longer phase-tagged) | v1 |

## Per-leg fields

### Header row

| UI element | Source | Phase |
|---|---|---|
| Direction chip (`inbound` / `outbound`) | 🆕 `freight_legs.direction` enum (P1) | v1 |
| Leg label | 🆕 `freight_legs.label` text | v1 |
| Origin | 🆕 `freight_legs.origin` text (P1 data; P2 surface polish) | v1 |
| Destination | 🆕 `freight_legs.destination` text (P1 data; P2 surface polish) | v1 |
| **`↔ BORDER` chip** | 🆕 `freight_legs.crosses_international_border` boolean (P1) | v1 |
| Treatment toggle (`Bundled` / `Passthrough`) | ✅ `freight_legs.treatment` enum (R6 carry-forward) | v1 |
| Action menu (⋯) | UI | v1 |

### Body grid (5 fields)

| UI element | Source | Phase |
|---|---|---|
| Mode | ✅ `freight_legs.mode` enum | v1 |
| Carrier / forwarder | ✅ `freight_legs.carrier` text | v1 |
| Incoterm | ✅ `freight_legs.incoterm` enum (DDP / DAP / FOB / EXW / FCA / CIF) | v1 |
| **Cargo ready** | 🆕 `freight_legs.cargo_ready_date` date (P1) | v1 |
| **Vessel ETD** | 🆕 `freight_legs.vessel_etd` date (P1; optional on FOB/EXW) | v1 |
| **Freight markup pill** | 🆕 `freight_legs.freight_markup_pct` numeric, default 0.30 (P1) | v1 |
| **Derived transit caption** (`X.Xw in transit`) | 🔧 `vessel_etd − cargo_ready_date` per leg | v1 |

❌ Dropped from P1 leg body: `transit_lead_weeks` (replaced by the two date fields and the derived transit caption).

### Per-tier rate table

| UI element | Source | Phase |
|---|---|---|
| Tier label, units | ✅ `quote_tiers.label`, `.qty` (R7b carry-forward) | v1 |
| Total freight (cost) per tier | 🆕 `freight_leg_tiers.total_freight` numeric, PM-entered (P1) | v1 |
| Per-unit billable | 🔧 `(total_freight × (1 + freight_markup_pct)) / units` | v1 |
| Caption (`$X × 1.30 ÷ Y units`) | 🔧 derived | v1 |

❌ Dropped: `incl. ins` rollup badge (insurance toggle removed entirely in rev 1).

### Customs cluster (REVISED visibility rule)

**Old rule (original 6.2):** `direction = 'inbound' AND incoterm = 'DDP'`

**New rule (rev 1):** `crosses_international_border = true AND incoterm = 'DDP'` (extensible to DAP-cleared variants if surfaces)

Each leg evaluates independently. Multi-leg journey: Shenzhen → Busan → Long Beach renders customs on **both** legs (Korea entry + US entry); a Shenzhen → Shanghai → LA journey renders customs only on the Shanghai → LA leg (domestic China leg has no border).

| UI element | Source | Phase |
|---|---|---|
| Cluster visibility | 🔧 derived from `crosses_international_border` + `incoterm` | v1 |
| Duty rate | ✅ `freight_legs.customs.duty_pct` (R6 carry-forward, JSONB) | v1 |
| **Duty markup pill** | 🆕 `freight_legs.duty_markup_pct` numeric, default 0.30 (P1) | v1 |
| Tariff rate | ✅ `freight_legs.customs.tariff_pct` (R6 carry-forward, JSONB) | v1 |
| **Tariff markup pill** | 🆕 `freight_legs.tariff_markup_pct` numeric, default 0.30 (P1) | v1 |
| Math footer caption | UI copy | v1 |

❌ Dropped from P1 customs: `cbm_per_unit`. Returns with the P3 freight calculator.

### PDF attachment slot

| UI element | Source | Phase |
|---|---|---|
| **Slot visibility (rendered)** | 🆕 P1 — slot always renders on DPS-arranges legs | v1 |
| Filename + uploaded_at + size (populated) | 🆕 `freight_legs.forwarder_quote_pdf_id → attachments` (P2 upload) | v1.1 |
| Upload affordance | 🆕 attachment upload flow (P2) | v1.1 |

Behavior change vs original 6.2: slot **renders** in P1 (so PMs see the surface and can use audit_note to reference a PDF stored elsewhere); upload mechanism ships P2.

## Customer-arranges populated state

Mode renders when `freight_panel.mode = customer_arranges`.

| UI element | Source | Phase |
|---|---|---|
| Direction chip | 🆕 `freight_legs.direction` (typically outbound) | v1 |
| Incoterm select (locked to EXW / FCA / CIF / DAP) | 🆕 `freight_legs.incoterm` with mode-aware constraint | v1 |
| Origin | 🆕 `freight_legs.origin` | v1 |
| **Cargo ready** | 🆕 **`freight_legs.cargo_ready_date`** — PROMOTED from `freight_customer_arranges_meta.ready_date` | v1 |
| Customer freight contact | 🆕 `freight_customer_arranges_meta.customer_contact` | v1 |
| Audit note | 🆕 `freight_customer_arranges_meta.audit_note` text | v1 |
| Tier per-unit | 🔧 zero across all tiers (no cost in customer-arranges) | v1 |

❌ Dropped: `ready_date` from `customer_arranges_meta` (renamed and promoted to leg head).

## Downstream rollup

| UI element | Source | Phase |
|---|---|---|
| **FRT row at T2** | 🔧 `Σ legs ((leg.tier.total_freight × (1 + leg.freight_markup_pct)) / leg.tier.units) WHERE treatment = 'bundled'` | v1 |
| **D+T row** | 🔧 `Σ legs WHERE crosses_international_border AND incoterm IN ('DDP') OF (duty_billable + tariff_billable)` per tier | v1 |
| Pass-through callout | 🔧 `count(legs WHERE treatment = 'passthrough') > 0` | v1 |
| `· N border-crossing legs` count | 🔧 derived | v1 |
| Customer-arranges → "FRT row hidden" copy | 🔧 `mode = customer_arranges` | v1 |

## Math contract (new — explicit in rev 1)

Documented in designer notes; reproduced here for the data-source map record.

Per leg, per tier:

```
goods_cost_base   = Σ(per-SKU production cost × units shipped)
freight_cost      = freight_legs.tier.total_freight (PM-entered)
freight_billable  = freight_cost × (1 + freight_markup_pct)
duty_cost         = customs.duty_pct × goods_cost_base
duty_billable     = duty_cost × (1 + duty_markup_pct)
tariff_cost       = customs.tariff_pct × goods_cost_base
tariff_billable   = tariff_cost × (1 + tariff_markup_pct)
```

Journey rollup, per tier:

```
freight_journey_billable = Σ(freight_billable across legs in group)
duty_journey_billable    = Σ(duty_billable across customs-eligible legs in group)
tariff_journey_billable  = Σ(tariff_billable across customs-eligible legs in group)
```

`customs-eligible` = `crosses_international_border AND incoterm = 'DDP'`.

## Schema deltas — exact SQL

```sql
-- New columns on freight_legs (P1)
alter table freight_legs add column cargo_ready_date date;
alter table freight_legs add column vessel_etd date;
alter table freight_legs add column crosses_international_border boolean not null default false;
alter table freight_legs add column freight_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column duty_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column tariff_markup_pct numeric(5,4) not null default 0.3000;

-- Drops from freight_legs (P1)
alter table freight_legs drop column transit_lead_weeks;
alter table freight_legs drop column insurance_bundled;

-- customs JSONB on freight_legs
-- drop key: customs.cbm_per_unit
update freight_legs set customs = customs - 'cbm_per_unit';

-- Rename + promote: freight_customer_arranges_meta.ready_date → freight_legs.cargo_ready_date
update freight_legs fl
  set cargo_ready_date = m.ready_date
  from freight_customer_arranges_meta m
  where m.freight_leg_id = fl.id and m.ready_date is not null;
alter table freight_customer_arranges_meta drop column ready_date;

-- leg_group table (P1 — was anticipated in original 6.2 as architectural; now load-bearing)
create table freight_leg_groups (
  id uuid primary key,
  quote_id uuid references quotes,
  label text not null,
  display_order int not null default 0
);
alter table freight_legs add column leg_group_id uuid references freight_leg_groups;
```

## Schema commitments out of rev 1

1. **Multi-leg native** — `freight_leg_groups` is a P1 table, not a P2 stub.
2. **Per-component markup** — three numeric columns on `freight_legs`, all default 0.30, all overridable per-leg.
3. **`crosses_international_border` boolean** — PM-set in v1 (no inference). Plan to deprecate when origin/destination get country-code structure.
4. **`cargo_ready_date` unified across modes** — single source of truth, no divergent naming.
5. **PDF slot rendered P1** — schema column `forwarder_quote_pdf_id` exists in P1; upload action ships P2.

## Cross-surface contracts (unchanged from original)

- **R6 Cost Build cost stack** — FRT row sums bundled-leg billables; D+T row sums duty + tariff billables. Math contract above feeds the cost stack directly.
- **R7a IA arc** — Freight is one of the Cost Build sub-sections.
- **R7b Setup precedent** — visual register inherited (cards, table grammar, inline-edit chrome, action cluster, eyebrow grammar).
- **R5 audit log** — every freight-leg edit, treatment toggle, markup pill override, cargo_ready / ETD change, customer-arranges meta write hits `audit_log`.
- **Mark-Accepted snapshot** — freight metadata travels with the quote artifact.

## What's still out of scope (carry-forward to v2)

| Gap | Status | Resolution path |
|---|---|---|
| Multi-SKU allocation | Banked (P3) | Surfaces when real workflow shows containers serving multiple SKUs |
| Rate breakdown sub-table | Banked (P3) | When forwarders provide structured breakdowns |
| LCL→FCL break-even guidance | Banked (P3) | Needs rate-table data |
| Insurance unbundling | Banked (P3) | If DPS shifts from bundled-in-quote model |
| Multi-currency / FX | Out of scope | DPS always USD |
| CBM-driven container utilization | Banked (P3) | Returns with freight calculator |
| Country-code derivation of `crosses_international_border` | Out of v1 | Plan to deprecate manual boolean once origin/destination get country-code structure |

## Pattern 25 schema verification — REQUIRED before CC writes implementation

Multi-leg P1 moves Pattern 25 from advisory to gating. CC must rule on:

1. **`freight_legs` vs existing `freight_inputs` disposition.** Original schema has `freight_inputs` flat per `(quote_sku_id, tier_id)`. Rev 1 design replaces or supplements with `freight_legs` + `freight_leg_groups` + per-leg-per-tier cost rows. Migration / additive / hybrid — CC's call.
2. **Customs JSONB approach.** CD's commitment is to keep customs as JSONB on `freight_legs`, not a separate sub-table. Verify this composes with the markup-pct columns living at row level (not in JSONB).
3. **`forwarder_quote_pdf_id` foreign-key target.** Confirm `attachments` table exists or will be created in the same migration.
