# Autosave focus-stability sweep — Step 6 Pass 2 audit

**Slice:** v1 release-critical path item 3.
**Brief:** `docs/autosave-focus-stability-brief.md`.
**Step:** 6 — Pass 2 dynamic affordance audit (this doc).
**Status:** Analytical Pass 2 complete (post-Step-7 fix). Browser-smoke verification deferred to Step 9 (Edward smoke pass).

---

## Audit shape

Per brief §4.2: "Pass 2 — Dynamic affordance coverage. CC catalogs every 'add' affordance in the app. For each, runs the canonical scenario 'click add → immediately type → verify focus persists and value commits.'"

Post-Step-2 diagnosis (`disabled={... || pending}` is the root cause) and post-Step-7 fix (16 instances cleaned), Pass 2 verifies that:

1. **The fix transfers cleanly to dynamic-add scenarios.** A newly-added row's input is the same `TierPriceAdjInput` / `PackagingLineRow` / etc. component — the Step 7 fix applies to both static and dynamic instances.
2. **No add-affordance path involves an input that wasn't audited in Pass 1.** I.e., Pass 1 + Step 7 cover the universe.

Pass 2 is **analytical** at this stage (trace each scenario to the input components it exercises) plus **browser smoke** at Step 9 (Edward manually walks each scenario).

---

## A. 10-scenario matrix

For each scenario from Step 1 inventory: trace the add-affordance to the input the user types into, confirm it was fixed in Step 7.

### Scenario 1 — Add tier (Pricing) → type qty in new column

**Add affordance:** `AddTierButton` (`add-tier-button.tsx`) → `addTier` server action (`actions/quotes.ts:1956`).
**Post-add UI:** new `<TierRow>` (Setup) AND new tier column appears on Pricing's per-cell inputs (`TierPriceAdjInput`, `RequiredSellCell`, `ClientTargetCell`).
**Inputs the PM types into:**
- TierRow qty input (Setup) — `tier-row.tsx:165` — **already compliant pre-Step-7** (`disabled={disabled}` only; no pending).
- TierPriceAdjInput (Pricing) — `tier-price-adj-input.tsx:133` — **FIXED in Step 7**.
- RequiredSellCell — `required-sell-cell.tsx:209` — **FIXED in Step 7**.
- ClientTargetCell — `client-target-cell.tsx:263` — **FIXED in Step 7**.
- Pricing sku-summary-row cell — `pricing/sku-summary-row.tsx:552` — **FIXED in Step 7**.

**Verdict:** ✅ All inputs Pattern 47 compliant. Aisha-demo symptom resolved.

### Scenario 2 — Add tier (Mark Accepted path, if reachable)

**Add affordance:** Same `AddTierButton`/`addTier` action. Mark Accepted may show tier rail; depending on routing, the affordance may not be reachable from Mark Accepted itself (acceptance gate is acceptance-only).
**Verdict:** ✅ Same components as Scenario 1; same fixes apply. No surface-specific concern.

### Scenario 3 — Add SKU via HubSpot search (Setup, top-level)

**Add affordance:** `SkuSearchPanel` → `addSkuFromHubspotProduct` (`actions/quotes.ts:444`).
**Post-add UI:** new `<SkuRow>` (Setup), new row in `<SkuSummaryRowList>` (Pricing).
**Inputs the PM types into (immediate post-add typing scenario):**
- SkuRow unitsPerPack / retailBenchmark / notes — confirm these aren't affected (read sku-row.tsx for compliance).
- QtyPerParentInline (only if parentSkuId is set — N/A for top-level add).

Let me verify SKU row inputs are compliant.

### Scenario 4 — Add SKU via HubSpot search (Setup, in-drawer child of assembly)

**Add affordance:** Same `addSkuFromHubspotProduct` action with `parentSkuId` set.
**Post-add UI:** new child SKU row inside the drawer's child list.
**Inputs the PM types into:**
- QtyPerParentInline (`sku-row.tsx:1496`) — **FIXED in Step 7** (line 1501).
- Other SkuRow inputs.

### Scenario 5 — Add product via modal (Setup, top-level)

**Add affordance:** `AddProductModal` → `addProductSku` (`actions/quotes.ts:705`).
**Post-add UI:** new `<SkuRow>` (Setup). Modal closes; row materializes.
**Inputs the PM types into:** same SkuRow input set as Scenario 3.

### Scenario 6 — Add product via modal (Setup, in-drawer with forcedParentId)

**Add affordance:** `AddProductModal` with `forcedParentId` prop → `addProductSku` with `parentSkuId` set.
**Post-add UI:** new child SKU row inside the parent's drawer child list.
**Inputs the PM types into:** QtyPerParentInline (FIXED) + SkuRow inputs.

### Scenario 7 — Add assembly (Setup)

**Add affordance:** `AddAssemblyButton` → `addAssemblySku` (`actions/quotes.ts:1595`).
**Post-add UI:** new top-level assembly `<SkuRow>` (Setup).
**Inputs the PM types into:** same SkuRow input set.

### Scenario 8 — Add packaging line (Costs)

**Add affordance:** Add-line affordance in `PackagingDrilldown` → `addPackagingLine` (`actions/packaging.ts:112`).
**Post-add UI:** new `<PackagingLineRow>` (or equivalent) in the drilldown.
**Inputs the PM types into:**
- Category select — `packaging-drilldown.tsx:426` — **FIXED in Step 7**.
- Supplier text — `:464` — **FIXED**.
- Markup_pct number — `:490` — **FIXED**.
- Unit_cost number — `:627` — **FIXED**.

**Verdict:** ✅ All inputs Pattern 47 compliant.

### Scenario 9 — Add freight leg group (Costs, fresh quote / mode chooser)

**Add affordance:** Mode chooser → `addLegGroup` (`actions/freight.ts:321`).
**Post-add UI:** first leg group renders with the centered Add Leg modal triggered.
**Inputs the PM types into (in Add Leg modal):**
- Modal inputs are part of the Add Leg flow (per-leg fields).
- Leg mode select — `freight-drilldown.tsx:523` — **FIXED in Step 7**.
- Leg incoterm select — `:563` — **FIXED in Step 7**.
- Leg date inputs (`LegDateInput`) — already compliant pre-Step-7 (R6.2 commit 4.1).
- Per-tier rate inputs in the modal — need verification (not in the Pass 1 audit list because they're inside the modal, not the leg body; check whether they have `disabled={... || pending}`).

### Scenario 10 — Add freight leg (Costs, within existing group)

**Add affordance:** "+ Add leg" button → centered modal opens → `addLeg` (`actions/freight.ts:469`).
**Post-add UI:** new leg renders inside existing leg group.
**Inputs the PM types into:** same as Scenario 9 — Add Leg modal inputs.

---

## B. Spot-check results

### B.1 — SkuRow inputs (Scenarios 3-7) — ✅ PASS

Confirmed inputs in SkuRow + child cells:
- `UnitsPerPackCell` (`sku-row.tsx:1980-1986`) — `disabled={disabled}` only. ✅
- `RetailBenchCell` (`sku-row.tsx:1854-1859`) — `disabled={disabled}` only. ✅
- `QtyPerParentInline` (`sku-row.tsx:1496-1501`) — fixed in Step 7. ✅
- Reassign panel qty input (`sku-row.tsx:1409`) — no `disabled` attr (modal-style; clean). ✅
- Delete-confirmation text input (`sku-row.tsx:1331`) — no `disabled` attr (modal-style; not autosave). ✅

Buttons with `disabled={disabled || pending || !canToggle}` (`sku-row.tsx:579`) and similar are legitimate per Pattern 47 rule (e) carve-out.

### B.2 — Add Leg modal per-tier rate inputs (Scenarios 9-10) — ✅ PASS

`freight-drilldown.tsx:1947-1959` — per-tier rate inputs in Add Leg modal have NO `disabled` attribute (modal-pattern: pending state lives on the form-submit button; inputs stay enabled throughout the modal lifecycle until close). Clean by virtue of not having the anti-pattern at all.

---

## C. Pass 2 verdict

**✅ VERIFICATION PASS — all 10 scenarios trace to Pattern 47 rule (e) compliant inputs post-Step-7.**

Coverage:
- **Pricing per-tier inputs** — fixed in Step 7 (Scenarios 1, 2)
- **Setup SKU row + sub-cell inputs** — pre-Step-7 compliant + Step 7 fixed QtyPerParentInline (Scenarios 3-7)
- **Costs / Packaging drilldown inputs** — fixed in Step 7 (Scenario 8)
- **Costs / Freight Add Leg modal inputs** — no anti-pattern (Scenarios 9-10)
- **TierRow Setup inputs** — pre-Step-7 compliant
- **LegDateInput** — pre-Step-7 compliant (R6.2 commit 4.1)

The structural fix from Step 7 + the existing compliant inputs cover every Pattern 47 rule (e) surface relevant to the 10 dynamic scenarios. **No additional fixes needed.**

---

## D. Step 9 Edward smoke pass — scope

The analytical Pass 2 establishes structural compliance. Edward smoke pass at Step 9 manually walks each of the 10 scenarios in a browser to confirm:

1. The Aisha-demo symptom (add tier 6 → type qty → focus persists) reproduces as **fixed**.
2. No regressions: existing per-tier adj typing on Pricing, packaging unit_cost typing on Costs, etc., all remain stable.
3. Each add-affordance scenario exercises real keyboard input + commit without focus drop.

If smoke surfaces a residual focus issue not captured by the structural audit, Step 10 disposition: fix-now (if Pattern 47 rule (e) variant) OR bank for v1.5+ (if a different mechanism).
