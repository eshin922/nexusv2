**Severity:** MEDIUM

**Dimension:** 1, 11 — page-head + action cluster vs SKU table footer

**Issue:** The page-head action cluster's `+ Add SKU` button is hardcoded `disabled` with a `title` attribute saying "wires to add-product modal in §6.b Step 8". Step 8 shipped — the Add-product modal lives in the SKU table footer's `+ Add product` button and is fully functional there. The page-head button is now duplicative AND dead. Two failure modes coexist: (1) PMs read the disabled state as "feature not implemented" and don't look for the working trigger 200px below; (2) the canonical R7b prototype has BOTH buttons functional, with the page-head one as the primary entry. Implementation halves that grammar without removing the second affordance.

The "Save draft" button is also hardcoded `disabled` with title "Saved automatically as you edit." That's a tone divergence — disabled-with-a-title-explaining-why-it's-disabled reads as a half-finished feature. R5+ pattern would just remove the affordance or rename it (e.g., a non-button "Saved automatically · 2s ago" status caption) since the underlying mechanism is autosave, not a discrete save action.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:101-105` —
```jsx
<div className="r7b-actions">
  <button className="btn ghost sm">+ Add SKU</button>
  <button className="btn primary">Save draft</button>
</div>
```
Both buttons render as functional affordances in the canonical (no `disabled`).

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/page.tsx:145-162`

**Fix proposal (two options — pick one):**

Option A (keep both buttons functional, match canonical):
```tsx
<div className="actions">
  <AddProductModal quoteId={quote.id} disabled={!editable} variant="ghost" />
  {/* Save draft → autosave status pill */}
  <span
    className="btn ghost sm"
    style={{ pointerEvents: "none", color: "var(--ink-3)" }}
    title="Saved automatically as you edit"
  >
    Auto-saved
  </span>
</div>
```
This requires extending `AddProductModal` to accept a `variant` prop ("ghost" vs "primary") so it can render its trigger button in the page-head register. Simplest path: hoist `open` state to page-head scope OR mount a second `<AddProductModal>` instance (modal trigger button is part of the component).

Option B (drop the page-head action cluster entirely — Pattern 19 disposition):
```tsx
{/* §6.b — page-head action cluster removed per audit MEDIUM-1.
    + Add product lives in the SKU table footer (working trigger).
    Save draft → autosave model; status feedback lives at row level.
    Page head reduces to eyebrow + h1 + sub-copy. */}
```
Cleaner; loses the canonical's "two affordances at the top" grammar but matches actual functional layout.

Recommended: **Option A** to preserve canonical grammar. The page-head action cluster is part of R7a's load-bearing register; dropping it would cascade to other surfaces with the same pattern.

**Risk if shipped:** PMs see a disabled `+ Add SKU` button at the top and stop scanning (assuming the slice is incomplete). The working footer trigger is below the fold of the SKU table on real data. Discoverability loss is real for a primary action.
