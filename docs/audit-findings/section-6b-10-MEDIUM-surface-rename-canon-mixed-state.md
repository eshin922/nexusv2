**Severity:** MEDIUM

**Dimension:** 1, 6, 8 — cross-surface naming canon

**Issue:** The post-RI.8 surface naming canon ("Cost build → Costs") is half-applied across §6.b surfaces. Internal-inconsistency examples:

1. `src/lib/nav/surface-meta.ts:53` — setup's nextMove label: **"Continue to Cost build →"** (OLD name)
2. `src/lib/nav/surface-meta.ts:100` — mark_accepted's backAction label: **"← Costs"** (NEW name)
3. `src/app/projects/[id]/quotes/[quoteId]/page.tsx:208-209` — DN callout body: **"Cost goes on Cost build."** (OLD name; preserved per Pattern 28 R7b verbatim)
4. `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:675` — leaf drawer helper: **"Cost goes on Cost build"** (OLD name; preserved per Pattern 28 R7b verbatim)
5. `surface-meta.ts:43-45` HEADER comment claims "Display labels follow Slice RI.8 surface naming canon (Costs / Pricing / Quote) even though the keys stay underscore-form for R7a continuity." — claim doesn't match all values

**The mismatch is not catastrophic — labels of "Continue to Cost build →" and "← Costs" don't disagree about WHERE the surface lives** (URL `/costs`). But PMs reading the banner say "Continue to Cost build" and then arrive at a surface titled "Costs" in the eyebrow/heading. Discoverable but slightly disorienting.

CLAUDE.md "Surface naming canon" calls the operating rule: rename surface references (anything user-facing), preserve concept references. Banner text + leaf drawer copy + DN callout copy are all surface references and should be "Costs". The setup-meta `nextMove.label` says "Cost build" — surface reference, should be "Costs".

**Canonical reference vs canon collision:** R7b canonical JSX says "Cost build" (line 53 nextMove was Edward smoke + canonical R7b designer notes literal). The cross-cutting rename canon was banked POST-R7b. Pattern 28 says copy is verbatim from designer notes — but the surface naming canon is a global rename rule that supersedes per-surface designer copy. The fix: document this collision explicitly so Pattern 28 audits don't keep re-flagging.

**Canonical reference:** `CLAUDE.md` "Surface naming canon (Slice RI.8)" + "Rename heuristic — surface refs vs concept refs" sections.

**Implementation reference:**
- `src/lib/nav/surface-meta.ts:53` (setup nextMove)
- `src/app/projects/[id]/quotes/[quoteId]/page.tsx:139-141, 208-209` (h1 sub-copy + DN callout body)
- `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:675-676` (leaf drawer italic)

**Fix proposal:** Apply surface rename canon globally to §6.b surface refs:

1. `surface-meta.ts:53`: `nextMove: { label: "Continue to Costs →" }`
2. `page.tsx:139-141`: "Cost goes on **Costs** (the next surface)." or "Cost goes on the next surface." (already says "the next surface" — verify whether to add "Costs" in parens or drop).

Looking at page.tsx 138-143:
```tsx
<p className="sub">
  The starting shape of the quote. What we&rsquo;re selling, in
  what quantities, with what context. Cost goes on the next
  surface.
  {pm?.name ? ` · PM ${pm.name}` : ""}
</p>
```
Already says "the next surface" (not "Cost build" explicitly) — this one is OK; matches the canon-aware naming.

3. `page.tsx:208-209`: "what we're selling, in what quantities, with what context. Cost goes on **Costs**. The SKU and Tier tables…"

4. `sku-row.tsx:675-676`: "Leaf SKU — single-line. Cost goes on **Costs**; this drawer is for notes and metadata."

5. **Bank in CLAUDE.md** as a clarifying note under "Surface naming canon":

```markdown
## Pattern-28-vs-rename-canon collision (banked from §6.b Step 11 audit)

When R-round designer notes / prototype copy refers to a surface by
its OLD name AND a subsequent rename canon has rebranded the
surface, the rename canon wins. Copy fidelity (Pattern 28) does NOT
override the rename for surface-reference contexts (banner labels,
helper text linking to a destination, eyebrow surface tags).

Concept references (math layer naming, audit-log keys, schema
columns, lifecycle enums) follow the original Pattern 28 / rename
heuristic — preserve concept refs even if the surface gets renamed.

Banked post-§6.b audit instance: "Cost build" → "Costs" in
nextMove label, leaf drawer helper, DN callout body. R7b canonical
JSX literal said "Cost build" but the rename canon post-dates the
prototype.
```

**Risk if shipped:** Minor PM disorientation (banner says "Continue to Cost build" → click → land on "Costs" heading). Internal inconsistency between metadata (surface-meta.ts) and surface-naming canon. MEDIUM rather than HIGH because the surface still resolves to the right route — discoverability isn't broken, just stylistic.
