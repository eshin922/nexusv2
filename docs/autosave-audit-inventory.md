# Autosave focus-stability sweep — Step 1 inventory

**Slice:** v1 release-critical path item 3.
**Brief:** `docs/autosave-focus-stability-brief.md`.
**Step:** 1 — inventory (this doc).
**Status:** Initial catalog. Pass 1 audit (Step 5) and Pass 2 audit (Step 6) fill per-field compliance findings.

This doc has two halves: the **dynamic add-affordance catalog** (Pass 2 territory) and the **static editable input inventory** (Pass 1 territory). The dynamic catalog has been confirmed against the codebase; the static inventory is a surface-by-surface enumeration.

---

## A. Child-leaf affordance disposition (Step 1 gating question)

**Question:** Is "add child leaf to assembly" a distinct server action (9th affordance), or a `parentSkuId` parameter on the existing add actions (still 8)?

**Answer: parameter, not distinct action. Catalog stays at 8.**

Evidence:

- `src/app/actions/quotes.ts:455` — `addSkuFromHubspotProduct` accepts `parentSkuId` from FormData (`const parentSkuIdRaw = trimOrNull(formData.get("parentSkuId"));`); writes it to the new `quote_skus` row at line 528.
- `src/app/actions/quotes.ts:750` — `addProductSku` (Phase 1 modal) accepts the same `parentSkuId` from FormData; writes at line 843.
- `src/app/actions/quotes.ts:569` comment: "now accept parent_sku_id + qty_per_parent so the modal can [serve child-creation]."
- `src/app/actions/quotes.ts:1387` comment on `addAssemblySku`: "Top-level only — no parent_sku_id supported. Assembly nesting [via reassignment, not add]."
- No `addChildLeaf` or `addChildSku` action exists (grep returned zero matches on `addChild|childLeaf|add_child|child_leaf`).

**UI affordance — two paths, same actions:**

- **Top-level "+ Add product" / "+ Add assembly"** — adds row at top of SKU table. No `parentSkuId`.
- **Inside-drawer "+ Add child SKU"** (`AddProductModal` with `forcedParentId` prop at `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:1707`) — adds row inside a row drawer's child list. `forcedParentId` populates the `parentSkuId` on FormData.

**Pass 2 implication:** test BOTH UI paths per action (top-level + in-drawer), not just one. Two paths exercise different snapshot-prop re-render surfaces — the drawer container animating/rendering may produce a different mutation-yank shape than the top-level table.

The catalog stays at 8 server actions; the Pass 2 **scenario matrix** is ~10 (8 actions × ~1-2 UI paths per action).

---

## B. Dynamic add-affordance catalog (Pass 2 territory)

Eight server actions. From Architect §0.5 pre-flight, confirmed by Step 1 re-check.

| # | Server action | File:line | Surface | UI path(s) | Audit `action` |
|---|---|---|---|---|---|
| 1 | `addTier` | `actions/quotes.ts:1956` | Pricing (also used in Mark Accepted, Cost summary side) | "+ Add tier" button (`AddTierButton`) | `"created"` (line 2099) |
| 2 | `addSkuFromHubspotProduct` | `actions/quotes.ts:444` | Setup | SKU search panel (`SkuSearchPanel`) AND in-drawer child-add | `"created"` (line 521) |
| 3 | `addProductSku` | `actions/quotes.ts:705` | Setup | Add product modal Phase 1 (`AddProductModal`) — top-level AND in-drawer with `forcedParentId` | `"created"` (line 827) |
| 4 | `addAssemblySku` | `actions/quotes.ts:1595` | Setup | "+ Add assembly" button (`AddAssemblyButton`); top-level only (no nesting) | `"created"` (line 1638) |
| 5 | `addPackagingLine` | `actions/packaging.ts:112` | Costs / Packaging drilldown | "+ Add line" affordance inside packaging drilldown | `"created"` (line 161) |
| 6 | `addLegGroup` | `actions/freight.ts:321` | Costs / Freight drilldown | Mode chooser → first leg group on a fresh quote | `"created"` (line 349) |
| 7 | `addLeg` | `actions/freight.ts:469` | Costs / Freight drilldown | "+ Add leg" affordance within an existing leg group (also centered modal opens on click) | `"created"` (line 590) |
| 8 | `assignSkuToParent` | `actions/quotes.ts:983` | Setup | Re-parenting an existing SKU (reassign panel); NOT a fresh-row add but creates the same focus-stability concern (child-list re-renders) | `"parent_assigned"` (line 1041) |

**Note on action 8 (`assignSkuToParent`):** strictly a re-parenting action (sets `parent_sku_id` on an existing row), not an "add." Surfaces here because the in-drawer child list re-renders when reassignment lands — same focus-stability concern shape. If Pass 2 needs to draw a strict line, exclude this from the add-affordance count (back to 8); but smoke it during Pass 2 because the symptom mechanism (snapshot-prop re-render of a list) is identical.

**Production:** NO user-driven add affordance. `upsertProductionInputs` (`actions/production.ts:142`) materializes rows automatically per (SKU, tier). Production input fields stay in **Pass 1 static field coverage**.

**Pass 2 scenario matrix (10 scenarios):**

1. Add tier (Pricing) → type qty in new column → focus persists, value commits
2. Add tier (Mark Accepted side, if reachable from there) → same
3. Add SKU via HubSpot search (Setup, top-level) → type units_per_pack → focus persists
4. Add SKU via HubSpot search (Setup, in-drawer child of assembly) → type unit fields → focus persists
5. Add SKU via product modal Phase 1 (Setup, top-level) → type unit fields → focus persists
6. Add SKU via product modal Phase 1 (Setup, in-drawer with `forcedParentId`) → type → focus persists
7. Add assembly (Setup) → type assembly-level fields → focus persists
8. Add packaging line (Costs) → type unit cost → focus persists
9. Add freight leg group (Costs, fresh quote / mode chooser path) → type leg fields → focus persists
10. Add freight leg (Costs, within existing group) → type leg fields → focus persists

Plus race-edge scenarios per brief §6.

---

## C. Static editable input inventory (Pass 1 territory)

Pre-Pass-1 catalog of every editable autosave field by surface. Per-field Pattern 47 compliance findings batch into `docs/autosave-audit-pass-1.md` during Step 5.

### C.1 Setup surface

**SKU rows** — `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx`

- `unitsPerPack` (number input)
- `retailBenchmark` (number input with mono caption — Pattern 29 read↔edit)
- `notes` (per-SKU text input)
- `qtyPerParent` (number input — `QtyPerParentInline`, conditional on `sku.parentSkuId !== null`)
- Category select (cost_category — currently Slice 9 deferral; field exists but UI may be in flight)

**Tier rows** — `src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx`

- `qty` (number input, line 165)
- `priceAdj` (number input, line 181)
- Tier label (text input — confirm during Pass 1)

**Quote-level notes** — `src/app/projects/[id]/quotes/[quoteId]/notes-editor.tsx`

- `internalNotes` (textarea)
- `customerFacingNotes` (textarea)

**Tier preset select** — `src/app/projects/[id]/quotes/[quoteId]/tier-preset-select.tsx`

- Preset select (changes the entire tier set; mutation pattern; verify Pattern 47 applies)

### C.2 Costs surface — Packaging drilldown

**Packaging line rows** — `src/app/projects/[id]/quotes/[quoteId]/packaging/packaging-line-row.tsx`

- `unitCost` (number input — Pattern 29 read↔edit candidate per brief Pattern 29 v1.1 polish)
- `markup_pct` (number input)
- `units_per_unit` (number input)
- Supplier (text input — temporary per UX_BACKLOG)
- Category select

### C.3 Costs surface — Production grid

**Production cells** — `src/app/projects/[id]/quotes/[quoteId]/production/production-section.tsx`

- Per-(SKU, tier) cost cells (number inputs)
- Service fee fields
- Notes per cell (verify)

**No add affordance** — rows materialize automatically per (SKU, tier) via `upsertProductionInputs`. Pass 1 covers; Pass 2 does not.

### C.4 Costs surface — Freight drilldown

**Freight legs** — `src/components/costs/freight-drilldown.tsx`

- Leg-tier rate cells (per-leg, per-tier rate inputs — number)
- Leg metadata: origin, destination (text inputs)
- Leg dates: `vesselEta`, `actualDeliveryDate` (date inputs — `LegDateInput` primitive with blur+Enter commit pattern per R6.2 commit 4.1)
- Leg customs: `cbm_per_unit`, `duty_pct`, `tariff_pct` (number inputs, conditional on `crosses_international_border AND incoterm='DDP'`)
- Leg `markup_pct` (number input)
- Customer-arranges meta fields (text/number inputs in non-PM-managed mode)

### C.5 Pricing surface

**Pricing inputs** — across multiple components in `src/app/projects/[id]/quotes/[quoteId]/pricing/` and `src/components/pricing/` and `src/components/`

- `targetMarginPct` (per-quote, popover from header) — `quote-target-margin-popover.tsx`
- `globalPriceAdjPct` (quote-level slider) — `global-price-adj-input.tsx`
- `tierPriceAdjPct` (per-tier override) — `tier-price-adj-input.tsx`
- `sellPriceOverride` (per-cell) — sku-summary-row or cell-level
- `clientTargetPricePerUnit` (per-cell) — `client-target-cell.tsx`
- Required-sell display cell (`required-sell-cell.tsx` — verify if editable or display-only)

### C.6 Quote surface

**No editable autosave fields.** Customer-facing render boundary; preview/PDF only. Excluded from Pattern 47 scope (per brief Section 1 Scope OUT).

Possible chrome fields: `customer-notes-drawer.tsx`, `preview-toolbar.tsx` — verify whether any are editable autosave or read-only display. If editable, include in Pass 1.

### C.7 Mark Accepted surface

**No editable autosave fields.** Acceptance gate + writeback; per `mark-accepted/page.tsx` no `<input>` / `<textarea>` / `<select>` elements found in grep. Excluded from Pattern 47 scope.

If Slice 12 / writeback brief later adds reason-for-acceptance or notes fields, include then.

### C.8 Admin surfaces (lower priority per brief Scope OUT — audit separately in v1.5+)

Tracked for completeness; not in v1 sweep scope.

- `src/app/admin/firm-settings/firm-settings-form.tsx` — target_margin, floor_margin, vendor identity, customer-facing defaults
- `src/app/admin/firm-settings/customer-facing-defaults-form.tsx` — vendor_name, prepared_by, address, phone, etc.
- `src/app/admin/markup-defaults/markup-defaults-table.tsx` — per-category markup_pct
- `src/app/admin/users/users-table.tsx` — role assignment, etc.
- `src/app/[id]/category-select.tsx` — category select primitive

---

## D. Reconciliation pipe + autosave infrastructure shape

Per Architect §0.5 confirmed against current code:

- Reconcile pipe: `src/components/costing-store-provider.tsx:21-67`
- Wait-for-quiet: `QUIET_PERIOD_MS = 800` (line 76)
- Realtime coalesce: 250ms prefix (line 80)
- Optimistic store factory: `src/lib/costing-store.ts:1-74` (`makeCostingStore`)
- Slice 8 Architectural Rule 1 (bans optimistic adds): `costing-store.ts:41-52`

Pattern 47 verification at Step 5/6 checks each field's compliance against these primitives.

---

## E. Step 1 sub-step status

- ✅ Child-leaf disposition resolved — parameter on existing add actions; catalog stays at 8.
- ✅ Add-affordance catalog confirmed against codebase (8 actions + assignSkuToParent as adjacent case).
- ✅ Static editable input surfaces enumerated by surface.
- ⏳ Pass 1 per-field compliance audit — Step 5.
- ⏳ Pass 2 per-scenario reproduction — Step 6 (gated on Step 2 diagnosis checkpoint with Edward + CA).

**Next:** Step 2 — diagnose tier-6 symptom on Pricing tier add. Instrument all three root cause categories (hook race / registration gap / snapshot-prop re-render) without pre-committing to a hypothesis. Diagnosis findings are the Edward + CA checkpoint before Step 3 (draft Pattern 47 unified definition).
