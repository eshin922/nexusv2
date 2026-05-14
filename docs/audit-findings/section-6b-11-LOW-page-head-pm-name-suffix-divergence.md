**Severity:** LOW

**Dimension:** 1 — page head sub-copy

**Issue:** Page-head sub-copy in implementation includes a PM name suffix not present in the canonical (`page.tsx:138-143`):

```tsx
<p className="sub">
  The starting shape of the quote. What we&rsquo;re selling, in
  what quantities, with what context. Cost goes on the next
  surface.
  {pm?.name ? ` · PM ${pm.name}` : ""}
</p>
```

The trailing `· PM {name}` appears AFTER a period — reading as a separate clause appended to the sentence. Canonical doesn't show this (canonical mock data doesn't include a PM name field in the page head).

Pattern 19 disposition: nexus extension to surface ownership context (PMs care WHO owns the quote, especially across the 12-person team). Justifiable, but the placement is awkward — middle of a flowing sub-copy paragraph.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:97-99` —

```jsx
<p className="sub">The starting shape of the quote. What you're selling, in what quantities, with what context. Cost goes on the next surface.</p>
```

(Also note: canonical says "What **you're** selling"; implementation says "What **we're** selling" per Edward's first-person-plural disposition from §6.b smoke. Preserved per page.tsx:119-120 commit comment. That's intentional and correct.)

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/page.tsx:138-143`

**Fix proposal:** Move PM context into the eyebrow line (where it joins client / scenario / version):

```tsx
<div className="eyebrow">
  {project.clientName ?? project.dealName}
  <span className="sep">·</span>
  {quote.scenarioLabel}
  <span className="sep">·</span>
  v{quote.versionNumber} draft
  {pm?.name && (
    <>
      <span className="sep">·</span>
      PM {pm.name}
    </>
  )}
</div>
<h1>
  Setup <em>· SKUs, tiers, notes</em>
</h1>
<p className="sub">
  The starting shape of the quote. What we&rsquo;re selling, in
  what quantities, with what context. Cost goes on Costs.
</p>
```

This puts PM name in the mono-uppercase eyebrow register (where it belongs as metadata) and keeps the sub-copy as flowing prose. Matches the R7a Eyebrow grammar shipped in RI.9 — "{client} · {scenario} · v{N} draft" can carry additional ` · {role} {name}` chips without breaking the register.

**Risk if shipped:** Awkward placement of PM name in sub-copy. Doesn't break anything; minor stylistic. LOW.
