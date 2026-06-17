# CA brief — Pricing Surface Redesign · CC impl

**Slice name:** `slice-pricing-surface-redesign`
**Status:** Brief draft. CD prototype shipped + 2 rounds of CA review; all
fixes + scenarios landed clean. Design is LOCKED.
**Date:** 2026-06-16
**Predecessor:** PR #53 FR-12 copy operations merged. Phase A.1 v2 +
library workflow restructure (PR #50/51/52/53) wrapped clean.

---

## 1 · What this slice is

CD redesigned the Pricing surface ("Tune price & review" on the Quote
umbrella) to fix a v1 launch defect: the current page has 12 competing
surfaces with no first-glance comprehension. CD's prototype reorganizes
into a three-zone, mode-aware shape (STATE / ACTION / DETAIL) driven by
a single classifier.

The redesign **replaces BOTH** existing surface layers:

- **Pricing reframe v1 top-band components** (shipped earlier slice) —
  `BlendedHeadline`, `FloorBlock`, `TierComplianceBlock`,
  `SuggestionEngine`, `ApplyToast`, `EmptyState` in
  `src/components/pricing-reframe/`
- **Legacy ROOM 0/1/2/3 components** preserved below the top-band per
  Edward's interim (b) disposition — `LinesRequiringReview`,
  `CostStackHeader`, `VerdictBand`, `PerTierOverrideCard`,
  `PricingSectionHead`, `SkuSummaryRowList`

Both layers consolidate into the new classifier-driven shape. The
duality Edward shipped as a stopgap goes away.

CD ran two review rounds (May 18-19). All 5 fixes + 3 scenarios landed
clean in round-2 re-spin (verified May 19). Read designer notes §9 first
— it's the consolidated fix log from re-review and disambiguates
several subtle points.

**Your job:** translate the prototype to production in the existing
Pricing surface route. The design is not under review. What follows is
impl scope, constraints, and cross-stream watch items.

---

## 2 · Step 0 · Stage the CD bundle

Bundle has NOT been added to repo yet. First action: stage CD's
deliverable into the repo so it's accessible to project knowledge +
your impl reference.

**Files to stage** (Edward delivers to you locally; you `git mv` /
`cp` into the bundle path):

- `Nexus_Pricing_Surface_Redesign.html` (prototype harness)
- `app/pricing_surface/classifier.js` (the contract)
- `app/pricing_surface/pricing_surface.jsx` (component compositions)
- `app/pricing_surface/data.js` (mock fixtures — 14 scenarios)
- `app/pricing_surface/styles.css` (canonical CSS, `.psr-*` namespace)
- `app/r6/cost-stack.jsx` (R6 dependency, black box reuse)
- `cd-pricing-surface-redesign-designer-notes.md`
- `cd-pricing-surface-redesign-data-source-map.md`

**Destination:** `docs/design-prototypes/dist/pricing_surface_bundle/`
(matches Pattern 30 staging precedent from R6 + library modal).

**Optional:** copy `Nexus_Pricing_Surface_Redesign.html` to project root
or `docs/design-prototypes/` for browser-rendering review during impl
("which scenario am I building against right now?").

Commit Step 0 as separate kickoff commit with manifest preview before
touching production code.

---

## 3 · Ground truth, in priority order

1. `docs/design-prototypes/dist/pricing_surface_bundle/cd-pricing-surface-redesign-designer-notes.md`
   — design decisions, dispositions, scenario inventory, considered-
   and-rejected
2. `docs/design-prototypes/dist/pricing_surface_bundle/cd-pricing-surface-redesign-data-source-map.md`
   — QuoteState contract (the type to model), per-surface field
   traces, classifier ownership
3. `docs/design-prototypes/dist/pricing_surface_bundle/app/pricing_surface/classifier.js`
   — the classifier; this is the impl reference, not a sketch
4. `docs/design-prototypes/dist/pricing_surface_bundle/app/pricing_surface/pricing_surface.jsx`
   — component compositions; translate to production conventions

Read the designer notes §9 first.

---

## 4 · The classifier is the contract · architectural non-negotiable

Model `QuoteState` as a TypeScript interface per the data-source map
§"Classifier output contract." Every state-bearing surface consumes
from one `classify(quote, policy)` output per render. No surface
re-derives mode, status, qualifier copy, action ranking, projected
blended, or cell status inside a component. **This is the structural
fix for the source-of-truth class of bugs** (the original meta-tile
contradiction that motivated the redesign).

The classifier is pure: `(quote, policy) → QuoteState`. Same input →
same output. No I/O, no state, no side effects. This makes it
server-renderable, memoizable, testable.

**If you find yourself writing `margin < floor_margin_pct` inside a
component, stop** — that comparator belongs in the classifier. CD's
first prototype shipped two such violations (DetailPerSku line
465-468; SkuBreakdown line 504-508); both were closed in round-2
re-spin (per-cell status is now classifier-owned). Hold the line.

The §3 source-of-truth rule, codified in the data-source map:

- `cell.status` is classifier-owned. No component re-derives.
- `action.projected_blended_after_apply` is classifier-owned.
  SuggestionCard reads, never computes.
- `state_line.qualifiers` is classifier-owned. State line never
  composes copy from flags directly.
- Missing-suggestion case emits `kind: "calculating_suggestion"`.
- `allow_override: false` emits `kind: "override_unavailable"`.

---

## 5 · Components in scope

All from CD's source under `app/pricing_surface/`:

- **Page composer** (`PricingSurface`) — mode-aware zone rendering
- **STATE zone:** `StateLine`, `StateCallout` (suggestion-led only),
  `StateCard` (blocked only)
- **ACTION zone:** `SummaryCard` (sendable only — **new component**,
  flag in your scope), `ActionCard`, `SuggestionCard`
- **DETAIL zone:** `DetailZone` (toggle), `DetailGlobalAdjust`,
  `DetailTierTable`, `DetailCostStack`, `DetailPerSku`,
  `SkuBreakdown`, `DetailMetaTiles`
- **R6 cost stack:** composed from `app/r6/cost-stack.jsx`, not
  reinvented. Treat R6 as a black box dependency.

`SendableSummary` is the only net-new component. Everything else is
reorganization or composition.

### Components to TEAR DOWN (in order)

**Layer 1 — Pricing reframe v1 top-band** (subsumed by new STATE/
ACTION zones):

- `src/components/pricing-reframe/blended-headline.tsx`
- `src/components/pricing-reframe/floor-block.tsx`
- `src/components/pricing-reframe/tier-compliance-block.tsx`
- `src/components/pricing-reframe/suggestion-engine.tsx`
- `src/components/pricing-reframe/apply-toast.tsx`
- `src/components/pricing-reframe/empty-state.tsx`
- `src/components/pricing-reframe/shell.tsx`
- `src/components/pricing-reframe/reframe-state-context.tsx`
- `src/styles/pricing-reframe.css`

Keep `src/lib/pricing-predicates.ts` — the `TARGET_TOLERANCE` constant
+ `isBelowTarget` / `isBelowFloor` helpers fold into classifier
implementation. Don't lose the tolerance discipline (it solved Bug #D
float-precision and the classifier inherits the same risk).

Keep `src/lib/pricing-suggestions.ts` — suggestion engine stays;
classifier consumes its output via `quote.suggestions.{surgical,
global}`.

**Layer 2 — Legacy ROOM 0/1/2/3** (subsumed by new DETAIL zone):

- `LinesRequiringReview` (ROOM 0)
- `CostStackHeader` (ROOM 1 — but R6 cost stack stays via
  `app/r6/cost-stack.jsx`; verify reuse, don't double-tear)
- `VerdictBand` (ROOM 2)
- `PerTierOverrideCard` (between ROOM 2/3)
- `PricingSectionHead` (ROOM 3)
- `SkuSummaryRowList` (ROOM 3)

Verify each component isn't referenced elsewhere in repo before
deletion (`grep -rn` per usual). Some may have leaked into Quote
umbrella or Mark Accepted surfaces — flag and disposition before
removing.

---

## 6 · Live recompute · the thing not in the prototype

The prototype shows pre-classified static scenarios. Production needs
the recompute pipeline:

- Classifier runs on initial render
- Classifier re-runs on any cell mutation: override applied/cleared,
  suggestion accepted, global adjust input change, upstream cost
  recompute (e.g., raws cost lands)
- Mid-edit input debounce: 200-300ms recommended; profile and tune
- DETAIL expanded/collapsed state persists within a session
  (sessionStorage or equivalent); resets at logout. No per-PM
  preference — that's v1.5+ if data shows the need.

The "just updated" hint on the state line (30s timeout) fires on **mode
transitions only**, not on every recompute. A global-adjust nudge that
doesn't change mode shouldn't surface the hint. Predicate:
`previous_mode !== current_mode`.

---

## 7 · Mode transition behavior

Two flavors covered in the prototype:

- **Recovery** (`apply_surgical`, `apply_global`): blocked /
  suggestion-led → sendable, or blocked → suggestion-led. Triggered by
  user clicking Apply.
- **Escalation** (`global_adjust_keystroke`,
  `cost_recompute_below_floor`): sendable / suggestion-led → blocked,
  or sendable → suggestion-led. Triggered by mutation that pushes a
  cell across a threshold.

Both render in place — never navigate. DETAIL state preserved. **No
surprise expansion on escalation.** Flash banner (one-shot) + persistent
state-line hint (30s) both fire on mode change. Scenario ⑪ shows
recovery; scenario ⑬ shows escalation; both are visual reference.

The rail's state-pip across Quote umbrella sub-tabs updates with the
new mode. Verify the rail's `quote.mode` reader picks up the classifier
output (or whatever existing convention the rail uses).

---

## 8 · Schema verification · Architect first

Designer notes claim no new schema. Data-source map's "Net new schema"
section enumerates every field as either existing or classifier-
derived. **Before kickoff, route the data-source map through Architect
to confirm.** Pattern 22 §0.5 verification cadence (now at 33 catches
cumulative) has paid forward on every slice — don't skip it on the
largest slice yet.

Existing fields the classifier reads:

- `quote.skus[].cells[tier_id].{margin_pct, sell_unit, cost_unit,
  cost_stack, override_applied}`
- `quote.skus[].client_target_unit`
- `quote.tiers[].{id, qty}`
- `quote.blended_margin_pct`, `quote.recommended_tier_id`
- `quote.suggestions.{surgical, global}` (populated by existing
  suggestion engine)
- `firm_settings.{target_margin_pct, floor_margin_pct, allow_override,
  allow_accept_risk}`

If Architect flags anything as missing, surface back before starting
impl. Schema drift mid-impl is the most expensive failure mode.

**One specific watchpoint:** v1 cost-stack composition uses 4 fields
`{pkg, prod, frt, dt}` per CD's data model. Production may carry more
granular fields after R6.2 freight slice landed (multi-leg with
customs JSONB; FR-12 brief touched these). Reconcile during Architect
pass — classifier may need to roll multi-leg fields up to a 4-bucket
display.

---

## 9 · Cross-surface effects

- **Audit log:** every `Apply Surgical`, `Apply Global`,
  `Request Override`, and individual override applied/cleared on a
  cell gets a row. Verify hooks exist or add them. Don't ship apply
  paths without audit.
- **`Mark accepted →` in header:** remove. Per R7a IA grammar, the
  action lives on the Mark Accepted sub-tab of Quote umbrella;
  shortcutting it from a sibling surface breaks IA. CD's pushback 3
  disposition.
- **Legacy in-place components:** see §5 tear-down list. Tear down
  after verifying no cross-surface imports. Be especially careful with
  `CostStackHeader` — R6 component stays via `app/r6/cost-stack.jsx`;
  the legacy Pricing-surface wrapper is what goes away.
- **`pricing-predicates.ts`:** preserve `TARGET_TOLERANCE`-aware
  comparators; fold semantics into classifier. Don't lose the
  precision discipline.
- **Lineage chip (FR-12):** the `copied_from_quote_id` chip surfaces
  on project detail scenario cards, NOT on Pricing surface. No
  collision; flagging only to confirm the redesign correctly leaves
  the lineage indicator on its current home (project detail).

---

## 10 · Suggestion engine integration

Classifier consumes `quote.suggestions.{surgical, global}` from the
existing engine (`src/lib/pricing-suggestions.ts`). If the engine is
async and hasn't returned by render time, classifier emits a
`calculating_suggestion` inert action — this is the prototype's
behavior and is correct.

Two production calls to make:

1. **Block render vs render-with-pending:** if `calculating_suggestion`
   fires often (because the engine is slower than initial render),
   consider blocking page render until first suggestion arrives. If it
   fires rarely, the pending state is fine.
2. **Refresh hook:** if the suggestion comes in late, the page should
   re-classify and re-render once. Wire a hook or polling depending on
   engine architecture.

Surface your call back for confirmation if it changes UX visibly.

---

## 11 · v1 critical path sequencing

This slice sits at item 6 of v1 path:

| # | Slice | Status |
|---|---|---|
| 1 | PR #50 HubSpot bidirectional | ✅ |
| 2 | Dev server crash mitigation | ✅ |
| 3 | PR #51 library-first creation flow | ✅ |
| 4 | PR #52 library modal UX polish | ✅ |
| 5 | PR #53 FR-12 copy operations | ✅ |
| **6** | **Pricing surface redesign (THIS)** | **⏳ kickoff** |
| 7 | Library scroll patch (parallel) | (in flight standalone) |
| 8 | Slice 12 Mark Accepted + NetSuite SO push | queued |
| 9 | Pre-launch cleanup | queued |
| 10 | MS OAuth | queued |
| 11 | SPEC compliance audit | queued |
| 12 | Pre-launch review | queued |
| 13 | v1 release | — |

External timeline holds: Phase 1 complete July 1 → beta mid-July →
full rollout mid-July.

No schema overlap with recent slices (PR #50/51/52/53 touched library,
modal, copy operations; none touched Pricing-surface state). Verified
clean.

---

## 12 · Out of scope

**Separate CC tickets to file** (pre-existing bugs, not blocked by
this slice):

- Test fixture names visible in production screenshots (Test-123-ABC,
  TEST MAKEUP BAG, etc.) — impl-time leak from a prior round
- "If customer picks Tier 1" conditional language in legacy
  cost-stack T1 column — Pricing reframe v1 shipped the unconditional
  language; cost stack didn't propagate

The other three pixel-pass items (sparkline data-point legend, SHOW
BREAKDOWN register, cost-stack horizontal bar labels) are **obsoleted
by the redesign** — the components carrying them go away. No ticket
needed.

**Deferred to v1.5** (instrument first, decide later):

- 2-tier non-trivial layout adaptation (s03 covers the trivial case)
- `worst_plausible_margin()` helper for provisional refinement
- Cost stack tightness at 5+ tiers (R6 territory; separate slice)
- Richer mode-transition animation (margin tweens, callout dissolve).
  v1 MVP is flash + persistent hint.
- Per-PM DETAIL preference persistence (session-only in v1)

---

## 13 · CB smoke gate

Before merge, CB walks the 14 scenarios against the live deployment.
Verifies:

- Classifier output matches expected mode / state-line / action
  ranking per scenario (use CD's scenario fixtures as ground truth)
- Transition scenarios (⑪, ⑬) render persistent hint + flash banner
  correctly; DETAIL state preserved
- DETAIL expand/collapse persists within session, resets across
  sessions
- `Mark accepted →` does NOT appear in the Pricing surface header
  (regression check on the IA grammar fix)
- All legacy components torn down (no `BlendedHeadline`,
  `LinesRequiringReview`, etc. rendering anywhere on the page)
- New `SendableSummary` renders correctly in sendable mode
- Audit rows generated on every apply path
- Pattern 45 customer-view boundary clean (no Pricing-surface
  components imported from PDF surface)

CB report back to CA before merge.

---

## 14 · Three impl pushbacks to surface if seen

1. **Classifier perf at scale.** 10+ tiers × 20+ SKUs means 200+ cells
   per `classify()` call. The prototype loop is straightforward but
   unprofiled. If renders block, profile and memoize. Server-side
   classification is an option since the function is pure — consider
   if client-side proves slow.
2. **Suggestion engine race conditions.** If `calculating_suggestion`
   shows up more than rarely, surface back and we'll disposition
   (block render vs accept pending).
3. **R6 cost stack with override-applied cells.** CD's
   `DetailCostStack` distributes markup across PKG/PROD/FRT (skipping
   D+T as internal layer). If R6's existing override handling
   computes differently, reconcile before merge. The cost stack is
   shared territory; don't fork it silently.

---

## 15 · Pattern 30 deliverable expectations for CC

- Step-1 kickoff doc per current cadence (Pattern 30 path
  determination + §0.5 verification ledger + locked dispositions +
  step plan)
- Working impl in production codebase conventions (your call on file
  org; the prototype's `app/pricing_surface/` structure is reference,
  not mandate)
- Pattern 27 two-layer manifest per commit
- Pattern 47 verify PASS every commit
- Pattern 45 customer-view boundary clean
- Per-commit Architect §0.5 verification (33 cumulative; add this
  slice's catches)

**Tests covering classifier invariants:**

- Mode taxonomy is exhaustive (every quote produces exactly one of
  `sendable` / `suggestion_led` / `blocked`)
- Exactly one `recommended: true` action per render in suggestion-led
  and blocked modes
- Per-cell status agrees with per-tier and per-SKU rollups (no
  contradictions)
- Provisional rule symmetric: missing data never silently classifies
  as sendable
- `mode === "blocked"` implies `allow_accept_risk` paths gated
  correctly
- `allow_override: false` emits `override_unavailable` inert action,
  not `Request Override`

Audit log hooks verified or added for all apply / override paths.
CB smoke harness bundled with the impl.

---

## 16 · Locked dispositions (carry-forward from CD review rounds)

From May 18-19 review cycle; do not re-litigate:

- Three-zone STATE/ACTION/DETAIL shape with mode-aware composition
- One-line state + summary card (status-only state line; numbers in
  summary card; zero numeric overlap)
- Classifier as single source of truth (§3 rule)
- Over-client-target as flag, not mode (parallel array; compounds via
  table)
- Provisional handling: any unknown = inert CTA (simple v1 rule;
  instrument frequency for v1.5)
- Action ranking heuristic per designer notes §4.5 (exactly one
  `recommended: true`)
- Flash banner + persistent state-line "just updated" hint (30s) on
  mode transitions
- `SendableSummary` as new component (no other net-new components)
- Remove `Mark accepted →` from Pricing header (R7a IA grammar)
- Accept-risk banner shown when policy disallows (discoverability for
  cross-firm onboarding)
- 14 scenarios coverage (CD shipped; round-2 added s12/s13/s14)

---

## 17 · Open questions for kickoff Step 1

CC review surfaces additional questions. Pre-flagged for awareness:

- Step-plan granularity: 8 steps? More? CC's call based on commit-
  cadence comfort.
- Architect schema verification ordering: pre-Step-1 or as Step 1?
  CA lean Step 1 (no schema migrations expected; Architect confirms
  in <30 min and locks confidence for build).
- Performance baseline measurement: pre-tear-down (capture current
  Pricing surface render time as comparison reference)? CA lean YES
  if cheap; otherwise skip.
- Tear-down sequencing: tear down legacy AFTER new shape lands,
  or interleave? CA lean tear-down AFTER (avoids broken-state commits
  mid-slice).

Surface back with CC review dispositions + Q5+ catches before kickoff
authorize.

---

## Status

Brief draft. CC reviews, surfaces Pattern 22 §0.5 catches, and locks
step plan. Edward + CA disposition any remaining Q1-Q4 + catches.
Then Step 1 kicks off.

Cumulative §0.5 count entering this slice: 33 (post-FR-12). Expect
the largest catch batch yet given surface complexity + classifier-as-
contract architecture; Architect pass should surface most pre-build.

— CA, 2026-06-16
