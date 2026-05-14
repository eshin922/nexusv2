**Severity:** LOW

**Dimension:** 2 — empty SKU table state

**Issue:** When `skus.length === 0`, the implementation renders an empty-state paragraph inside the `.r7b-card`:

```tsx
<p style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--ink-3)", fontStyle: "italic", margin: 0 }}>
  {editable
    ? 'No SKUs yet. Use "+ Add product" or "↗ Pull from HubSpot" below to start.'
    : "No SKUs."}
</p>
```

Inline-styled paragraph. The canonical R7b prototype only fixtures the populated state (5 SKUs); empty state isn't explicitly designed. Pattern 19 disposition: nexus-extended empty state.

Two issues:

1. **Inline styles** — Pattern 30 cleanup target. Should live as a named class.
2. **Copy includes verbatim button labels** ("+ Add product" / "↗ Pull from HubSpot") in italic body text. PMs reading this need to map the prose to the visible affordances below. Light cognitive cost.

**Canonical reference:** R7b prototype has no empty-state fixture for SKUs. Brief §8 risks: "Empty SKU table state — when COUNT(quote_skus) = 0, table renders header row + '+ Add product' / '↗ Pull from HubSpot' footer. R7b prototype shows populated state only. Designer agent should verify empty state matches grammar (or flag as new dimension if R7b didn't fixture it)."

This is the brief's explicit ask. Banked: empty state matches grammar IF we treat it as Pattern 19 nexus extension. The current implementation satisfies the functional requirement (header + footer + empty paragraph between).

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/page.tsx:250-255`

**Fix proposal:**

1. **Promote to class:**

```css
/* §6.b — empty-state copy for tables. Cards render header row +
   footer; this paragraph fills the body when count=0. */
.r7b-empty-state {
  padding: 24px 16px;
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-3);
  font-style: italic;
}
```

2. **Drop button-label-in-prose** and use icon glyphs:

```tsx
<p className="r7b-empty-state">
  {editable
    ? 'No SKUs yet. Add one below to start.'
    : "No SKUs."}
</p>
```

Cleaner — PMs see the empty state, look down to the footer, see the affordances. Don't need the prose to label them.

**Risk if shipped:** Inline-style + verbose copy. Trivial UX cost; the working state is correct. LOW.
