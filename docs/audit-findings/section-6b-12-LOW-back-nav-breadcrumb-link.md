**Severity:** LOW

**Dimension:** 1 — back-nav above page head

**Issue:** Implementation renders a Tailwind-styled back link ABOVE the `.r7b-head` block (`page.tsx:99-106`):

```tsx
<div className="mb-2 text-sm">
  <Link
    href={`/projects/${project.id}`}
    className="text-ink-3 hover:text-ink"
  >
    ← {project.dealName}
  </Link>
</div>
```

The canonical R7b page-head structure (`docs/design-prototypes/dist/7bsetup.jsx:86-107` for PageHead, line 459-461 in main SetupPage:
```jsx
return (
  <div className="r7b-page">
    <PageHead />
    <NextMove />
    …
```
) starts directly with the eyebrow inside `.r7b-head`. No "← {dealName}" back link above.

The back link is a nexus extension for project-level navigation. R7a's load-bearing rule: rail XOR breadcrumb per surface, never both. Setup has `railVisible: true` (per `surface-meta.ts:49`), so breadcrumb should NOT render here. The back link is breadcrumb-like.

**Pattern 21 + XOR rules collision:** R7a's XOR enforcement (RI.9 `<NavShell>` + `<SurfaceChrome>` ships this) says rail XOR breadcrumb. The back link above `.r7b-head` looks like a breadcrumb-flavored affordance bypassing the rule. Two valid dispositions:

(A) The back link is informational, not navigational — semantic "where am I" affordance for PMs landing at this URL fresh. Keep, document as Pattern 19 nexus extension.

(B) The back link duplicates the outer-rail's project context (PM clicks the project marker in the rail to return). Remove.

Implementation chose path (A) without documenting it. R7b canonical doesn't have it.

**Canonical reference:** `docs/design-prototypes/dist/7bsetup.jsx:459-461` — `SetupPage` body starts with `<PageHead />` directly, no breadcrumb/back-link element above.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/page.tsx:99-106`

**Fix proposal:** Pattern 19 disposition — keep the back link with rationale, OR drop it.

If keeping: document in r1-setup.css and use canonical mono register so it matches the eyebrow visually (currently uses `text-sm` which is 14px — too prominent against the 10px mono eyebrow below it):

```css
/* §6.b — back-link above page head (nexus extension for direct-URL
   landing navigation). Canonical R7b doesn't include this; rail's
   project marker is the primary "go to project" affordance. Pattern
   19 disposition: keep for direct-URL navigation; visually match
   eyebrow register so it doesn't compete with the h1 title. */
.r7b-back-link {
  display: inline-flex; align-items: center; gap: 4px;
  margin-bottom: 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--ink-3);
  text-decoration: none;
}
.r7b-back-link:hover { color: var(--ink); }
```

JSX:

```tsx
<Link href={`/projects/${project.id}`} className="r7b-back-link">
  ← {project.dealName}
</Link>
```

If dropping: remove lines 99-106 entirely.

**Recommended:** Keep with rationale (PMs landing via direct URL benefit from the back-nav; rail-only navigation requires PMs to know where the rail is, which is fine for muscle memory but not for first-visit). Convert to canonical mono register.

**Risk if shipped:** Mild visual noise (one element in tailwind register sitting above canonical CSS). Doesn't break anything; nothing PMs will complain about. LOW.
