# Rest-of-App Fidelity Sweep — Source Completeness Review

**Date:** 2026-05-13
**Branch:** main (post-§6.b merge)
**Purpose:** Pre-brief completeness check for the rest-of-app fidelity
sweep slice. Verifies on-disk source files against the 5 surfaces the
sweep will cover, surfaces gaps before brief drafting.

**Status (2026-05-13 update):** All 5 surfaces GREEN. Edward added
R2 + R3 designer notes + data-source maps (`r2-designer-notes.md`,
`r2-data-source-map.md`, `r3-designer-notes.md`,
`r3-data-source-map.md`) closing the three gaps from the initial
review. **Brief drafting unblocked; Path A (proceed with
dual-canon convention) is the path taken.**

## Per-surface verification matrix

| Surface | HTML shell | Source JSX + data | Canonical CSS | Designer notes | Data-source map | RI.9 canon reflected | Overall |
|---|---|---|---|---|---|---|---|
| **Cost build (Costs)** — R6 body / RI.9 chrome | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (impl) | **✅ GREEN** |
| **Costing (Pricing)** — R2 body / RI.9 chrome | ✅ | ✅ | ✅ (2styles.css) | ✅ (r2-designer-notes.md, added 2026-05-13) | ✅ (r2-data-source-map.md, added 2026-05-13) | ✅ (impl) | **✅ GREEN** |
| **Customer view (Quote)** — R3 body / RI.9 chrome | ✅ | ✅ | ✅ (3styles.css) | ✅ (r3-designer-notes.md, added 2026-05-13) | ✅ (r3-data-source-map.md, added 2026-05-13) | ✅ (impl) | **✅ GREEN** |
| **Mark Accepted** — R3 body / RI.9 chrome | ✅ | ✅ | ✅ (3styles.css, shared) | ✅ (r3-designer-notes.md, shared) | ✅ (r3-data-source-map.md, shared) | ✅ (impl) | **✅ GREEN** |
| **Home** — R4 (Lumen) body / RI.9 chrome | ✅ | ✅ | ✅ (4bstyles.css) | ✅ | ✅ | ✅ (impl) | **✅ GREEN** |

Legend: ✅ on disk + ready for sweep · ⚠️ on disk but partial / older · ❌ missing

**Note on RI.9 canon:** Pre-R7 designer notes (R2/R3/R4/R5/R6) predate
RI.9 nav primitives by design. The sweep operates under a **dual-canon
discipline**: RI.9 + R7a/R7b implementation is canon for page chrome
(eyebrow, back-link, action cluster, next-move banner, surface rename);
the per-surface design source is canon for surface body register
(tables, drilldowns, content layout, copy). Banked as candidate
Pattern 37 in the brief.

---

## Surface-by-surface detail

### 1. Cost build (Costs) — R6 ✅

- **HTML shell:** `docs/design-prototypes/dist/Nexus Round 6.html` ✅
- **JSX source files (all on disk):**
  - `r6_page.jsx` ✅
  - `r6_cost-stack.jsx` ✅
  - `r6_section.jsx` ✅
  - `r6_packaging.jsx` ✅
  - `r6_production.jsx` ✅
  - `r6_freight.jsx` ✅
  - `r6_bulk-raw.jsx` ✅
  - **Extracted at `dist/source/round-6/`** with `cost-build-page.jsx`,
    `cost-stack-header.jsx`, `packaging-drawer.jsx`, etc. (Pattern 30
    grep-able) ✅
- **Data files:** `r6_data.js` ✅, `r6_data.bulk-raw.js` ✅
- **Canonical CSS:** `6styles.css` ✅ — **already migrated to
  `src/styles/r6-cost-build.css` verbatim in §6.b Costs path-B
  commits 1-5/5.**
- **Designer notes:** `docs/r6-designer-notes.md` (14 KB) ✅
- **Data-source map:** `docs/r6-data-source-map.md` (10 KB) ✅
- **RI.9 canon:** Partial — `r6_page.jsx` already implements eyebrow
  + nextMoveBanner per RI.9. Designer notes reference R7a / R7b nav
  primitives. **No additional CD work needed for Cost build sweep.**

**Status: GREEN.** The §6.b Costs path-B migration consumed this
source. Rest-of-app sweep for Costs would be a fidelity-audit pass
against the now-shipped canonical CSS — minor adjustments only.

### 2. Costing (Pricing) — expected R5/R6, on-disk R2 ❌

- **HTML shell:** `Nexus Round 2.html` exists ✅ but no R5/R6
  equivalent for Pricing surface. R5 prototype covers Admin only;
  R6 prototype covers Cost build only.
- **JSX source files (on disk, but R2-era):**
  - `r2_costing.jsx` (27 KB; old `TwoAxisVerdict` pattern;
    pre-RI.9-chrome) ⚠️
  - `r2_build.jsx`, `r2_datamap.jsx`, `r2_notes.jsx`, `r2_shell.jsx`,
    `r2_data.js` ⚠️
  - **Extracted at `dist/source/round-2/app/r2/`** ✅
- **Canonical CSS:** `2styles.css` (18 KB) ⚠️ — predates RI.9; only
  partial mapping to current Pricing impl
- **Designer notes:** **`r2-designer-notes.md` does NOT exist** ❌
  (no Round-2 designer notes in `dist/docs/`; only r4 / r5 / r6 /
  r7a / r7b / round-3 notes are present)
- **Data-source map:** **`r2-data-source-map.md` does NOT exist** ❌
- **RI.9 canon:** Pricing's RI.9 chrome (eyebrow + back-link + action
  cluster + "Pricing" rename canon) lives in IMPLEMENTATION code
  (`src/components/pricing/pricing-page-head.tsx`); design source
  R2 predates it.

**Status: GAP.** Pricing's design-source authority is the R2 prototype,
which predates RI.9 + the surface rename canon. Sweep can proceed
treating implementation as canon for chrome and R2 design as canon
for body (table register, verdict pills, etc.) — but Edward + CA need
to disposition whether to:
- (a) **Accept R2 + impl-as-chrome-canon** and proceed
- (b) **Request CD refresh** of Pricing to a current-canon round
  (would slot in as R5.5 / R6.5 / R8 — TBD)
- (c) **Strip R2 + use impl as full canon** (no design-source
  reference; risky — drift accumulates without prototype anchor)

### 3. Customer view (Quote) — expected R5/R6, on-disk R3 ❌

- **HTML shell:** `Nexus Round 3.html` ✅
- **JSX source files (on disk, R3-era):**
  - `r3_customer-view.jsx` (15 KB) ⚠️
  - `r3_data.js` (8 KB) ⚠️
  - **Extracted at `dist/source/round-3/customer-view.jsx`** ✅
- **Canonical CSS:** `3styles.css` (22 KB) ⚠️ — predates RI.9
- **Designer notes:** `round-3-designer-notes.md` (17 KB) ⚠️ — uses
  OLD surface naming ("Customer view" not "Quote"; "Cost Build" not
  "Costs"; "Costing Sheet" not "Pricing"). Heavy "Mark-Accepted"
  copy throughout.
- **Data-source map:** `round-3-data-source-map.md` (13 KB) ⚠️
- **RI.9 canon:** Quote's RI.9 chrome (eyebrow + back-link to Pricing
  + Quote PDF presentation) lives in IMPLEMENTATION
  (`src/components/quote/quote-host.tsx` etc.); design source R3
  predates it AND uses the pre-rename surface name "Customer view".

**Status: GAP.** Same shape as Pricing — disposition needed on
R3-as-canon vs CD refresh vs impl-as-canon.

### 4. Mark Accepted — expected R5/R6, on-disk R3 ❌

- **HTML shell:** `Nexus Round 3.html` ✅ (shared with Customer view)
- **JSX source files (on disk, R3-era):**
  - `r3_mark-accepted.jsx` (32 KB) ⚠️
  - `r3_data.js` (shared with customer-view) ⚠️
  - **Extracted at `dist/source/round-3/mark-accepted-flow.jsx`** ✅
- **Canonical CSS:** `3styles.css` ⚠️ (shared)
- **Designer notes:** `round-3-designer-notes.md` ⚠️ (shared) — uses
  pre-RI.9 chrome conventions; "Mark-Accepted" with hyphen vs current
  "Mark Accepted"
- **Data-source map:** `round-3-data-source-map.md` ⚠️
- **RI.9 canon:** Mark Accepted's RI.9 chrome lives in
  `src/components/mark-accepted/`; design source R3 predates it.
  Mark-Accepted has its own state machine (draft → pending → accepted
  / rejected); R3 designer notes lock the pending-state Cost Build
  freeze commitment + writeback infra outline that informs the
  combined writebacks slice queued after this sweep.

**Status: GAP.** Same shape as Pricing/Quote — disposition needed.

### 5. Home — R4 (Lumen) ✅

- **HTML shell:** `Nexus Round 4.html` ✅
- **JSX source files (on disk):**
  - `r4_organizer.jsx` (Deal organizer / Home main view) ✅
  - `r4_project-detail.jsx` (Project detail page) ✅
  - `r4_rail.jsx` (two-tier nav rail) ✅
  - `r4_copy-ops.jsx` (Copy-from-existing-quote modal) ✅
  - `r4_data.js` ✅
  - **No `dist/source/round-4/` extracted directory** — but loose
    JSX files at dist root are grep-able. Pattern 30 satisfied
    without extraction.
- **Canonical CSS:** `4bstyles.css` (34 KB; "4b" suffix suggests
  CD shipped a "4a" + "4b" variant; only 4b on disk) ✅
- **Designer notes:** `r4-designer-notes.md` (10 KB) ✅ — uses
  pre-rename surface names ("Cost build / Costing sheet / Customer
  view") but Home itself doesn't render those labels.
- **Data-source map:** `r4-data-source-map.md` (8 KB) ✅
- **RI.9 canon:** Home's RI.9 chrome (action cluster grammar, Resume
  card, inbox-next-move) was implemented during RI.9 step 4-6 +
  9; the design source R4 predates RI.9 but the implementation
  carries those primitives.

**Status: GREEN (with note).** All R4 source files on disk and
grep-able. Sweep proceeds against R4 design for Home body register
+ implementation for nav primitives. Single note: confirm `4bstyles.
css` is the intended canonical (vs an unshipped `4astyles.css`).

---

## Cross-cutting gaps (need Edward + CA disposition)

### Gap 1: "R5/R6 for Pricing/Quote/Mark Accepted" doesn't exist

Edward's directive references "R5/R6 prototype source" for Costing
/ Customer view / Mark Accepted. The R5 prototype covers Admin
surfaces only (firm-settings, markup-defaults, audit-log); the R6
prototype covers Cost build only. The actual design source for
those three surfaces is **R2 (Costing) and R3 (Customer view, Mark
Accepted)** — earlier rounds that predate RI.9 chrome canon and the
surface rename canon.

This is one of three things:

- **(a) Approximation in the directive.** R2/R3 IS what's on disk
  and what CD considers canonical for those surfaces. Edward's
  "R5/R6" was shorthand. **Action: accept R2/R3 + proceed with
  sweep.** Risk: design source is stale relative to current canon;
  fidelity audits will surface "R3 says 'Customer view' but production
  says 'Quote'" type conflicts that need Pattern-28-vs-rename-canon
  collision arbitration per surface.

- **(b) Missing CD deliverable.** Edward expected CD to ship
  R5/R6-era prototypes for Pricing/Quote/Mark Accepted that don't
  yet exist on disk. **Action: ping CD for the refreshed
  prototypes before brief drafts.** Sweep stalls until CD delivers.

- **(c) Intentional sequencing.** Edward planned to refresh those
  surfaces' design later (e.g., R8 for multi-route shipping
  touches Customer view + Cost build) and the sweep is meant to
  consume current-state R2/R3 as the source-of-truth for body
  register only. **Action: proceed with R2/R3 + explicit
  "chrome-canon-from-impl, body-canon-from-design" disposition in
  the brief.**

### Gap 2: Pre-RI.9 designer notes don't reflect current chrome canon

The designer notes for R2, R3, R4 predate RI.9 (May 2026) and
therefore don't reference eyebrow + back-link + action cluster
+ nextMoveBanner as production-anchored chrome primitives. They
describe an older era's page chrome. Only R7a (RI.9 nav slice)
and R7b (§6.b Setup) designer notes reference RI.9 canon.

The implementation IS canon for RI.9 chrome (every quote-scoped
surface uses `surface-meta.ts` + `YourNextMoveBanner` + Eyebrow
primitives via the RI.9 implementation). The sweep needs to
explicitly bank "chrome reads from implementation; body register
reads from design source" as the working discipline.

### Gap 3: Missing per-round designer notes / data-source maps

- **`r2-designer-notes.md` does NOT exist** (only round-3 +
  r4-r7b are present). Pricing surface has no per-round designer
  notes on disk — only the bundled HTML shell + JSX source files.
- **`r2-data-source-map.md` does NOT exist** for Pricing.

These two files would be standard CD deliverables for Pattern 30
discipline; their absence means Pricing's sweep operates without
canonical visual-treatment + data-shape documentation.

### Gap 4: Surface rename canon coverage in design source

The post-RI.8 surface rename canon ("Cost build → Costs", "Costing
Sheet → Pricing", "Customer view → Quote") **post-dates every
relevant design source.** Per the Pattern-28-vs-rename-canon
collision discipline banked in CLAUDE.md (§6.b Step 11 audit
Finding 10), surface references in design copy default to the OLD
names. The sweep must apply the rename canon **everywhere a surface
reference renders in production**, even when the design source uses
the old name — the brief should make this explicit so the audit
doesn't re-flag the same gaps the §6.b sweep already addressed for
Setup.

---

## Seed findings from §6.b smoke (carried into the rest-of-app sweep)

These are already-caught findings from §6.b implementation work that
naturally land on the rest-of-app sweep:

1. **Cost build page chrome missing eyebrow + back-link** — `Costs`
   surface needs explicit verification its eyebrow + back-link
   structure matches the canonical RI.9 nav primitives the way
   Setup ships them. Banked from Edward smoke pre-PR observations.

2. **Cost build page title rename canon application** — `"Cost
   build"` → `"Costs"` per RI.8 surface rename canon. Some legacy
   copy may still reference the old name; sweep verifies.

3. **Scenario name inline edit affordance** — UX_BACKLOG entry
   logged; Pattern 29 read↔edit on the eyebrow variant label.
   Could fold into sweep if the eyebrow gets touched; otherwise
   stays as its own future slice.

4. **Designer audit Finding 17 (.calc-display primitive)** — modal
   margin block fully inline-styled. Cross-surface extraction
   candidate: any surface that renders a "calculated, display-only"
   register cell.

5. **Designer audit Finding 18 (.warn-band primitive)** — modal
   SKU dup-check warn band fully inline-styled. Cross-surface reuse
   target: Slice 9.5 validation surfacing + Mark-Accepted
   sent-vs-draft mismatch + Pricing below-floor warning band.

6. **Designer audit Finding 22 (.r7b-empty-state class)** — empty
   state grammar reusable across surfaces with empty data shapes
   (SKU table, tier table, future Cost-build sections with no
   inputs, Pricing tier table when no tiers, etc.).

---

## Recommended next step

**Three paths, pick one:**

### Path A — Accept R2/R3 as canonical, brief proceeds

Treat R2/R3 design sources as authoritative for body register;
implementation as canonical for RI.9 chrome. Brief explicitly
banks the dual-canon convention. Sweep proceeds without CD
refresh.

**Pros:** unblocked immediately; reflects current state-of-the-world
honestly.

**Cons:** design source is materially older than implementation;
fidelity audits will surface chrome-vs-body inconsistencies per
surface that need arbitration; the surface rename canon
collision recurs on every surface's audit findings.

### Path B — Ping CD for refreshed prototypes

Surface specific gaps to CD: Pricing needs an R8-era prototype
incorporating RI.9 chrome + rename canon; Quote + Mark Accepted
same; potentially Pricing needs designer notes + data-source map
that don't currently exist. CD ships the refreshed bundle. Sweep
brief drafts AFTER refresh lands.

**Pros:** clean canonical anchor for the sweep; no per-surface
arbitration; long-term Pattern 30 discipline stays clean.

**Cons:** depends on CD turnaround; could be slow; multi-route
shipping (R8 candidate) may want to consolidate the Pricing /
Quote / Cost build refresh into the R8 round, which couples this
sweep to a parallel design-side workstream.

### Path C — Defer the sweep, ship the writebacks slice first

Skip rest-of-app fidelity sweep for now; ship Mark-Accepted external
writebacks slice (HubSpot deal + NetSuite SO push, already
sequenced as #3 on the release path). Return to the fidelity sweep
after writebacks land + CD has caught up on Pricing/Quote/Mark
Accepted refreshes.

**Pros:** writebacks unblock NetSuite integration sooner; lets
CD work in parallel without coupling sequencing.

**Cons:** the 19 banked §6.b audit findings (7 MEDIUM + 12 LOW)
+ the seed findings above keep accumulating without resolution
— rest-of-app sweep grows in scope the longer it waits.

---

**Recommendation:** Path A or Path C. Path B introduces a CD
dependency that the v1 release path doesn't need — most of the
banked findings are token-discipline + class-name fidelity which
the IMPLEMENTATION can canon-authority on. CD refresh is the right
call for multi-route shipping (R8) regardless, but blocking the
fidelity sweep on it adds schedule risk.

Edward + CA disposition needed to pick.

---

## Disposition (2026-05-13)

**Path A taken.** Edward closed the source gaps by adding R2 + R3
designer notes + data-source maps. All 5 surfaces now GREEN. Brief
drafting proceeds with explicit dual-canon discipline:

- **Chrome canon:** RI.9 implementation + R7a/R7b designer notes
  (eyebrow, back-link, action cluster, nextMoveBanner, surface
  rename). Applies to every quote-scoped surface uniformly.
- **Body canon:** Per-surface design source (R2 for Pricing, R3
  for Quote + Mark Accepted, R4 for Home, R6 for Costs). Surface
  rename canon overrides any old-name surface references in design
  copy per the Pattern-28-vs-rename-canon collision discipline.

Brief drafting starts now (Option B per Edward — write the
dual-canon §0 + per-surface sections inline). Pattern 37 (dual-canon
discipline) and Pattern 38 (completeness-reviews-first-class)
banked as candidates in the brief.
