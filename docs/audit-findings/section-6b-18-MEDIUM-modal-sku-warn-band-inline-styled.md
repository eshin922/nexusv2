**Severity:** MEDIUM

**Dimension:** 11 — Add-product modal SKU duplicate warning band

**Issue:** The SKU duplicate warning band is built entirely with inline styles (`add-product-modal.tsx:426-467`):

```tsx
<div
  role="alert"
  style={{
    padding: "10px 12px",
    background: "var(--warn-soft)",
    border: "1px solid oklch(from var(--warn) l c h / 0.40)",
    borderLeft: "3px solid var(--warn)",
    borderRadius: 6,
    fontSize: 12.5,
    color: "var(--ink)",
    lineHeight: 1.5,
  }}
>
  <strong style={{ color: "var(--warn)" }}>
    This SKU already exists in HubSpot.
  </strong>{" "}
  {existingMatch.name}{" "}
  <span style={{ color: "var(--ink-3)" }}>
    · {existingMatch.productType ?? "no product type"}
  </span>
  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
    <button … className="btn primary sm" …>Pull existing</button>
    <button … className="btn sm" …>Use different SKU</button>
  </div>
</div>
```

Same maintenance concern as Finding 17. The warning band is a recurring affordance pattern — Slice 9.4 / 9.5 will need warn-bands for validation issues; Mark-Accepted needs warn-bands for sent-vs-draft mismatches. Currently each implementation invents its own inline-style register.

This warning band is also missing a polish-layer commitment: the canonical R-round inline warn-band register (R5 / R6 use `border-left: 3px solid var(--warn)` + `background: var(--warn-soft)` consistently). The implementation matches that visual but doesn't reuse a shared primitive.

**Canonical reference:** `docs/product-modal-brief.md:64-69` — brief specifies the warning + two CTAs; doesn't dictate styling. R5 / R6 designer notes show the warn-band register; R7b designer notes Pushback 1 mentions "has note warn-soft chip" but doesn't show a full warn-band primitive.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:424-467`

**Fix proposal:** Extract to a shared `.warn-band` primitive in `r1-setup.css` (or — if other surfaces also need it — a `src/styles/design-tokens.css` add):

```css
/* §6.b Phase 1 — inline warn band. Recurring pattern across
   surfaces (modal SKU dup-check, future Slice 9.5 validation
   surfacing, Mark-Accepted sent-vs-draft banner). Canonical
   register: --warn-soft bg + --warn 3px left-accent. Reusable
   across surfaces.

   Cross-surface candidates ready to migrate when they ship:
   - Mark-Accepted sent-vs-draft mismatch banner
   - Slice 9.5 validation surfacing
   - Cost build deposit-status alert
   */
.warn-band {
  padding: 10px 12px;
  background: var(--warn-soft);
  border: 1px solid oklch(from var(--warn) l c h / 0.40);
  border-left: 3px solid var(--warn);
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink);
}
.warn-band strong {
  color: var(--warn);
}
.warn-band .secondary { color: var(--ink-3); }
.warn-band .actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
```

JSX:

```tsx
{existingMatch && (
  <div role="alert" className="warn-band">
    <strong>This SKU already exists in HubSpot.</strong>{" "}
    {existingMatch.name}{" "}
    <span className="secondary">
      · {existingMatch.productType ?? "no product type"}
    </span>
    <div className="actions">
      <button type="button" className="btn primary sm" onClick={handlePullExisting} disabled={pending}>
        Pull existing
      </button>
      <button type="button" className="btn sm" onClick={handleUseDifferentSku} disabled={pending}>
        Use different SKU
      </button>
    </div>
  </div>
)}
```

**Risk if shipped:** Inline-style sprawl + missed primitive opportunity. The warn-band is the kind of cross-cutting affordance Slice 9.5 + Mark-Accepted both need; extracting now means they reuse, not reinvent. MEDIUM because of the cross-surface impact, not just the local cleanup.
