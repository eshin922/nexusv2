**Severity:** LOW

**Dimension:** 3 — leaf drawer helper copy

**Issue:** The leaf drawer helper copy reads "Leaf SKU — single-line. Cost goes on Cost build; this drawer is for notes and metadata." This is verbatim from the canonical (`docs/design-prototypes/dist/7bsetup.jsx:232-234`). But the surface naming canon (CLAUDE.md "Surface naming canon (Slice RI.8)") renamed the surface "Cost build → Costs (URL /cost-build → /costs)". The label "Cost build" in the helper copy is the OLD surface name; current canon says "Costs".

Pattern 28 says copy is verbatim from designer notes. But the canon update post-dates R7b's canonical JSX. Two valid dispositions:

(A) Treat R7b canonical as fidelity contract → keep "Cost build" verbatim. R7b designer notes also say "Cost build" (line 13: "Cost goes on Cost build (the next surface).") → fidelity match.

(B) Treat the surface naming canon as a global rename that supersedes R7b → update to "Costs". The DN callout in the page head already follows path (A) ("Cost goes on Cost build."). If the leaf drawer says "Costs" and the DN callout says "Cost build" within the same screen, that's split-brain — confusing.

The implementation currently follows path (A) consistently (both DN callout and leaf drawer say "Cost build"). The surface label in the inner-rail is "Cost build" (`docs/design-prototypes/dist/7bsetup.jsx:73`: `<div className="r4-surf">Cost build</div>`) — also canonical-old-name. But the actual `<NavShell>` rail (RI.9 shipped) probably uses the new "Costs" label via SURFACE_META.

Let me verify quickly:

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/sku-row.tsx:675-677` (leaf drawer); `src/app/projects/[id]/quotes/[quoteId]/page.tsx:206-213` (DN callout); `src/components/nav/inner-rail.tsx` (rail labels — to be verified).

**Fix proposal:** Defer-with-rationale (Pattern 19). Document in CLAUDE.md or in the R7b designer notes header:

> When R7b designer notes / prototype refer to "Cost build" as a surface name, the labels need to flow through the surface naming canon (post-RI.8). New canonical label is "Costs". For verbatim-copy citations, prefer the new label; cite R7b copy as `[label-renamed: Cost build → Costs]` in commit messages.

Then update both call sites:
1. `sku-row.tsx:675` — "Leaf SKU — single-line. Cost goes on Costs; this drawer is for notes and metadata."
2. `page.tsx:208-209` — "what we're selling, in what quantities, with what context. Cost goes on Costs."

Verify the inner rail's surface label (`docs/design-prototypes/dist/7bsetup.jsx:73` → "Cost build") should also be "Costs" — but the rail is `<NavShell>` (RI.9 shipped from `SURFACE_META`); it already uses canonical "Costs" if RI.9 was properly migrated. Spot-check in `src/lib/nav/surface-meta.ts`.

Banked observation: Pattern 28 (verbatim copy fidelity) can collide with a later cross-cutting rename canon. When that happens, the rename canon wins — but document the divergence in the brief / designer notes so future Pattern 28 audits don't re-flag the rename as a fidelity gap.

**Risk if shipped:** Minor. PMs reading the page see "Cost build" but the rail/surfaces say "Costs"; mild dissonance, not blocking. LOW.
