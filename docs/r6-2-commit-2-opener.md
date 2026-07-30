# R6.2 Freight Slice — Commit 2 Kickoff

**Branch:** `slice-r6-2-freight`
**Prior commits on branch:**
- `2474043` — additive schema (migration 0026 + schema.ts updates)
- `f269195` — incident artifacts (UX_BACKLOG entries, recovery doc, smoke script)
- `5a5adc9` — orphan cleanup (audit script + recovery point)

**Status:** Commit 1 is live on shared DB. R6.2 schema (4 tables + 3 enums) is operational. Journal is clean (26 hash-matched rows, 0 orphans). `npm run db:migrate` runs no-op. Ready for commit 2.

---

## Anchor docs (read first, in this order)

1. **`docs/r6-2-gap-dispositions.md`** — every gap resolution. Edward-signed-off attention gaps (5, 8, 17, 22, 24) + 19 accept-CC-bias gaps. **Most load-bearing doc for commit 2.**
2. **`docs/r6-2-freight-revision-brief.md`** — revised scope + math contract + the 5 CD decisions Edward locked.
3. **`docs/design-prototypes/dist/docs/r6-2-designer-notes.md`** — CD's rev-1 designer intent + pushbacks.
4. **`docs/design-prototypes/dist/docs/r6-2-data-source-map.md`** — schema deltas + cross-surface contracts.

Prior chat history (commit 1, journal incident, recovery) is captured in the `f269195` artifacts. Don't need to re-read unless something surfaces.

---

## Commit 2 scope — the destructive sweep

~165 references across the codebase. Write as **one coherent commit** — the cost stack changes are tightly coupled and partial states are worse than a complete sweep.

Files in scope (from CC's earlier inventory):

- `freight.ts` (~810 lines) — full action layer rewrite against new `freight_legs` / `freight_leg_groups` / `freight_leg_tiers` / `freight_customer_arranges_meta` schema
- `costing.ts` — freight math at 3 sites; replace per-(quote_sku, tier) rollup with per-(leg, tier) → per-tier aggregation with per-component markup
- `quotes.ts` — delete-cascade + copy paths for the new leg/leg-group hierarchy
- `warnings.ts` — wire validation rules per Gap 5 disposition (warn-not-reject on date pairs; range checks; required-fields)
- `validation.ts` — validation rule definitions
- `quote-guards.ts` — server-side `ActionGuardError` paths for invalid writes
- Page reads — every consumer pointing at legacy `freight_inputs`
- Store provider — Realtime subscription wiring for the new tables
- `freight-drilldown` UI — full panel rebuild against the rev-1 design (embedded in Setup page, NOT standalone full-page)
- `customs-row` UI — customs cluster rendering with per-component markup pills
- 2 verify scripts — extend or rewrite as needed

---

## Critical non-negotiables for commit 2

### ⚠ Migration is already applied — do NOT re-apply

Commit 1 migration `0026` is live on shared DB; journal row 29 records it. Commit 2 should be **code-only** — no schema changes, no new migration files, no `db:migrate` runs. If commit 2 work surfaces a need for additional schema, that's a separate commit with its own migration file (0027) handled via normal `db:migrate` flow.

### Implementation corrections from CD prototype

CD's rev-1 prototype uses two rendering choices for design legibility that production diverges from:

1. **Panel embeds INSIDE the Setup page** — not standalone full-page. Strip CD's page chrome (eyebrow `LUMEN & CO · PRIMARY · V4 DRAFT`, page title H1, top-right action cluster). Integrate as the Freight section within Setup → Cost Build sub-sections (R7a IA arc). Match Packaging / Production / Bulk Raw sibling section header treatment.

2. **Add-Leg modal is centered popup, not slide-in.** CD's prototype renders the Add-Leg form as a slide-in from the right edge; production renders as a centered modal with backdrop. Same field set, same validation, same Save-on-commit behavior — different chrome. Use Setup's existing modal primitive.

### Math contract (per Edward sign-off)

```
goods_cost_base    = Σ(per-SKU production cost × units shipped) for that leg
freight_cost       = freight_legs.tier.total_freight (PM-entered)
duty_cost          = duty_pct × goods_cost_base
tariff_cost        = tariff_pct × goods_cost_base

freight_billable   = freight_cost  × (1 + freight_markup_pct)
duty_billable      = duty_cost     × (1 + duty_markup_pct)
tariff_billable    = tariff_cost   × (1 + tariff_markup_pct)

journey_freight_tier = Σ(freight_billable across bundled legs in group)
journey_duty_tier    = Σ(duty_billable across customs-eligible legs in group)
journey_tariff_tier  = Σ(tariff_billable across customs-eligible legs in group)
```

**Markup is on the AMOUNT, not the rate.** Per-component (not global) — Cally's tariff-anomaly case requires that `tariff_markup_pct` can be zeroed without losing markup on duty or freight.

**Customs visibility rule, per leg:** `crosses_international_border = true AND incoterm = 'DDP'`. Each leg in a journey evaluates independently. Shenzhen → Busan → Long Beach renders customs on **both** legs (Korea entry + US entry). Shenzhen → Shanghai → Long Beach renders customs only on the Shanghai → LA leg (domestic China leg has no border).

`goods_cost_base` is **live computation** per Gap 19 disposition — consistent with `getCostingBundle` derive-not-cache pattern. No materialization.

### Edward-locked CD decisions (don't relitigate)

| # | Decision |
|---|---|
| 1 | Per-component markup as inline pills (`× 1.30` next to each pct field; click opens override input) |
| 2 | `vessel_etd` shown always, marked optional on FOB/EXW (NOT hidden on incoterm change) |
| 3 | `cargo_ready_date` aligned across modes — promoted out of `customer_arranges_meta` to leg head |
| 4 | Per-leg PDF slot rendered at P1; upload mechanism deferred to P2 (visible empty slot with phase chip) |
| 5 | Derived transit caption surfaces in leg-group header (`· 4.5w total transit`) |

### Architectural commitments out of dispositions

| Gap | Commitment |
|---|---|
| 8 | `freight_leg_mode` enum has 10 values incl. `parcel` — already in schema.ts post-commit-1 |
| 11 | **Drop the panel-level "Save draft" button as cosmetic.** Modal Save commits immediately + `revalidateQuoteTree` |
| 17 | Full migration A — `freight_inputs` retires post-sweep. Sweep every consumer; nothing reads the legacy placeholder after this commit |
| 18 | `freight_customer_arranges_meta` as separate table (not JSONB) — schema already reflects this |
| 22 | Freight is **per-quote, not per-SKU** at data layer. `quote_sku` unbinds from freight. Rollup amortizes across SKUs by `tier.qty` |
| 24 | `attachments` table + `forwarder_quote_pdf_id` FK column deferred to P2 — P1 PDF slot is purely visual |

---

## Gap 5 validation rules (Edward-signed-off)

Wire these into `warnings.ts` / `validation.ts` / `quote-guards.ts`:

| Rule | Disposition |
|---|---|
| `vessel_etd >= cargo_ready_date` per leg | Warn, not reject |
| Cross-leg sequential: `legN.cargo_ready >= leg(N-1).vessel_etd` (by display_order) | Warn, not reject |
| `cargo_ready_date` required on DDP/DAP; recommended on FOB/EXW | Per brief |
| `vessel_etd` required on DDP/DAP; optional on FOB/EXW | Per brief |
| Per-tier `total_freight` (bundled or passthrough) | Nullable until saved; > 0 required at Mark-Accepted |
| Markup pcts (freight / duty / tariff) range | 0.0000 – 9.9999 (numeric(5,4)) |
| `origin` / `destination` required when mode = dps_arranges; optional otherwise | Per disposition |
| `customs.duty_pct` / `customs.tariff_pct` range | 0.0000 – 9.9999 |
| Surface | Server-side `ActionGuardError` + inline UI error chip |

---

## Accept-bias gaps in scope for commit 2

Reference dispositions doc for full text. Highlights for sweep planning:

- **Empty state** — DPS-arranges leg-group with no legs shows single header + centered `+ Add first leg` ghost button (Gap 1)
- **Blank duty/tariff pct** — `null` in JSONB; UI `<input placeholder="0.0%">`; rollup treats null as 0 (Gap 2)
- **Audit logs** — `freight_leg_markup_updated` action with `diff_json.component` discriminator; `freight_leg_customs_updated` action with from/to per changed key only (Gaps 3, 14)
- **`↔ BORDER` chip tokens** — `--border-chip` + `--border-chip-soft` (Gap 4)
- **Transit caption** — hide entirely unless ALL legs in group have both dates filled (Gap 6)
- **Leg `⋯` menu** — `Delete leg` · `Move up` · `Move down` only (no Duplicate in v1) (Gap 7)
- **Display order** — `display_order int` on both `freight_leg_groups` + `freight_legs`; entry-sequence in v1 (Gap 9)
- **Add-leg modal association** — leg-group-header `+ Add leg` pre-fills; panel-level auto-creates group if none, picks if multiple exist (Gap 10)
- **`crosses_international_border` in customer-arranges** — hide checkbox; default `false` (Gap 12)
- **Markup pill on-blur** — empty → revert; negative → reject inline; > 9.9999 → reject inline (Gap 13)
- **Pass-through PDF surface** — pass-through freight line shows `freight_billable`; duty + tariff travel as separate line when leg is also customs-eligible (Gap 15)
- **Cost stack visual for multi-leg D+T** — D+T row gets `· N customs legs` mono sub-caption when N > 1; no tooltip in v1 (Gap 16)
- **Cost stack source** — reads exclusively from `freight_legs` post-sweep (Gap 20)
- **Validation engine integration** — out of scope for R6.2 P1; surface as inline UI chips per Gap 5, not persistent `warnings` rows (Gap 21)
- **`audit_note`** — TEXT; plain text; newlines preserved via `white-space: pre-wrap` in PDF render; 1000-char visible counter (Gap 23)

---

## What's out of scope for commit 2

- **PDF upload mechanism** — slot renders empty with `upload · P2` phase chip; no backing column
- **CBM/unit auto-calc** — banked P3 with freight calculator
- **Insurance toggle** — banked P3 if insurance model unbundles
- **Freight calculator + port templates** — banked P3
- **Rate breakdown sub-table** — banked P3
- **SKU allocation across multi-SKU shipments** — banked P3
- **Multi-route / R8 routing** — separate round; multi-leg-within-journey is sufficient per Edward
- **Country-code derivation of `crosses_international_border`** — out of v1; PM-set boolean is truth-source until origin/destination get country-code structure (v2)
- **0021 quote_number_backfill hash mismatch** — benign per timestamp algorithm; banked, don't touch
- **`drizzle-kit push` retirement** — separate UX_BACKLOG item; not in this slice
- **Audit trail value granularity** (Edward's separately-relayed UX_BACKLOG item) — separate scope

---

## Smoke + verification expectations

Before commit lands:

1. **Type-check clean** across all touched files
2. **`npm run db:migrate`** runs no-op (commit 2 is code-only)
3. **R6.2 panel renders correctly** in Setup → Cost Build sub-section
4. **Math contract verifies** against the multi-leg fixture (Shenzhen → Busan → Long Beach): freight_billable, duty_billable, tariff_billable sum correctly across legs into journey-level rollup
5. **Customer-arranges mode** renders with zero-cost + persistent metadata; FRT row hidden in cost stack
6. **Cost stack** reads exclusively from `freight_legs`; no `freight_inputs` consumer remains
7. **`freight_inputs` table** can be dropped (verify no consumer references; actual DROP comes in a separate cleanup migration after commit 2 lands and verifies)

---

## Deliverable + cadence

- **Single coherent commit** on `slice-r6-2-freight`
- **Smoke results** posted before merge (math verify, type-check, panel render, cost stack source confirmation)
- **Standing by for review** before merge to main

Estimated effort: 2-3 days for the sweep + smoke. If anything surfaces that conflicts with stated design intent (a third prototype/doc conflict, or any disposition that doesn't compose cleanly), surface in the chat — do not gap-fill.

---

Anchor docs are in `docs/`. Migration 0026 is live. Branch is clean. Go.
