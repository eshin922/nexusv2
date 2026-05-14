**Severity:** MEDIUM

**Dimension:** 11 — Add-product modal Margin display block

**Issue:** The Margin display (calculated, read-only) is rendered as a fully-inline-styled `<div>` (`add-product-modal.tsx:503-536`):

```tsx
<div style={{
  padding: "8px 12px",
  background: "var(--paper-2)",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--ink-3)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
}}>
  <span style={{
    fontFamily: "var(--mono)",
    fontSize: 9.5,
    letterSpacing: "0.10em",
    textTransform: "uppercase",
    color: "var(--ink-4)",
  }}>Margin</span>
  <span style={{
    fontFamily: "var(--mono)",
    color: marginVal !== null ? "var(--ink)" : "var(--ink-4)",
  }}>{marginVal !== null ? fmtMarginPct(marginVal) : "—"}</span>
</div>
```

That's a moderately complex composition (label + value, distinct typography per child, distinct color per state) built entirely in inline style. Tokens are correct so dark-mode is OK, but maintenance is brittle. If a future visual tweak adds a 3rd column (e.g., a "vs. firm target" comparison), the inline-style block becomes unreadable.

Per Pattern 30, this is the kind of nexus-specific composition that should be extracted to `r1-setup.css` so it's:
1. Recognizable as a polish surface (named class)
2. Maintainable (single CSS rule vs N inline-style invocations)
3. Discoverable for R7c future polish (CD can see the class names and propose updates)

**Canonical reference:** No canonical for the Margin display block (Phase 1 addition; brief specifies "Margin = price - cost, display only" but no styling). Pattern 19 disposition: nexus extension to the canonical modal.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:503-536`

**Fix proposal:** Extract to `r1-setup.css`:

```css
/* §6.b Phase 1.3 — calculated Margin display block. Read-only;
   renders below Unit price + Unit cost row. Value = (price − cost)
   / price as whole-number percentage. Em-dash placeholder when
   price is 0 / NaN / cost is NaN. Edward smoke disposition:
   margin reads as percent, not USD. */
.r7b-modal-body .calc-display {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 12px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 6px;
  font-size: 12px;
  color: var(--ink-3);
}
.r7b-modal-body .calc-display .lab {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-4);
}
.r7b-modal-body .calc-display .val {
  font-family: var(--mono);
  color: var(--ink-4);
}
.r7b-modal-body .calc-display .val.has-value {
  color: var(--ink);
}
```

JSX:

```tsx
<div className="calc-display">
  <span className="lab">Margin</span>
  <span className={`val${marginVal !== null ? " has-value" : ""}`}>
    {marginVal !== null ? fmtMarginPct(marginVal) : "—"}
  </span>
</div>
```

**Banked observation:** the `.calc-display` class becomes a primitive other Phase 2/3 modal fields can reuse (e.g., if a future "Markup as %" calculated display lands, it uses the same class).

**Risk if shipped:** Inline style sprawl in a 700-line component file. Not breaking; making future polish harder. MEDIUM because it's a primitive worth extracting before more cells inherit the inline-style pattern.
