**Severity:** LOW

**Dimension:** 11 — Add-product modal Description textarea styling

**Issue:** The Description textarea uses inline styles instead of the canonical `.r7b-modal-body input` register:

```tsx
<textarea
  id="ap-description"
  …
  rows={2}
  style={{
    resize: "vertical",
    padding: "8px 10px",
    border: "1px solid var(--rule)",
    borderRadius: 6,
    background: "var(--paper-2)",
    color: "var(--ink)",
    font: "inherit",
  }}
/>
```

The canonical `.r7b-modal-body input, .r7b-modal-body select` rule (`r7b-setup.css:532-540`) covers input + select but NOT textarea. The inline style replicates the same register manually — visually correct but maintenance-divergent. If the canonical rule changes (e.g., R7c bumps to `padding: 10px 12px`), this textarea won't follow.

Pattern 30 (canonical CSS verbatim): canonical doesn't include textarea rule for modal body because the canonical Add-product modal had no textarea field (Description was added in Phase 1). Extending the canonical rule to include textarea is the right path.

**Canonical reference:** `docs/design-prototypes/dist/7bstyles.css:532-540` — `.r7b-modal-body input, .r7b-modal-body select` rule. No textarea.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:357-375`

**Fix proposal:** Add textarea to the canonical selector group via local override in `r1-setup.css`:

```css
/* §6.b Phase 1.3 — extend canonical .r7b-modal-body input/select
   rule to include textarea. Canonical didn't have a textarea field
   (Description was Phase 1 addition). Same register for consistency. */
.r7b-modal-body textarea {
  padding: 8px 10px;
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--paper-2);
  color: var(--ink);
  font: inherit;
  resize: vertical;
  min-height: 56px;
}
.r7b-modal-body textarea:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--paper);
}
```

Then drop the inline style from the textarea JSX:

```tsx
<textarea
  id="ap-description"
  value={form.description}
  onChange={(e) => update("description", e.target.value)}
  placeholder="Optional"
  disabled={pending}
  rows={2}
/>
```

**Risk if shipped:** Maintenance divergence — future R7c tweaks to modal input styling won't flow to the textarea. Visual register currently matches; no in-flight bug. LOW.
