**Severity:** LOW

**Dimension:** 11 — Add-product modal FSC trio layout

**Issue:** The FSC trio renders as a 3-column grid (`grid-template-columns: 1fr 1fr 1fr; gap: 12px`) inside a 640px modal:

```tsx
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
  <div className="field">… FSC claim …</div>
  <div className="field">… FSC status …</div>
  <div className="field">… Supplier verified …</div>
</div>
```

At 640px modal width, each FSC field is ~200px wide minus padding. Labels like "Supplier verified" (16 chars at mono 9.5px / 0.10em letter-spacing) consume nearly the full width. Select options like "FSC Recycled" (12 chars at ~13px) fit, but the dropdown chevron + native select chrome may push longer labels into truncation.

The brief's modal width bump (580 → 640px) was specifically for this FSC trio — sized to fit the 3-up grid. So this is at-the-limit, not over. But "Supplier verified" feels tight; visual smoke test on production data is worth doing.

Pattern 11 (Design illustrative, real data needs different proportions) — if the modal in production renders smaller than expected (e.g., a PM on a 1366x768 laptop with browser sidebar consuming horizontal space), the modal max-width is `min(640px, 100%)` → degrades gracefully to viewport width, but the 3-column FSC trio still occupies the full width — each column gets smaller.

**Canonical reference:** No canonical for the FSC trio (Phase 1 brief addition; not in R7b canonical JSX). Pattern 19 disposition: nexus-extended modal field; 3-up grid is the layout chosen during Phase 1.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:608-664`

**Fix proposal:** Wrap the 3-column grid in a media query that falls back to single-column on narrow viewports. Add to `r1-setup.css`:

```css
/* §6.b Phase 1.3 — FSC trio grid. 3-up on standard modal width
   (640px); single-column on narrow viewports (< 540px) where
   each label gets cramped. */
.r7b-modal-body .fsc-trio {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}
@media (max-width: 540px) {
  .r7b-modal-body .fsc-trio {
    grid-template-columns: 1fr;
  }
}
```

Then JSX:

```tsx
<div className="fsc-trio">
  …
</div>
```

Drop the inline style. Single source of truth for the grid; theming-aware degradation.

**Risk if shipped:** Acceptable on default 1280-1920px production viewports. Edge case on narrow viewports (< 540px) where labels truncate. Nexus is desktop-only per SPEC §8; this is a degenerate fallback. LOW.
