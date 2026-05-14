**Severity:** MEDIUM

**Dimension:** 2 — SKU row overflow menu (⋯ button menu items)

**Issue:** The overflow menu (`overflowOpen && (…)`) at `sku-row.tsx:501-633` is rendered with hardcoded Tailwind utility classes for every menu item:

- `min-w-[200px] rounded border border-rule bg-paper py-1 shadow-md` — container
- `block w-full px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-30` — every menuitem
- `text-bad hover:bg-bad-soft` — delete button
- `mr-2 font-mono text-ink-3` — leading glyph spans

These use Nexus's token-aware Tailwind utilities (`text-ink-2`, `bg-paper-2`, etc.) so dark-mode IS supported, BUT they sit inside a row using canonical CSS class register (`.r7b-sku-row .actions` etc.). The mix-and-match is internally inconsistent — a future R7c refresh of the row would update canonical classes but miss the Tailwind-utility-defined menu.

Pattern 30 (CLAUDE.md): "Canonical design-source CSS imported verbatim." Menu is a nexus extension (canonical R7b prototype shows a single `⋯` button with no menu definition). Pattern 19 (defer-with-rationale) applies — the menu is a structurally necessary nexus affordance because critical actions don't have row-level homes yet (reassign, detach, refresh, HubSpot link). But the rationale isn't documented in CSS layer — and it should be a canonical-style affordance.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:175-178` — actions cluster has a single `⋯` button, no menu. `docs/design-prototypes/dist/7bstyles.css:216-224` — `.r7b-sku-row .actions button` register.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:501-633`

**Fix proposal:** Extract the menu into a canonical-styled register in `r1-setup.css` (nexus override territory):

```css
/* §6.b — SKU row overflow menu (nexus extension; canonical R7b
   shows a single ⋯ button without a menu definition). Pattern 19:
   menu is a structurally-necessary extension because critical
   row affordances (reassign, detach, refresh, HubSpot link) don't
   have row-level homes yet. Register matches canonical mono / ink
   / paper-2 hover token vocabulary. */
.r7b-sku-overflow {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  z-index: 50;
  min-width: 200px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 4px 0;
  box-shadow: 0 4px 16px oklch(0 0 0 / 0.12);
}
.r7b-sku-overflow [role="menuitem"] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.r7b-sku-overflow [role="menuitem"]:hover {
  background: var(--paper-2);
  color: var(--ink);
}
.r7b-sku-overflow [role="menuitem"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.r7b-sku-overflow [role="menuitem"].danger {
  color: var(--bad);
}
.r7b-sku-overflow [role="menuitem"].danger:hover {
  background: var(--bad-soft);
}
.r7b-sku-overflow .glyph {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
  width: 16px;
  text-align: center;
}
```

JSX simplifies to:

```tsx
{overflowOpen && (
  <div role="menu" className="r7b-sku-overflow">
    {!isAssembly && onDrawerToggle && (
      <button type="button" role="menuitem"
        onClick={() => { onDrawerToggle(); setOverflowOpen(false); }}
        disabled={disabled}>
        <span className="glyph">📝</span>
        {hasNote ? "Open notes" : "Add notes"}
      </button>
    )}
    {/* … same for Move up/down, Delete (with className="danger"), Reassign, Detach, Refresh, Open in HubSpot … */}
  </div>
)}
```

The `relative` wrapper `<div ref={overflowRef}>` keeps its current usage; the menu inherits position from it.

**Risk if shipped:** Inconsistent CSS authoring — half the row in canonical CSS, half in Tailwind utility classes. Future R7c refresh that touches the `.r7b-sku-row .actions` register won't see the overflow menu styles (they're in JSX class strings). Maintenance burden + Pattern 30 violation.
