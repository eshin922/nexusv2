**Severity:** LOW

**Dimension:** 9, 11 — SKU footer + Add-product modal trigger composition

**Issue:** The Add-product modal component (`add-product-modal.tsx`) renders TWO different elements depending on `open` state:

```tsx
if (!open) {
  return (
    <button type="button" className="add-sku primary" onClick={() => setOpen(true)} disabled={disabled}>
      + Add product
    </button>
  );
}
return (
  <div className="r7b-modal-backdrop" …>
    <div className="r7b-modal" …>
      {/* full modal content */}
    </div>
  </div>
);
```

When closed: a button. When open: a full-screen backdrop overlay. The component is mounted as a direct child of `<div className="r7b-sku-footer">` (per `sku-footer.tsx:54`):

```tsx
<div className="r7b-sku-footer">
  <AddProductModal quoteId={quoteId} />
  <button … className="add-sku">↗ Pull from HubSpot</button>
  <span className="meta">Drag rows to reorder</span>
</div>
```

When the modal opens, the entire `.r7b-modal-backdrop` (fixed-position, full-viewport) is rendered as a child of `.r7b-sku-footer`. That's structurally valid (fixed positioning escapes flow), but:

1. **Semantically odd** — the modal is conceptually a child of the page (or `<body>`) not the SKU footer. React Portal pattern is the canonical answer.
2. **z-index hierarchy risk** — if the page-head adds a z-indexed element (sticky banner, dropdown menu), the modal needs `z-index: 100` to win. Current `.r7b-modal-backdrop` rule has `z-index: 100` (`r7b-setup.css:509`) which is high enough for v1, but the lack of portal isolation means future stacking contexts could conflict.
3. **Stop-propagation reliance** — modal click handler stops propagation (`onClick={(e) => e.stopPropagation()}` on `.r7b-modal`) to prevent backdrop close. Works, but a portal would isolate the modal's DOM tree from sibling event handlers entirely.

Pattern 19 disposition: works for v1, not breaking, but doesn't follow modal best-practice for React-portal isolation.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:354-415` — canonical `AddProductModal` is also mounted in-flow (no portal in the prototype). So implementation matches canonical structural composition.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:279-298`

**Fix proposal:** Defer-with-rationale. v1 ships in-flow modal (matches canonical). If future surfaces add stacking contexts that conflict with the backdrop z-index (e.g., a top-bar with dropdown that needs z-index > 100), migrate to React Portal:

```tsx
import { createPortal } from "react-dom";

// In return:
return (
  <>
    {!open && <button …>+ Add product</button>}
    {open && createPortal(
      <div className="r7b-modal-backdrop" onClick={close} role="dialog" …>
        <div className="r7b-modal" …>
          { /* … */ }
        </div>
      </div>,
      document.body
    )}
  </>
);
```

Banked observation: Edward might prefer portal-first because the audit-log surfacing in Slice 8 used portal-mounted alerts (verify if/when). If portal becomes the cross-cutting modal pattern, this finding upgrades to MEDIUM and refactors the modal preemptively.

**Risk if shipped:** Modal renders correctly in v1 (canonical matches the in-flow pattern). Future stacking-context conflicts are speculative. LOW.
