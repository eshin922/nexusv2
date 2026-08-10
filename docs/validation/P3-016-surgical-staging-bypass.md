# P3-016 · Recommendation CTAs bypass the R12 staging contract

**Status: OPEN — release blocker. Not repaired. Runtime observation TAKEN
2026-08-10; both callers classified.**

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

## Browser proof required to close

1. Recommendation click creates **staged state**.
2. Preview / deltas appear.
3. **Database does not change** before page-level Apply.
4. Discard restores the committed state.
5. Page-level Apply persists **exactly once**.
6. Reload reflects the persisted state.
7. **Surgical and global obey the same interaction contract.**
8. Thrown / rejected paths surface visibly rather than failing silently.

## Standing constraints

- **BASELINE-01 is immutable.** This work does not touch it.
- **S-7 must not move.** The repair changes where a lever is persisted, not what
  any commercial value is.
- VAL-101 classification resumes from the `frame.join` runtime failure **after**
  this blocker closes.
