# RI.8 navigation / workflow audit — Designer findings

**Status:** Designer agent output, May 2026. Edward + CA disposition
decision pending.

**Scope doc:** `docs/ri8-navigation-audit-scope.md` (the invocation
brief Designer was given).

**Companion:** `docs/ri8-brief-amendment.md` §12 (where this audit
sits in RI.8 planning).

**Designer competency note (per scope §4):** Designer's demonstrated
pattern is per-surface fidelity + vocabulary-consistent extensions,
NOT cross-surface workflow IA. The agent held that line honestly —
~70% of findings are within its pattern; ~30% are flagged as
structural / outside competency / probable CD R7 ask. Path
recommendation reflects the split.

---

## 0. Summary

- **13 findings total:** 9 tactical (RI.8-absorbable) + 4 structural
  (RI.9 / CD R7 / Slice 9.5)
- **Headline finding (F-1):** the inner-rail sub-rail
  (`Setup / Cost build / Costing sheet / Customer view` per-scenario
  switcher) never renders because `activeQuoteId` isn't passed in
  `src/app/projects/[id]/layout.tsx`. Brief §3.6 line 540 commits
  this as the canonical Round 4 navigation affordance. Likely the
  load-bearing source of Edward's "navigation feels clunky"
  perception — fixing F-1 alone may resolve majority of friction.
- **Designer's recommended path: Path 2** (tactical items into RI.8;
  structural items → CD R7 ask + RI.9 navigation slice).

---

## 1. Tactical findings (RI.8-absorbable)

### F-1: Inner-rail sub-rail never renders (active scenario never highlighted) — HIGH friction

- **Surfaces:** every project-scoped surface (Project Detail, Setup,
  Cost Build, Costing Sheet, Customer view, Mark-Accepted)
- **What:** `src/app/projects/[id]/layout.tsx:29` renders
  `<InnerRail projectId={id} />` and does NOT pass `activeQuoteId`.
  InnerRail (`src/components/rails/inner-rail.tsx:36-37`) needs that
  prop to compute `activeScenarioLabel` which gates the sub-rail
  expansion (lines 133-164). With `activeQuoteId === undefined`, no
  scenario ever becomes active, the sub-rail (Setup / Cost build /
  Costing sheet / Customer view links) NEVER renders, and the active
  highlight on the matching scenario row never shows.
- **Proposed fix (Option B — cleaner):** create
  `src/app/projects/[id]/quotes/[quoteId]/layout.tsx` where quoteId
  is available as a route param; thread to `<InnerRail>` there.
  Project layout keeps its existing shape; deeper quote-scoped
  layouts get the activated rail. Next 15-canonical composition.
- **Alt (Option A):** make `<InnerRail>` a client component that
  reads `useParams()` directly. Rail becomes client-side.
- **Disposition:** TACTICAL — absorb into RI.8 §11 step 4 (or
  earliest convenient slot — this is high-payoff). Option B
  preferred.

### F-2: Inner-rail "Setup" link 404s (when sub-rail is fixed)

- **Surface:** inner rail (`inner-rail.tsx:136`)
- **What:** Links to `/projects/[id]/quotes/[quoteId]/setup`. That
  route doesn't exist — Setup is the bare index at
  `/projects/[id]/quotes/[quoteId]/page.tsx`.
- **Fix:** change href to `/quotes/${s.latestQuoteId}` (drop the
  `/setup` segment). Label stays "Setup".
- **Disposition:** TACTICAL — bundle with F-1 fix.

### F-3: Inner-rail "Customer view" greyed-out with stale "ships in Slice 10" tooltip

- **Surface:** inner rail (`inner-rail.tsx:156-162`)
- **What:** Disabled span. RI.6 shipped Customer view; the surface
  is live. Tooltip is wrong.
- **Fix:** replace with `<Link>` matching the other sub-rail entries,
  href = `/projects/${projectId}/quotes/${s.latestQuoteId}/customer-view`.
- **Disposition:** TACTICAL — bundle with F-1 / F-2.

### F-4: Setup page's "Cost inputs" three-column nav strip is dead navigation

- **Surface:** Setup (`src/app/projects/[id]/quotes/[quoteId]/page.tsx:250-271`)
- **What:** Three `<CostInputLink>` cells pointing at `/packaging`,
  `/production`, `/freight`. Those routes now redirect to
  `/cost-build?section=X` (RI.4). Functionally works via redirects
  but misrepresents the IA (brief §3.5 calls for one
  "Cost Inputs becomes link to unified Cost Build page" affordance).
  Plus stale "Slice 5/6/7 — active" sub-copy.
- **Fix:** replace with one "Continue to Cost build →" affordance.
  Matches brief §3.5 + R1 design source.
- **Disposition:** TACTICAL — fits RI.8 step 1 (Setup spot-fix per
  brief §6 decision (c)). This is broken-IA cleanup, not redesign.

### F-5 (partial — tactical part): Cross-surface back-navigation inconsistency

- **Surfaces:** Setup, Cost Build, Costing Sheet, Customer view,
  Mark-Accepted — each uses a different back-nav convention
- **What:** Five surfaces, five conventions. Setup has
  `← {project.dealName}`; Cost Build has zero in-page back-nav
  (R6 deliberately stripped breadcrumb); Costing Sheet has
  `← Back to Cost Build` button in action cluster; Customer view +
  Mark-Accepted have thin top-strip text links. PMs relearn back-nav
  per surface.
- **Tactical part:** F-1 fix (inner-rail sub-rail renders) eliminates
  ~70% of the friction by giving PMs a consistent in-rail surface
  switcher.
- **Structural part:** standardizing breadcrumb pattern across all
  five quote-scoped surfaces — would re-introduce something prior
  Designer audit S-16 explicitly removed from Cost Build. Recursion
  outside Designer's competency.
- **Disposition:** SPLIT. F-1 tactical fix → RI.8. Standardization
  → F-5-structural below (RI.9 / CD R7).

### F-6: Costing Sheet "← Back to Cost Build" button competes with primary actions

- **Surface:** Costing Sheet (`costing-page-head.tsx:74-79`)
- **What:** Back affordance in the same right action cluster as
  Preview / Mark accepted (primary CTA). PMs read mixed-direction
  intent across the cluster.
- **Fix:** move "← Back to Cost Build" to the page-eyebrow
  (top-left). Eyebrow becomes a breadcrumb: `← Cost build · {client}
  / Quote v{version}`. Action cluster keeps forward-facing only.
- **Disposition:** TACTICAL — absorb into RI.8. Edward should
  confirm shape; if uncertain, escalate to CD R7 since R2 source
  doesn't sketch this exact configuration. Designer's read: the
  move is conservative + matches existing R2 eyebrow grammar.

### F-7: Customer view + Mark-Accepted breadcrumbs use raw inline-text styling

- **Surfaces:** Customer view (`customer-view/page.tsx:237-251`),
  Mark-Accepted (`mark-accepted/page.tsx:165-186`)
- **What:** Raw `<div style={{ padding, fontSize: 13 }}>` with
  inline `<Link style={{ color: "var(--ink-3)" }}>`. Bypasses the
  design token register.
- **Fix:** apply `.r2-eyebrow` or equivalent mono-caption token +
  spacing rhythm. Reference shape: Mark-Accepted Host top strip
  (`mark-accepted-host.tsx:81-93`) — already correct register.
- **Disposition:** TACTICAL — absorb into RI.8 dark-mode-sweep step
  or per-surface polish pass.

### F-9: Project Detail scenario card "Open" routes only to Costing Sheet

- **Surface:** Project Detail (`projects/[id]/page.tsx:377-382`)
- **What:** Single "Open" button → `/costing`. PMs adding inputs
  want Cost Build; the extra hop adds noise. Costing Sheet is right
  for *reviewing* but not for *building*.
- **Fix (proposed):** dual-affordance per scenario card —
  "Open · Costing" + "Build" both visible. Additive (no removal).
- **Disposition:** TACTICAL-ISH. Edward + CA's call on whether the
  dual-link shape lands or stays single-link. Designer's read:
  dual link is small + clearly better.

### F-12: Inner-rail "Activity" placeholder reads as broken

- **Surface:** inner rail (`inner-rail.tsx:216-223`)
- **What:** Section shows "Mini feed — RI.3" as italic placeholder.
  RI.3 shipped; mini feed was deferred. PMs read "RI.3" and conclude
  the rail is half-built.
- **Fix:** wire the mini activity feed. Data exists —
  `getProjectActivity` is already called by Project Detail at
  `projects/[id]/page.tsx:62-66`; same query with smaller limit
  drives the rail. Brief §3.6 line 535 commits this.
- **Alt:** remove the placeholder section entirely until ready
  (cheap fix).
- **Disposition:** TACTICAL — either option fits RI.8 polish.
  Designer recommends wiring (option a); ~half-day work.

---

## 2. Structural findings (RI.9 / CD R7 / out-of-Designer-competency)

### F-5 (structural part): Cross-surface breadcrumb standardization

- **What:** Standardizing breadcrumb shape across Setup / Cost Build /
  Costing Sheet / Customer view / Mark-Accepted requires re-introducing
  a breadcrumb on Cost Build that R6 source intentionally stripped
  (per code comment + prior Designer audit S-16). Designer cannot
  resolve unilaterally — it's a CD intent question.
- **Disposition:** STRUCTURAL — Edward + CA call. Likely CD R7 ask
  or RI.9 navigation slice.

### F-8: Home → quote re-entry pattern (no "resume last quote" affordance)

- **Surface:** Home (`src/app/page.tsx`), Project Detail
- **What:** PMs working same scenario over multiple sessions: Home
  → outer-rail-Recent (projects, not quotes) → Project Detail →
  scenario card → Open → Costing Sheet. Four clicks. Round 4's
  "What's my move" inbox was designed for exactly this gap; it's
  currently a placeholder (deferred to Slice 9.5).
- **Disposition:** STRUCTURAL — outside Designer competency
  (feature decision). Either wait for Slice 9.5 inbox or design
  smaller extension (e.g., Recent rail shows recent scenarios not
  just projects). Edward + CA call.

### F-10: Cost Build has zero in-page back-nav (R6 deliberately stripped)

- **Surface:** Cost Build (`cost-build-header.tsx`)
- **What:** R6 anchors page identity on FUNCTION; intentionally
  strips breadcrumb + status pill. PMs depend on inner rail (broken
  per F-1) or browser back. Once F-1 is fixed, this is mostly
  resolved.
- **Disposition:** STRUCTURAL CONDITIONAL — only matters if F-1's
  sub-rail wiring doesn't fully land. Verify after F-1 ships.

### F-11: Customer view + Mark-Accepted shed inner rail or keep it?

- **Surfaces:** Customer view, Mark-Accepted
- **What:** Both inherit the project layout's inner rail. Customer
  view's PdfPage is full-bleed-ish; Mark-Accepted's `macc-stage` is
  also full-bleed and presents as focused modal-flavored surface.
  The 240px rail reads as workflow tool — appropriate for Cost Build
  / Costing Sheet but jarring on customer-preview / confirmation-flow
  surfaces.
- **Disposition:** STRUCTURAL — IA question Designer cannot decide
  unilaterally. CD R7 territory.

### F-13: Workflow continuity — sent → customer-signal → Mark-Accepted has no forward-pointing affordance

- **Surfaces:** Costing Sheet, Customer view, Mark-Accepted
- **What:** No per-surface "next move" affordance after PM sends a
  quote. Round 4's "What's my move" inbox is the canonical home.
- **Disposition:** STRUCTURAL — defer to Slice 9.5 inbox work.
  Flag to Edward + CA.

---

## 3. Designer's recommended disposition path

**Path 2 — split tactical/structural:**
- Dispose F-1, F-2, F-3, F-4, F-5-tactical, F-6, F-7, F-9, F-12
  into RI.8 §11 steps. Cheapest cluster (F-1+F-2+F-3 is one fix
  worth ~half a day) produces outsized PM-experience improvement.
- Package F-5-structural, F-8, F-11, F-13 as a CD R7 IA ask + create
  RI.9 navigation slice as implementation home. F-10 is conditional
  on F-1 — verify post-F-1.

**Alt paths:**
- Path 1: dispose tactical only; defer structural without RI.9
  commitment. Tactical items fix the felt friction; structural
  decisions wait.
- Path 3 (not recommended): defer all 13 to RI.9 / R7. F-1 alone is
  a 1-hour fix; deferring loses outsized payoff.

**Designer's call: Path 2.** F-1 is responsible for most of the felt
friction; the per-surface tactical items are cheap + additive. The
structural items deserve CD's IA pass rather than agent extrapolation.

---

## 4. CD R7 ask framing (if Edward + CA route to CD)

Suggested ask shape per Designer:

> "Per-surface fidelity isn't the problem — the problem is the
> connections between surfaces. R7 design pass on:
> (a) Home-to-quote re-entry pattern,
> (b) inner-rail surface-visibility rules across the IA arc,
> (c) per-surface 'next move' affordance vs centralized inbox,
> (d) breadcrumb standardization across quote-scoped surfaces
>     (with attention to R6's deliberate omission on Cost Build),
> (e) action button cluster grammar across quote-scoped surfaces
>     (Cost Build header, Costing Sheet head, Customer view
>     toolbar, Mark-Accepted header) — hierarchy, grouping,
>     primary CTA placement, direction consistency."

These are the F-5-structural / F-8 / F-11 / F-13 items framed for
CD's IA-level review.

**(e) origin:** Edward's RI.8 step 0 smoke surfaced Costing Sheet
action cluster ergonomics — the Preview / customer-accept /
Mark-Accepted trio lacks visible hierarchy. Customer-accept is a
workflow prereq for Mark-Accepted (sequenced steps); Preview is
a sideways look-at; clustering grammar doesn't currently signal
either relationship. Navigation audit scope §2.2 asked about
"action button placement consistency" but Designer's findings
(F-6) only covered back-nav placement; cluster grammar across
quote-scoped surfaces went unanswered. Extended the ask shape
rather than spinning a separate audit cycle — same competency
split applies (per-surface fidelity Designer can do;
cross-surface grammar is IA judgment).

---

## 5. Disposition — RESOLVED (Edward + CA, May 2026)

- [x] **Path 2 selected** — Designer's recommendation.
- [x] **CD R7 ask scope confirmed:** the 4 items in §4 above (Home
      re-entry / rail visibility / next-move / breadcrumb
      standardization). Routes to human CD when ready.
- [x] **RI.9 navigation slice opens** once CD lands IA direction;
      F-5-structural / F-8 / F-11 / F-13 land there with CD R7
      output as kickoff scope.

**Tactical-finding sub-decisions:**
- **F-1 Option B** — create `/projects/[id]/quotes/[quoteId]/layout.tsx`
  for cleaner Next 15 layout composition. Watch for double-rail
  render risk; scope the render to quote layout only.
- **F-1 + F-2 + F-3 ship as FIRST COMMIT** on slice-ri.8, BEFORE
  the larger admin rebuild. Headline fix that reframes everything
  else.
- **F-9:** dual-affordance per scenario card ("Open · Costing" +
  "Build" both visible).
- **F-12:** wire mini activity feed via existing
  `getProjectActivity` with smaller limit (option a).
- **F-6:** move "← Back to Cost Build" to Costing Sheet page-eyebrow
  as breadcrumb (R2 grammar).
- **F-10:** conditional — verify post-F-1 fix; if sub-rail wiring
  resolves Cost Build's back-nav gap, F-10 closes without separate
  work.

**Methodological banking:** Designer's honest limit-flagging
behavior on this audit (caught structural F-1 within pattern;
surfaced IA-level questions outside pattern as clean CD R7 ask)
banked as working principle 9 in `docs/designer-agent-prompt.md`.
Both behaviors reinforced for future scope briefs.

Dependent RI.8 brief amendment subscopes revised. slice-ri.8
branches off main with the three RI.8 prereq docs as first commit;
F-1 + F-2 + F-3 fix as second commit.
