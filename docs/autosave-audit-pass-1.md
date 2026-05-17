# Autosave focus-stability sweep — Step 5 Pass 1 audit

**Slice:** v1 release-critical path item 3.
**Brief:** `docs/autosave-focus-stability-brief.md`.
**Step:** 5 — Pass 1 static field audit (this doc).
**Pattern reference:** Pattern 47 (`CLAUDE.md` "Autosave focus-stability").
**Status:** Audit complete. **16 INPUT/SELECT instances** need fix per Pattern 47 rule (e). Per-instance dispositions below; Step 7 applies fixes.

---

## Audit method

Two-stage grep:

1. **All `disabled=\{... || pending\}` / `disabled=\{pending\}` instances** — 52+ matches across 23 files. Most are on `<button>` elements (legitimate double-click protection per Pattern 47 rule (e) carve-out for buttons).
2. **Multiline grep `<(input|textarea|select)\b[^>]*?disabled=\{[^}]*pending[^}]*\}`** — narrows to element-attribute matches on form-control elements specifically. **16 instances** surface as Pattern 47 rule (e) violations.

The element-type discrimination is the key audit insight: focus-stability concern applies to inputs/textareas/selects (browsers drop focus on disabled form controls); does not apply to buttons (where double-click protection IS the right reason to disable on `pending`).

---

## A. IN-SCOPE Pattern 47 rule (e) violations — 16 instances

### A.1 Pricing surface (6 instances)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 1 | `src/components/global-price-adj-input.tsx:177` | `<input type="number">` | Quote-level GPA (`global_price_adj_pct`) | `disabled={disabled \|\| pending}` | Per-keystroke debounced (500ms) | **A — drop `pending`** |
| 2 | `src/components/tier-price-adj-input.tsx:133` | `<input type="number">` | Per-tier adj (`tier_price_adj_pct`) | `disabled={disabled \|\| pending}` | Per-keystroke debounced (500ms) | **A — drop `pending`** |
| 3 | `src/components/required-sell-cell.tsx:209` | `<input type="text" inputMode="decimal">` | Per-cell sell-price override | `disabled={pending}` | Blur/Enter commit (already) | **A — drop `pending`** (preventive) |
| 4 | `src/components/pricing/client-target-cell.tsx:263` | `<input type="text" inputMode="decimal">` | Per-cell client target | `disabled={pending}` | Blur/Enter commit (already) | **A — drop `pending`** (preventive) |
| 5 | `src/app/projects/[id]/quotes/[quoteId]/pricing/sku-summary-row.tsx:552` | `<input type="text" inputMode="decimal">` | Per-cell value (likely sell override or client target — pattern 29 cell) | `disabled={pending}` | Blur/Enter commit (already) | **A — drop `pending`** (preventive) |
| 6 | `src/components/quote-target-margin-popover.tsx:266` | `<input type="number">` | Per-quote target margin override | `disabled={pending}` | Explicit commit (popover form) | **A — drop `pending`** (preventive) |

**Primary bugs (active focus-yank):** instances 1 + 2. Per-keystroke save means `pending` flips mid-typing → focus drops at the 500ms debounce-fire moment. This is the Aisha-demo symptom mechanism.

**Preventive fixes:** instances 3-6. Already use blur/Enter commit; `pending` flips post-blur, so focus has already moved. But Pattern 47 rule (e) requires drop anyway — the discipline is uniform, and adversarial timing (Enter pressed exactly when pending flips) could theoretically yank.

### A.2 Setup surface (2 instances)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 7 | `src/app/projects/[id]/quotes/[quoteId]/tier-preset-select.tsx:90` | `<select>` | Tier preset choice | `disabled={pending}` | Form action (single commit) | **A — drop `pending`** (preventive) |
| 8 | `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:1501` | `<input type="number">` | `qty_per_parent` inline editor (`QtyPerParentInline`) | `disabled={disabled \|\| pending}` | Blur/Enter commit (already; matches LegDateInput pattern) | **A — drop `pending`** |

Instance 8 already uses the canonical blur/Enter pattern from R6.2 commit 4.1 (`onBlur={fire}`, `onKeyDown` Enter→blur at `sku-row.tsx:1503-1506`) but missed the `disabled` attribute alignment. One-line fix.

### A.3 Costs / Packaging drilldown (4 instances)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 9 | `src/components/costs/packaging-drilldown.tsx:426` | `<select>` | Packaging category | `disabled={disabled \|\| pending}` | On-change save | **A — drop `pending`** |
| 10 | `src/components/costs/packaging-drilldown.tsx:464` | `<input type="text">` | Supplier (temp free-text per UX_BACKLOG) | `disabled={disabled \|\| pending}` | Per-keystroke debounced | **A — drop `pending`** |
| 11 | `src/components/costs/packaging-drilldown.tsx:490` | `<input type="number">` | `markup_pct` | `disabled={disabled \|\| pending}` | Per-keystroke debounced | **A — drop `pending`** |
| 12 | `src/components/costs/packaging-drilldown.tsx:627` | `<input type="number">` | `unit_cost` | `disabled={disabled \|\| pending}` | Per-keystroke debounced | **A — drop `pending`** |

Instances 10-12 are per-keystroke autosaves — same active-bug mechanism as Pricing instances 1-2.

### A.4 Costs / Production drilldown (1 instance)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 13 | `src/components/costs/production-drilldown.tsx:596` | `<input type="number">` | Production cost cell (per SKU × tier) | `disabled={disabled \|\| pending}` | Per-keystroke debounced | **A — drop `pending`** |

Production input instance. Active bug.

### A.5 Costs / Freight drilldown (2 instances)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 14 | `src/components/costs/freight-drilldown.tsx:523` | `<select>` | Leg mode | `disabled={!editable \|\| pending}` | On-change save | **A — drop `pending`** |
| 15 | `src/components/costs/freight-drilldown.tsx:563` | `<select>` | Leg incoterm | `disabled={!editable \|\| pending}` | On-change save | **A — drop `pending`** |

Number inputs on freight legs (rates, customs %, etc.) at file:line refs 466/476/706/725/864/1280 are on BUTTONS (toggles, action affordances) per inspection; not in this audit. The leg date inputs were already fixed in R6.2 commit 4.1 via `LegDateInput` primitive.

### A.6 Project detail (1 instance — edge case)

| # | File:line | Element | Field | Current pattern | Save shape | Fix option |
|---|---|---|---|---|---|---|
| 16 | `src/app/projects/[id]/category-select.tsx:30` | `<select>` | Project category | `disabled={pending}` | Form action | **A — drop `pending`** (preventive) |

Project-level select. PM-editable from project detail. Same fix shape.

---

## B. OUT-OF-SCOPE — admin surfaces (per brief Scope OUT)

Brief Section 1 Scope OUT: "Admin-only fields (low-volume; lower priority; audit separately in v1.5+ if needed)." Tracked here for completeness; NOT in v1 sweep scope.

- `src/app/admin/firm-settings/firm-settings-form.tsx:347` — likely button (need verify)
- `src/app/admin/firm-settings/firm-settings-form.tsx:692` — likely button
- `src/app/admin/firm-settings/customer-facing-defaults-form.tsx:281` — likely button
- `src/app/admin/markup-defaults/markup-defaults-table.tsx:318` — button
- `src/app/admin/markup-defaults/markup-defaults-table.tsx:323` — button
- `src/app/admin/users/users-table.tsx:188` — likely button
- `src/app/admin/users/users-table.tsx:196` — likely button

These return matches on the unscoped grep but were filtered out of the input/select/textarea multiline grep — most are buttons. Spot-verify in a future v1.5+ admin sweep.

---

## C. Compliant — already correct (no fix needed)

These elements were inspected and confirmed Pattern 47 rule (e) compliant:

- **`src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx`** (Setup tier rows) — `disabled={disabled}` only on label/qty/priceAdj inputs (lines 131, 170, 185). Already compliant.
- **`src/components/costs/freight-drilldown.tsx` `LegDateInput`** — canonical blur/Enter pattern with `disabled={disabled}` only. R6.2 commit 4.1 reference.
- **All `disabled={... || pending}` on `<button>` elements** (~36 instances) — legitimate double-click protection. Pattern 47 rule (e) carve-out: "Buttons may still use `disabled={pending}` to prevent double-click."

---

## D. Out of scope per brief Section 1 — confirmed no Pattern 47 violations

- **Quote surface (customer-facing render)** — no editable autosave fields (confirmed Step 1 inventory). No Pattern 47 applicability.
- **Mark Accepted surface** — no editable autosave fields (confirmed Step 1 inventory). No Pattern 47 applicability.

---

## E. Fix-shape summary

All 16 instances use **Option A** (drop `pending` from `disabled` attribute on the form-control element). No instances require Option B (blur/Enter commit migration) — every instance is either:

- Already using per-keystroke autosave (and just needs the `disabled` attribute cleaned up; instances 1, 2, 10, 11, 12, 13)
- Already using blur/Enter commit but with vestigial `disabled={pending}` (instances 3-8, 16; preventive cleanup)
- On-change save for selects (instances 7, 9, 14, 15, 16; simple `disabled` attr fix)

**Net diff scope:** 16 one-line changes across 11 files. Plus possible `pending` indicator preservation (the "saving…" caption sibling still uses `pending` for visual feedback; no change to that).

**Verification at Step 11:** Architect can re-grep the multiline pattern and confirm zero matches after Step 7 fixes land.

---

## F. Step sequencing impact

- **Step 6 Pass 2 audit** — 10-scenario matrix from Step 1 inventory. Each scenario will exercise the post-fix Pattern 47 compliance for both static-render AND just-added dynamic-render cases. Pass 2 confirms the static fixes from Step 7 transfer cleanly to dynamic affordances.
- **Step 7 fix application** — mechanical sweep across the 16 instances. Each fix is one line. No new abstractions; no helpers. Each commit can group related files (Pricing batch, Costs batch, etc.) for review clarity.
- **Step 8 regression test** — Playwright (or equivalent) covering the canonical "add affordance → type immediately → focus persists" scenarios. Pass 2 inventory drives the test list.
