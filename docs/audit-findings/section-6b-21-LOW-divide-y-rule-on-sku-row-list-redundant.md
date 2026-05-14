**Severity:** LOW

**Dimension:** 2, 9 — SKU row list container

**Issue:** The `<SkuRowList>` wraps the row iteration in a div using Tailwind utility class:

```tsx
<div className="divide-y divide-rule" onDragEnd={handleDragEnd}>
  {orderedRows.map(({ sku, depth, … }) => (
    <SkuRow … />
  ))}
</div>
```

The `divide-y divide-rule` produces `> * + * { border-top: 1px solid var(--rule) }`. But the canonical `.r7b-sku-row` rule already has `border-bottom: 1px solid var(--rule)` (`r7b-setup.css:145`). Result: **every SKU row pair has TWO 1px rule lines stacked** — one from `divide-y` on the row above (border-top) and one from canonical row's border-bottom.

In rendered light-mode this looks like a 2px rule (or 1.5px on high-dpi displays where sub-pixel rounding kicks in). Visible at scan speed only on close inspection.

Edward's PM smoke may have missed it because the doubled rule on dark mode may also look correct (the canonical rule is `var(--rule)` which is light-mode `oklch(0.92 …)` vs dark `oklch(0.28 …)` — adjacent rules in dark mode merge visually).

**Canonical reference:** `docs/design-prototypes/dist/7bstyles.css:140-147` — `.r7b-sku-row { border-bottom: 1px solid var(--rule) }` provides ALL row dividers. No additional divider on the container.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row-list.tsx:184-187`

**Fix proposal:** Drop the `divide-y divide-rule` utility. Replace with a plain div:

```tsx
<div onDragEnd={handleDragEnd}>
  {orderedRows.map(({ sku, depth, … }) => (
    <SkuRow … />
  ))}
</div>
```

`onDragEnd` is the only meaningful behavior on the wrapper. The canonical row's `border-bottom` produces the divider; no wrapper-level divider needed.

Optional further cleanup: if the last row's `border-bottom` is visually noisy (rule line between row and `.r7b-sku-footer`), add a canonical-aware override:

```css
/* Drop the last SKU row's border-bottom so footer's border-top
   isn't doubled. Pattern 19 — small polish on visible drift. */
.r7b-sku-row:last-of-type {
  border-bottom: none;
}
```

But verify canonical CSS first — `r7b-setup.css:127` says `.r7b-sku-row.open { border-bottom: none }` only for the open state. Last-row treatment may want similar.

**Risk if shipped:** 2px-appearing rules between SKU rows on light mode. Trivial; PMs might not notice. LOW. The fix is one-line; worth doing.
