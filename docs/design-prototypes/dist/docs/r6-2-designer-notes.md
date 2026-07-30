# R6.2 Freight Panel — Designer notes (rev 1)

> **Revision 1** lands against the original R6.2 design. Architecture is intact; field-level scope and one math-contract addition are the changes. The 10-gap structure of the original brief carries forward — phase assignments shifted, two gaps moved to P1 from P2 / P3, two original-P1 fields dropped to P3.

## What changed in rev 1 — five-line summary

1. **Multi-leg moves P2 → P1.** Shenzhen → Busan → Long Beach is now a v1 case. `+ Add leg` is active; the leg-group wrapper already encoded the right shape.
2. **`cargo_ready_date` + `vessel_etd` replace `transit_lead_weeks`.** Dates surface per leg; transit is derived (`vessel_etd − cargo_ready_date`). Journey total transit lands as a caption in the leg-group header.
3. **Per-component markup pills (P1).** `freight_markup_pct`, `duty_markup_pct`, `tariff_markup_pct` — each default 0.30, overridable per-leg. Inline pills (default `× 1.30`, click to edit). Cally's tariff-anomaly example: when tariff hit 125%, PMs zero out `tariff_markup_pct` without losing markup on duty or freight.
4. **CBM/unit removed from P1; insurance toggle removed entirely.** Both return at P3 (CBM with the freight calculator; insurance only if model unbundles).
5. **Customs visibility widens.** Old rule: `direction = 'inbound' AND incoterm = 'DDP'`. New rule: `crosses_international_border AND incoterm puts customs on DPS`. Shenzhen → Busan → Long Beach now shows customs on **both** legs (Korea entry + US entry); domestic legs never show customs.

## Decisions Edward locked (the 5 CD picks)

| # | Decision | Pick | Why |
|---|---|---|---|
| 1 | Per-component markup surface grain | **Inline pills** (× 1.30) | Default behavior is silent; override is rare. Sub-card adds chrome for a feature PMs touch maybe twice a year. |
| 2 | `vessel_etd` on FOB/EXW | **Show always, mark optional** | Hide-on-incoterm-change is a real data-loss footgun if PM toggles back. Cost of an optional field is small. |
| 3 | `cargo_ready_date` naming across modes | **Align** — rename + promote out of `customer_arranges_meta` | Single source of truth for "when are goods ready." Cleaner audit trail. |
| 4 | Per-leg PDF slot in v1 | **Render P1, upload P2** | Multi-leg P1 makes per-leg PDFs more pointed (2–3 forwarder PDFs per journey is plausible); DPS-arranges legs have no `audit_note` equivalent, so holding the slot leaves PMs without an in-system home for PDF reference. |
| 5 | Derived transit caption | **Leg-group header** | Journey-level total transit is the question PMs field most often from clients ("when does it arrive"). Multi-leg journeys especially benefit. |

## The math contract (new — explicit per Edward sign-off)

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

**Markup is on the AMOUNT, not the rate.** A 125% tariff with 0% markup is still 125% of `goods_cost_base`; the markup multiplies the resulting tariff dollar amount, not the rate itself. The downstream rollup card carries this math explicitly in copy so PMs can audit "why is this customer's D+T charge what it is" without back-solving from a single blended markup.

## Surface vocabulary — what each affordance carries

### The leg head (top of each leg)

- **Direction chip** (`inbound` / `outbound`) — unchanged from original 6.2.
- **`↔ BORDER` chip** — new in rev 1. Renders when `crosses_international_border = true`. Drives customs cluster visibility. Visual cousin of `direction`; sits in the route line.
- **Treatment toggle** (`Bundled` / `Passthrough`) — per-leg, unchanged.
- **Customer-arranges legs** swap the treatment toggle for `COST = $0 · METADATA ONLY` mono caption.

### The leg body grid

Five fields now (was four): Mode · Carrier · Incoterm · **Cargo ready** · **Vessel ETD** · **Freight markup**.

The freight-markup cell is a one-field row showing the markup pill, with the derived "X.Xw in transit" caption right-aligned when both dates are filled. Felt right to pair the markup with the transit derivation since both are per-leg "this is the leg's commercial shape" data.

### The customs cluster

- **Two cells** now (was three after CBM removal): Duty rate + duty markup pill · Tariff rate + tariff markup pill.
- **Math footer**: a small mono caption — `Math: duty_billable = duty_pct × goods_cost × (1 + duty_markup) · tariff same · feeds D+T row`.
- **Eyebrow widened**: `Customs · DDP · border crossing` (was `Customs · DDP`).

### The leg-group header

- **Journey transit caption** (P1) — `· 4.5w total transit`. For multi-leg, computed as `max(vessel_etd) − min(cargo_ready_date)` across legs. Single-leg uses the leg's own dates.
- **`+ Add leg`** is active (no P2 chip).

## What stays the same (boundary lines)

CD did not revisit these — they're settled from the original 6.2:

- Three-mode chooser (DPS arranges · Customer arranges · Not yet entered) + new fourth mode in prototype harness: Multi-leg journey (for demo of the P1 capability)
- Customer-arranges shape and meta (now reduced to contact + audit_note; ready_date promoted out)
- `direction` primitive on each leg — still drives some logic, still architectural
- `treatment` toggle on the leg (bundled vs passthrough)
- Leg-group wrapper as journey container
- Visual register from R7b Setup precedent
- USD only, single primary forwarder, manual lead-time provenance
- Downstream rollup card pattern (math summary + customer-PDF implication copy)
- The 10-gap structure (this revision shifts phases; doesn't add or remove gaps)

## Three pushbacks for the revision

### Pushback 1 · The markup pill assumes PMs know what `× 1.30` means.

A new PM looking at the customs cluster for the first time sees `Duty 5.8%  × 1.30 [OVR]`. The pill is small and looks decorative. Without onboarding context, a PM might not realize that `× 1.30` is the live markup multiplier on the billable amount. The math footer helps (it spells out `duty_billable = duty_pct × goods_cost × (1 + duty_markup)`) but that footer is one mono line at the bottom of the customs cluster. Pushback: consider a tooltip or `?` icon next to each pill in v1.1 — for now, the math footer carries the explanation. If PM observation shows confusion, lift the explanation higher.

### Pushback 2 · `crosses_international_border` as a PM-set boolean is technically debt.

The flag is correct in concept but PM-set is fragile. A PM entering Shenzhen → Busan as origin/destination should have the system infer the border crossing from country codes. We're shipping PM-set in v1 because the schema doesn't yet structure origin/destination with country codes — it's free text. Plan: v1.x or v2 adds country-code structure, deprecates the manual boolean. Flagged in the data-source map so CC sees the future debt.

### Pushback 3 · Journey transit caption may oversimplify.

`max(vessel_etd) − min(cargo_ready_date)` works for the linear single-journey case. It doesn't model:
- Layover time between legs (Busan port dwell)
- Whether two legs are sequential or parallel (rare in freight, but theoretically possible for splits)
- Lead-time uncertainty (forwarder gives a 4-6w range, not a precise ETD)

V1 caption is "4.5w total transit" — a single number that hides the range. v1.1 could surface a range; v2 could integrate forwarder ETA confidence. For now, the caption is honest about being a derivation: it lives next to `· 2 legs` in the same mono register, signaling "this is computed metadata, not the ground truth."

## Considered and rejected (in this revision pass)

- **Sub-card variant for markup pcts.** Cleaner visual separation but adds chrome for fields PMs touch ~twice a year. Q1 disposition picked inline pills. Rejected sub-card.
- **Auto-derive `crosses_international_border` from incoterm.** Tempting (DDP usually means border-crossing); fragile (DDP on a domestic US-to-US leg exists). PM-set is the v1 truth-source.
- **Sum customs into a single "landed cost" line on the rollup.** Cleaner number but loses Cally's auditability ask. Kept duty + tariff as separately tracked, summed by markup category.

## Schema deltas (v1 commitments)

Spelled out in the data-source map. Summary:

```sql
-- Add to v1:
alter table freight_legs add column cargo_ready_date date;
alter table freight_legs add column vessel_etd date;
alter table freight_legs add column crosses_international_border boolean not null default false;
alter table freight_legs add column freight_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column duty_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column tariff_markup_pct numeric(5,4) not null default 0.3000;

-- Drop from v1:
alter table freight_legs drop column transit_lead_weeks;
alter table freight_legs drop column insurance_bundled;
-- customs.cbm_per_unit also dropped from the customs JSONB

-- Rename:
-- freight_customer_arranges_meta.ready_date → freight_legs.cargo_ready_date
-- (data migrated; column promoted from meta-row to leg-row)
```

## Phase map (updated for rev 1)

| # | Element | v1 (P1) | v1.1 (P2) | Banked (P3) |
|---|---|:---:|:---:|:---:|
| 1 | Direction | ✓ | | |
| 2 | Origin + destination | data capture ✓ | UI render | |
| 3 | Rate breakdown | single total_freight ✓ | | breakdown sub-table |
| 4 | Insurance line | — | — | full unbundling |
| 5 | Lead time / ETA | **cargo_ready + vessel_etd ✓** | | |
| 6 | Container utilization | — | | caption + LCL/FCL thresholds |
| 7 | SKU allocation | — | | per-leg `sku_id` filter |
| 8 | Customer-arranges populated | ✓ | | |
| 9 | Forwarder PDF | **slot ✓ · upload P2** | upload mechanism | |
| 10 | Multi-currency | — out of scope all phases — | | |
| + | **Multi-leg within journey** | **✓** (was P2) | | |
| + | **Per-component markup (frt/duty/tariff)** | **✓** | | |
| + | **`crosses_international_border` flag** | **✓** | | |
| + | **CBM/unit auto-calc** | — | — | with freight calculator |
| + | **Freight calculator + port templates** | — | — | full P3 |
| + | **Insurance bundled toggle** | — | — | if model unbundles |

## Carry-forward to v1.1 + v2

- **Country-coded origin/destination** — replaces manual `crosses_international_border`.
- **`?` tooltip on markup pills** — explanation lifted from math footer.
- **Forwarder rate templates** (LA/Miami/Shenzhen/NY · LCL/FCL) — enables the freight calculator.
- **Tooltip / hover on the journey transit caption** — surface the date range, not just the sum.
- **Multi-leg drag-reorder** — if the prototype's leg-order matters (Shenzhen → Busan → LA vs Busan → Shenzhen → LA — only the first is real, but the system shouldn't accept the second silently). v1 lets PM set order through entry sequence; v1.1 could lock with a chevron-grip handle.

## Pattern 25 schema verification gate

Multi-leg moving to P1 promotes Pattern 25 from advisory to gating. Before CC writes any implementation:

- CC rules on `freight_legs` vs `freight_inputs` disposition. The original schema has `freight_inputs` flat per `(quote_sku_id, tier_id)`. The R6.2 design replaces or supplements with `freight_legs` + `freight_leg_groups` + per-leg-per-tier cost rows. **CC owns repo truth** on whether this is migration, additive, or hybrid.
- The new markup columns (freight / duty / tariff) and the `crosses_international_border` bool are part of the gate.
- Customs sub-object stays as JSONB on `freight_legs` (CD's original commitment — preserved).

Without Pattern 25 sign-off, the math contract above is design intent, not schema reality.
