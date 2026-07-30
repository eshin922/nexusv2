# Pattern 25 Schema Verification Gate — R6.2 Freight Implementation

**To:** CC
**From:** CA (relayed from Edward via design coordination)
**Status:** Pre-implementation gate · blocking R6.2 implementation slot
**Scope:** Schema disposition for R6.2 freight panel · `freight_inputs` → `freight_legs` shape

---

## Context

R6.2 freight panel design is final (rev 1) — this is the **full first implementation**. No prior 6.2 work has landed in dev; the current state has only the legacy `freight_inputs` placeholder schema from the original SPEC. R6.2 introduces the proper data model (`freight_legs` + `freight_leg_groups` + per-leg-per-tier rows + customs JSONB), the math contract, multi-leg support, dual date fields, widened customs visibility, and per-component markup.

Before implementation begins, Pattern 25 requires CC to rule on the schema shape — specifically, how the new R6.2 schema relates to the legacy `freight_inputs` placeholder. The CD-side design is committed; the schema disposition (migration shape, fields, table relationships) is yours to settle.

This is the kickoff prompt for that ruling. Can begin in parallel with current CC plate (Slot 2 fidelity sweep, Slot 3 Pricing reframe) — schema disposition doesn't depend on either.

---

## Input materials

| Doc | Authority |
|---|---|
| `/mnt/user-data/outputs/r6-2-freight-revision-brief.md` | **Authoritative for the revised scope.** Read first. Delta against the original R6.2 brief; reflects PM feedback + Edward sign-off on math contract. |
| `r6-2-designer-notes.md` (rev 1) | CD's revised designer notes. Explicit rev-1 doc with summary of changes, Edward's 5 locked decisions, math contract, three new pushbacks for review, updated phase map. |
| `r6-2-data-source-map.md` (rev 1) | CD's revised schema map. Every field traced to schema + phase; includes exact SQL deltas (additions, drops, rename migration for `ready_date` → `cargo_ready_date`) and three specific Pattern 25 items CD flagged for CC. |
| CD's revised prototype (HTML/JSX/CSS/data.js · screenshots in coordination thread) | Source of truth for surface layout, per-component markup pill placement, multi-leg rendering, customs cluster shape post-CBM-removal. |
| `SPEC.md` line 240+ | Current `freight_inputs` schema. |
| `CLAUDE.md` line 50+ | Current freight cost rollup math contract. |

---

## What you're ruling on

### Primary: schema disposition

The R6.2 design replaces or supplements the existing `freight_inputs` table with `freight_legs` + `freight_leg_groups` + per-leg-per-tier cost rows. Three candidate paths:

| Option | Shape | Trade-off |
|---|---|---|
| **A — Full migration (biased)** | Drop `freight_inputs`; create `freight_legs` + `freight_leg_groups` + `freight_leg_tiers` + customs JSONB per leg. | Cleanest schema; one source of truth. `freight_inputs` is a placeholder that was never properly used in production workflows, so there's no real data preservation cost. |
| **B — Hybrid additive** | Keep `freight_inputs` as a derived view summarizing `freight_legs`. Existing code paths read from view; new code paths read from `freight_legs` direct. | Compatibility for any code currently reading `freight_inputs` (need to inventory). Adds complexity (view + table). |
| **C — Net-new additive** | Add `freight_legs` etc. alongside `freight_inputs`; `freight_inputs` becomes a per-(SKU, tier) bridge aggregating from legs. | Both tables coexist with shifted semantics. Heaviest of the three. |

Bias: **A**, pre-production, no historical data preservation cost, cleanest going forward. Your call.

### Secondary choices CC picks

1. **`freight_customer_arranges_meta` as separate table or JSONB on `freight_legs`?** CD left this open. Separate table is cleaner for audit-log diff tracking; JSONB is half the migration work. Bias: separate table if audit log granularity on these fields matters.

2. **`crosses_international_border` flag scope.** v1 has it as a per-leg boolean, PM-set. v1.x or v2 could derive from origin/destination country codes. Confirm v1 = PM-set boolean (matches design intent + revision brief).

3. **`goods_cost_base` source of truth.** Math reads sum of per-SKU production cost × units shipped per leg. CC owns whether this is computed live (`packaging_inputs` + `production_inputs` + `bulk_raw` rollup × `units_in_shipment ?? tier.qty`) or materialized somewhere. Bias: live computation. No new storage.

4. **Cost stack integration.** The FRT row and D+T row on the existing Cost Build cost stack need updated source contracts:
   - FRT row at tier T = `journey_freight_tier(T)` (sum across bundled legs in journey)
   - D+T row at tier T = `journey_duty_tier(T) + journey_tariff_tier(T)` (sum across customs-eligible legs)
   - Pass-through legs still surface separately on customer-facing PDF (existing convention)

---

## Schema deltas to incorporate

From the revision brief:

```sql
-- Date fields per leg (replaces transit_lead_weeks)
alter table freight_legs add column cargo_ready_date date;
alter table freight_legs add column vessel_etd date;

-- International border crossing flag
alter table freight_legs add column crosses_international_border boolean not null default false;

-- Per-component markup (per leg, overridable; defaults 30%)
alter table freight_legs add column freight_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column duty_markup_pct numeric(5,4) not null default 0.3000;
alter table freight_legs add column tariff_markup_pct numeric(5,4) not null default 0.3000;
```

**Remove from P1 schema:**
- `freight_legs.customs.cbm_per_unit` — out (returns in P3 with freight calculator)
- `freight_legs.insurance_bundled` — out (returns in P3 if insurance unbundles)
- `freight_legs.transit_lead_weeks` — out (replaced by date fields; transit lead derived)

**From CD's earlier P1 schema commitments (carry forward):**
- `freight_legs.direction` enum (`inbound` / `outbound`)
- `freight_legs.origin`, `freight_legs.destination` text
- `freight_leg_groups` table with `id`, `quote_id`, `label`, `display_order`
- `freight_legs.leg_group_id` ref to `freight_leg_groups`
- `freight_customer_arranges_meta` (separate table or JSONB — your call per Secondary #1)

**Customer-arranges meta naming:** per revision brief, the cargo-ready date field aligns across modes. Either rename `customer_arranges_meta.ready_date` → `cargo_ready_date` and promote out of the meta blob to the leg head, or accept divergent naming. CD bias: align (single source of truth for "when are goods ready").

---

## Math contract (per Edward sign-off)

```
goods_cost_base   = Σ(per-SKU production cost × units shipped) for that leg
freight_cost      = freight_legs.tier.total_freight (PM-entered)
duty_cost         = duty_pct × goods_cost_base
tariff_cost       = tariff_pct × goods_cost_base

freight_billable  = freight_cost × (1 + freight_markup_pct)
duty_billable     = duty_cost × (1 + duty_markup_pct)
tariff_billable   = tariff_cost × (1 + tariff_markup_pct)

journey_freight_tier  = Σ(freight_billable across bundled legs in group)
journey_duty_tier     = Σ(duty_billable across customs-eligible legs in group)
journey_tariff_tier   = Σ(tariff_billable across customs-eligible legs in group)
```

Markup is on the **amount**, not the rate. Per-component (not global 30%) — Cally's tariff-hike example: when tariff was 125%, marking up another 30% on top was untenable, so PM needs to be able to zero out `tariff_markup_pct` without losing markup on duty or freight.

Customs cluster visibility per leg: `crosses_international_border = true AND incoterm IN ('DDP')` (extensible to DAP-cleared variants if they surface).

The `effective_units` convention from `CLAUDE.md` (`units_in_shipment ?? tier.qty`) carries forward but now operates per-leg.

---

## ⚠ Implementation corrections (relayed from Edward)

CD's revised prototype renders the panel as a standalone full-page surface with a slide-in modal for "Add freight leg." Both are prototype-only choices; production implementation diverges:

### 1. Surface placement — embedded in Setup page

R6.2 freight panel **lives INSIDE the existing Setup page**, not as a standalone full-page surface. CD's prototype uses full-page chrome (eyebrow `LUMEN & CO · PRIMARY · V4 DRAFT`, page title `Freight · complete panel · rev 1`, action cluster top-right) for design legibility. Production rendering:

- **No standalone page chrome.** No eyebrow. No page-title H1. No top-right action cluster.
- **Integrates as the Freight section** within Setup → Cost Build sub-sections (R7a IA arc — already canonical per existing data-source-map "Cross-surface contracts honored" section).
- **Visual register inherits Setup precedent** (R7b cards, table grammar, inline-edit chrome) — same treatment as Packaging / Production / Bulk Raw sibling sections.
- **Section header pattern** matches the existing Setup sub-section convention — eyebrow + section title + status chip + owner. Mirror Packaging's section header treatment.

CD's prototype is the source of truth for the panel's **internal** layout (modes, leg shape, customs cluster, downstream rollup card, per-component markup pills, multi-leg rendering). Strip the page wrapper; embed in Setup.

### 2. "Add freight leg" modal — centered popup, not slide-in

The Add Leg form (currently rendered as a slide-in from the right edge in CD's prototype) should render as a **centered popup modal**. This was previously settled — "centered modal preference confirmed; not slide-in" — and the prototype's slide-in rendering is a regression to be corrected at implementation time.

- **Standard centered modal pattern** — overlay backdrop, centered card, close on backdrop click or ✕
- **Same content/fields** as the prototype's slide-in version (direction, incoterm, label, mode, carrier, origin, destination, cargo_ready_date, vessel_etd, crosses_international_border checkbox, per-component markup pcts, per-tier rate inputs, customs cluster when applicable, PDF attach affordance)
- **Use Setup's existing modal primitive** — match whatever centered-modal pattern other Setup sub-sections use for "Add ___" actions

---

## What's settled — don't relitigate

- 3-mode chooser at top of panel (DPS arranges · Multi-leg journey · Customer arranges)
- Customer-arranges as first-class mode with 5-field meta (`origin`, `cargo_ready_date`, `customer_contact`, `audit_note`, `incoterm` locked to EXW/FCA/CIF/DAP)
- Direction primitive on each leg (inbound / outbound)
- Treatment on the line (bundled vs passthrough)
- Leg-group wrapper as journey container; multi-leg active in P1
- Visual register inheritance from R7b Setup precedent
- Per-component markup as inline pills (`× 1.30` next to each pct field; click opens override)
- USD only; single primary forwarder; manual lead-time provenance
- Math contract per Edward sign-off — markup on amount not rate; per-component split
- Customs cluster visibility logic (`crosses_international_border AND incoterm puts customs on DPS`)
- All P2/P3 deferrals per revision brief (insurance toggle, CBM/unit auto-calc, freight calculator, port templates, rate breakdown, SKU allocation, multi-route routing)

---

## Deliverable

CC's Pattern 25 output:

1. **Migration plan** (`.sql` or migration spec) implementing the chosen disposition (A/B/C above)
2. **Updated schema** for `freight_legs`, `freight_leg_groups`, customs JSONB, customer-arranges (table or JSONB), reflecting all deltas
3. **Updated cost rollup contract** in `costing.ts` (or equivalent) implementing per-leg → per-tier aggregation with per-component markup applied at the line level
4. **Confirmation of the four Secondary choices** above (`customer_arranges_meta` shape, `crosses_international_border` scope, `goods_cost_base` source, cost stack source contracts)
5. **Any blocking issues that surface** — existing `freight_inputs` consumer code requiring special handling, math discrepancies, schema constraints, anything you find

Estimate: ~1 day. Can run in parallel with current CC plate.

---

## Sequencing reminder

Per current v1 release path:

```
Slot 2 (fidelity sweep) → Slot 3 (Pricing reframe) → R6.2 impl → Slot 4 (Leaf-detach) → Slice 11 → OAuth → Mark-Accepted → v1
```

- Pattern 25 ruling lands before R6.2 impl can start
- Can begin **now** in parallel with Slot 2/3 — schema disposition doesn't depend on either
- Slice 11's Pass-through Fix A math verification depends on R6.2 being implemented and stable
- Mark-Accepted's NetSuite SO payload shape depends on R6.2's per-component markup + multi-leg cost model — R6.2 must precede

---

## Out of scope for this Pattern 25 gate

- R6.2 implementation itself (separate slice after schema ruling lands)
- CD prototype iteration to reflect surface-placement / modal-type corrections (optional CD addendum; not blocking CC)
- P2/P3 deferrals (CBM/unit auto-calc, freight calculator, port templates, insurance unbundling)
- Multi-route / R8 work (separate round; multi-leg-within-journey is sufficient per Edward)
- Audit-trail value-granularity enhancement (separate UX backlog item; CC handling via separate relay)

---

Ping back with Pattern 25 ruling + any blockers. Edward + CA standing by to clarify anything that surfaces.
