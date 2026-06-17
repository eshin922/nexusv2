# slice-pricing-surface-redesign · Step 1 kickoff

**Branch:** `slice-pricing-surface-redesign`
**Step:** 1 (kickoff + CD bundle staging + Pattern 22 §0.5
verification + Pattern 30 path determination + performance
baseline + step plan lock)
**Date:** 2026-06-16
**Companion docs:**
- Brief: `docs/cc-comm-pricing-surface-redesign-brief.md` (CA;
  LOCKED post-design review)
- Review: `docs/cc-comm-pricing-surface-redesign-review.md` (CC,
  2026-06-16; 8 catches + Q5-Q11)
- CD source (staged this commit):
  `docs/design-prototypes/dist/pricing_surface_bundle/`
**Predecessor:** PR #53 (slice-fr12-copy-operations) merged
`64c2460`. v1 release-path item 6.

---

## §1 — Slice purpose

CD redesigned the Pricing surface ("Tune price & review" on the
Quote umbrella) to fix a v1 launch defect: 12 competing surfaces
with no first-glance comprehension + repetition saturation (the
same alarm string appearing 5-6× per page).

The redesign reorganizes into **three zones · mode-aware**:

```
[STATE]   — what's happening
[ACTION]  — what to do
[DETAIL]  — drill in (collapsed by default)
```

Mode taxonomy: `sendable | suggestion_led | blocked` —
determined by one classifier (`PSR.classify(quote, policy)`)
that every state-bearing surface consumes from per render. **The
classifier is the structural fix** for the source-of-truth bug
class (the original meta-tile contradiction).

The redesign **replaces BOTH** existing layers on the Pricing
route:
- Pricing reframe v1 top-band (`src/components/pricing-reframe/*`)
- Legacy ROOM 0/1/2/3 components (`src/components/pricing/{lines-requiring-review,verdict-band,per-tier-override-card,pricing-section-head}` + `pricing/sku-summary-row*`)

Schema work: **two new `firm_settings` columns** per Catches 1+2
(`allow_override`, `allow_accept_risk`). Versioned-table
carry-forward helper extension per CLAUDE.md pattern.

---

## §2 — Step 0 · CD bundle staged

Bundle path: `docs/design-prototypes/dist/pricing_surface_bundle/`

Contents (8 files):
- `Nexus_Pricing_Surface_Redesign.html` — prototype harness
- `app/pricing_surface/classifier.js` — the contract (Q6 reference)
- `app/pricing_surface/pricing_surface.jsx` — component
  compositions (Steps 4-6 reference)
- `app/pricing_surface/data.js` — 14-scenario fixtures
- `app/pricing_surface/styles.css` — canonical `.psr-*` CSS
- `app/r6/cost-stack.jsx` — R6 dependency (black box)
- `docs/cd-pricing-surface-redesign-designer-notes.md`
- `docs/cd-pricing-surface-redesign-data-source-map.md`

Pattern 30 staging precedent matches R6 + library modal.

---

## §3 — Pattern 30 path determination

**Path B-default** (canonical CSS verbatim, prefix-clean
selectors).

CD's `app/pricing_surface/styles.css` uses **36 `.psr-*` prefix-
clean class selectors** (verified by enumeration). No collision
risk with existing global classes or other surface registers
(`.a1v2-*`, `.r7b-*`, `.r6-*`, `.lib-*`, `.r-a1v2-*`).

**Imported verbatim from:**
`docs/design-prototypes/dist/pricing_surface_bundle/app/pricing_surface/styles.css`
**Destination:** `src/styles/r-psr-pricing.css` (lands in Step 4)
**Deliberate drops at file root:** TBD during Step 4 import —
review prototype-only chrome (state-strip / blurb-style review
aids if present) per Pattern 31 precedent.

**Tokens verified at §0.5 pass:** all 19 tokens CD references
(`--accent`, `--accent-ink`, `--bad`, `--bad-soft`, `--display`,
`--good`, `--good-soft`, `--ink` through `--ink-4`, `--mono`,
`--paper` through `--paper-3`, `--rule`, `--rule-2`, `--ui`,
`--warn`, `--warn-soft`) exist in `src/styles/design-tokens.css`.
Zero token gaps; Path B-default adoption is clean.

**Canonical frame reuse (no redesign):** none. The redesign
ships net-new chrome registers; no existing modal / card frame
is consumed beyond design tokens.

---

## §4 — Pattern 22 §0.5 verification ledger

8 catches dispositioned via the CC review + Edward + CA lock.
Reproduced here for self-containment.

### Catch #1 — `firm_settings.allow_override` missing [BLOCKER · DISPOSITIONED]

Classifier reads `firm_settings.allow_override` per data-source
map §"Action cards" + §"State card." Column doesn't exist.

**Disposition (locked):** Step 2 migration adds:

```sql
alter table firm_settings
  add column allow_override boolean not null default true;
```

`versionedFirmSettingsUpdate` helper extended per CLAUDE.md
"Versioned-table carry-forward audit" pattern (Slice RI.7
precedent).

### Catch #2 — `firm_settings.allow_accept_risk` missing [BLOCKER · DISPOSITIONED]

Same shape as Catch #1; gates accept-risk banner visibility per
data-source map §"Accept-risk banner."

**Disposition (locked):** combined into the Catch #1 migration:

```sql
alter table firm_settings
  add column allow_override boolean not null default true,
  add column allow_accept_risk boolean not null default true;
```

Both columns get versioned-table carry-forward extension in
Step 2.

### Catch #3 — Cost stack 4-field rollup vs R6.2 multi-leg shape [ARCHITECTURAL · DISPOSITIONED]

Data-source map expects `Cell.cost_stack: { pkg, prod, frt, dt }`
shape; R6.2 freight slice replaced flat `freight_inputs` with
`freight_leg_groups` + `freight_legs` carrying `customs JSONB`.

**Disposition (locked):** rollup formula lives in the **costing
math layer** per Q6 — canonical for all consumers (Pricing
surface, Quote umbrella PDF). Classifier reads the rolled-up
shape; classifier doesn't compute the rollup. Document the
rollup formula in costing layer comment header. Per-leg display
banked v1.1+ on PM demand.

### Catch #4 — `CostStackHeader` cross-surface [HYGIENE · DISPOSITIONED]

`CostStackHeader` is imported by both `costs/page.tsx` AND
`pricing/page.tsx`. Tear-down list literal reading would delete
the file; would break Costs surface.

**Disposition (locked):** tear-down is **remove-import-only**.
File preserved; only the Pricing surface's import + mount
removed. Step 8 plan absorbs this distinction.

### Catch #5 — Shared primitives preserved [HYGIENE · DISPOSITIONED]

`MarginVerdictPill`, `MarginSparkline`, `TwoAxisVerdictPair`,
`ReverseSolveDialog` consumed by row component + Quote umbrella
summary cards. Brief §5 list (`SkuSummaryRowList`) reads as
file-level delete.

**Disposition (locked):** tear-down scopes to the ROW renderer
(import + mount removal); shared primitives stay shipped for
sibling consumers + new `SkuBreakdown` composition. These
primitives are the "naturally fold" reusable atoms CD's notes
mention.

### Catch #6 — `EmptyState` name collision [NOTATION · DISPOSITIONED]

`EmptyState` identifier also names a locally-defined function in
`src/app/page.tsx` (home page). Not a `pricing-reframe/empty-state.tsx`
import; just a name collision.

**Disposition (locked):** notation only; tear-down sweep
filters by import path (`grep -rn 'from .*pricing-reframe/empty-state'`)
not by identifier name. Step 8 import-aware.

### Catch #7 — `global_lift_pct` vs `global_price_adj_pct` [NOTATION · DISPOSITIONED]

Data-source map writes `quote.global_lift_pct`; production column
is `quotes.global_price_adj_pct` (numeric(5,4), schema.ts:284).

**Disposition (locked):** notation only. Classifier impl uses
the real column. Bank as classifier-impl reference so future-CC
reading the data-source map doesn't search for a phantom column.

### Catch #8 — `quote.suggestions` schema framing [NOTATION · DISPOSITIONED]

Data-source map prefixes `quote.suggestions.surgical/.global`
with `schema:` but the suggestion engine
(`src/lib/pricing-suggestions.ts`) returns suggestions per
in-render call; not persisted as a JSON column.

**Disposition (locked):** notation only. Classifier consumes
`pricingSuggestions(quote, policy)` at classify-time. v1 ships
in-render call; v1.1+ if perf shows classify-cost saturation.

---

## §5 — Open questions locked (Q1-Q11)

All dispositioned via CC review + Edward + CA lock 2026-06-16.

| Q | Source | Disposition |
|---|---|---|
| Q1 | Brief §17 | Step-plan granularity → **9 steps** (Q11 detail) |
| Q2 | Brief §17 | Architect schema verification ordering → **Step 1** (this kickoff) |
| Q3 | Brief §17 | Performance baseline measurement → **YES** (Q9 detail; captured §7 below) |
| Q4 | Brief §17 | Tear-down sequencing → **AFTER new shape ships** (Q10 detail) |
| Q5 | CC | Schema migration timing → **Step 2 mandatory** |
| Q6 | CC | `cost_stack` rollup formula authority → **(β) costing math layer** |
| Q7 | CC | Versioned-table carry-forward extension → **Confirm in Step 2** |
| Q8 | CC | Provisional mode taxonomy → **(β) 3 modes + state-line status flag** |
| Q9 | CC | Performance baseline → **30-min Lighthouse @ Step 1** (captured §7) |
| Q10 | CC | Tear-down sequencing → **Step 8 (after new shape ships)** |
| Q11 | CC | Step plan → **9 steps** |

---

## §6 — Step plan (locked · 9 steps)

Per-commit Pattern 27 two-layer manifest required on every
implementation commit.

1. ✅ **Step 1** — Kickoff (this commit bundle: brief + review +
   kickoff + CD bundle staging + perf baseline + Pattern 30 path
   determination + §0.5 lock)
2. **Step 2** — Schema migration: `firm_settings.allow_override`
   + `firm_settings.allow_accept_risk` (both `boolean NOT NULL
   DEFAULT true`); `versionedFirmSettingsUpdate` helper extended;
   Architect §0.5 sign-off
3. **Step 3** — Classifier impl: `src/lib/pricing-classifier.ts`
   with `QuoteState` contract (TS interface mirroring
   data-source map §"Classifier output contract") + pure
   `classify(quote, policy)` function + invariant unit tests
   (brief §15 enumeration: mode exhaustiveness; exactly-one-
   recommended; per-cell ↔ per-tier ↔ per-SKU rollup agreement;
   provisional symmetry; blocked-implies-accept-risk-gated;
   `allow_override:false` → `override_unavailable`)
4. **Step 4** — STATE zone components + canonical CSS adoption:
   `src/styles/r-psr-pricing.css` Path B-default import +
   `<StateLine>` + `<StateCallout>` (suggestion-led only) +
   `<StateCard>` (blocked only)
5. **Step 5** — ACTION zone components: `<SendableSummary>`
   (NET-NEW component per CD §2.3) + `<ActionCard>` +
   `<SuggestionCard>` (consumes
   `quote.suggestions.{surgical, global}` from in-render
   engine call; calculating_suggestion fallback for race)
6. **Step 6** — DETAIL zone components: `<DetailZone>` toggle +
   `<DetailGlobalAdjust>` + `<DetailTierTable>` +
   `<DetailCostStack>` (reads cost-math-layer rollup per Q6) +
   `<DetailPerSku>` + `<SkuBreakdown>` + `<DetailMetaTiles>`
7. **Step 7** — Page composer + recompute pipeline: mode-aware
   zone rendering at `pricing/page.tsx`; classifier re-runs on
   cell mutation / suggestion accept / global adjust keystroke
   (200-300ms debounce); session-only DETAIL collapse state;
   mode-transition flash banner + persistent "just updated" hint
   (30s; predicate `previous_mode !== current_mode`)
8. **Step 8** — Legacy tear-down: remove `BlendedHeadline` /
   `FloorBlock` / `TierComplianceBlock` / `SuggestionEngine` /
   `ApplyToast` / pricing-reframe `EmptyState` / `Shell` /
   `ReframeStateContext` + `src/styles/pricing-reframe.css`
   (delete files; nothing else consumes); remove `pricing/page.tsx`
   imports + mounts for ROOM 0/1/2/3 (`LinesRequiringReview` +
   `VerdictBand` + `PerTierOverrideCard` + `PricingSectionHead`
   + `SkuSummaryRowList` row renderer); **preserve shared
   primitives** (`MarginVerdictPill` / `MarginSparkline` /
   `TwoAxisVerdictPair` / `ReverseSolveDialog` /
   `CostStackHeader`) per Catches #4 + #5
9. **Step 9** — Smoke guide PSR-1..PSR-14 (14 scenarios from CD
   round-2) + cumulative Pattern 27 fold + §0.5 ledger + PR
   open

Steps 4-6 can run within a working session in parallel; commit
order matches sequence above for clean blame.

---

## §7 — Performance baseline

**Server-side route latency** (anonymous curl, captured 2026-06-16):

| Run | Status | Latency (ms) | Body size |
|---|---|---|---|
| 1 | 307 (Clerk redirect) | 227 | 159 B |
| 2 | 307 | 214 | 159 B |
| 3 | 307 | 213 | 159 B |
| 4 | 307 | 212 | 159 B |
| 5 | 307 | 211 | 159 B |

**Summary:** min 211 · median 213 · max 227 · mean 215 ms.

**Caveat:** anonymous curl hits Clerk middleware → 307 redirect
to sign-in. The 215ms median represents middleware + auth check
latency, NOT actual classifier + render time on the Pricing
route. Real Lighthouse baseline requires browser-authenticated
capture.

**CC recommends CB capture authenticated baseline before Step 8
tear-down begins** so post-redesign comparison has ground truth
on the same machine. Banked here as the transport floor; CB
captures full render baseline at Step 1 conclusion or Step 3
classifier impl checkpoint.

**Target quote for baseline:** any of the FR12 scenarios (e.g.,
`f84334bd-afa1-4016-9511-71f7d5600e35` · Epicuren Alt 1 · 6
ASYs · 1 tier · global_price_adj 0%). Larger fixtures aren't
available in current dev DB; CB may seed a 5-SKU × 5-tier quote
for stress baseline.

---

## §8 — Pre-merge gates

- [ ] Typecheck PASS every commit (`npx tsc --noEmit`)
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (this kickoff)
- [ ] Pattern 27 two-layer manifest per implementation commit
- [ ] Pattern 28 — fidelity contract is CD designer notes +
      pricing_surface.jsx prototype; copy verbatim
- [ ] Pattern 30 Path B-default canonical CSS adoption clean
      (Step 4 wire)
- [ ] Pattern 45 customer-view boundary clean (Pricing surface
      is PM-internal)
- [ ] Classifier invariant unit tests (brief §15)
- [ ] CB end-of-phase smoke walk PSR-1..PSR-14 (merge gate)

---

## §9 — Carry-forwards (banked)

Concur with brief §12 + CC review §8:

- **Multi-leg cost stack display** — v1.1+ when PM demand
  surfaces (Catch #3)
- **`worst_plausible_margin()` provisional refinement** —
  instrument inert-CTA frequency first per designer notes §8
- **Per-PM DETAIL preference** — session-only in v1; v1.5+
- **Mode-transition animation polish** — v1.5+
- **Performance baseline regression check** — bake into post-v1
  monitoring
- **2-tier non-trivial layout adaptation** — v1.5+; s03 covers
  trivial case
- **Cost stack tightness at 5+ tiers** — R6 territory; separate
  slice (designer notes §4.7)
- **Richer mode-transition animations** — v1.5+
- **Save-as-template scenarios across slices** — v2 per SPEC
  non-goal

---

## §10 — Predecessor state inherited

PR #53 merged 2026-06-16 (`64c2460`). On `main`:

- FR-12 copy operations active; `copied_from_quote_id` lineage
  persists; `scenario_copied` audit namespace stable
- CSF modal scratch + within-project + cross-project copy paths
  all functional
- `quotes.global_price_adj_pct` column unchanged (Catch #7 will
  reference)
- `quote_tiers.tier_price_adj_pct` column unchanged (per-tier
  override; classifier reads)
- `quote_sku_tiers.sell_price_override` (Slice 9.3) — classifier
  reads via `cell.override_applied` derivation
- `firm_settings` 14-column shape (Steps 2 adds two columns)

No schema overlap with this slice's migration. Versioned-table
carry-forward helper (`versionedFirmSettingsUpdate`) is the
extension target.

Pricing surface route (`src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx`)
currently composes both legacy ROOM 0/1/2/3 components AND
pricing-reframe v1 top-band components (per Edward's interim
disposition). Step 7 page composer rewrite + Step 8 tear-down
consolidates both layers into the new classifier-driven shape.

---

## §11 — Standing by

Step 1 PASS. Cleared to proceed to Step 2 (schema migration) on
Edward's next directive.

Step 2 is the load-bearing schema work; Step 3 classifier impl
depends on the migration landing first. No mid-slice schema
verification needed beyond this kickoff's §0.5 lock.

— CC, 2026-06-16
