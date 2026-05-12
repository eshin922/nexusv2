# Slice RI.9 brief skeleton — Navigation IA implementation

**Status:** SKELETON — drafted post-RI.8 close (May 2026) while
context is fresh from the navigation audit findings. Section
content for CD R7 items (a-e) is placeholder until CD lands the
actual design output. Once CD R7 ships, replace the placeholders
with referenced commitments + flesh out implementation specs.

**Branch:** opens off main once CD R7 lands. Not yet created.

**Slice anchor:** brief amendment §11 step 12 closure deferred to
this slice — RI.8 carried the tactical findings; RI.9 carries the
structural findings.

---

## 1. Scope statement

RI.9 implements the four navigation-IA structural findings
deferred from Slice RI.8 + CD R7 design output for cross-surface
nav patterns. This is the second half of the navigation audit
disposition (RI.8 carried the tactical findings F-1 / F-2 / F-3 /
F-4 / F-5-tactical / F-6 / F-7 / F-9 / F-12).

**In scope:**

- F-5-structural — cross-surface breadcrumb standardization
- F-8 — Home → quote re-entry pattern ("resume last quote")
- F-11 — Customer view + Mark-Accepted inner rail visibility
- F-13 — forward-pointing workflow continuity (sent → customer
  signal → Mark-Accepted)
- CD R7 nav IA design output items (a-e) — see §3 below
- Setup CD R7 ask output (separate scope from nav IA per Edward +
  CA Gate 3 disposition, but Setup is consumed by the nav-IA
  Setup affordance so coordinated)

**Out of scope:**

- Per-surface fidelity refinements (Designer Pattern 1 audits
  during build, as usual)
- RI.9.5 cross-surface design audit (Edward deferred to its own
  scope; not blocked on RI.9 — could run in parallel)

---

## 2. Structural findings (already captured)

Reference: `docs/ri8-navigation-audit-findings.md` §2 for full
context. Summary:

### F-5-structural — Cross-surface breadcrumb standardization

Surfaces are inconsistent on breadcrumb format/presence:
- Costs (R6) deliberately strips breadcrumb
- Pricing (R2) has eyebrow breadcrumb (`← Costs · Pricing · ...`)
  after RI.8 F-6 fix
- Quote / Mark-Accepted (R3) have `.r2-eyebrow` register
  breadcrumbs after RI.8 F-7 fix

CD R7 decides:
- Is R6's "no breadcrumb" deliberate-and-keep, or
  oversight-and-add?
- If keep, what's the surface IA signal that replaces it?
- If add, what register matches R6's restraint?

### F-8 — Home → quote re-entry pattern

Today PMs return to Home and have to re-navigate to find their
in-progress quote. "Resume last quote" or recent-activity
quote-row affordance would close the gap.

CD R7 decides:
- Surface placement (Home page top-level, or rail-only?)
- Granularity (last quote vs last 3 vs last activity timestamp)
- Triggers / persistence model

### F-11 — Customer view + Mark-Accepted inner rail

These surfaces inherit project layout's inner rail. Customer view
is a focused render-the-PDF surface; rail may be noise. Mark-
Accepted is a confirmation surface with multiple sub-states; rail
context may help OR may compete.

CD R7 decides:
- Shed inner rail entirely on customer view? Keep on Mark-
  Accepted?
- If shed, what's the "where am I" signal?
- Conditional on sub-state for Mark-Accepted?

### F-13 — Forward-pointing workflow continuity

Sent quote → customer signal → Mark-Accepted is a workflow chain
but has no forward-pointing affordance. PM completes one step and
must remember to advance.

CD R7 decides:
- "Next: record customer response" pill on sent quote view?
- Pricing-surface forward-action after send?
- Notification register vs in-page affordance?

---

## 3. CD R7 items (placeholders — replace when CD lands)

Per `docs/ri8-navigation-audit-findings.md` §4, suggested ask
shape was:

> (a) Home-to-quote re-entry pattern
> (b) inner-rail surface-visibility rules across the IA arc
> (c) per-surface 'next move' affordance vs centralized inbox
> (d) breadcrumb standardization across quote-scoped surfaces
>     (with attention to R6's deliberate omission on Cost Build)
> (e) action button cluster grammar across quote-scoped surfaces
>     (Costs header, Pricing head, Quote toolbar, Mark-Accepted
>     header) — hierarchy, grouping, primary CTA placement,
>     direction consistency

Item (f) — customer-facing notes authoring placement — relocated
INTO the separate Setup R7 ask per Edward + CA Gate 3 disposition.

**Once CD R7 lands:**

- [ ] Replace each (a)-(e) placeholder with referenced CD output
  + extracted-source path
- [ ] Flesh out per-item implementation spec (component changes,
  schema impact if any, audit-log integration, dark-mode
  treatment)
- [ ] Map (a)-(e) to specific F-5/F-8/F-11/F-13 commitments where
  applicable

---

## 4. Dependencies

### Blockers (slice can't open until these resolve)

- **CD R7 nav IA design output** delivered for items (a)-(e).
  Routed via Edward + CA Gate 4.
- **Setup CD R7 design output** delivered (task #149 routing
  pending Gates 2 + 4). Setup is consumed by the nav-IA Setup
  affordance, so coordinated kickoff makes sense even though
  scopes are separate.

### Adjacent

- **Designer-invocation durable fix** (task #140) — addressed in
  RI.8 step 11 closure. designer-agent-prompt.md now carries
  Working Principles 10 + 11 (comprehensive audit pattern +
  coverage gap signaling). Future Designer invocations during
  RI.9 implementation use the corrected pattern.
- **RI.9.5 design audit slice** — separately scoped per Edward;
  can run in parallel with RI.9 implementation (different scope,
  no blocking dependency).

### What RI.9 implementation does NOT block

- RI.8 cost-stack architecture pass already shipped (per-component
  markup primitives, freight markup feature). RI.9 doesn't touch
  the math layer.
- Theme toggle / dark mode infrastructure already shipped.
  RI.9 surfaces apply existing tokens.

---

## 5. Expected methodological patterns

Carry forward from RI.8 + earlier slices:

1. **Region-scope over trigger-scope** when smoke surfaces
   multiple architectural-region issues (CLAUDE.md pattern banked
   from RI.8 cost-stack pass).
2. **Comprehensive Designer audit against extracted source +
   single smoke at end** (designer-agent-prompt.md Working
   Principle 10). For each new surface RI.9 touches, run one
   comprehensive audit, not iterative.
3. **Coverage gap signaling** for cross-cutting dimensions
   (iconography, motion, density) per Working Principle 11.
4. **Defer-with-rationale** when divergence reflects structural
   difference; don't force uniform treatment.
5. **Surface refs vs concept refs** for any rename cascades
   (CLAUDE.md heuristic — applied during RI.8 surface rename;
   reapply if RI.9 spawns new naming questions).
6. **Functional dependency check before dropping an affordance**
   (CLAUDE.md pattern; especially relevant if F-11 disposition
   removes inner rail on customer view — what writes the data
   that rail surfaces?).
7. **Two computations for similar-labeled displays will diverge**
   (CLAUDE.md pattern banked from RI.8 cost-stack semantic
   mismatches; relevant if RI.9 adds new derived display
   surfaces).
8. **Blur+Enter autosave pattern** (Slice RI.8 freight surface
   established; applies to any new editable surfaces RI.9
   introduces).

---

## 6. Step sequencing (placeholder)

To be fleshed out post-CD-R7. Expected shape mirrors RI.8 §11:

1. **Step 0** — branch kickoff + prereq sweep
2. **Step 1** — F-5-structural implementation per CD R7 (d)
3. **Step 2** — F-8 implementation per CD R7 (a)
4. **Step 3** — F-11 implementation per CD R7 (b)
5. **Step 4** — F-13 implementation per CD R7 (c)
6. **Step 5** — action cluster grammar per CD R7 (e) — touches
   Costs / Pricing / Quote / Mark-Accepted headers
7. **Step 6** — Setup CD R7 implementation (coordinated)
8. **Step 7** — Designer audit (Pattern 1 comprehensive across
   touched surfaces)
9. **Step 8** — Smoke + bug fix
10. **Step 9** — PR-to-main

---

## 7. Open questions (resolve at kickoff)

- **Bundle scope:** ship F-5/F-8/F-11/F-13 as one slice (RI.9),
  or split into RI.9a (nav IA) + RI.9b (Setup)? Decision depends
  on CD R7 output coupling.
- **RI.9.5 timing:** does it open before, during, or after RI.9?
  Recommendation: after — RI.9 changes inform RI.9.5 audit scope.
- **Slice 12 (Mark-Accepted writeback)** ordering: post-RI.9
  navigation work? Or independent? F-13 forward-pointing
  affordance is adjacent to Slice 12's Mark-Accepted workflow.
- **Setup §6.b R7 ask outcome:** if Setup gets a substantial
  redesign, RI.9 step 6 grows; if Setup stays close to current
  with Notes-only treatment, step 6 is small.

---

## Reference docs

- `docs/ri8-navigation-audit-findings.md` — full audit findings,
  §2 structural, §4 CD R7 ask framing, §5 disposition
- `docs/ri8-brief-amendment.md` §12 — RI.8 + RI.9 split disposition
- `docs/ri8-setup-cd-r7-ask.md` — Setup R7 ask (related but separate)
- `docs/designer-agent-prompt.md` — Working Principles 1-11
- `CLAUDE.md` — methodological patterns (region-scope, defer-with-
  rationale, coverage-gap-signaling, surface-unification orphaning,
  two-computations-diverge)
