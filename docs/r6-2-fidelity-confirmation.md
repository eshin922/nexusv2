# R6.2 Freight — Fidelity Confirmation Pass

**Author:** CC
**Date:** 2026-05-14
**Inputs read:**
- `docs/r6-2-pattern-25-cc-kickoff.md` (CA, authoritative for corrections)
- `docs/r6-2-freight-revision-brief.md` (CA, authoritative for revised scope)
- `docs/design-prototypes/dist/docs/r6-2-designer-notes.md` rev 1 (CD)
- `docs/design-prototypes/dist/docs/r6-2-data-source-map.md` rev 1 (CD)
- `docs/design-prototypes/dist/r6_2_freight-panel.jsx` (CD prototype)
- `docs/design-prototypes/dist/r6-2_data.js` (CD fixtures)
- Existing schema: `src/db/schema.ts` (`freight_inputs` placeholder + `freightMode` / `freightTreatment` enums)

**Revision brief content note:** brief content is largely duplicated downstream into the designer notes + data-source map (those derive from this brief). The brief alone adds: Cally's PM rationale for the changes (context, not actionable), explicit per-incoterm date requiredness (folded into Gap 5 below), and explicit "forwarder identity hidden from customer-facing PDF" commitment for multi-leg (folded into R-9.5 and Gap 15). All five "Open for CD" picks in the brief are settled in rev-1 designer notes (Edward decisions #1-#5).

---

## Method

For each UI surface + behavior + math contract + schema commitment + edge case in R6.2:

- **READY** → confirmed by an explicit statement in one of the docs above (CA or CD). Citation in italics.
- **GAP** → not explicitly stated, or stated with ambiguity that affects implementation choices. CC bias suggestion clearly labeled where applicable.

No assumptions, no precedent-borrowing without explicit confirmation per Edward's directive.

---

## 1. Ready list

### Mode chooser

- **R-1.1** Three-mode chooser at top of panel: DPS arranges · Multi-leg journey · Customer arranges. *(Kickoff line 148; designer notes line 80)*
- **R-1.2** Mode chooser is UI state, not persisted to schema. *(Data-source map line 17)*
- **R-1.3** Prototype shows a 4th "Multi-leg journey" mode tile separate from "DPS arranges." *(Prototype `ModeChooser` lines 62-82 has separate `multi_leg` and `dps_arranges` mode tiles.)*

### Leg-group wrapper

- **R-2.1** `freight_leg_groups` is a P1 table with `id` UUID, `quote_id` FK, `label` text, `display_order` int. *(Data-source map SQL lines 178-184)*
- **R-2.2** Group label rendered in header (e.g. `Outbound · Shenzhen → Busan → Long Beach`). *(Data-source map line 26; prototype `LegGroup` lines 98-110)*
- **R-2.3** Leg count caption: `· N leg(s)` (mono register). *(Prototype line 103; data-source map line 27)*
- **R-2.4** Journey transit caption: `· X.Xw total transit` computed as `max(vessel_etd) − min(cargo_ready_date)` across legs, rounded to 0.1 weeks. *(Data-source map line 28; designer notes line 21)*
- **R-2.5** `+ Add leg` button active in P1 (no phase chip). *(Data-source map line 29; designer notes line 71)*

### Per-leg header

- **R-3.1** Direction chip: `inbound` / `outbound` enum. *(Data-source map line 37)*
- **R-3.2** Leg label (text). *(Data-source map line 38)*
- **R-3.3** Origin / Destination (text fields). *(Data-source map lines 39-40)*
- **R-3.4** `↔ BORDER` chip — visible when `crosses_international_border = true`. Renders next to origin → destination in the route line. *(Designer notes line 54; prototype lines 182-189)*
- **R-3.5** Treatment toggle: `bundled` / `passthrough` enum. PM-set per leg. *(Data-source map line 42)*
- **R-3.6** Customer-arranges legs swap the treatment toggle for `COST = $0 · METADATA ONLY` mono caption (read-only). *(Designer notes line 56; prototype lines 199-203)*
- **R-3.7** Action menu (`⋯`) is UI; behavior not specified in docs. *(Data-source map line 43; behavior is **Gap 7** below)*

### Per-leg body grid

- **R-4.1** Five fields: Mode · Carrier · Incoterm · Cargo ready · Vessel ETD · Freight markup (technically six counting markup pill; "five fields" in designer notes is excluding the markup pill row). *(Designer notes line 60; prototype lines 207-251)*
- **R-4.2** Mode enum carries the existing `freightMode` shape extended; prototype lists `Ocean FCL, Ocean LCL, Air freight, Air express, LTL truck, Truckload, Drayage, EXW pickup, Other`. *(Prototype `D.modes` array, fixtures line 185-187)* — **but**: existing schema has `freightMode` pgEnum with values `parcel / ltl / ftl / ocean / air / courier / other` (`schema.ts:67-75`). The prototype set differs significantly. **See Gap 8.**
- **R-4.3** Carrier / forwarder = text. *(Data-source map line 50)*
- **R-4.4** Incoterm enum: `DDP / DAP / FOB / EXW / FCA / CIF`. *(Data-source map line 51; fixtures lines 175-182)*
- **R-4.5** `cargo_ready_date` date column on `freight_legs` (P1). *(Data-source map line 52; schema delta)*
- **R-4.6** `vessel_etd` date column on `freight_legs`; optional on FOB/EXW; renders with `· optional` italic caption for those incoterms. *(Data-source map line 53; prototype lines 230-234; Edward decision #2 explicitly: "Show always, mark optional" — line 18 of designer notes)*
- **R-4.7** Freight markup pill: numeric `freight_markup_pct` column, default 0.30, overridable per-leg. Inline pill shows `× 1.30` (default style) or `× 1.45 OVR` (override style). *(Designer notes line 17; prototype `MarkupPill` lines 114-152; data-source map line 54)*
- **R-4.8** Derived transit caption `· X.Xw in transit` right-aligned in the markup-pill row when both dates filled. *(Designer notes line 62; prototype lines 244-248)*

### Per-tier rate table

- **R-5.1** `freight_leg_tiers` is a per-(leg, tier) table; column `total_freight` numeric, PM-entered. *(Data-source map line 64; kickoff line 167)*
- **R-5.2** Tier label + units come from `quote_tiers.label` + `.qty` (R7b carry-forward). *(Data-source map line 63)*
- **R-5.3** Per-unit billable = `(total_freight × (1 + freight_markup_pct)) / units` per tier. *(Data-source map line 65; prototype line 280)*
- **R-5.4** Inline raw caption: `$X × 1.30 ÷ Y units` shown next to the billable value. *(Data-source map line 66; prototype line 293)*

### Customs cluster

- **R-6.1** Visibility rule: `crosses_international_border = true AND incoterm = 'DDP'`. *(Designer notes line 11; data-source map line 74; kickoff line 116)*
- **R-6.2** Each leg evaluates independently — multi-leg journeys can have customs on multiple legs. *(Data-source map line 76)*
- **R-6.3** Two cells in P1: Duty rate + duty markup pill · Tariff rate + tariff markup pill. *(Designer notes line 66)*
- **R-6.4** Math footer caption: `Math: duty_billable = duty_pct × goods_cost × (1 + duty_markup) · tariff same · feeds D+T row` (mono, ink-4, uppercase). *(Designer notes line 67; prototype lines 327-333)*
- **R-6.5** Eyebrow text: `Customs · {incoterm} · border crossing`. *(Designer notes line 68; prototype line 308)*
- **R-6.6** Customs sub-object: `freight_legs.customs` JSONB with `duty_pct` + `tariff_pct` keys. CBM removed in P1. *(Data-source map lines 81, 83, 87)*
- **R-6.7** Duty markup pill: `freight_legs.duty_markup_pct` numeric, default 0.30. *(Data-source map line 82)*
- **R-6.8** Tariff markup pill: `freight_legs.tariff_markup_pct` numeric, default 0.30. *(Data-source map line 84)*

### PDF attachment slot

- **R-7.1** Slot rendered P1 on DPS-arranges legs (always visible). Upload mechanism is P2. *(Data-source map lines 93-97; Edward decision #4 line 20)*
- **R-7.2** When populated (P2 onward), shows filename + uploaded_at + size + Replace affordance. *(Prototype lines 339-351)*
- **R-7.3** Empty state copy: `↑ Attach forwarder quote PDF` + `upload · P2` phase chip. *(Prototype lines 352-356)*

### Customer-arranges mode

- **R-8.1** Locked incoterm set: EXW / FCA / CIF / DAP. *(Kickoff line 149; data-source map line 106)*
- **R-8.2** `freight_customer_arranges_meta` table fields after rev 1 promotion: `customer_contact` text + `audit_note` text. *(Data-source map lines 109-110; designer notes line 11)*
- **R-8.3** `cargo_ready_date` PROMOTED out of `customer_arranges_meta` to `freight_legs.cargo_ready_date` for single source of truth. *(Designer notes Edward decision #3 line 19; data-source map line 108)*
- **R-8.4** Tier per-unit = 0 across all tiers in customer-arranges (no cost). *(Data-source map line 111)*
- **R-8.5** `mode = customer_arranges` hides FRT row in downstream rollup; metadata travels with the quote artifact (Mark-Accepted snapshot). *(Data-source map lines 123, 201)*

### Downstream rollup card

- **R-9.1** FRT row at tier T = `Σ (leg.tier.total_freight × (1 + leg.freight_markup_pct)) / leg.tier.units` across legs where `treatment = 'bundled'`. *(Data-source map line 119; prototype lines 366-370)*
- **R-9.2** D+T row at tier T = `Σ (duty_billable + tariff_billable)` across legs where `crosses_international_border AND incoterm = 'DDP'`. *(Data-source map line 120)*
- **R-9.3** Pass-through callout when `count(legs WHERE treatment = 'passthrough') > 0`. *(Data-source map line 121)*
- **R-9.4** `· N border-crossing legs` count caption when N > 0. *(Data-source map line 122; prototype line 388)*
- **R-9.5** Customer-arranges mode → "FRT row hidden" copy. *(Data-source map line 123; prototype lines 380-384)*
- **R-9.6** Forwarder identity hidden from customer-facing PDF. With multi-leg, each leg's `carrier` is internal-only; customer-facing surface shows summed cost without surfacing per-leg forwarder identity. *(Brief line 172)*

### Add-leg modal (corrected from prototype slide-in)

- **R-10.1** Centered popup modal (NOT slide-in). Standard centered modal pattern: overlay backdrop, centered card, close on backdrop click or ✕. *(Kickoff lines 137-143)*
- **R-10.2** Use Setup's existing centered-modal primitive (`.r7b-modal-*` register per other Setup sub-sections). *(Kickoff line 143)*
- **R-10.3** Form fields (same as prototype slide-in version): direction, incoterm, label, mode, carrier, origin, destination, cargo_ready_date, vessel_etd, crosses_international_border checkbox, per-component markup pcts (3 pills), per-tier rate inputs, customs cluster (when applicable), PDF attach affordance. *(Kickoff lines 141-142; prototype lines 399-557)*
- **R-10.4** Cancel / Add leg footer buttons. *(Prototype lines 548-554)*

### Cost stack integration

- **R-11.1** FRT row source contract = `journey_freight_tier(T)` (sum across bundled legs in journey). *(Kickoff lines 55-58)*
- **R-11.2** D+T row source contract = `journey_duty_tier(T) + journey_tariff_tier(T)`. *(Kickoff line 58)*
- **R-11.3** Pass-through legs still surface separately on customer-facing PDF (existing convention). *(Kickoff line 58)*

### Math contract

- **R-12.1** Per-leg formulas (markup on amount, not rate):
  ```
  goods_cost_base   = Σ(per-SKU production cost × units shipped)
  freight_cost      = freight_legs.tier.total_freight (PM-entered)
  freight_billable  = freight_cost × (1 + freight_markup_pct)
  duty_cost         = customs.duty_pct × goods_cost_base
  duty_billable     = duty_cost × (1 + duty_markup_pct)
  tariff_cost       = customs.tariff_pct × goods_cost_base
  tariff_billable   = tariff_cost × (1 + tariff_markup_pct)
  ```
  *(Designer notes lines 25-37; kickoff lines 98-111)*
- **R-12.2** Journey rollup per tier (sums per-leg billables across the leg-group). *(Designer notes lines 39-45)*
- **R-12.3** `customs-eligible` filter for the rollup = `crosses_international_border AND incoterm = 'DDP'`. *(Data-source map line 149)*
- **R-12.4** `effective_units` convention from `CLAUDE.md` (`units_in_shipment ?? tier.qty`) carries forward but now operates per-leg. *(Kickoff line 117)*

### Surface placement (corrected from prototype)

- **R-13.1** Panel embedded inside Setup page as the Freight sub-section. NOT a standalone full-page surface. *(Kickoff lines 122-134)*
- **R-13.2** Strip: eyebrow, page-title H1, top-right action cluster. *(Kickoff line 129)*
- **R-13.3** Visual register inherits R7b Setup precedent (cards, table grammar, inline-edit chrome). *(Kickoff line 131)*
- **R-13.4** Section header pattern mirrors Packaging's section header treatment (eyebrow + section title + status chip + owner). *(Kickoff line 132)*

### Banked / deferred to P2/P3

- **R-14.1** P2 deferrals: PDF upload mechanism (slot rendered P1); origin/destination surface polish. *(Designer notes phase map lines 142-149)*
- **R-14.2** P3 deferrals: CBM/unit auto-calc + freight calculator + port templates + insurance bundling + rate breakdown sub-table + SKU allocation + multi-route routing + country-code derivation of `crosses_international_border`. *(Designer notes phase map + carry-forward; kickoff lines 156-158)*

---

## 2. Gap list

Listed in dispositionable order. For each: **what's missing**, **what I'd need to proceed**, and (where I have one) a **bias suggestion** clearly labeled `would propose if asked` — NOT submitted as an answer.

### Gap 0 — RESOLVED 2026-05-14

Brief added to repo at `docs/r6-2-freight-revision-brief.md`. Content largely duplicates designer notes + data-source map; new content (Cally's PM rationale, explicit per-incoterm date requiredness, multi-leg forwarder-identity-hidden commitment) folded into the rest of the report. No standalone unresolved gap here.

### Gap 1 — Empty state of a DPS-arranges leg-group before any legs are added

**What's missing:** The prototype shows the `EmptyState` component (lines 84-95) for the panel-level empty (`mode = "empty"`). But what does a freshly-created `freight_leg_groups` row with zero `freight_legs` rows look like? Once the PM picks DPS-arranges mode + creates a leg-group, but before clicking "+ Add leg", is the leg-group rendered with just its header + an empty body? With a "+ Add first leg" CTA inside it? Hidden entirely until first leg lands?

**What I need:** PM-facing UX for the "empty leg-group" state (different from "empty panel").

**Bias** (would propose if asked): a single visible leg-group with header + a centered `+ Add first leg` ghost button in the body. Mirrors EmptyState shape but scoped to the leg-group.

### Gap 2 — Default value + visual treatment for blank duty / tariff pct fields

**What's missing:** The prototype shows duty_pct=0.058 + tariff_pct=0.075 hardcoded in fixtures. For a NEW leg in customs-visible state, what's the default before PM enters values? `null`? `0`? Placeholder showing `—`? Does PM see two empty `%` inputs?

**What I need:** explicit default + empty-state visual for `customs.duty_pct` and `customs.tariff_pct` per leg. Storage: JSONB allows null/missing keys; UI behavior on null is unspecified.

**Bias** (would propose if asked): `null` (no key in customs JSONB until PM enters); UI shows empty `<input placeholder="0.0%">`; downstream rollup treats null as 0 with a chip "needs entry" surfaced somewhere (separate gap on that chip).

### Gap 3 — Audit log entry shape for a markup pill override

**What's missing:** Audit log convention for `freight_markup_pct`, `duty_markup_pct`, `tariff_markup_pct` changes is not specified. Designer notes line 200 says "every freight-leg edit, treatment toggle, markup pill override, cargo_ready / ETD change, customer-arranges meta write hits `audit_log`" but doesn't define the action key or diff_json shape.

**What I need:** action keys for markup pill overrides (one per component, or one shared with a `component: 'freight'|'duty'|'tariff'` discriminator in diff_json), and the diff_json shape (`{ markup_pct: { from: 0.30, to: 0.25 }, component: 'duty' }`?).

**Bias** (would propose if asked): one shared action `freight_leg_markup_updated` with `diff_json.component` discriminator; from/to pcts in diff_json. Reads cleanly in timeline; queryable.

### Gap 4 — `↔ BORDER` chip color token

**What's missing:** Designer notes line 54 calls the chip a "visual cousin of `direction`" but the prototype (lines 182-189) renders it with hardcoded `oklch(0.55 0.07 215 / 0.12)` background + `oklch(0.45 0.10 215)` text — a teal-blue distinct from the direction-chip palette. Does it inherit a direction token, get its own border-themed token, or stay hardcoded?

**What I need:** explicit token name (e.g., `--border-chip` / `--border-chip-soft`) or confirmation that the literal oklch in the prototype is the intended palette.

**Bias** (would propose if asked): introduce `--border-chip` + `--border-chip-soft` tokens; prototype's literal oklch becomes the light-mode values; dark-mode values to be set if smoke surfaces the need.

### Gap 5 — Validation rules (partially closed by brief)

**Partially closed by brief:** the revision brief (lines 128-133) specifies per-incoterm date requiredness:

| Field | DDP / DAP | FOB / EXW |
|---|---|---|
| `cargo_ready_date` | Required | Recommended (PM knows when goods are ready regardless of who ships) |
| `vessel_etd` | Required | Optional |

That closes the "is the date field required" sub-gap for DDP/DAP (yes) and FOB/EXW (cargo_ready recommended-but-not-blocked; vessel_etd genuinely optional). What's still open:

- Must `vessel_etd >= cargo_ready_date` per leg? Server-side reject or just UI warning?
- Cross-leg: must `legN.cargo_ready_date >= leg(N-1).vessel_etd`? (Sequential leg ordering invariant.)
- "Recommended but not blocked" on FOB/EXW `cargo_ready_date` — UI warning chip surfaces but server accepts NULL? Or is it actually a soft block?
- Per-tier `total_freight` validation: must be > 0 if treatment = bundled? Allowed to be null (no entry yet)?
- Markup pct range: 0.00-1.00? 0.00-9.99? Allowed negatives?
- Origin / destination: required when not customer-arranges?
- Customs duty_pct / tariff_pct range: 0.0000-9.9999 per the numeric(5,4) precision, but UI doesn't say.

**What I need:** validation matrix per remaining field — server-reject vs UI-warn vs allow-and-flag.

**Bias** (would propose if asked): hard requireds on DDP/DAP (server-reject); soft recommendeds on FOB/EXW (UI chip, server accepts NULL). Specific bias on date pair: warn (not reject) when `vessel_etd < cargo_ready_date` because forwarders sometimes give estimated ETDs before cargo-ready is locked.

### Gap 6 — Single-leg-with-only-one-date journey transit caption rendering

**What's missing:** Designer notes line 21 + R-2.4 say transit caption = `max(vessel_etd) - min(cargo_ready_date)`. When only ONE leg has both dates filled (and others have nulls), does the caption render? Hide? Render with a partial-data indicator?

**What I need:** behavior spec for the leg-group transit caption when some legs have missing dates.

**Bias** (would propose if asked): hide the caption entirely unless ALL legs have both dates filled. Partial-data caption confuses more than it helps; PMs will fill in dates when known and the caption appears as a reward.

### Gap 7 — Per-leg `⋯` action menu contents

**What's missing:** The prototype renders a `⋯` action menu (line 204) on the leg header but the menu's contents are not specified anywhere. Existing patterns from sku-row's overflow menu suggest: Delete leg, Reorder up/down, possibly Duplicate.

**What I need:** explicit list of actions per leg overflow menu.

**Bias** (would propose if asked): `Delete leg`, `Move up`, `Move down`. Skip Duplicate for v1 (rare; PM adds via `+ Add leg`).

### Gap 8 — Mode enum value mismatch between schema + prototype

**What's missing:** Existing `freightMode` pgEnum in `schema.ts:67-75` carries `parcel / ltl / ftl / ocean / air / courier / other`. The prototype's mode dropdown uses different strings: `Ocean FCL / Ocean LCL / Air freight / Air express / LTL truck / Truckload / Drayage / EXW pickup / Other`. The fine-grained set in the prototype doesn't map cleanly to the existing enum (ocean → FCL or LCL? air → freight or express?).

**What I need:** disposition — extend the enum with the new values? Add a `freight_mode_detail` text column adjacent to the existing enum (enum + detail)? Drop the existing enum entirely?

**Bias** (would propose if asked): rebuild the enum to match the prototype values (`ocean_fcl / ocean_lcl / air_freight / air_express / ltl_truck / truckload / drayage / exw_pickup / other`). Existing `freightInputs` rows in dev DB use the old values; small data-migration script renames per-row (`ocean → ocean_fcl` if PM didn't specify; let PMs reclassify post-migration if needed). Pre-prod tolerance per Pattern 32.

### Gap 9 — Order of leg-groups within a quote + order of legs within a group

**What's missing:** `freight_leg_groups.display_order` is in the schema delta (line 182 of data-source map). Order of legs WITHIN a group is not specified — is it `sort_order` column on `freight_legs`? Insertion-time order via `created_at`? PM-controlled with drag/grip?

**What I need:** ordering convention for both leg-groups (within a quote) and legs (within a group).

**Bias** (would propose if asked): `display_order int` on `freight_leg_groups` + `display_order int` on `freight_legs`; both set by entry sequence in v1 (no drag yet); v1.1 adds the chevron-grip drag pattern Designer notes line 164 mentions.

### Gap 10 — Add-leg modal: leg-group association

**What's missing:** When PM clicks `+ Add leg` from the leg-group header (vs `+ Add leg` from the panel-level page head), is the new leg associated with that specific leg-group? Does the modal include a leg-group selector? Auto-create a new leg-group if no group exists yet?

**What I need:** UX spec for the leg-to-leg-group association at add time.

**Bias** (would propose if asked): clicking `+ Add leg` inside a leg-group header → modal pre-fills leg-group association (no picker). Clicking panel-level `+ Add leg` from a state with zero groups → modal creates a new leg-group automatically with auto-generated label (`Outbound · {origin} → {destination}` post-submit). Clicking panel-level `+ Add leg` from a state WITH existing groups → modal includes a leg-group picker (`new group` / `existing group N`).

### Gap 11 — `+ Add leg` action wiring

**What's missing:** The prototype's `+ Add leg` button in two places (page head + leg-group header) opens the same modal. The cost-stack integration on Cost Build is auto-derived from freight_legs/freight_leg_groups, but the panel itself doesn't seem to have a Save discipline — the prototype's "Save draft" is a non-functional button. Is each modal submit an immediate DB write? Or does the panel hold pending state until a Save action?

**What I need:** save-discipline spec — autosave per modal submit vs deferred Save like packaging's auto-on-blur.

**Bias** (would propose if asked): each modal Save commits to DB immediately + revalidateQuoteTree. Same pattern as packaging/freight inputs today; PMs expect immediate persistence in Setup. Drop the panel-level Save Draft button as cosmetic.

### Gap 12 — `crosses_international_border` writability when mode = customer_arranges

**What's missing:** Customer-arranges legs in the prototype have `crosses_international_border: false` hardcoded in fixtures. Does the field render at all in customer-arranges? Is it editable? The customs cluster never shows for customer-arranges (per visibility rule), but does the border boolean still get tracked for the leg?

**What I need:** form field availability matrix per mode for `crosses_international_border`.

**Bias** (would propose if asked): hide the checkbox in customer-arranges mode of the Add-leg modal; default `false`. Customer-arranges legs never accrue customs (PM has no obligation), so the boolean is functionally dead for the mode.

### Gap 13 — Markup pill override input on-blur behavior

**What's missing:** Prototype's `MarkupPill` component (lines 114-152) opens an input on click. On blur OR Enter, the input closes. What happens to invalid values? Negative numbers? Empty input? Value > 100% (i.e., > 1.00 in numeric form)?

**What I need:** invalid-input behavior + validation range for markup pcts (this overlaps with Gap 5 but is specifically about the inline pill UX).

**Bias** (would propose if asked): empty input → revert to current value (no change). Negative → reject with inline-error chip. Out-of-range (>9999%) → reject with inline-error chip. Range 0.0000-9.9999 matches numeric(5,4); valid spans the realistic markup space.

### Gap 14 — Audit log granularity for `customs.duty_pct` and `customs.tariff_pct` edits

**What's missing:** Customs sub-object is JSONB. When PM edits duty_pct or tariff_pct, what does the audit_log row look like? `action: 'freight_leg_customs_updated'` with `diff_json.customs.duty_pct: {from, to}`? Or full JSONB blob diff?

**What I need:** audit log convention for JSONB sub-field edits on `freight_legs.customs`. (Overlap with Gap 3 — same family of audit-shape gap, just for customs JSONB instead of markup-pct columns.)

**Bias** (would propose if asked): `action: 'freight_leg_customs_updated'`, `diff_json: { duty_pct: { from, to }, tariff_pct: { from, to } }` — flat from/to for the changed keys only; never log the full JSONB blob.

### Gap 15 — Pass-through PDF surface on customer-facing PDF

**What's missing:** Kickoff line 58 says "Pass-through legs still surface separately on customer-facing PDF (existing convention)." Existing convention for pass-through freight is the Quote PDF Additional charges block that ships separately from freight rollup. The new per-component markup means pass-through legs have THREE billable amounts (freight, duty, tariff) — does each surface separately on the PDF? Or just freight passthrough?

**What I need:** customer-facing PDF rendering spec for pass-through legs with customs.

**Bias** (would propose if asked): pass-through freight line shows freight_billable only; duty + tariff travel as a separate line if the leg is also customs-eligible. This matches how forwarders typically itemize on customer-facing invoices.

### Gap 16 — Cost stack visual treatment when D+T sums across two border-crossing legs

**What's missing:** Cost stack currently has a D+T row. With multi-leg P1, that row's value can be summed from 2+ legs (Shenzhen → Busan duty + Korea-→-US duty in the multi-leg fixture). The cost stack visual shows ONE D+T value; does it indicate the multi-leg composition via tooltip / sub-caption / a `· N legs` count?

**What I need:** cost stack D+T row visual treatment for multi-leg.

**Bias** (would propose if asked): cost stack D+T row gets a `· N customs legs` mono sub-caption when N > 1, similar to existing rollup conventions. No tooltip in v1; visible sub-caption is enough.

### Gap 17 — Migration disposition (A/B/C)

**What's missing:** Pattern 25 kickoff asks CC to pick A (full migration) / B (hybrid additive view) / C (net-new additive). Edward bias is A but he asks CC to rule.

**What I need:** CA + Edward confirmation that bias A holds, OR redirection to B/C. Existing `freightInputs` consumers need to be inventoried before A is safe — there's existing action-layer code (`freight.ts`, `costing.ts`) that reads `freight_inputs`.

**Bias** (would propose if asked): A — full migration, drop `freight_inputs`, build `freight_legs` / `freight_leg_groups` / `freight_leg_tiers` / `freight_customer_arranges_meta` clean. Pre-production tolerance per Pattern 32; the existing freight inputs in dev are smoke data not real production data. BUT this requires a comprehensive code sweep to find every `freightInputs` reference + replace with the new contract. Estimate: 1-2 days of refactor.

### Gap 18 — Secondary choice: `customer_arranges_meta` separate table vs JSONB

**What's missing:** Kickoff Secondary #1 asks CC to pick. After the rev 1 rename (cargo_ready_date promoted out), the table has just 2 fields: `customer_contact` text + `audit_note` text. CD bias: separate table if audit granularity matters.

**What I need:** dispositioned decision.

**Bias** (would propose if asked): separate table `freight_customer_arranges_meta` with `freight_leg_id` FK, `customer_contact` text, `audit_note` text. Two fields each PM-edited independently — separate table = independent audit-log diff tracking per field, JSONB = bundled diff. PM workflow benefit > migration cost.

### Gap 19 — Secondary choice: `goods_cost_base` source of truth (live vs materialized)

**What's missing:** Kickoff Secondary #3 asks CC. CD bias: live computation. Means each freight cost rollup recomputes `goods_cost_base` from `packaging_inputs` + `production_inputs` + `bulk_raw` × `effective_units` per leg.

**What I need:** dispositioned decision.

**Bias** (would propose if asked): live computation. No new storage; consistent with the rest of the costing rollup pattern (`getCostingBundle` derives, doesn't cache).

### Gap 20 — Secondary choice: cost stack source contracts

**What's missing:** Kickoff Secondary #4 asks CC. Already covered in R-11.1–11.3 above + Gap 16 for visual treatment. Open: should FRT row + D+T row be EXCLUSIVELY sourced from `freight_legs` post-migration, or do they continue to ALSO read the existing `freight_inputs` for back-compat during transition?

**What I need:** confirmation that disposition A → FRT/D+T read only from `freight_legs` post-migration; no back-compat read from `freight_inputs`.

**Bias** (would propose if asked): A path forward — single source of truth. The migration replaces; no dual-read.

### Gap 21 — Validation engine integration

**What's missing:** Existing validation engine (`validation.ts`) generates persistent warnings into the `warnings` table. Does R6.2 introduce new warning rules (e.g., "leg has no cargo_ready_date", "border-crossing leg with no duty_pct set", "passthrough leg with no total_freight")? Or is the validation engine out of scope for R6.2?

**What I need:** scope disposition — validation engine touched or not.

**Bias** (would propose if asked): out of scope for R6.2 P1. Validation rules surface as inline UI chips on the row (Gap 5 territory), not persistent `warnings` rows. v1.1 adds persistent warning rules if PM workflow shows gaps surface late.

### Gap 22 — `freight_leg_tiers` schema details

**What's missing:** Kickoff line 167 and R-5.1 cite `freight_leg_tiers` as a per-(leg, tier) table. The SQL deltas in data-source map (lines 153-185) do NOT include a `CREATE TABLE freight_leg_tiers` — only `freight_leg_groups`, `freight_legs` column changes, and `freight_customer_arranges_meta` rename. The per-tier rates table HAS to live somewhere; current `freight_inputs` is per (quote_sku, line_group, tier) — does R6.2 mean per (leg, tier) without quote_sku, and the rollup derives quote_sku from leg origin/destination context?

**What I need:** explicit `freight_leg_tiers` (or whatever name) DDL — columns, constraints, FK to legs + tiers, unique index.

**Bias** (would propose if asked): `freight_leg_tiers(id uuid pk, freight_leg_id uuid FK, tier_id uuid FK, total_freight numeric(12,2), units_in_shipment integer, created_at, updated_at)` with unique index on `(freight_leg_id, tier_id)`. quote_sku association moves OUT of the freight table — freight legs are per-quote-not-per-SKU at the data layer; rollup aggregates across quote SKUs by tier.qty for amortization.

### Gap 23 — Customer-arranges audit_note multi-line behavior

**What's missing:** `audit_note` is text in `freight_customer_arranges_meta`. Prototype line 263 renders a `<textarea>`. Max length? Newlines preserved through Mark-Accepted snapshot + customer-facing PDF? Markdown rendering or plain text?

**What I need:** field-level behavior spec for `audit_note`.

**Bias** (would propose if asked): TEXT type (unbounded); plain text only (no markdown); newlines preserved in PDF render (`white-space: pre-wrap`); soft UI max via 1000-char visible counter that doesn't block submit beyond.

### Gap 24 — Forwarder PDF placement: `attachments` table FK target

**What's missing:** Kickoff Pattern 25 verification #3 asks CC to confirm `attachments` table exists OR will be created in the same migration. **Verified absent in current schema** — no `attachments` table. Needs creation in this migration OR deferral to P2 when upload actually fires.

**What I need:** disposition — create `attachments` table now (P1, schema only — column ready for upload to populate in P2) OR defer entirely (column added in P2 alongside upload mechanism).

**Bias** (would propose if asked): defer. Schema column `forwarder_quote_pdf_id` references a table that doesn't exist is a stale FK pointer. Either create the table empty + column with FK, OR defer both. Bias toward defer — Pattern 32 pre-production tolerance + R-14.1 says PDF upload is P2.

---

## Summary

- **25 Ready surfaces** confirmed explicitly across the docs (+R-9.6 added from brief).
- **24 Gaps** flagged (Gap 0 resolved by brief addition; Gap 5 partially closed by per-incoterm date requiredness). Most are small dispositions (UX behavior, validation rules, audit shapes); 3 are larger architectural (Gap 8 mode enum, Gap 17 migration disposition, Gap 22 `freight_leg_tiers` DDL).
- **No Pattern 25 schema ruling has been made yet** — that's blocked on the gaps resolving + the four Secondary choices in the kickoff doc settling.

**Awaiting CA + Edward disposition on the Gap list before proceeding to Pattern 25 schema work.**
