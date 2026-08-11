# Pricing Phase 3 · operator acceptance review

**Edward operating. 2026-08-10.** Technical closure of Phase 3 and P3-017 remains
intact; this review does not reopen either. Findings are recorded here as they
are observed and are **not repaired** unless Edward dispositions them.

A finding reopens completed engineering only if the observed behaviour violates
an accepted contract or creates a material V1 operator/business failure.
Everything else is a recommendation or post-V1.

**Environment.** `http://127.0.0.1:3100` — isolated validation instance on the
release branch. Production is **not** the review surface: `b6de377` (P3-016),
`b4ebbd5` (Cost Stack restoration) and `3d5564e` are all release-branch only, so
production still serves the R6 stack and the write-at-click path.

**Quote.** Acme Beauty 6 SKU launch · `a5672a11-aae8-4e8d-8b47-40acc20685c1` —
1 assembly, 6 leaves, 4 tiers (1k / 10k / 25k / 50k), firm target 35% / floor
25%. One pre-existing direct price of `$12.5000` on Sprayer × 10,000, left by a
test run and deliberately not cleared.

---

## V1 blocker

### B-2 · A staged lift moved the quoted price with no row — **FIXED 2026-08-10**

**Observed by Edward, step 1:** *"when i click global price adjustment i see the
staged changes in the cost stack. lift all 1 to floor does not do that."*

**Reproduced.** The Cost Stack's row list is IDENTICAL before staging, after
staging a lift, and after staging a quote-wide adjustment:

```
Packaging · Production · Bulk raw · Freight · Duty + tariff
Sell before adjustment · Price adjustment · Sell after adjustment
PM overrides · Quoted sell · Unit cost · Margin
```

`Surgical lifts` and `Sell after lifts` **never render**. With a lift staged the
stack shows `Quoted sell +$0.1331` and `Margin +3.0pp` — and no row that
accounts for either. The global adjustment appears to behave correctly only
because `Price adjustment` is an unconditional row.

**This violates an accepted contract, and a load-bearing one.** R11 §4:

> **Every lever that can change a quoted price owes the cost stack a row.** If
> it cannot be shown as a row, the stack cannot assert reconciliation, and the
> assertion is the thing that makes the stack trustworthy. **← LOAD-BEARING**

**Root cause — mine, from the P3-017 restoration.** The conditional rows key on
`state.cells[].lift_applied_pct`, and `state` is the CLASSIFIER, which describes
COMMITTED state. The Design Authority keys the same rows on `rollups`, which in
the prototype is computed from the WORKING set. So the row appears canonically
the moment a lift is staged, and in production only once one is applied — and
this quote has no committed lifts, so it never appears at all.

Two bases for one question, which is Pattern 50 exactly. I wrote a comment in
`detail-zone.tsx` claiming the existence test was correct because *"a lift
refused by an override contributes exactly nothing, so keying on the delta would
delete the rendering that shows a refusal happened."* That reasoning is sound
and it is about the wrong axis: it argues existence-over-delta, and says nothing
about committed-over-working. I got the first choice right and never noticed the
second.

**The reconciliation strip does not catch it**, and that is the sharpest part.
The strip reads governed node values, not rendered rows, so it reports ✓ on a
column whose *visible* rows no longer add up. Exactly the failure mode the
4-decimal note in `format.ts` was written about — a correct assertion sitting
under numbers that appear to contradict it — arriving by a different route.

### Disposition — Edward, 2026-08-10: **narrow basis correction.** SHIPPED.

#### The exact basis change

Lever-row EXISTENCE moved off the classifier and onto the governed working set.

| | before | after |
|---|---|---|
| source | `state.cells[].lift_applied_pct` / `.override_applied` | `working.lifts` / `working.overrides`, **unioned** with the classifier |
| basis | COMMITTED | WORKING (intended state), plus committed |
| resolved in | `detail-zone.tsx`, in-component | `pricing-surface-shell.tsx`, at the composition point |

Nothing else moved. No lever semantics, no redesign, no change to what a row
*contains* — contribution values are still read from their governed nodes in
`blendedByTier`, so a refused lift renders the zero the graph actually holds.

**Why a union rather than a swap.** `working` is the right basis and is the
complete intended set, but the staging model documents one case it cannot carry:
persisted overrides whose identity does not translate to a staging key "pass
through unchanged — they are real and in effect". Keying purely on `working`
would have dropped the row for those. Existence is monotone, so showing a lever
when either source knows of it is correct in both directions, and a union cannot
*lose* a row — which is the whole property under repair.

#### Evidence — `tests/e2e/costing/cost-stack-lever-rows.spec.ts`, 4 tests

**Staged** — from a quote with no committed lift: `Surgical lifts` and `Sell
after lifts` both appear immediately, in canonical order (after `Sell after
adjustment`, adjacent to each other, before `Quoted sell`), and the displayed
contribution accounts for the displayed movement in `Quoted sell`.

**Applied** — both rows survive the transition to committed state, with a
non-zero contribution. Polled rather than read once: Apply persists and *then*
the store reconciles, so the committed graph carrying the lift arrives after the
staging bar clears.

**Removed** — discard releases both rows. Existence follows the governing set in
both directions, not just on the way in.

**Override / refusal — existence-over-delta preserved.** A lift is staged, then
a direct price is set on the same cell. §13.3: the override supersedes the
computed chain, so the lift moves the price by nothing. `Surgical lifts` **stays
rendered at zero** alongside `PM overrides`. A refusal the operator can see is
the point; a zero contribution must not erase evidence that the lever exists.

#### The detection gap

The strip reconciles governed node VALUES, so it prints ✓ whether or not any of
its four terms was ever rendered. The new detector asserts a property of the
rendered DOM instead, in movement:

```
Δ(Quoted sell) === Δ(Sell before adjustment) + Δ(Price adjustment)
                   + Δ(Surgical lifts) + Δ(PM overrides)
```

every term read from the staged-delta chips the page actually painted, and **a
row that does not exist contributes nothing — which is exactly how it fails.**
It consults neither the row-generation logic it checks nor the governed values
the strip already reconciles, so it is not circular. It is deliberately written
to name no row, so it also catches a future lever that has no name yet.

**Proven to detect `81de6bb`.** With the repair reverted and the tests kept:

```
column 0 — Quoted sell moved 0.1331 but the visible contribution rows
account for 0.0000. A lever moved the price with no row on screen.
Rows present: Packaging, Production, Bulk raw, Freight, Duty + tariff,
Sell before adjustment, Price adjustment, Sell after adjustment,
PM overrides, Quoted sell, Unit cost, Margin
```

**The detector was vacuous on its first draft, and the falsification run is what
caught it.** It keyed the staged chip on `.delta` — which is also the class a
CONTRIBUTION row uses for its own value, since a contribution is signed. So it
matched the value on those rows and nothing at all on level rows, summed zero
against zero, and **passed against the unrepaired build.** Re-keyed on
`title="was X · staged Y"`, which belongs to the staged chip alone. Had I only
run it against the fixed code it would have shipped green and guarded nothing.

#### One regression this introduced, and its repair

The spec applies a lift, which writes a `pricing_adjustments_applied` audit row.
VAL-209 counts those rows on the *same fixture quote* and asserts exactly one —
so it failed `Expected: 1, Received: 2` in the full suite while passing in
isolation. VAL-209's own teardown is bounded to rows created after IT started
and so can never clear a row left earlier. Fixed in this spec's teardown, bounded
the same way: committed lifts cleared, and audit rows for the quote, its tiers
and its leaves deleted for the window this file was running.

Gates: `test:unit` 744/744, `prebuild` PASS, `tsc` clean, `test:e2e` **34 passed
/ 3 failed** — two the classified freight findings, the third (VAL-101) passing
in isolation and in a combined run, the known cross-project concurrency variance.

### B-1 · Staged changes gave no feedback where the operator was looking — **FIXED 2026-08-10**

**Observed (step 1, reported early):** *"none of the 'Lift all 1 to floor'
buttons work."*

**They work.** Measured on the deployed branch, `r3Volume`:

| | |
|---|---|
| buttons found | 4, all enabled, all functional |
| click result | stages correctly — chip reads *"Lift Bottle · MOQ · 1,000 units by 5.3%"* |
| chip position | `y = −851` — **1196px above the button**, off-screen |
| both visible at once | **never**; viewport is 720px |
| at the point of action | unchanged: still 4 buttons, still *"Lift all 1 to floor"* |
| console / page errors | none |

**Not a contract violation.** Staging behaves exactly as P3-016 specified, and
the compliance grid is *correct* to stay still: the classifier describes
COMMITTED state, so a staged lift must not move the grid. Both halves are right
on their own terms.

**It is a material V1 operator failure.** The only evidence the action landed is
a chip 1196px above the fold. From the operator's seat a working control is
indistinguishable from a dead one — the product owner, who commissioned the
feature, read it as broken.

**The consequence is one this codebase has already paid for.** The reflex when a
button appears dead is to press it again. That reflex produced P3-016 in
production: `null → 0.1884 → 0.4123`, two writes 727ms apart, compounding.
Staging is idempotent so repeat presses are harmless *here* — but the surface is
still teaching the operator that habit, and AM-005 records the same quote being
double-pressed again on 2026-08-10 at 20:57.

**Confirmed by the operator, 2026-08-10:** *"ok i see it now — this is a problem
the operator would have the same issue as me."* The product owner, who
commissioned the feature and knows the staging model exists, read a working
control as broken and stayed convinced across three rounds of evidence. That is
the finding; no stronger signal is available for this class.

**Reproduced three times, two browsers:** headless at 720px (chip 1196px above
the button), the operator's own Chrome at ~1970px (button y=1508, chip y=332),
and in the operator's own session — where a scroll of a few hundred pixels to
reach the grid is enough to push the only confirmation off the top.

**The failure generalises beyond this control.** Every staging affordance on the
surface — per-cell lift, direct price, per-tier adjustment, the recommendation
CTAs — reports into the same single bar at the top of the page. Any of them
operated from below the fold has the same silence. Fixing this button would
leave the shape intact.

**Not repaired.** The fix is a design decision, not a correction:

| option | what it costs |
|---|---|
| **Sticky staging bar** — `position: sticky` once anything is staged | Smallest change, no new state, and it fixes *every* affordance at once rather than this one. **Hazard:** R11 already released the trace anchor from `position: sticky` because two elements pinned at `top: 0` overlay each other (CLAUDE.md, R11 §load-bearing). Needs to compose with the inline trace shipped under R-1 |
| **Feedback at the point of action** — the row acknowledges the press | Closest to where the eye is. **Contract risk:** the grid describes COMMITTED state by construction, and that is the structural property (H2) making the banner and the grid unable to disagree. A *staged marker* says "you asked for this", not "this is the state" — defensible, but it is the same blur P3-016 punished |
| **Scroll the bar into view on first stage** | Cheapest. Hostile — takes the operator's place in the grid away, and grates on every subsequent stage |

### Disposition — Edward, 2026-08-10: **sticky staging bar.** SHIPPED.

**The repair is four lines of CSS and no TypeScript.**

```css
.r12-staging:not(.applied) { position: sticky; top: 0; z-index: 30; }
```

`:not(.applied)` **is** the pending test rather than a new flag. The component
already renders exactly two mutually exclusive bars — `.r12-staging` when
changes are staged, `.r12-staging.applied` when nothing is pending but levers
are in effect — so the distinction was already in the DOM. Two consequences: no
new state to get wrong, and the bar releases on its own, because the element
that was sticky simply stops being rendered when `isStaged` goes false.

Nothing was added to the compliance grid. It continues to describe COMMITTED
state, which is the property (H2) making it and the banner unable to disagree.

### Evidence — `tests/e2e/costing/staging-bar-sticky.spec.ts`, 7 tests

Each path scrolls the control below the fold, acts, and asserts four things. The
fourth is what makes the other three mean anything: at the same instant the
bar's `position` is forced back to `static` and re-measured, so the test proves
the REPAIR put the bar on screen rather than the page happening to be short.

| staging path | bar top after | where it would sit unstuck |
|---|---|---|
| bulk `Lift all N to floor` | **0** | −907px |
| per-cell lift | **0** | −478px |
| direct price | **0** | −478px |
| recommendation CTA | **0** | −171px |
| quote-wide adjustment | **0** | −1082px |

**Paths 3 and 4 of the disposition are one mechanism in this build.**
`stageTierAdj` has exactly one caller — the shell's `onApply`, reached from the
recommendation CTA — so there is no separate per-tier adjustment control to
walk. Recorded rather than presented as two proofs. The quote-wide lever
(`Stage this adjustment`) is covered as a fifth distinct path.

**Apply, removal and release, all from the pinned state:** two changes staged
from below the fold; one chip discarded and the bar stays pinned with the
remainder; Apply pressed from the pinned bar and the staged bar releases; the
`.applied` bar replacing it is asserted `position: static`, because nothing is
pending. A full `Reset all` releases it too.

**The hazard named in the disposition, tested:** with the bar pinned AND an
inline cost-stack trace open — `bar z=30`, trace anchor `position=relative z=3`,
`overlap=false`. R11 releases `.r10-anchor` from `position: sticky` inside
`.r11-tracewrap` precisely because two elements pinned at `top: 0` overlay each
other; the inline trace shipped under R-1 keeps that release, and the test
asserts it rather than trusting it.

**One instrument corrected mid-repair.** The first version asserted `scrollY`
was unchanged. That is the wrong measurement, and it failed: Chrome's scroll
anchoring RAISES `scrollY` when content is inserted above the fold, precisely to
hold the view still — so an unchanged `scrollY` would have meant the content
slid. Re-expressed as the compliance grid's position in viewport coordinates,
which is the property the disposition actually names. Measured movement: **≤4px
on every path.**

Gates: `test:unit` 744/744, `prebuild` PASS, `tsc` clean, `test:e2e` 33 passed /
3 failed — two the classified freight findings, the third passing in isolation
(known cross-project concurrency variance).

**Sufficiency is not claimed.** Whether one shared surface is enough — or
whether the per-cell paths also want acknowledgement where the hand is — is an
operator question, and the remaining walkthrough is what answers it.

**Scope note:** this is the bulk control in the compliance grid
(`compliance-grid.tsx:407`). Whether the per-cell *"Lift {label} to floor"*
(`cell-action.tsx:400`) and the recommendation CTAs share the shape is
**unmeasured** — not yet walked, and not assumed.

## Recommendation

### R-1 · Cost Stack trace placement — **DISPOSITIONED: inline. Shipped.**

**Observed (step 9, reported early):** pressing a Cost Stack cell opens the trace
at the bottom of the page rather than in line.

**Contract position: NOT a violation.** The Design Authority renders the stack
trace *below* the stack, not inline — `pricing-page.jsx:978` places
`<StackTrace>` as a sibling after `<CostStack>`, and the panel's own scope copy
says *"…that is a row **in the stack above**."* The inline behaviour was the R6
table's, where tiers were rows and there was a row to pin beneath; the transpose
to the accepted R11/R12 shape removed that. The canonical keeps inline traces for
the **per-SKU** breakdown only (`SkuTrace`, rendered inside the SKU block).

**Two things make the correct placement read wrongly, and the first is a
regression introduced by the restoration:**

1. **A gap that the Authority does not specify.** Canonical `.r11-tracewrap`
   carries `border-top: 1px solid var(--accent)` and butts flush against the
   element above, so the panel reads as that box expanding. The restoration
   added an outer `.psr-stack-tracewrap { margin-top: 10px }`
   (`r12-pricing-workspace-overrides.css`), which breaks the join. Nothing in the
   Authority asks for it. **Author error, not a design decision.**

2. **The scope note is not rendered.** Canonical `StackTrace` passes a
   `scopeNote` naming what the chain explains and what the quoted price carries
   beyond it — *"This chain explains sell before adjustment ($X). The quoted
   blended price ($Y) also carries N% price adjustment and one surgical lift —
   those are rows in the stack above."* Production's `renderStackTrace`
   (`pricing-surface-shell.tsx`) passes no scope note, and `PricingTrace` has no
   parameter for one. **Pre-existing; predates the restoration.** It is the
   sentence that ties a below-the-stack panel back to the pressed cell, so its
   absence compounds (1).

Also unimplemented from canonical `StackTrace`: the **synthetic `blended-root`**
that roots the chain at `Sell before adjustment · blended` with the five section
blends as its operands, and the `meta` line (`{units} units across {n} SKUs ·
margin on quoted {pct}`).

### Disposition — Edward, 2026-08-10: **make it inline.** Shipped.

The trace now opens as the element immediately after the row whose cell was
pressed, keeping the canonical `.r11-tracewrap` register (accent top-rule, flush
against what it expands). The `.psr-stack-tracewrap` gap is deleted.

**This is an accepted Nexus extension (Pattern 39), not a fidelity gap**, and it
is recorded as one in `detail-zone.tsx` and in the overrides stylesheet so a
later audit finds the reason rather than re-raising the divergence. The
prototype already uses an inline trace for the per-SKU breakdown (`SkuTrace`),
so the vocabulary is canonical even where this placement is not.

Which row owns the open trace is resolved by **matching the traced node key
against the keys each row rendered** — not by parsing `quote/{tier}/{name}`,
which would be identity derivation in the layout layer and would break silently
the first time the grammar gained a segment.

Pinned by `tests/e2e/costing/cost-stack-inline-trace.spec.ts`, which asserts
**adjacency** — that the panel is the next DOM sibling of its row — rather than
mere visibility. The previous placement would have satisfied any test that only
checked the panel existed.

**Still open, and NOT part of this disposition:** item (2), the missing scope
note, plus the synthetic root and meta line. Recorded as R-2.

### R-2 · The stack trace is thinner than the Authority's

Independent of placement. Canonical `StackTrace` (`pricing-page.jsx:996`)
carries three things production does not:

- a **scope note** — *"This chain explains sell before adjustment ($X). The
  quoted blended price ($Y) also carries N% price adjustment and one surgical
  lift — those are rows in the stack above."* `renderStackTrace` passes none,
  and `PricingTrace` has no parameter for one.
- a synthetic **`blended-root`** rooting the chain at *Sell before adjustment ·
  blended*, with the five section blends as its operands.
- a **meta** line — `{units} units across {n} SKUs · margin on quoted {pct}`.

Pre-existing; predates the Cost Stack restoration. Less acute now that placement
is inline, since adjacency supplies by position most of what the scope note
supplied by words — but the sentence also names what the quoted price carries
*beyond* the traced chain, which adjacency cannot say.

## Post-V1

*(none recorded yet)*

---

# Findings outside Phase 3 scope

Observed during the same session on the **Costs** surface (Phase 2, in progress,
design fidelity open). Recorded here so they are not lost; they belong to Costs
acceptance, not to this review, and none is repaired.

## C-1 · The Production markup cell says "no markup" while a markup is applied

**Observed by Edward:** *"on the costs page, production section, markup fields
doesn't seem to work."*

**There is no field.** `production-drilldown.tsx:480` is the only occurrence of
`markup` in the file:

```jsx
<div className="num">
  <span className="markup">—</span>
</div>
```

And it is not an unwired input either: `assembly_production_inputs` has **no
markup column**. Production markup is firm-wide by design —
`lookupMarkup(markupDefaults, "Manufacturing")`, set at
`/admin/markup-defaults` — and the engine applies it:
`productionCostSum × (1 + productionMarkup)` (`costing.ts:1687`).

**So the behaviour is correct and the display is not.** In the same column, on
the same page, packaging renders a *resolved, editable* markup with a
`markupPctSource` of `category_default` or `manual_override`. Production renders
a bare em-dash. An operator reading down the page sees markups on packaging and
`—` on production, which reads as *production is quoted at cost*. It is not: the
Manufacturing markup is in the PROD row of the cost stack and in every quoted
price.

This is Pattern 57's family — not a wrong number, a **cell asserting something
false about a commercial quantity**. The nearest honest fix is small and needs no
schema: the engine already holds the resolved value and even publishes it as a
node (`costing.ts:1796`), so the cell can render it read-only with a source
caption, exactly as packaging does for a category default.

**Severity is Costs' call, not this review's.** It misleads rather than
miscalculates, so it is not a V1 blocker on the Pricing acceptance criteria; on
a cost surface whose job is to explain where money goes, it is more than
cosmetic.

## C-2 · Bulk raw silently uses the "Other" markup — adjacent, unasked, one line away

Noticed while tracing C-1, and stated rather than left:
`RAW_MARKUP_CATEGORY = "Raw ingredients"` carries its own comment —
*"Slice 9 will likely add this; falls back to Other today"* (`costing.ts:841`).
So every bulk-raw cost is marked up at the **Other** rate, and nothing on any
surface says so. Same shape as C-1 one row down. Not investigated further.
