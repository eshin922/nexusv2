**Severity:** MEDIUM

**Dimension:** 2, 10 — pack cell content + units_per_pack inline chip

**Issue:** The `<UnitsPerPackCell>` component (Phase 1.4) renders inside the `.pack` sub-text of the Product cell. The canonical `.pack` cell carries `{pack}` text + an optional `.indicator` chip (HAS NOTE warn-soft). The implementation places `<UnitsPerPackCell>` as the FIRST child of `.pack` (BEFORE the HAS NOTE chip), but its chip register is hand-rolled inline-style with no canonical class hook:

```tsx
const chipStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  background: "var(--paper-3)",
  border: "1px solid var(--rule)",
  borderRadius: 3,
  padding: "1px 6px",
  color: "var(--ink-3)",
  marginRight: 6,
  verticalAlign: "middle",
};
```

The canonical `.indicator` rule already produces the same visual register: `font-family: var(--mono); font-size: 9.5px; color: var(--ink-4); background: var(--paper-3); padding: 1px 5px; border-radius: 3px; letter-spacing: 0.04em;` (`docs/design-prototypes/dist/7bstyles.css:186-191`). Two chip families now coexist with subtly different vocabulary (10px vs 9.5px, 6px vs 5px padding, ink-3 vs ink-4 color) — visually noisy in a column that's already dense.

Additional gap: when value === "1" (the default), the chip still renders "1/pk", consuming space for the most common case. R7b designer notes don't explicitly say to hide the default; Phase 1.4 brief OQ3 disposition says "default to 1 on insert" and "exposed as inline edit on the SKU row". The decision to ALWAYS render is justifiable (PMs must always see what units_per_pack is set to) — but the noise question is real if 90%+ of products are 1/pk.

**Canonical reference:** `docs/design-prototypes/dist/7bstyles.css:186-191` (.indicator rule); `docs/design-prototypes/dist/7bsetup.jsx:160-163` (.pack cell with single .indicator child).

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:1153-1275` — `<UnitsPerPackCell>` definition; line 369-376 in the SKU row JSX is where it's mounted.

**Fix proposal:**

1. **Use canonical `.indicator` class** rather than inline chip styles. The canonical CSS already produces the right register; reusing it ensures the units-per-pack chip and the HAS NOTE chip are visually a matched pair (both at 9.5px / 5px padding / mono / ink-4):

```tsx
function UnitsPerPackCell({ value, disabled, onChange }) {
  // … same edit/read state machine …

  if (editing) {
    return (
      <span className="indicator" style={{ cursor: "text" }}>
        <input
          ref={inputRef}
          type="number" min={1} step={1} value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            else if (e.key === "Escape") { e.preventDefault(); revert(); }
          }}
          aria-label="Units per pack"
          style={{
            background: "transparent", border: "none", font: "inherit",
            color: "var(--ink)", width: 36, padding: 0, textAlign: "right",
          }}
        />
        <span style={{ color: "var(--ink-4)" }}>/pk</span>
      </span>
    );
  }

  return (
    <span
      className="indicator"
      onClick={disabled ? undefined : enterEdit}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={…}
      aria-label={`Units per pack: ${display}. Click to edit.`}
      style={{ cursor: disabled ? "default" : "text" }}
    >
      {display}
    </span>
  );
}
```

Then in `r1-setup.css`, add a single targeted override for the units-per-pack `.indicator` variant if any visual differentiation is desired (e.g., a different background to distinguish from HAS NOTE chip):

```css
/* §6.b Phase 1.4 — units_per_pack indicator (canonical .indicator
   register with a units-per-pack-specific tint). HAS NOTE chip
   uses the warn-soft variant; this carries the resting tint. */
.r7b-sku-row .name .pack .indicator.units-per-pack {
  /* No override — canonical .indicator is the right register. */
}
```

Add `className="indicator units-per-pack"` to keep the future-targeting selector.

2. **Reorder children inside `.pack`** so HAS NOTE chip is first (right of `{pack}` text), then units-per-pack chip — matches the canonical's "indicator is the single chip in this cell" framing more closely. Or document the order as intentional.

**Risk if shipped:** Two close-but-not-identical chip vocabularies on the same row. Visual noise; Pattern 19 violation (forcing two registers where one canonical register covers both cases). Dark-mode-wise both happen to use design tokens already so no theme regression.
