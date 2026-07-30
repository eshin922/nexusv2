# R6.2 Fidelity Gap Dispositions

**From:** CA + Edward
**To:** CC
**Re:** `docs/r6-2-fidelity-confirmation.md` (CC's gap report)
**Status:** Draft for Edward review → relay to CC

---

## Bottom line

- **24 gaps reviewed** (Gap 0 closed — brief now in repo). 19 can be dispositioned by accepting CC's stated bias. **5 want Edward's explicit attention** before locking. Reordered to match CC's triage logic: schema-blocking first (17, 8, 22, 24), then behavior (5).
- **No CD round-trip required.** None of CC's biases materially conflict with stated design intent.
- **Pattern 25 schema disposition is A (full migration)** — Edward already biased; CC's consumer inventory confirms the path is viable with 1-2 days of refactor for `freight.ts` + `costing.ts` reads.
- **CC's R-9.6 addition** (forwarder identity hidden from customer-facing PDF) confirmed — this was a commitment in the brief that's now explicitly tracked in the ready list.

---

## Edward-attention gaps (5) — schema-blocking first

### Gap 17 — Migration disposition (A / B / C) ⚡ schema-blocking

Edward biased A in the kickoff. CC's consumer inventory found existing reads in `freight.ts` + `costing.ts` — confirms A is viable but means CC does a 1-2 day refactor sweep replacing `freight_inputs` references with the new `freight_legs` / `freight_leg_groups` / `freight_leg_tiers` contract.

**Disposition: A (full migration).** Drop `freight_inputs`; build the new schema clean; sweep all consumer code.

**Estimated CC effort:** 1-2 days refactor + 2-3 days new R6.2 implementation = ~4-5 days total for R6.2 slice. The migration sweep is the pad on top of my earlier "3-4 day" estimate.

### Gap 8 — Mode enum rebuild ⚡ schema-blocking

Existing `freightMode` pgEnum has 7 coarse values; prototype has 9 finer values; **Edward confirmed DPS does ship via USPS / UPS Ground / FedEx Ground, so `parcel` stays as its own enum value.** Final new enum is 10 values:

```
parcel · ocean_fcl · ocean_lcl · air_freight · air_express · ltl_truck · truckload · drayage · exw_pickup · other
```

**Per-row migration mapping** for existing dev rows:

| Existing | New | Note |
|---|---|---|
| `parcel` | `parcel` | Identity. DPS uses USPS / UPS Ground / FedEx Ground. |
| `ltl` | `ltl_truck` | Direct match. |
| `ftl` | `truckload` | Direct match. |
| `ocean` | `ocean_fcl` | FCL is the safer default; PM reclassifies to LCL post-migration if needed. |
| `air` | `air_freight` | Safer than `air_express` (which is courier-class). |
| `courier` | `air_express` | Express courier services map cleanly. |
| `other` | `other` | Identity. |

Pre-production tolerance per Pattern 32 applies. CC writes a `UPDATE freight_inputs SET freight_mode = ...` per-row script as part of the migration.

**Small CD-side touchup needed:** prototype `data.js` modes array gains `Parcel` as a tenth display option. Not a redesign — one-line addition to the existing modes array. CC handles as part of implementation.

**Edward, confirm before CC proceeds.**

### Gap 22 — `freight_leg_tiers` DDL + quote_sku unbinding ⚡ schema-blocking

CC's DDL proposal:
```sql
create table freight_leg_tiers (
  id uuid primary key,
  freight_leg_id uuid not null references freight_legs(id),
  tier_id uuid not null references quote_tiers(id),
  total_freight numeric(12,2),
  units_in_shipment integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (freight_leg_id, tier_id)
);
```

**Disposition: Accept.** Two architectural commitments embedded:

1. **Quote_sku unbinding from freight at the data layer.** Existing `freight_inputs` was per-(quote_sku, tier); the new model is per-(leg, tier). Freight becomes per-quote-not-per-SKU; rollup aggregates by `tier.qty` for amortization. This is a real shift — Edward worth knowing.
2. **`units_in_shipment` carries forward as a per-(leg, tier) override.** Defaults to `tier.qty` when null per the `effective_units` convention. Standalone column rather than JSONB.

The data-source map's SQL deltas were silent on this table; the rev-1 doc skipped it. CC's DDL plugs the hole correctly.

### Gap 24 — `attachments` table

Required for the `forwarder_quote_pdf_id` FK on `freight_legs`. Table doesn't exist; PDF upload mechanism is P2.

CC bias: defer both (table + FK column) to P2 to avoid a stale FK pointer. P1 PDF slot is purely visual.

**Disposition: Accept defer.** P1 slot renders as an empty UI affordance with the "upload · P2" phase chip; no backing column yet. When P2 ships PDF upload, the migration creates `attachments` table + adds `forwarder_quote_pdf_id` column to `freight_legs` together. Clean.

### Gap 5 — Validation rules (behavior-blocking, not schema-blocking)

Brief closed two sub-rules:
- `cargo_ready_date`: Required on DDP/DAP · Recommended on FOB/EXW ✓
- `vessel_etd`: Required on DDP/DAP · Optional on FOB/EXW ✓

Remaining sub-rules need Edward disposition:

| Rule | Disposition | Note |
|---|---|---|
| `vessel_etd >= cargo_ready_date` per leg | **Warn, not reject** | Forwarders give ETDs before cargo-ready is locked; reject would block legitimate PM workflow. |
| Cross-leg sequential: `legN.cargo_ready >= leg(N-1).vessel_etd` (by display_order) | **Warn, not reject** | Forwarder ETDs are estimates; cross-leg drift is normal at quote time. |
| Per-tier `total_freight` when treatment = bundled | **Nullable until saved; > 0 required at Mark-Accepted** | PMs enter incrementally; final validation gates the accepted-quote artifact. |
| Per-tier `total_freight` when treatment = passthrough | **Same as bundled** | Same flow. |
| Markup pct ranges (`freight` / `duty` / `tariff`) | **0.0000 – 9.9999** | Matches numeric(5,4) precision; covers Cally's tariff-anomaly zero-markup case and any forwarder weirdness. |
| `origin` / `destination` required | **Required when mode = dps_arranges; optional otherwise** | Customer-arranges has its own origin field in meta. |
| `customs.duty_pct` / `customs.tariff_pct` range | **0.0000 – 9.9999** | Matches numeric(5,4); Cally's 125% tariff hike sits inside the range. |
| Validation surface | **Server-side reject via `ActionGuardError` + UI inline error chip** | Standard pattern. |

---

## Accept-CC-bias gaps (19)

All accept CC's stated bias from the fidelity report. CC can implement against these dispositions directly.

| Gap | Topic | Disposition |
|---|---|---|
| 1 | Empty state of DPS-arranges leg-group | Accept: single visible leg-group header + centered `+ Add first leg` ghost button. |
| 2 | Default for blank duty/tariff pct | Accept: `null` (no key in customs JSONB until entry); UI shows empty `<input placeholder="0.0%">`; rollup treats null as 0. "Needs entry" chip handling deferred to Gap 5 inline-error chip pattern. |
| 3 | Audit log entry for markup pill override | Accept: shared action `freight_leg_markup_updated` with `diff_json.component` discriminator (`'freight'` / `'duty'` / `'tariff'`); from/to pcts in diff_json. |
| 4 | `↔ BORDER` chip color token | Accept: introduce `--border-chip` + `--border-chip-soft` tokens; prototype's literal oklch becomes light-mode values. |
| 6 | Single-leg-with-only-one-date transit caption | Accept: hide caption entirely unless ALL legs have both dates filled. |
| 7 | Per-leg `⋯` action menu contents | Accept: `Delete leg` · `Move up` · `Move down`. No Duplicate in v1. |
| 9 | Order of legs / leg-groups | Accept: `display_order int` on both `freight_leg_groups` + `freight_legs`; entry sequence in v1; drag-grip ships v1.1. |
| 10 | Add-leg modal leg-group association | Accept: leg-group-header `+ Add leg` pre-fills association; panel-level `+ Add leg` auto-creates group if none, picks if multiple exist. Picker case is vestigial in v1 (multi-route is P2). |
| 11 | Save-discipline (autosave vs deferred) | Accept: modal Save commits immediately + revalidateQuoteTree. **Drop the panel-level "Save draft" button as cosmetic.** |
| 12 | `crosses_international_border` in customer-arranges | Accept: hide checkbox in customer-arranges mode of Add-leg modal; default `false`. |
| 13 | Markup pill override on-blur behavior | Accept: empty → revert to current; negative → reject inline; > 9.9999 → reject inline. Range matches Gap 5 disposition. |
| 14 | Audit log granularity for customs JSONB edits | Accept: `freight_leg_customs_updated` action; from/to for changed keys only; never log full JSONB blob. |
| 15 | Pass-through PDF surface on customer-facing PDF | Accept: pass-through freight line shows `freight_billable`; duty + tariff travel as a separate line when leg is also customs-eligible. |
| 16 | Cost stack visual for multi-leg D+T sum | Accept: D+T row gets `· N customs legs` mono sub-caption when N > 1. No tooltip in v1. |
| 18 | `customer_arranges_meta` separate table vs JSONB | Accept: separate table `freight_customer_arranges_meta(freight_leg_id PK, customer_contact text, audit_note text)`. Independent audit-log diff per field. |
| 19 | `goods_cost_base` source of truth | Accept: live computation; consistent with `getCostingBundle` derive-not-cache pattern. |
| 20 | Cost stack source: legs only vs back-compat read | Accept: cost stack reads exclusively from `freight_legs` post-migration. Single source of truth. |
| 21 | Validation engine integration | Accept: out of scope for R6.2 P1. Validation surfaces as inline UI chips (per Gap 5), not persistent `warnings` rows. v1.1 revisits if PM workflow shows gaps surfacing late. |
| 23 | `audit_note` multi-line behavior | Accept: TEXT type; plain text (no markdown); newlines preserved via `white-space: pre-wrap` in PDF render; soft UI max via 1000-char visible counter (doesn't block submit). |

---

## Pattern 25 schema ruling — confirmed

CC's four secondary choices from the kickoff:

| # | Question | Disposition |
|---|---|---|
| 1 | `freight_customer_arranges_meta` separate table or JSONB | **Separate table** (Gap 18) |
| 2 | `crosses_international_border` scope | **PM-set boolean in v1**; derive from country codes in v2 when origin/destination get structured |
| 3 | `goods_cost_base` source | **Live computation** (Gap 19) |
| 4 | Cost stack source contracts | **`freight_legs` exclusively** post-migration (Gap 20) |

Plus the primary disposition: **A (full migration)**, with `freight_inputs` consumer sweep across `freight.ts` and `costing.ts`.

---

## Next step

Edward review the 4 attention gaps (5, 8, 17, 24). Modify or approve. Once locked:

CC proceeds to:
1. **Pattern 25 schema ruling** finalized — emit migration SQL with all deltas baked in (the rev-1 data-source-map SQL + Gap 8 enum rebuild + Gap 22 `freight_leg_tiers` DDL + Gap 18 separate meta table + Gap 24 deferral note)
2. **Existing `freight_inputs` consumer sweep** — inventory + plan replacement reads
3. **Implementation** — full R6.2 against the dispositioned spec

Estimated CC effort post-disposition: ~4-5 days total (1-2 days refactor sweep + 2-3 days new R6.2 implementation).

---

## What's deliberately NOT changed by these dispositions

- The settled corrections (panel embeds in Setup; Add-Leg modal is centered popup) remain settled.
- The math contract per Edward sign-off remains intact.
- The 5 Edward-locked decisions (markup pills inline, vessel_etd show-optional, cargo_ready alignment, PDF slot at P1, transit caption in leg-group header) remain intact.
- Customs visibility rule (`crosses_international_border AND incoterm = 'DDP'`) remains intact.
- No P2/P3 deferrals get pulled forward.

---

## Notable architectural commitments out of these dispositions

1. **Enum rebuild** (Gap 8) replaces existing `freightMode` with prototype-aligned values. Migration script touches existing dev rows.
2. **`freight_inputs` full retirement** (Gap 17 = A) means CC sweeps every consumer; nothing reads the placeholder after migration.
3. **`freight_leg_tiers` net-new table** (Gap 22) handles per-(leg, tier) cost data. Quote_sku unbound from freight at the data layer.
4. **`attachments` table deferred to P2** (Gap 24) keeps schema clean; P1 PDF slot is visual-only.
5. **Validation as inline UI chips** (Gap 21) keeps R6.2 scope contained; persistent warnings row revisit in v1.1.

These are the 5 commitments that, post-disposition, become the canonical R6.2 schema + behavior shape. Worth a mental check before sign-off.
