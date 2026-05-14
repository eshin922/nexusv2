**Severity:** HIGH

**Dimension:** 2 — SKU table column widths + structure

**Issue:** The SKU `<div className="r7b-sku-thead">` declares 7 column slots: `[grip][Type][Product][Category][Retail bench][Components][actions]`. The `<div className="r7b-sku-row">` also declares 7 children. **But the Product cell (third slot) carries TWO additional inline affordances that the canonical's Product cell does not** — a `<QtyPerParentInline>` widget (rendered as a sibling of `.label-pack` + `.pack` inside `.name`) AND the tree-line `└─ ` indentation indicator inside `.label-pack > .lbl`. These cause the row's Product cell to grow tall on child rows AND to push the in-cell hierarchy out of canonical alignment.

The canonical .name structure is strictly:
```jsx
<div className="name">
  <div className="label-pack">
    <span className="lbl">{label}</span>
    <span className="product">{product}</span>
  </div>
  <span className="pack">{pack}{has_note}</span>
</div>
```

Two children: `.label-pack` (a flex row) and `.pack` (a span). The implementation adds a THIRD child (`<QtyPerParentInline>`) that renders as an inline-flex pill with `"× {n} per parent"` text. This element has no canonical .qty-per-parent style and uses Tailwind utility classes (`text-[10px]`, `text-gray-500`, `border-gray-200`, `bg-white`) — a non-token-aware affordance inside a token-aware row. Dark-mode failure mode: text and borders won't theme.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:155-164` — Product cell has 2 children only (`.label-pack` + `.pack`). `docs/design-prototypes/dist/7bstyles.css:179-216` — `.r7b-sku-row .name` is `display: flex; flex-direction: column; gap: 2px;` with no provision for a 3rd `qty-per-parent` row.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:355-411` — the third child `{sku.parentSkuId && (<QtyPerParentInline … />)}` is appended to `.name`. The `QtyPerParentInline` component lives at `sku-row.tsx:778-840` and uses hardcoded gray-* Tailwind classes throughout.

**Fix proposal:**

1. **Token discipline** — rewrite QtyPerParentInline to use canonical tokens (no hardcoded gray-*):
   ```tsx
   return (
     <span
       style={{
         display: "inline-flex", alignItems: "center", gap: 4,
         fontFamily: "var(--mono)", fontSize: 10,
         color: "var(--ink-4)", letterSpacing: "0.04em",
       }}
     >
       <span>×</span>
       <input
         type="number" step="0.0001" min={0}
         value={value} disabled={disabled || pending}
         onChange={(e) => setValue(e.target.value)}
         onBlur={fire}
         onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
         title="qty per parent"
         style={{
           width: 44, padding: "0 4px",
           background: "var(--paper-3)", border: "1px solid var(--rule)",
           borderRadius: 3, color: "var(--ink-2)",
           fontFamily: "var(--mono)", fontSize: 10,
         }}
       />
       <span>per parent</span>
       {pending && <span style={{ color: "var(--ink-4)" }}>…</span>}
       {error && <span style={{ color: "var(--bad)" }} role="alert">{error}</span>}
     </span>
   );
   ```

2. **Tree-line treatment** — the canonical doesn't have nested rows; nexus extends with a tree-line indicator. Pattern 19 (defer-with-rationale) applies: the data shape IS different (assemblies have children rendered as nested rows). Document the divergence in `r1-setup.css` (it lives there as nexus-specific override territory). The current treeLine + paddingLeft hack is OK structurally but needs a cleaner home — wrap the indent in a labeled span:
   ```tsx
   {treeLine && (
     <span
       aria-hidden
       style={{ color: "var(--ink-4)", marginRight: 4, fontFamily: "var(--mono)", fontSize: 10 }}
     >
       └─
     </span>
   )}
   ```
   Drop the `lbl` className conflation (the tree-line is decorative; the canonical `.lbl` style applies font-mono 11px ink-3 which is wrong for the tree connector glyph at smaller scale).

3. **Audit Pattern 26 manifest claim** — the §6.b path-B migration commit message should have flagged QtyPerParentInline as a nexus-specific extension to the canonical .name structure. It didn't (or if it did, the polish layer wasn't named). Banked: when extending canonical structure with new affordances, manifest them in POLISH MATCHED explicitly.

**Risk if shipped:** Dark-mode token regression (text-gray-500 doesn't theme), Pattern 19 violation (silent extension without rationale doc), and visual misalignment on rows with deep children. PM smoke might miss the dark-mode regression because Setup defaults to light. Dark-mode is the lowest-priority test environment per UX_BACKLOG, which is why this is HIGH rather than CRITICAL.
