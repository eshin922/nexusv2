**Severity:** MEDIUM

**Dimension:** 4 — tier ★ Recommended toggle

**Issue:** The canonical R7b prototype renders `★ recommended` as a DISPLAY-ONLY span below the tier label when `t.recommended === true`. Designer notes Decision 5 + brief §3.4 specify the toggle behavior ("click toggles; clicking on one row unsets siblings") but the canonical JSX doesn't render the toggle UI (`docs/design-prototypes/dist/7bsetup.jsx:286-289`):

```jsx
<div className="label">
  <span className="lab">{t.label}</span>
  {t.recommended && <span className="rec">★ recommended</span>}
</div>
```

The implementation extends this with:
- `<button className="rec rec-clickable">★ recommended</button>` when recommended (click-to-clear)
- `<button className="rec-set">☆ mark recommended</button>` (hover-revealed) when not recommended

The hover-reveal pattern is documented in `r1-setup.css:147-183` as a nexus extension. Discoverability concern: PMs viewing a tier table with NO recommended tier set see no affordance at rest — only on hover. For a brand-new tier (preset just applied; recommended=middle tier), the "mark recommended" affordance for the OTHER tiers is invisible until hover. PMs need to know which tiers can be marked recommended; hover-only-reveal forces serial hover-discovery.

**Compounding issue:** The `.rec-set` selector chain in `r1-setup.css:171-176` has a duplication artifact:

```css
.r7b-tier-row:hover .r7b-tier-row .label .rec-set,  /* malformed — would require nesting */
.r7b-tier-row:hover .rec-set,                       /* this is the one that works */
.r7b-tier-row .label .rec-set:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
```

The first selector `.r7b-tier-row:hover .r7b-tier-row .label .rec-set` is a typo (.r7b-tier-row inside .r7b-tier-row never matches). Doesn't break anything (the second selector covers it), but it's dead code.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:286-289`; brief `docs/section-6b-brief.md:175-181`.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx:139-161` + `src/styles/r1-setup.css:147-183`.

**Fix proposal:**

1. **Replace hover-reveal with always-visible ghost ☆ affordance.** PMs scanning the tier table at rest can see at-a-glance: which tier IS recommended (filled ★ in accent) AND which tiers CAN be recommended (ghost ☆ in ink-4). Click on ghost ☆ promotes that tier (and clears the sibling). This is a discoverability win at the cost of mild visual noise.

```css
/* Replace .rec-set hover-revealed → always-visible ghost */
.r7b-tier-row .label .rec-set {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--mono); font-size: 9px; letter-spacing: 0.10em;
  text-transform: uppercase; color: var(--ink-4);
  background: transparent; border: 1px solid transparent;
  border-radius: 3px; padding: 1px 4px; margin: -1px -4px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.r7b-tier-row .label .rec-set:hover:not(:disabled) {
  color: var(--accent-ink);
  border-color: oklch(from var(--accent) l c h / 0.40);
}
.r7b-tier-row .label .rec-set:disabled {
  cursor: default; opacity: 0.4;
}
```

Then remove the hover-show/opacity-0 transition rules.

2. **Clean up the malformed selector.** Drop `.r7b-tier-row:hover .r7b-tier-row .label .rec-set` from the rule chain entirely.

3. **Audit the always-visible variant for visual noise.** If 3-4 ghost ☆ on a 4-tier preset is too noisy, fall back to a "Mark recommended" overflow-menu entry in the row's actions cluster (canonical R7b shows only `×` delete button in that cell — extending with a dropdown is a Pattern 19 disposition).

**Risk if shipped:** PMs scanning a freshly-preset-applied tier table see no path to change which tier is recommended. They must hover row-by-row to discover the affordance. For a 4-tier-step preset where T2 is recommended by default, "make T3 recommended instead" requires hover→click on T3 — 1-step but undiscoverable until they try.
