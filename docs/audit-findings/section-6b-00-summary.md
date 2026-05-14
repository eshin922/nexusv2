# §6.b Step 11 Designer Audit — Summary

**Audit date:** 2026-05-13
**Branch:** slice-ri.8 (Step 11 pre-PR audit)
**Scope:** all 12 dimensions per brief §9.1 + Phase 1 HubSpot-first modal + Costs path-B sanity sweep

## Audited dimensions

1. All 4 R7b Setup states (default · assembly drawer open · leaf drawer open · empty tiers preset picker)
2. SKU table — column widths, Type badge, label/product/pack stacking, HAS NOTE chip, components count, drag grip
3. Per-row drawer — one-at-a-time, child-SKU navigation list, per-SKU notes textarea, HAS NOTE chip click
4. Tier table — card chrome parity, inline-edit affordances, ★ Recommended toggle, preset picker
5. Tier preset picker empty state — 2×2 grid, h6 "Start with a preset", canonical chrome
6. Notes split — purple internal + green customer audience-distinct zones, audience footers, Preview link
7. Drag-and-drop — grip glyph, grab cursor, smooth reorder, dragged-row dims, sort_order writes
8. Pattern 21 compliance — R7B STATES tab strip NOT shipped as production UI
9. Pull from Inventory absence — verified NOT present in footer (only "+ Add product" + "↗ Pull from HubSpot")
10. units_per_pack inline chip — Pattern 29 read↔edit cell in .pack sub-text
11. Add-product modal Phase 1 — HubSpot-first 13 fields rewrite, OQ2 + OQ3 dispositions, SKU blur dup-check, label/value mapping, margin %, FSC trio
12. Costs path-B migration — canonical r6-stack / r6-tier-col / r6-section-row / .drawer-toolbar; tier-label legacy " — Xk" suffix stripped

## Finding counts

- **HIGH:** 2
- **MEDIUM:** 8
- **LOW:** 12

**Recommendation:** **APPROVE-with-required-fixes**. The shipped implementation honors brief contracts and canonical R7b structure in nearly every dimension. The 2 HIGH findings are recoverable with sub-day fixes and don't block PR-to-main — they need to land but can land as commits in this branch before merge. The MEDIUM + LOW findings are polish + maintenance; not all need fixing pre-PR but should be banked.

Pattern 21 compliance: ✅ verified (R7B STATES tab strip not rendered; CSS dead-rules present per Pattern 30 verbatim).
Pull from Inventory: ✅ verified (footer has only "+ Add product" + "↗ Pull from HubSpot").
Phase 1 modal: ✅ all 13 fields render, OQ2 / OQ3 dispositions correctly applied, SKU blur check works with two CTAs, margin reads as percentage, label/value divergence honored.
Costs path-B: ✅ canonical class register confirmed; legacy " — Xk" suffix stripped.

## Per-finding index

| # | Severity | Dimension | Title |
|---|---|---|---|
| 01 | MEDIUM | 1, 11 | Page-head `+ Add SKU` disabled + duplicative; "Save draft" disabled as autosave placeholder |
| 02 | HIGH | 2 | SKU `.name` cell has 3 children (canonical has 2); QtyPerParentInline uses non-token gray-* Tailwind |
| 03 | MEDIUM | 2, 10 | units_per_pack inline chip uses hand-rolled register, not canonical `.indicator` |
| 04 | MEDIUM | 2 | SKU overflow menu uses Tailwind utility classes inside canonical `.r7b-sku-row .actions` |
| 05 | MEDIUM | 2 | Reassign panel uses hardcoded `gray-*` Tailwind; dark-mode breaks |
| 06 | LOW | 4 | Tier price-adj cell doesn't display `%` suffix (canonical shows "%") |
| 07 | LOW | 4 | Tier qty cell renders raw integer; canonical shows formatted thousands |
| 08 | MEDIUM | 4 | "Mark recommended" affordance is hover-revealed; discoverability gap for fresh tier table |
| 09 | LOW | 3 | Leaf drawer helper copy says "Cost build" (old name); see Finding 10 for collision |
| 10 | MEDIUM | 1, 6, 8 | Surface naming canon "Cost build → Costs" half-applied; setup nextMove label still old name |
| 11 | LOW | 1 | Page-head sub-copy appends "· PM {name}" awkwardly; should move into eyebrow line |
| 12 | LOW | 1 | Tailwind-styled back-nav link above `.r7b-head`; not in canonical |
| 13 | HIGH | 11 | Add-product modal attach-existing path hardcodes `skuRole: leaf` regardless of HubSpot `hs_product_classification` |
| 14 | MEDIUM | 11 | Pull-existing flow clears `existingMatch.id`; submit re-resolves via second API call (race + edge fail) |
| 15 | LOW | 11 | FSC trio 3-column grid uses inline style; should be class-based with media-query fallback |
| 16 | LOW | 11 | Modal Description textarea uses inline styles; canonical `.r7b-modal-body` rule doesn't cover textarea |
| 17 | MEDIUM | 11 | Margin calculated display fully inline-styled; should be `.calc-display` primitive |
| 18 | MEDIUM | 11 | SKU dup-check warn band fully inline-styled; should extract `.warn-band` for cross-surface reuse |
| 19 | LOW | 9, 11 | Add-product modal renders in-flow (not via React Portal); v1 acceptable |
| 20 | LOW | 8 | `.r7b-state-strip` CSS rules dead in `r7b-setup.css`; Pattern 30 + Pattern 21 collision — document |
| 21 | LOW | 2, 9 | `<SkuRowList>` wrapper has `divide-y divide-rule` Tailwind; canonical row already provides border-bottom (doubled rule) |
| 22 | LOW | 2 | Empty SKU state paragraph is inline-styled; should promote to `.r7b-empty-state` class |

## Top 3 recommended fixes before PR

These are the load-bearing items to land on this branch before PR-to-main:

### 1. Finding 02 — QtyPerParentInline tokenization (HIGH)
File: `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:778-840`
Rewrite the `<QtyPerParentInline>` widget to use canonical tokens instead of `gray-*` Tailwind classes. Dark-mode regression risk is the lever; this gets the row-internal "× N per parent" widget into the token system. Should take < 30 min; same shape as other token-aware row affordances.

### 2. Finding 13 — attach-existing skuRole hardcoding documented (HIGH)
File: `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:213`
Add the code-comment block documenting the Phase 1 limitation + Phase 4 audit dimension. Doesn't change behavior; banks the gap so it doesn't ship as a silent assumption. < 15 min.

### 3. Finding 10 — surface rename canon Setup nextMove label (MEDIUM)
File: `src/lib/nav/surface-meta.ts:53`
One-line change: `nextMove: { label: "Continue to Costs →" }`. Resolves the internal-inconsistency with mark_accepted's `backAction: "← Costs"` and the rest of the canon-aware UI. Also update the DN callout body + leaf drawer helper to match (3 lines total). < 10 min.

## Banked observations for future audits / R7c

- **Pattern 29 migration** for tier qty + price-adj cells (Findings 06, 07). Banked in `r1-setup.css` as "existing cost-build cells should migrate to read↔edit for consistency." Out of §6.b scope; carries to §6.c or R7c.
- **Cross-surface warn-band primitive** (Finding 18). Slice 9.5 validation surfacing + Mark-Accepted sent-vs-draft mismatch will need the same primitive. Extract once, reuse three places.
- **Pattern 28 vs surface-rename canon collision** (Finding 10). Banked recommendation: CLAUDE.md update documenting rename canon overrides Pattern 28 verbatim-copy for surface-reference contexts (not concept-reference contexts).
- **Modal portal pattern** (Finding 19). Defer until a stacking-context conflict surfaces; if Edward prefers portal-first across the app, upgrade Finding 19 to MEDIUM.
- **Empty state grammar** (Finding 22). Brief §8 explicitly asked the designer to flag empty state. Banked: `.r7b-empty-state` as a reusable class across surfaces that have empty states (SKU table, tier table when no preset chosen, future Cost-build sections with no inputs).

## Pattern 21 compliance verification

- ✅ No JSX renders `.r7b-state-strip` (verified via grep on `src/`)
- ✅ Empty-tiers state correctly shows `<TierPresetPicker>` only when `tiers.length === 0` (page.tsx:354); no toggle UI
- ✅ Drawer states (assembly open / leaf open) are derived from `openSkuId` local state in `SkuRowList`; no state-strip toggle
- ⚠️ Dead CSS rules for `.r7b-state-strip` present in `r7b-setup.css:29-46` (Pattern 30 verbatim; not a violation, documented in Finding 20)

## Pull from Inventory absence verification

- ✅ No JSX renders "Pull from inventory" / "Pull from Inventory" (verified via grep on `src/`)
- ✅ Only TWO strings in `sku-footer.tsx` reference it — both are comments documenting the Confirmation C disposition
- ✅ Footer composition matches canonical 2-button-+-meta layout per Confirmation C

## Costs path-B sanity sweep verification

- ✅ `.r6-stack` cost-stack header — canonical class + correct H2 + .legend swatches
- ✅ `.r6-tier-col` tier columns — canonical .head + .bars + .foot grammar
- ✅ `.r6-section` section drilldowns — canonical 6-track grid
- ✅ `.drawer-toolbar` inside `.r6-drawer` — canonical class (NOT legacy `r6-drawer-toolbar`)
- ✅ Mini-stack tier cells — canonical content-sized flex in auto track
- ✅ Tier-label rendering — legacy " — Xk" suffix stripped (verified via grep returns no matches)

## Closing

§6.b is in a shippable state. The two HIGH findings (02 QtyPerParentInline tokenization + 13 attach-existing skuRole documentation) should land as commits on this branch before PR-to-main. The MEDIUM findings are polish/maintenance that can ship either pre-PR or as fast-follows; recommend prioritizing 10 (surface naming canon) since it's a 10-minute fix with cross-surface internal-consistency impact. The LOWs are banked.

Pattern 30 + Pattern 27 + Pattern 28 working discipline held throughout the implementation. Two-layer fidelity manifest (Pattern 27) was visible in commit messages reviewed during this audit. The Path-B canonical-CSS-verbatim approach (Pattern 30) is paying for itself — most fidelity gaps surfaced are at the boundary of canonical-coverage (places where canonical structure didn't cover a nexus extension), not internal-canonical-divergence. That's the expected shape of a successful canonical-CSS migration.

Edward + CA: review the 2 HIGHs first; bank the 8 MEDIUMs into UX_BACKLOG with Patterns 19 + 29 + 30 tags; the 12 LOWs are documentation-grade catches. Recommend a single audit-followup commit bundling the 3 top fixes, then PR-to-main.
