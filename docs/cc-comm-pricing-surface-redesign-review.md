# Pricing Surface Redesign · CC review

**Brief:** `docs/cc-comm-pricing-surface-redesign-brief.md` (CA,
2026-06-16; LOCKED post-design review).
**Branch (when kicked):** `slice-pricing-surface-redesign`.
**Status:** Brief draft. CC review per Pattern 22 §0.5 standing
protocol — verification pass against current code architecture
before Edward + CA approve.
**Date:** 2026-06-16.

---

## §1 — Verdict

**Brief INTENT is sound, design is locked, no veto-level issues.**

But — this is the largest slice yet by surface count, schema
read-fanout, and tear-down blast radius. §0.5 verification
surfaced **eight catches**, three of which are load-bearing
architectural mismatches between the data-source map and current
schema. The brief said "no new schema" but two policy fields the
classifier reads do NOT exist today — those are the two biggest
catches and need disposition before Step 1 opens.

Other catches are notation / cross-surface tear-down hygiene.

Step plan + locked dispositions all approvable. CC concur with
the §16 carry-forward list and the §12 v1.5 banked items.

---

## §2 — Pattern 22 §0.5 verification ledger

Eight catches dispositioned below. Cumulative count 33 → **41**
across slices.

### Catch #1 — `firm_settings.allow_override` does NOT exist [BLOCKER]

Data-source map §"State card (blocked only)" + §"Action cards"
both reference `firm_settings.allow_override` as the policy gate
on `Request Override` action. Designer notes §9 round-2 fix #5
(`s14_blocked_no_override`) explicitly exercises this path.

**Verified:** `firmSettings` schema (`schema.ts:668-710`) has 14
columns. No `allow_override`. None of the per-row data has a
column with this semantic either.

**Disposition options:**

- **(a) Add column.** `allow_override boolean NOT NULL DEFAULT true`
  on `firm_settings`. Migration touches the versioned-table
  carry-forward helper (CLAUDE.md "Versioned-table carry-forward
  audit" pattern from Slice RI.7). Modest scope.
- **(b) Hardcode `true` v1; scope addition to v1.1+.** Brief's
  blocked-mode actions skip the override-unavailable branch in
  v1; scenario s14 doesn't surface in production until v1.1
  lands. Loses the discoverability fix CD landed in round-2.
- **(c) Defer via static config** (e.g., env var). PMs can't
  toggle per-firm; not aligned with single-firm v1 anyway. Most
  expedient.

**CC lean: (a) add column.** Versioned-table pattern is already
in place; the migration is mechanical; preserves CD's locked
design intent. Brief should explicitly call this as the v1 work,
not bank to v1.1+ (which leaves the inert action card guessing
what to render).

### Catch #2 — `firm_settings.allow_accept_risk` does NOT exist [BLOCKER]

Same shape as Catch #1. Data-source map §"Accept-risk banner"
gates banner visibility on `firm_settings.allow_accept_risk`.
Scenario `s08_blocked_accept_risk` exercises the false case.

**Verified:** column doesn't exist.

**Disposition options:** Same as Catch #1.

**CC lean: (a) add column.** Same rationale. Single migration
covers both new policy fields:

```sql
alter table firm_settings
  add column allow_override boolean not null default true,
  add column allow_accept_risk boolean not null default true;
```

Action layer carry-forward helper in `actions/firm-settings.ts`
extends per the pattern.

### Catch #3 — Cost stack shape mismatch [ARCHITECTURAL · v1.1+ banked]

Data-source map §"Cost stack" expects 4-field shape per cell:
`{pkg, prod, frt, dt}`. Brief §8 watchpoint already flags this.

**Verified:** R6.2 freight slice replaced `freight_inputs` with
`freight_leg_groups` + multi-leg `freight_legs` carrying
`customs JSONB` (duty + tariff per leg). Production cost stack
composition reads from this multi-leg model, not the flat
`{pkg, prod, frt, dt}` shape CD's prototype assumes.

The data-source map's note "Per-tier rollup (averaged across
SKUs) — derived" works fine when the classifier consumes the
production roll-up (which already aggregates legs into a single
`freight` total per tier). But the classifier's `Cell.cost_stack`
type signature `{ pkg, prod, frt, dt }` collapses multi-leg +
customs-JSONB into 4 buckets — that's a rollup, not a copy.

**Disposition:** Classifier rolls legs+customs → 4-bucket
display. Document the rollup formula in the classifier comment
header so future-CC reading the type sees the structural choice
(not a schema reference). v1.1+ candidate: per-leg cost-stack
display when PM demand surfaces.

**CC lean: ship the rollup; document inline.** Brief is correct
that this is reconcile-during-Architect-pass; flagging the
disposition so the classifier impl carries the rollup formula
explicitly.

### Catch #4 — `CostStackHeader` is cross-surface [HYGIENE]

Brief §5 "Components to TEAR DOWN · Layer 2" lists
`CostStackHeader` under tear-down with the asterisk:
"R6 cost stack stays via `app/r6/cost-stack.jsx`; verify reuse,
don't double-tear."

**Verified:** `CostStackHeader` import sites:
1. `src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx:33` —
   Costs surface (R6.2 production)
2. `src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx:15`
   — Pricing surface (the slice's tear-down target)

The component CANNOT be deleted. The Pricing surface's IMPORT +
mount is what goes away; the file stays for the Costs surface.

**Disposition (CC):** Step plan must distinguish "remove import +
mount from Pricing page" from "delete component file." The
brief's §5 list reads as "delete the file" when read literally;
the asterisk caveat is correct but easy to miss. CC review locks
this as remove-import-only.

### Catch #5 — `MarginVerdictPill` + `MarginSparkline` + `TwoAxisVerdictPair` + `ReverseSolveDialog` consumed by SKU summary row [HYGIENE]

Brief §5 Layer 2 lists `SkuSummaryRowList` for tear-down.
That's the LIST component; the row component
(`sku-summary-row.tsx`) imports four siblings:

- `MarginVerdictPill` from `src/components/pricing/margin-verdict-pill.tsx`
- `MarginSparkline` from `src/components/pricing/margin-sparkline.tsx`
- `TwoAxisVerdictPair` from `src/components/pricing/two-axis-verdict.tsx`
- `ReverseSolveDialog` from `src/components/pricing/reverse-solve-dialog.tsx`

Also `MarginVerdictPill` is consumed by
`src/components/quote-summary-card.tsx:15` (sibling surface) —
deleting it would break Quote umbrella summary cards.

**Disposition (CC):** tear-down list scope is the ROW component
(or row-renderer) only. The shared primitives stay shipped.
Designer notes §9 round-2 doesn't ask for these to be replaced;
they're per-SKU detail primitives that fold naturally into the
new `SkuBreakdown` component.

CC lean: rewrite the tear-down list to say "remove the legacy
PricingSurface ROOM 0/1/2/3 IMPORTS + MOUNTS from
`pricing/page.tsx`; preserve the underlying components for
sibling-surface use; introduce new compositions per CD's
prototype that re-use the surviving primitives where it makes
sense."

### Catch #6 — `EmptyState` name collision [NOTATION]

Brief §5 Layer 1 lists
`src/components/pricing-reframe/empty-state.tsx` for tear-down.

**Verified:** the `EmptyState` IDENTIFIER also names a function
in `src/app/page.tsx:122,131` — but it's a LOCALLY-defined
function for the home page's empty state, not an import from
`pricing-reframe/`. No collision risk; just flagging that a
grep-and-delete sweep needs to be import-aware.

**Disposition:** notation-only. Step plan includes
`grep -rn 'from .*pricing-reframe/empty-state'` to filter to
genuine consumers before deleting.

### Catch #7 — `quote.global_lift_pct` field name mismatch [NOTATION]

Data-source map §"Global price adjustment" writes
`schema: quote.global_lift_pct (writable)`.

**Verified:** the production column is `quotes.global_price_adj_pct`
(numeric(5,4)), at `schema.ts:284`. No `global_lift_pct`.

**Disposition (CC):** notation-only. Classifier impl uses the
real field; data-source map is design-side reference. Banking
this as the classifier-impl reference so future-CC reading the
data-source map doesn't search for a phantom column.

### Catch #8 — `quote.suggestions.{surgical, global}` field shape [NOTATION → DEFERRED]

Data-source map references `quote.suggestions.surgical/.global`
populated by the suggestion engine. Brief §10 expects classifier
to consume this shape.

**Verified:** the existing engine
(`src/lib/pricing-suggestions.ts`) returns suggestions per call;
they're not persisted as a `quotes.suggestions` JSON column.
They're computed-on-render values today.

**Disposition (CC):** the classifier doesn't need persistent
suggestions; it consumes `pricingSuggestions(quote, policy)` at
classify-time. Data-source map's "schema:" prefix is misleading
— these are derived, not persisted. v1.1+ if perf shows
classify-cost saturating; v1 ships the in-render call.

CC lean: notation only. Classifier impl calls the existing
suggestion engine; data-source map's "schema:" labels are
designer notation, not a contract.

---

## §3 — Open questions (CC review additions to brief Q1-Q4)

### Q5 — Schema migration timing (from Catches 1+2)

Brief §17 Q1-Q4 doesn't ask about schema. Catches 1+2 surface a
mandatory migration for the locked design.

CC proposes: **Step 1 (kickoff)** locks the schema migration as
Step 2 of the slice. Architect verifies migration shape;
versioned-table carry-forward helper extension lands with the
column add. No subsequent step depends on the migration ordering
beyond Step 2.

### Q6 — `cost_stack` rollup formula authority (from Catch #3)

Where does the leg+customs → `{pkg, prod, frt, dt}` rollup live?

- (α) Classifier — `classify()` computes the rollup and surfaces
  `Cell.cost_stack`.
- (β) Costing math layer — `src/lib/costing.ts` extends to
  return the rolled-up shape; classifier reads it.

CC lean: **(β) costing math layer**. The rollup is canonical for
all consumers (Pricing surface, Quote umbrella PDF, future cost
analysis), not Pricing-specific. Co-locating with the math layer
matches the "Costing math library; serves all four surfaces"
note in CLAUDE.md.

### Q7 — Versioned-table carry-forward extension [pre-build pattern]

Per CLAUDE.md "Versioned-table carry-forward audit," adding new
columns to `firm_settings` requires every `updateFirmSettings`-
style action to carry the new values forward. The pattern says:

> When a new column lands on a versioned table, every existing
> update path must carry forward unchanged columns OR be
> intentionally resetting them.

CC verifies the `versionedFirmSettingsUpdate` helper (per
CLAUDE.md reference to `src/app/actions/firm-settings.ts`)
exists and extends cleanly. Confirm during Step 2 schema work.

### Q8 — `provisional` mode taxonomy [from designer notes §4.4]

Designer notes §4.4 says "sendable becomes 'sendable_provisional'"
when any cell is missing. But the type signature in the data-
source map's `QuoteState.mode` enum has 3 values:
`"sendable" | "suggestion_led" | "blocked"`. No `sendable_provisional`.

Where does provisional live? Two options:

- (α) Add 4th mode value `sendable_provisional`.
- (β) Keep 3-mode taxonomy; provisional is the
  `flags.data_incomplete = true` flag composed with
  `mode === "sendable"`. State line shows asterisk via
  `state_line.status === "provisional"` (per the data-source map's
  `pill.status` enum).

CC lean: **(β) keep 3 modes + flag**. Designer notes §4.4 names
it "sendable_provisional" verbatim but the data-source map's
QuoteState contract uses `state_line.status` with a 4-value enum
(`sendable | review | blocked | provisional`). Mode + state-line
status answer different questions; provisional is a state-line
modifier on the sendable mode, not its own mode.

### Q9 — Performance baseline measurement [from brief §17 Q3]

Brief Q3 (CA lean YES if cheap). CC concur — capture current
Pricing surface render time before tear-down so post-redesign
comparison has ground truth.

CC lean: 30-min lighthouse-or-similar measurement on a
representative quote (5 SKUs × 5 tiers, blended ~25% at floor) at
Step 1 kickoff. Baseline persists in the kickoff doc.

### Q10 — Tear-down sequencing [from brief §17 Q4]

Brief Q4 (CA lean: tear down AFTER new shape lands). CC concur.

CC lean: tear-down step is **last** before smoke (between
DETAIL impl and CB walk). Production code carries both shapes
mid-slice; tear-down commit cleanly removes the legacy mount
once the classifier-driven shape is verified green. Avoids
broken-state commits mid-slice per brief.

### Q11 — Step plan granularity [from brief §17 Q1]

Brief Q1 CC's call. CC proposes **9 steps**:

1. Kickoff (this doc bundle + Pattern 22 §0.5 lock)
2. Schema migration (`firm_settings.allow_override` + `.allow_accept_risk`
   + versioned-table carry-forward helper extension)
3. Classifier impl (`src/lib/pricing-classifier.ts`) — `QuoteState`
   contract + `classify()` pure function + invariant unit tests
4. STATE zone components (`StateLine`, `StateCallout`, `StateCard`)
5. ACTION zone components (`SendableSummary` NEW; `ActionCard`,
   `SuggestionCard`)
6. DETAIL zone components (`DetailZone` toggle, `DetailGlobalAdjust`,
   `DetailTierTable`, `DetailCostStack`, `DetailPerSku`,
   `SkuBreakdown`, `DetailMetaTiles`)
7. Page composer + recompute pipeline + mode-transition flash +
   persistent hint
8. Legacy tear-down (`pricing-reframe/*` + Pricing page's legacy
   ROOM 0/1/2/3 mounts; preserves shared primitives per Catch #5)
9. Smoke guide PSR-1..PSR-14 + cumulative Pattern 27 fold +
   §0.5 ledger + PR

Steps 4-6 can run in parallel within a working session; sequencing
above is the commit-order suggestion.

---

## §4 — Architect schema verification timing

Brief §8 + §17 Q2 ask: pre-Step-1 or as Step 1? CA lean Step 1.

CC concur with Step 1. The Catches 1+2 verification IS the
Architect §0.5 pass; this review surfaces them pre-build. Step 1
(kickoff) consolidates: §0.5 ledger + dispositions + step plan
lock + schema migration design lock. Step 2 (schema migration)
executes against the locked design.

No subsequent steps depend on Architect re-verification; the
catches scale-up doesn't require a second Architect pass mid-
slice. If Step 3 classifier impl surfaces a new mismatch, surface
back; otherwise the §0.5 work is done.

---

## §5 — Cross-stream watch items confirmed

Brief §9 calls out cross-surface effects. CC verifies:

- **Audit log:** `audit_log` exists with `action` text column.
  Existing pattern from prior slices (Slice 9.2 source-namespace
  convention; Slice 8.5 cascade pattern; FR-12 single action with
  discriminator). Pricing redesign emits per the
  brief's "every Apply Surgical, Apply Global, Request Override"
  enumeration. CC banks a step-side audit namespace doc update for
  CLAUDE.md (similar pattern to FR-12's `scenario_copied`).
- **`Mark accepted →` removal:** verified the header CTA lives
  in the page composer. Mounting removal is in scope; the
  destination (Quote umbrella Mark Accepted sub-tab) ships in
  Slice 12 (queued).
- **Lineage chip (FR-12):** confirmed lives on project detail
  scenario cards, NOT Pricing. No collision.
- **`pricing-predicates.ts`:** `TARGET_TOLERANCE = 0.001` +
  `isBelowTarget` + `isBelowFloor`. CC verifies all three usages
  fold into classifier (`src/lib/pricing-suggestions.ts` keeps
  importing the constants; tier-compliance-block + blended-
  headline are torn down). Classifier inherits the tolerance
  discipline.

---

## §6 — Locked dispositions (Q1-Q11 summary)

Concur unless flagged:

| Q | Source | Disposition | CC lean |
|---|---|---|---|
| Q1 | Brief §17 | Step-plan granularity | 9 steps (Q11 detail) |
| Q2 | Brief §17 | Architect schema verification ordering | Step 1 |
| Q3 | Brief §17 | Performance baseline measurement | YES (Q9 detail) |
| Q4 | Brief §17 | Tear-down sequencing | AFTER new shape (Q10 detail) |
| Q5 | CC | Schema migration timing | Step 2 (mandatory) |
| Q6 | CC | cost_stack rollup formula authority | Costing math layer |
| Q7 | CC | Versioned-table carry-forward extension | Confirm in Step 2 |
| Q8 | CC | provisional mode taxonomy | Keep 3 modes + flag |
| Q9 | CC | Performance baseline | 30-min Lighthouse @ Step 1 |
| Q10 | CC | Tear-down sequencing | Step 8 (after new shape ships) |
| Q11 | CC | Step plan | 9 steps |

---

## §7 — Pre-merge gates (concur with brief §15)

Standard cadence:

- [ ] Typecheck PASS every commit (`npx tsc --noEmit`)
- [ ] Pattern 47 verify PASS every commit
- [ ] Pattern 22 §0.5 verification PASS (this review)
- [ ] Pattern 27 two-layer manifest per implementation commit
- [ ] Pattern 28 polish layer verbatim from CD prototype
- [ ] Pattern 30 path determination at Step 1 (CSS namespace
      lockdown)
- [ ] Pattern 45 customer-view boundary clean (Pricing surface
      is PM-internal; no PDF tree impact)
- [ ] Classifier invariant unit tests (brief §15 enumeration)
- [ ] CB end-of-phase smoke walk (merge gate; PSR-1..PSR-14)

---

## §8 — Carry-forwards (banked)

Concur with brief §12 verbatim. Plus from this review:

- **Multi-leg cost stack display** (per-leg in cost stack vs
  rollup to 4 buckets) — v1.1+ when PM demand surfaces (Catch #3)
- **`worst_plausible_margin()` provisional refinement** —
  instrument inert-CTA frequency first per designer notes §8
- **Per-PM DETAIL preference** — session-only in v1; v1.5+
  candidate
- **Mode-transition animation polish** — v1.5+ if usability
  surfaces missed transitions
- **Performance baseline regression check** — bake into post-v1
  monitoring if Lighthouse delta surfaces concern

---

## §9 — Sequencing

v1 release-path item 6 (per brief §11). Prereqs (PRs #50-#53)
shipped. No schema-overlap risk.

Post-merge: Slice 12 Mark Accepted + NetSuite SO push (queued).
The Quote umbrella IA destination for the removed `Mark accepted →`
CTA lands in Slice 12.

---

## §10 — Acceptance

**Brief approvable** pending:

1. **Catches #1 + #2** dispositions: confirm CC lean (a) — add
   both columns to `firm_settings` with versioned-table carry-
   forward helper extension. Migration ships as Step 2 of slice.
2. **Catches #3-8** dispositions concur; Step plan absorbs.
3. **Q5-Q11** dispositions: CC leans surfaced; Edward + CA lock.

Once those land in the brief inline, Step 1 (kickoff) can open.

— CC, 2026-06-16
