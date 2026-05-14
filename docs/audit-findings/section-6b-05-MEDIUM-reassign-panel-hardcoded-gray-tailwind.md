**Severity:** MEDIUM

**Dimension:** 2 — SKU reassign panel (expands below row)

**Issue:** The `<ReassignPanel>` component at `sku-row.tsx:713-772` renders with full Tailwind utility classes using hardcoded gray-* tokens that bypass the design-token system entirely:

- `border-l-2 border-gray-300 bg-gray-50` — outer container
- `border border-gray-300 bg-white` — select + input
- `bg-gray-900 hover:bg-gray-700 text-white` — Save button
- `border-gray-300 hover:bg-white` — Cancel button
- `text-xs text-gray-600` — labels

These are pre-token-system styles. Dark-mode failure: `bg-gray-50` doesn't theme; `bg-gray-900` is darker than `--ink` (the canonical ink token), so the Save button in dark mode appears DARKER than its surroundings instead of contrasting. Light mode renders OK but inconsistent with the rest of the row's `--paper-2` / `--rule` token vocabulary.

This is the SAME failure mode CLAUDE.md flags at the "Light mode is the default" working principle — illegible dark-mode tokens classified as critical. This panel renders the moment a PM clicks "Reassign parent" in the overflow menu, so it's not a hidden edge case.

**Canonical reference:** No canonical exists (Reassign is a nexus extension; R7b prototype shows the ⋯ button without expanding affordances). Pattern 19 disposition: extend with token-aware register, not legacy gray-* Tailwind.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:713-772`

**Fix proposal:** Rewrite ReassignPanel using canonical tokens. Drop into `r1-setup.css`:

```css
/* §6.b — SKU reassign panel (nexus extension for parent assignment).
   Expands below the row in response to ⋯ menu "Reassign parent". */
.r7b-sku-reassign {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  background: var(--paper-2);
  border-left: 2px solid var(--accent);
  border-bottom: 1px solid var(--rule);
  font-size: 12.5px;
}
.r7b-sku-reassign .form {
  display: flex; align-items: center; gap: 8px; min-width: 0;
}
.r7b-sku-reassign label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.r7b-sku-reassign select,
.r7b-sku-reassign input {
  padding: 4px 8px;
  border: 1px solid var(--rule);
  border-radius: 4px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
}
.r7b-sku-reassign select { flex: 1; min-width: 0; }
.r7b-sku-reassign input.qty { width: 90px; text-align: right; font-family: var(--mono); }
```

Then JSX:

```tsx
function ReassignPanel({ eligibleParents, currentParentId, currentQty, onCancel, onSubmit }) {
  const [parentId, setParentId] = useState(currentParentId ?? "");
  const [qty, setQty] = useState(currentQty ?? "");

  return (
    <div className="r7b-sku-reassign">
      <div className="form">
        <label>Parent</label>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— select parent —</option>
          {eligibleParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.skuLabel} — {p.productName} ({p.skuRole})
            </option>
          ))}
        </select>
        <label>Qty</label>
        <input
          className="qty"
          type="number"
          step="0.0001"
          min={0}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="qty per parent"
        />
      </div>
      <button type="button" className="btn primary sm" onClick={() => onSubmit(parentId, qty)}>
        Save
      </button>
      <button type="button" className="btn ghost sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
```

**Risk if shipped:** Dark-mode regression in the reassign workflow (gray-900 on a dark surface reads black-on-black or near-illegible). Inconsistent register with rest of canonical .r7b-* row chrome — a single hover surface that doesn't match any others.
