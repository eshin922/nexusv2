# P3-016 · Recommendation CTAs bypass the R12 staging contract

**Status: CLOSED 2026-08-10** on the recorded browser evidence. Runtime
observation taken · both callers classified · repair shipped · six of eight
browser proofs observed, two pinned by test with the gap recorded.

**Production evidence arrived after the repair, via [AM-005](AM-005-s7-scope.md).**
The defect fired on a live quote on 2026-08-10: two `pricing_suggestion_surgical`
writes **727ms apart**, `null` → `0.1884` → `0.4123`, which is `1.1884² − 1`.
An operator pressed the CTA twice because the first press looked like it had
done nothing — the exact reading this record predicted, confirmed by the audit
trail rather than by inference.

That evidence also exposed a defect in the repair itself: it first composed the
recommendation onto the **working** set, so a repeat press compounded the same
way — visibly and discardably, but still wrongly. Corrected to compose from
**committed**, the basis the classifier computes the recommendation on, which
makes a repeat press idempotent. Verified in the browser (two presses, one chip,
unchanged at `15.4%`) and pinned by test.

**Discovered:** 2026-08-10, after the compliance audit closed. New row, not a
reopened one — IDs are append-only, so this takes the next free number in the
P3 block.

---

## The conflict

Two accepted positions, both currently true in the repository, that cannot both
be honoured.

| | says |
|---|---|
| **R12 interaction contract** *(accepted)* | The recommendation **stages first**. Page-level Apply persists the working set. |
| **Implemented model** *(shipped, commented, unit-tested)* | Per-tier adjustment is an **immediate-write lever authored outside** the working set. |

This is a **contract conflict**, not a wiring defect. The distinction decides
the repair: nothing here is unwired, and a one-line fix would silently pick a
winner between two accepted positions.

### Where the bypass is encoded as intentional

| location | |
|---|---|
| `src/app/actions/pricing-lifts.ts:94` | *"Nothing STAGES one of these — `applySurgicalAdj` and `applyGlobalAdj` write…"* |
| `src/lib/pricing-apply-plan.ts:50-51` | *"The fourth lever, and the one that is authored elsewhere… write `quote_tiers.tier_price_adj_pct` immediately"* |
| `src/components/pricing-surface/pricing-staging-context.tsx:351, 495` | Seeds around *"the layer (`applySurgicalAdj`) that revalidates without remounting"* |
| `tests/unit/pricing-apply-plan.test.ts:133` | **"The load-bearing case."** Asserts the write happens outside staging |

**A passing unit test calls the bypass load-bearing.** Any repair changes that
test — which is why this is a package, not a patch.

## Static determination — sufficient, and already made

The `Apply Surgical →` CTA (`action-zone.tsx:281`) is wired: `onApply` is
supplied (`pricing-surface-shell.tsx:574`), the handler runs, and it calls
`applySurgicalAdj` (`pricing-apply.ts:146`) — a direct write to
`quote_tiers.tier_price_adj_pct` plus an audit row. **No path from this CTA
stages anything.** The shell consumes `usePricingStaging()` but reads only
`previewResult` from it.

## The runtime observation — TAKEN 2026-08-10

One click. Isolated validation environment (`127.0.0.1:3100`, Postgres
`127.0.0.1:55432`), **not production**.

**Target:** quote `a5672a11-aae8-4e8d-8b47-40acc20685c1` (`r3Volume` — 6 SKUs ×
4 tiers, SKU 0 at 0.2 markup, below floor on every tier). Firm target 35% ·
floor 25%.

### Before — 19:15:41Z

| | |
|---|---|
| `tier_price_adj_pct` · all four tiers | **`null`** |
| `quotes.global_price_adj_pct` | `0.0000` |
| audit rows for quote or its tiers | **none** |
| `.psr-suggestion-card` in DOM | **0** |
| staging chips · working-set nodes | **0 · 0** |
| APPLIED bar | *"1 pricing adjustment in effect"* |
| verdict band | **BLOCKED · 4 tiers below floor** · blended 54.8% |

### The click

`button.cta` inside `.psr-action-card.primary.recommended`, labelled
**`Apply →`**, under the heading *"Apply Surgical · lift T1, T2, T3, T4 above
floor / Recommended adjustment per SKU · **re-renders quote in place**"*.

One click. One `POST …/pricing 200 in 193ms`, followed by
`revalidateQuoteTree 8 paths`. No second fire.

### After — 19:15:59Z

| | |
|---|---|
| `tier_price_adj_pct` · **T1** (`MOQ · 1,000 units`) | **`null` → `0.1334`** |
| `tier_price_adj_pct` · T2, T3, T4 | unchanged `null` |
| audit rows written | **exactly 1** — `tier_price_adj_updated`, `entity_type: quote_tier`, `diff_json.source: "pricing_suggestion_surgical"`, `{from: null, to: "0.1334"}`, 19:15:53.490Z |
| staging chips · working-set nodes | **0 · 0 — unchanged** |
| any "staged" / "Discard" affordance | **none** |
| APPLIED bar | *"**2** pricing adjustments in effect"* |
| verdict band | **BLOCKED · 3 tiers below floor** |
| next move | flipped to **`suggestion_manual_only`** — *"Manual adjustment — Bottle on …"* |
| surfaced error | **none.** `applyError` stayed null |

### Classification — first failing boundary

> **DB changed · staging unchanged.**
> **Silent immediate-write / R12 staging-bypass defect.** Branch 1.

The write is committed at click time, with its audit row, and no part of the
staging model is involved. **Nothing is inert.** The CTA does exactly what it
was built to do — it just does it under a contract the surface no longer
claims to follow.

### Why an operator reads it as inert

Three things arrive together, and none of them says *"applied"*:

- the below-floor headline **does not clear** — Bottle is still 20.1% against a
  25% floor, so the problem the operator was looking at is still on screen;
- **the CTA disappears.** The write flips the recommendation to
  `suggestion_manual_only`, so the button that was just pressed is gone and
  cannot be pressed again to "make it take";
- the only confirmation anywhere is a counter incrementing **1 → 2** in the
  APPLIED bar, which is not where the operator was looking.

A committed, audited, irreversible-by-the-surface pricing change presents as a
no-op. That is worse than an inert button, because an inert button changes
nothing.

### Two further findings, recorded as observed

1. **`SuggestionCard` never rendered** — 0 nodes before *and* after. The CTA an
   operator actually presses in this state is the **ActionCard** `Apply →`
   (`action-zone.tsx:113`), not the `Apply Surgical →` button at
   `action-zone.tsx:281`. Same handler, same action, same defect — but the
   repair must cover the ActionCard path, which the original record cited only
   indirectly.
2. **The label promises four tiers; the action lifts one.** The CTA reads
   *"lift T1, T2, T3, T4 above floor"* (`pricing-classifier.ts:734`, which
   labels **every** tier below floor) while `surgical` targets the single worst
   tier. Blocked count moved 4 → 3. Recorded here; dispositioned with the
   repair, not before it.

### Fixture state after the observation

`a5672a11` T1 now carries `0.1334` plus one audit row. **Any run intended to be
comparable to BASELINE-01 must start from `validation:db:reset` + `validation:seed`**,
which the BASELINE-01 procedure already requires. BASELINE-01 itself is
untouched.

## The second caller — CLASSIFIED 2026-08-10

**`pricing-surface-shell.tsx:238`, inside `onApplyGlobalPreview`, is NOT part
of this defect.** It is the bulk-lift workflow, and it is separately governed:

```
onPreviewGlobalAdjust → previewGlobalAdj   (read-only projection, PB-004)
     operator reviews the preview
onApplyGlobalPreview  → applyGlobalAdj     (+ expectedPreview concurrency check)
onUndoGlobalAdjust    → undoGlobalAdj      (via the retained bulkAuditId)
```

It carries `optionRecommended: "false"`, sends an `expectedPreview` payload so
the server can reject a stale apply, retains `bulkAuditId` for an exact undo,
and confirms with *"Pricing updated."* **Preview → apply → undo is its own
committed-write contract**, exercised end to end by VAL-208
(`bulk-pricing-lift` — *previews, applies and exactly undoes a bulk pricing
lift*).

That is precisely the carve-out the repair conditions already allow: an
immediate-write action survives where **a separately governed workflow
genuinely requires it**. This one does.

### Caller audit — final

| call site | path | verdict |
|---|---|---|
| `shell:156` → `applySurgicalAdj` | recommendation CTA | **in scope — bypasses staging** |
| `shell:171` → `applyGlobalAdj` | recommendation CTA (sibling) | **in scope — same shape, same defect** |
| `shell:238` → `applyGlobalAdj` | bulk-lift preview / apply / undo | **out of scope — governed workflow, keeps its committed write** |

So the boundary is not *which action*, it is *which caller*. `applyGlobalAdj`
survives; **its recommendation caller does not.** The two recommendation CTAs
are repaired together, and the bulk-lift path is left exactly as it is.

## Repair package — conditions, when it is authorised

If the global path is also an old immediate-write contract, both are repaired in
**one** release-blocker package:

- the working set carries **all** operator pricing levers;
- recommendations **stage existing solver outputs** — **no new arithmetic**;
- **page-level Apply owns persistence**;
- update or remove the comments and unit tests that encode the bypass as
  load-bearing, rather than leaving them contradicting the shipped behaviour;
- immediate-write actions survive **only** if a separately governed workflow
  genuinely requires them;
- rejected and throwing action paths surface **visibly**;
- a rendered surgical CTA with no surgical suggestion **fails loudly** —
  `onApply` currently has two guarded branches and no else, so that state
  returns silently today.

## The repair — shipped 2026-08-10

**The fourth lever joined the set.** Everything downstream of staging already
handled per-tier adjustments symmetrically with lifts and overrides —
`planApply` diffs `intendedTierAdj` against `persistedTierAdj`, and
`applyPricingAdjustments` writes both directions with audit rows. The gap was
entirely upstream: `PricingSet` did not carry the lever, so nothing could stage
one, so the CTAs wrote directly.

| | |
|---|---|
| `pricing-staging.ts` | `PricingSet.tierAdj` added; seeded from persisted values; diffed into two new change kinds (`tier-adj`, `tier-adj-removed`) |
| `pricing-staging-context.tsx` | `stageTierAdj`; baseline carries none; `unstage` restores committed; preview resolves working `tierAdj` onto the costing input's tiers; `commit` sends the SET |
| `pricing-surface-shell.tsx` | both recommendation CTAs stage; fail loudly when a rendered CTA has no suggestion |
| `staging-bar.tsx` | chips for both new kinds, named for the tier via a `TierLabeller` |
| `pricing-classifier.ts` | CTA copy — staging language, and the surgical label names the tier it lifts |
| `pricing-apply.ts` | `applySurgicalAdj` **removed** — no callers, and left in place it is one import from being re-wired |

**Three things it deliberately did not do.** No new arithmetic — a
recommendation composes through `composePricingAdjustment`, the same rule the
bulk-lift preview uses. No change to what any commercial value IS — the same
tier still receives the same `0.1334`. And no change to the bulk-lift path.

**Two reads that were only ever workarounds are gone.** `commit` read tier
adjustments live from the store, and `appliedCount` subscribed to the store for
its per-tier component — both because a CTA wrote behind the layer's back. The
set is authoritative now, so both read from it, and a count assembled from two
sources can no longer disagree with itself.

### Removed comments and tests that encoded the bypass

- `pricing-apply-plan.ts:50` — *"the one that is authored elsewhere… nothing
  here stages one"*
- `pricing-lifts.ts:94` — *"Nothing STAGES one of these… that stays true"*
- `pricing-staging-context.tsx:351, 495` — both live-read workarounds, deleted
  rather than re-commented
- `pricing-apply-plan.test.ts:133` — **the load-bearing assertion.** The test
  survives; its reason changed. An untouched tier adjustment still plans no
  change, but now because the SET says so rather than because a write path went
  around the set.
- `pricing-classifier.ts:736` — *"re-renders quote in place"*, copy that
  described the mechanism being removed

### New guard

`tests/unit/pricing-recommendation-stages.test.ts` — 8 assertions pinning the
contract at source level: both kinds stage, neither calls a writer, the removed
action stays removed, bulk lift keeps `expectedPreview`, no arithmetic is
invented, both fail-loud branches exist and reach a person, and the copy says
staging.

**Source-level, deliberately.** The classifier offers surgical or global, never
both, so a rendered click can only ever exercise half the contract — and a
guard that can only check half is the guard that let this ship.

## Browser proofs

Isolated validation environment, reseeded to BASELINE-01's fixture counts
first.

| # | proof | result |
|---|---|---|
| 1 | Recommendation click creates staged state | ✅ **observed** — one chip, *"Adjust MOQ · 1,000 units to 13.3%"*, with Reset all + Apply 1 change |
| 2 | Preview / deltas appear | ✅ **observed** — `+$0.4210` and `+8.7pp` |
| 3 | Database does not change before Apply | ✅ **observed** — all four tiers still `null`, zero audit rows |
| 4 | Discard restores the committed state | ✅ **observed** — chip and deltas gone, APPLIED bar back, CTA returned |
| 5 | Page-level Apply persists exactly once | ✅ **observed** — one `pricing_adjustments_applied` (`change_count: 1`) + one derived `tier_price_adj_updated`, `source: "pricing_apply"` |
| 6 | Reload reflects the persisted state | ✅ **observed** — APPLIED 1 → 2, blocked 4 → 3 tiers, recommendation moves to `suggestion_manual_only` |
| 7 | Surgical and global obey the same contract | ⚠️ **pinned, not clicked** — see below |
| 8 | Thrown / rejected paths surface visibly | ⚠️ **pinned, not triggered** — see below |

The staged value is `13.3%` and the committed value is `0.1334` — the same
figure the click-time write produced in the observation above. **Where it
persists changed. What it persists did not.**

### Why 7 and 8 are pinned rather than clicked

**No fixture in the world renders a global recommendation.** All six draft
quotes were checked; none reaches `suggestion_led` with more than one tier
below target, which is the only state that offers the global CTA. And no
fixture reaches a refusal state through a recommendation path — the sent quote
is compliant, so it renders no CTA at all.

Both are covered by `pricing-recommendation-stages.test.ts` at source level.
That is a stronger guard than a single click, and it is **not a substitute for
the missing coverage**, which is recorded below.

## Open consequences — for disposition, not silently absorbed

**1 · Recommendation telemetry has no writer.** `applySurgicalAdj` emitted
`surgical_apply` plus `recommended_accepted` / `recommended_overridden`
`pricing_events`. Removing it removes the only writer of `surgical_apply`, and
`recommended_*` now comes only from the bulk-lift path — which passes
`optionRecommended: "false"`, so what survives is a stream of
`recommended_overridden` with no accepted counterpart. **That is a distortion,
and worse than absence.**

Staging is the wrong moment to emit acceptance — the operator has not committed
anything yet — and the Apply plan carries no provenance saying an adjustment
came from a recommendation. Restoring the signal is a design question, not a
line of code, so it is stated here rather than guessed at.

**2 · No test presses a recommendation CTA.** Not in the unit suite before this
repair, and not in any e2e scenario: `bulk-pricing-lift.spec.ts` walks VAL-208
and the governed bulk path, and nothing walks the recommendation path at all.
**That gap is what let P3-016 ship** — the contract was asserted in prose and in
a comment, and nothing exercised it. The new source-level guard closes the
structural half; a scenario that renders a global recommendation and one that
reaches a refusal would close the rest, and both need fixture-world additions,
which change the seed and so must not be made silently against BASELINE-01.

## Standing constraints

- **BASELINE-01 is immutable.** This work does not touch it. The validation
  database was reset and reseeded to its exact fixture counts before the
  proofs, so the environment is comparable again.
- **S-7 did not move for this repair.** Verified by baseline rather than by
  assertion — see below.

### S-7 — a separate finding, not this repair

`gate1b:verify-preserved` **fails** against production. It fails identically in
three places:

| where | global digest |
|---|---|
| this branch with the repair applied | `c0951e51…` |
| this branch with the repair stashed (`bc43c0a`) | `c0951e51…` |
| **`main`** (`024d231`) | `c0951e51…` |

Identical in all three, so **the repair moves nothing.** The delta is only
meaningful because the baseline was taken; comparing the repair against the
branch alone would have been self-consistent and wrong, which is the failure the
governed-test-command rule was banked for.

One quote accounts for the whole delta:

```
FAIL  52bd0077-20af-4345-8856-45003bfca8b3
      Smart Pressed Juice - Juice Cleanse Reorder 2026 / ZZ-VALIDATION-tier-propagation
      quoteRollup[0].blendedMarginPct: 0.22753988245172124 -> 0.45304813598507493
```

Its scenario label announces what it is: a hand-made validation scratch
scenario, living in production because dev and prod share one Supabase project,
inside the 24-quote S-7 basket. A digest over production data cannot separate
"code changed a number" from "someone edited a test quote", and here it is
reporting the second as the first.

**Not dispositioned here.** It is Edward's call whether the answer is excluding
`ZZ-VALIDATION-*` from the basket, re-baselining, or investigating the quote —
and it is a finding about the release's governing evidence, so it should not
ride in on a pricing repair.
- VAL-101 classification resumes from the `frame.join` runtime failure **after**
  this blocker closes.
