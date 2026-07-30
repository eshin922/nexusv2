# R6.2 Freight Panel — Revision Brief for CD

**Source:** PM feedback (Cally) after CD's shipped 6.2 design + Edward sign-off on math contract
**Status:** Delta against the original brief + landed design (revision pass, not rebuild)
**Scope:** Field-level revisions; architecture mostly intact

---

## Why this revision

CD's shipped 6.2 design is structurally sound — the leg-group wrapper, per-leg treatment, customer-arranges as a first-class mode, customs cluster on DDP, downstream rollup language — all carry forward unchanged. PM review (Cally + Edward) surfaced four field-scope shifts and one math-contract addition that don't change the IA but do change which inputs surface in v1.

The biggest single change: **multi-leg moves from P2 to P1.** Cally and Edward want the Shenzhen → Korea → US case (two carriers, one journey, summed across legs) working in v1, not deferred to v1.1. This is a phase reshuffle, not an architectural shift — CD's `leg_group.legs[]` already encoded the right shape.

Two scope removals (CBM/unit; insurance toggle) and two additions (cargo ready date + vessel ETD; per-component markup) round it out. The customs cluster's visibility rule widens from "inbound DDP" to "any leg crossing an international border with customs obligation on DPS." Math contract picks up a per-component markup model — freight, duty, tariff each have their own markup pct, default 0.30, overridable per-leg.

CD revises against the landed source files (HTML + JSX + CSS + data.js + notes + data-source map). This is not a restart.

---

## What changes — quick map

| Element | Original P1 design | Revised P1 |
|---|---|---|
| `customs.cbm_per_unit` | In customs cluster | **Removed.** CBM is embedded in total freight (calculated externally by PM). Returns w/ P3 freight calculator. |
| Insurance bundled toggle + `incl. ins` rollup badges | Per-leg toggle, per-tier rollup badge | **Removed entirely.** Revisit P3 when insurance model gets revisited. |
| Multi-leg within a journey (`+ LEG` action) | Disabled chip with P2 tag | **Active.** Multi-leg ships v1 — costs sum across legs per tier. |
| `transit_lead_weeks` (single field) | P2 field on leg | **Replaced** by dual date fields (see below). Field disappears. |
| Cargo ready date | Not present in DPS-arranges | **Add P1.** Required on DDP/DAP; PM-discretion on FOB/EXW. |
| Vessel ETD / departure date | Not present in DPS-arranges | **Add P1.** Required on DDP/DAP; optional on FOB/EXW. |
| Customs cluster visibility | `direction='inbound' AND incoterm='DDP'` | **Widen:** `crosses_international_border AND incoterm puts customs on DPS`. |
| Per-component markup | Implicit global (not surfaced) | **Add P1.** `freight_markup_pct` · `duty_markup_pct` · `tariff_markup_pct`, each default 0.30, overridable per-leg. |
| Customer-arranges mode | First-class, 5-field meta | **Unchanged.** Image-2 design maps cleanly to revised intent. |
| Visual register, leg-group wrapper, treatment-on-line, mode chooser, downstream rollup language | Locked | **Unchanged.** Do not revisit. |

---

## Math contract (new — make it explicit in panel + downstream rollup)

Per Edward sign-off:

**Goods cost base, per leg:**
```
goods_cost_base = Σ(per-SKU production cost × units shipped) for that leg
```
Pre-freight cost of the goods being moved on the leg. Sources from rolled-up SKU unit cost × `tier.qty` (or `units_in_shipment` override when present).

**Duty cost, per customs-eligible leg, per tier:**
```
duty_cost      = duty_pct × goods_cost_base
duty_billable  = duty_cost × (1 + duty_markup_pct)
```

**Tariff cost, per customs-eligible leg, per tier:**
```
tariff_cost      = tariff_pct × goods_cost_base
tariff_billable  = tariff_cost × (1 + tariff_markup_pct)
```

**Freight cost, per leg, per tier:**
```
freight_cost      = freight_legs.tier.total_freight (PM-entered)
freight_billable  = freight_cost × (1 + freight_markup_pct)
```

**Journey rollup, per tier:**
```
freight_journey_billable = Σ(freight_billable across legs in group)
duty_journey_billable    = Σ(duty_billable across customs-eligible legs in group)
tariff_journey_billable  = Σ(tariff_billable across customs-eligible legs in group)
```

**Why per-component markup, not global 30%:** Cally's tariff-hike example — when tariff hit 125%, marking it up another 30% was untenable. The per-component model lets PM zero out `tariff_markup_pct` during anomalies without losing markup on duty or freight. Default is 0.30 on all three; deviation is per-leg (or per-quote) override. Markup is on the AMOUNT, not the rate.

**CD decision — markup surface grain:**

| Option | Shape | Note |
|---|---|---|
| **Inline markup pill** (biased) | Each pct field has a `× 1.30` pill next to it; click opens override input | Discoverable, minimal chrome. Echoes inline-edit (R7b). |
| **Markup sub-card per leg** | Three markup pcts grouped in their own sub-card | Cleaner separation, more chrome. |

Bias: inline pill. Markup is almost always 0.30; full input fields by default would be visual noise. The override surface only opens when PM clicks the pill.

---

## Customs cluster — revised visibility logic

**Old rule:** `direction = 'inbound' AND incoterm = 'DDP'`.

**New rule, per leg:**
1. The leg crosses an international border, AND
2. The leg's incoterm puts customs obligation on DPS (typically DDP; extensible if DAP-cleared variants surface).

**Scenarios:**

| Journey | Customs renders on |
|---|---|
| Shenzhen → Long Beach (DDP, single leg) | The Shenzhen → Long Beach leg |
| Shenzhen → Busan → Long Beach (DDP, two legs) | **Both** legs — Korea entry AND US entry each accrue their own duty + tariff |
| Shenzhen → Shanghai → Long Beach (DDP, two legs) | Only the Shanghai → Long Beach leg (Shenzhen → Shanghai is domestic China, no customs event) |
| Long Beach → Phoenix (DDP, single domestic leg) | Never — no border crossing |

**Schema impact:** add `freight_legs.crosses_international_border` boolean. PM-set in v1 (PM knows the route as they enter it). Derivable in v1.x or v2 if origin/destination gain country-code structure.

**Customs cluster shape after CBM removal:**

```
┌─ CUSTOMS · DDP ──────────────────────────────────────────────┐
│                                                              │
│ DUTY RATE                  TARIFF (SECTION 301)              │
│ 5.8%  × 1.30 ⓘ             7.5%  × 1.30 ⓘ                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

(That's the inline-pill version. If CD picks the sub-card variant, markup pcts live below the rate row in a grouped surface.)

The downstream rollup language stays largely intact, but should now explicitly call out:
- `duty_billable` and `tariff_billable` both feed the internal-only D+T component on the cost stack (purple hatch per existing R6 convention)
- Per-component markup means PM can audit "why is this customer's D+T charge what it is" without back-solving from a single blended markup

---

## Date fields — cargo ready date + vessel ETD

**Cally's intent (from PM doc):** DDP needs both `cargo_ready_date` AND `vessel_etd` for accurate transit-time and lead-time math. FOB/EXW — vessel dates less critical once goods leave DPS hands.

**Per-leg date fields, DPS-arranges mode:**

| Field | Schema | DDP / DAP | FOB / EXW |
|---|---|---|---|
| `cargo_ready_date` | date | Required | Recommended (PM knows when goods are ready regardless of who ships) |
| `vessel_etd` | date | Required | Optional |

**Rendering treatment — CD picks:**

| Option | Behavior |
|---|---|
| **A** | Hide `vessel_etd` on FOB/EXW; show only `cargo_ready_date` |
| **B** (biased) | Show both always; mark `vessel_etd` as optional on FOB/EXW |

Bias B — losing a populated field on incoterm change feels like data loss when the PM had filled it. Optional means "low signal value" not "we drop it."

**Customer-arranges mode** already has `ready_date` inside `customer_arranges_meta`. Semantically the same data point as `cargo_ready_date` on DPS-arranges. Two options:

| Option | Behavior |
|---|---|
| **Align** (biased) | Rename `customer_arranges_meta.ready_date` → `cargo_ready_date`. Promote to leg head proper. Single source of truth for "when goods are ready." |
| **Accept divergence** | Leave both names. Two field names, one concept. |

Bias: align. Cleaner schema. Customer-arranges mode never has `vessel_etd` (DPS isn't running the leg), so the date surface still diverges — but the data point itself is unified.

**`transit_lead_weeks` disappears entirely.** Transit lead is now derivable from `vessel_etd - cargo_ready_date` (per leg) or summed across legs in a journey. If CD wants to surface total transit lead as a read-only caption (in the leg-group header? in the downstream rollup card?), it computes from the dates. **CD picks** whether to show this derived caption at all.

---

## Multi-leg P1 — active, not deferred

CD's `leg_group.legs[]` architecture stands. v1 changes:

- The `+ LEG <P2>` chip becomes `+ Add leg` (no phase tag, fully active).
- Each leg in the group renders the full leg shape — header row · body grid · per-tier table · customs cluster if border-crossing + DPS-customs · PDF slot per CD decision below.
- Per-tier freight cost sums across legs in the group:
  ```
  journey_freight_tier = Σ(leg.tier.total_freight for leg in group)
  ```
- Per-tier customs sums across customs-eligible legs in the group.
- Leg-group label describes the journey (e.g., "Outbound · Shenzhen → Korea → US"); individual leg labels describe the leg (e.g., "Shenzhen → Busan", "Busan → Long Beach").

**Downstream rollup language updates:** the existing "Pass-through legs surface separately on the customer quote PDF as a billable" carries forward, but sum-across-legs is now the typical case, not the edge case. Verify the rollup caption reads correctly when there are 2+ bundled legs in a journey.

**Forwarder identity hidden from customer-facing PDF** — commitment carries forward. With multi-leg, this means each leg's `carrier` is internal-only; customer-facing surface shows summed cost without surfacing per-leg forwarder identity.

---

## What stays unchanged (boundary lines)

CD should NOT revisit these — they're settled:

- The three-mode chooser (DPS arranges · Customer arranges · Not yet entered)
- Customer-arranges mode shape and 5-field meta (image-2 design maps to PM intent)
- `direction` primitive on each leg (inbound/outbound) — still architectural, still drives some logic
- `treatment` toggle on the leg (bundled vs passthrough)
- Leg-group wrapper as journey container
- Visual register inheritance from R7b Setup precedent
- Eyebrow chrome ("DN · R6.2 …") per Pattern 21
- USD only, single primary forwarder, manual lead-time provenance
- Downstream rollup card pattern (math summary + customer-PDF-implication copy)
- The 10-gap structure of the original brief (this revision doesn't add or remove gaps; it shifts which phase each gap's resolution lands in)
- Pattern 25 schema verification gate still applies before implementation

---

## Updated phase map

| # | Element | v1 (P1) | v1.1 (P2) | Banked (P3) |
|---|---|---|---|---|
| 1 | Direction field | ✓ | | |
| 2 | Origin + destination | data capture ✓ | UI render | |
| 3 | Rate breakdown | single total_freight ✓ | | breakdown sub-table |
| 4 | Insurance line | — | — | full unbundling support |
| 5 | Lead time / ETA | **`cargo_ready_date` + `vessel_etd` ✓** | | |
| 6 | Container utilization | — | | caption + LCL/FCL thresholds (returns with calc) |
| 7 | SKU allocation | — | | per-leg `sku_id` filter |
| 8 | Customer-arranges populated | ✓ | | |
| 9 | Forwarder PDF | CD decides — slot at P1 or hold P2 | upload mechanism | |
| 10 | Multi-currency | — out of scope all phases — | | |
| **+** | **Multi-leg within journey** | **✓ (was P2)** | | |
| **+** | **Per-component markup (freight/duty/tariff)** | **✓** | | |
| **+** | **`crosses_international_border` flag** | **✓** | | |
| **+** | **CBM/unit auto-calc** | — | — | with freight calculator |
| **+** | **Freight calculator + port templates (LA/Miami/Shenzhen/NY · LCL/FCL)** | — | — | full P3 |
| **+** | **Insurance bundled toggle + rollup badges** | — | — | if insurance unbundles |

---

## Schema deltas

**Add to v1:**
```sql
-- Date fields per leg, replacing transit_lead_weeks
alter table freight_legs add column cargo_ready_date date;
alter table freight_legs add column vessel_etd date;

-- International border crossing flag
alter table freight_legs add column crosses_international_border boolean not null default false;

-- Per-component markup (per leg, overridable; defaults 30%)
alter table freight_legs add column freight_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column duty_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column tariff_markup_pct numeric(5,4) not null default 0.3000;
```

**Remove from v1 customs sub-object:**
- `freight_legs.customs.cbm_per_unit` — drop from P1 schema entirely. Returns in P3 with freight calculator.

**Remove from v1 leg:**
- `freight_legs.insurance_bundled` — drop from P1 schema. Toggle and rollup badge return P3 if insurance model is revisited.
- `freight_legs.transit_lead_weeks` — drop entirely. Replaced by derivable transit lead from `vessel_etd - cargo_ready_date`.

**Customer-arranges meta (CD picks):**
- Either rename `freight_customer_arranges_meta.ready_date` → `cargo_ready_date` and promote to leg head proper (biased), or accept divergent naming across modes.

**Customs cluster visibility rule:**
- Old: `direction = 'inbound' AND incoterm = 'DDP'`
- New: `crosses_international_border = true AND incoterm IN ('DDP')` (extensible)

---

## Open for CD (decide before revising design)

1. **Per-component markup surface grain.** Inline pills (biased) vs separate markup sub-card per leg.
2. **`vessel_etd` on FOB/EXW.** Hide entirely vs show as optional (biased).
3. **`cargo_ready_date` naming across modes.** Align (biased — rename + promote out of customer-arranges meta) vs accept divergence.
4. **Per-leg PDF slot in v1.** Render slot at P1 with upload at P2, vs hold whole slot at P2 (biased). Rationale for holding: PMs can use `audit_note` as a freeform PDF reference in v1; revisit if friction surfaces in first month.
5. **Derived transit-lead caption.** Surface somewhere as read-only (where?) vs drop entirely. Bias: optional.

---

## Pattern 30 deliverable expectations

Same as original brief:
- Updated unbundled prototype source (HTML + JSX + CSS + `data.js`) reflecting these revisions
- Updated `r6-2-designer-notes.md` documenting the revision rationale (point to this brief, note what changed and why)
- Updated `r6-2-data-source-map.md` reflecting schema deltas and the new visibility rules

The original 6.2 unbundled source is the base. CD revises against it; does not restart.

---

## Pattern 25 schema verification gate

Multi-leg moving to P1 makes Pattern 25 gating, not advisory. Before CC writes any implementation:

- CC rules on `freight_legs` vs `freight_inputs` disposition. Original schema has `freight_inputs` flat per `(quote_sku_id, tier_id)`. The R6.2 design replaces or supplements this with `freight_legs` + `freight_leg_groups` + per-leg-per-tier cost rows. CC owns repo truth on whether this is a migration, an additive new table set, or a hybrid.
- The new markup fields and the `crosses_international_border` bool become part of the schema gate.
- Customs sub-object stays as JSONB on `freight_legs` (CD's earlier commitment — preserved).

---

## Timeline

Revision is smaller than the original 6.2 design — architecture intact, only field-level scope shifts and one new math contract. Estimate: 2-3 days for CD design revision + unbundled source update + notes/data-source-map updates.

Implementation slot in v1 release path unchanged. R6.2 implementation lands after rest-of-app fidelity sweep PR, before Microsoft OAuth, gated on Pattern 25 completion.
