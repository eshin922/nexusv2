# False-infeasibility diagnosis — CC → CA report

Per CA memo §3 mandate: report root cause + which branch fired + why,
propose the fix, **do not ship the patch before CA dispositions**.

## TL;DR

The `suggestion_infeasible = true` flag in Scenario B fires from the
**second branch** of `pricing-classifier-context.tsx:379-381`:

```ts
const suggestionInfeasible =
  (engineCallReturnedOptions && !usableSurgical && !usableGlobal) ||
  (!engineCallReturnedOptions && anyCellBelowTarget);
// ─── first ────────────────────────────────  ─── second ────
```

- **First branch (overflow)** — cannot fire from the pricing-surface
  path today. It requires `disabledReason` to be non-null on a
  suggestion option, which in turn requires the caller to pass
  `currentAdjByTier` to `rankPricingSuggestions`. The classifier
  context (`pricing-classifier-context.tsx:335-341`) does not pass
  it. `disabledReason` is always null → `usableSurgical`/`usableGlobal`
  never false via this route. Overflow-based infeasibility is
  structurally unreachable at the pricing-surface caller.
- **Second branch (asymmetry)** — the P0 A2 fix banked at
  `pricing-classifier-context.tsx:353-378`. Fires when the suggestion
  engine returns null AND at least one cell is below target. The comment
  above the branch calls this out explicitly: the engine works on tier
  BLENDED rollups; the classifier works on per-CELL statuses; when a
  worst-SKU cell is below target but the tier's blended margin sits at/above
  target, engine returns null (nothing to lift), classifier trips on the
  cell, and the second branch fires.

**CA's global-vs-surgical conflation hypothesis is essentially correct
but the mechanism is more specific** than "±999% clamp exceeded." The
overflow clamp is the wrong lever here. The actual mismatch is
**engine's tier-blended compliance basis vs classifier's worst-cell
compliance basis**. See §"Detailed trace" below.

## Detailed trace — Scenario B walk

**State (per CA memo):**
- SKUs: Glass bottle 30ml amber (worst), Glass dropper 30ml (better).
- Bottle worst-tier at 33.5% (below 35% target). Dropper at 35.2%
  (above 35% target).
- Compliance basis reported as "WORST-MARGIN-across-SKUs" — that's the
  classifier's basis.
- 3 tiers T1/T2/T3, with per-tier cell margins:
  - T1: bottle 33.3%, dropper 35.1%
  - T2: bottle 34.0%, dropper 35.9%
  - T3: bottle 33.5%, dropper 36.4%

**Classifier (`classify()` in `pricing-classifier.ts`):**
- Iterates cells (SKU × tier). Per-cell status: bottle cells all below
  target (< 35%), dropper cells all above target. No cell is below floor.
- `belowFloor.length === 0`, `belowTarget.length > 0` → mode =
  `"suggestion_led"`.
- Correctly identifies "there's a problem in the quote."

**Suggestion engine (`rankPricingSuggestions()` in
`pricing-suggestions.ts`):**
- Consumes tier ROLLUPS (`QuotePerTierRollup[]`), not cells.
- Each tier's `blendedMarginPct` is **revenue-weighted per SKU in
  tier** (`costing.ts:1635` — `revenue > 0 ? (revenue - cost) /
  revenue : 0`; per-tier `revenue` = sum across SKUs in tier).
- Given bottle drags margin down and dropper drags up, tier blended
  sits between 33.5% and 36.4%. If dropper revenue-weight is dominant
  (dropper is priced higher than bottle), tier-3 blended could sit at
  35.0% ± tolerance — right at or above target.
- `worstBelowTarget` iterates tiers, checks
  `isBelowTarget(t.blendedMarginPct, target)`. With tolerance 0.001,
  a tier blended at 34.999% or higher is NOT below target. If none of
  T1/T2/T3 blends below target, `worstBelowTarget` returns null →
  `buildSurgical` and `buildGlobal` both return null.
- Top-level `rankPricingSuggestions` at line 353:

  ```ts
  if (belowTarget.length === 0 && belowFloor.length === 0) {
    return null;
  }
  ```

  Engine returns null. `engineCallReturnedOptions = false`.

**Back in the classifier context (line 368-378):**

```ts
let anyCellBelowTarget = false;
for (const sku of skus) {
  for (const cell of Object.values(sku.cells)) {
    const m = cell?.margin_pct;
    if (m != null && m < effectiveTarget) {
      anyCellBelowTarget = true;
      break;
    }
  }
  if (anyCellBelowTarget) break;
}
```

At least one bottle cell has `margin_pct < 35%` → `anyCellBelowTarget
= true`.

- `suggestionInfeasible = (false && ...) || (!false && true) = TRUE`.

**Classifier (`classify()` action ranking):**
- Mode is `suggestion_led`.
- Line 466-506 handles suggestion_led actions.
- No `sugg.surgical`, no `sugg.global` (engine returned null; both
  suggestions objects unset).
- Falls into line 486 branch: `else if (quote.suggestion_infeasible)`.
- Emits `kind: "suggestion_infeasible"` with the copy:

  > "Suggestion unavailable — math infeasible"
  > "Engine couldn't compute a viable lift path (zero-revenue tiers,
  > missing cost data, or required adjustment exceeds the ±999% field
  > range). Enter pricing on the Costs surface to recover."

**But none of those three conditions actually apply.** Zero revenue,
missing cost data, and ±999% overflow are all false. The real
condition is **cell-margin below target within a tier whose blended
margin sits above target** — the semantic asymmetry.

## Why the P0 A2 fix over-corrects

The P0 A2 fix (banked 2026-06-25) was added to solve a stuck-pending
case: classifier said `suggestion_led`, engine returned null, so the
UI fell through to `calculating_suggestion` — an in-flight-inert
state that never resolves (v1 engine is sync; no async ever
completes). The fix flipped the fallthrough to `suggestion_infeasible`.

That fix is correct for one shape of the problem but wrong for the
asymmetry shape:

| Case | engine ranked | anyCellBelowTarget | P0 A2 verdict | Should be |
|------|---------------|--------------------|--------------|-----------|
| Zero revenue everywhere | null | true | infeasible | infeasible (correct) |
| Tier blended below target, engine null due to overflow | null (via disabledReason) | true | infeasible | infeasible (correct) |
| **Tier blended above target, one cell below** | null | true | **infeasible** | **manual-recovery** |
| No cells below target | null | false | (no state emitted) | sendable (correct) |

Row 3 is what Scenario B is hitting. The current copy claims math
infeasibility; the reality is that the ENGINE has nothing to propose
because a tier-level proportional lift can't surgically fix ONE SKU
in ONE tier — but the quote is neither stuck nor infeasible; PM has
recovery paths (cost input adjustment, per-cell override via Costs
surface, admin override).

## Additional evidence

1. **PM applied 3 lifts and margins moved** — this rules out
   zero-revenue and missing-cost-data. The engine WAS proposing
   lifts earlier in the walk; the current state has all tier
   blended margins sitting above target (per the applied lifts
   pushing them up), which is exactly the asymmetry corner.
2. **Delta computation is trivial** — for bottle at 33.5% to reach
   35%, closed-form lift is ~2.3%. Nowhere near ±999%. The overflow
   clamp is not the gate.
3. **D+T = $0.00 is not additionally poisoning** — the engine
   doesn't inspect D+T directly; it uses tier `totalRevenue` and
   `totalCost`. Rules that out as an independent cause.

## Root cause statement (proposed for CA disposition)

The `suggestion_infeasible` verdict in Scenario B is **structurally
misclassified**. The engine correctly returns null (nothing to lift
at tier level). The classifier correctly identifies below-target
cells. The bug is at the intersection: the P0 A2 asymmetry gate
conflates "engine has nothing to propose at its abstraction level"
with "quote is mathematically infeasible."

The narrower true statement is: **the SUGGESTION ENGINE cannot
auto-solve this shape at its current abstraction level (tier-scoped
lifts). The QUOTE has recovery paths (cost adjustment, cell override,
admin override) — infeasibility copy is wrong; user is not stuck.**

## Fix branches (three options, for CA disposition)

### Option A · Narrow the asymmetry gate (smallest change)

Change line 380-381 in `pricing-classifier-context.tsx`:

```ts
// Was:
const suggestionInfeasible =
  (engineCallReturnedOptions && !usableSurgical && !usableGlobal) ||
  (!engineCallReturnedOptions && anyCellBelowTarget);

// To:
const anyTierBelowTarget = quoteRollup.some(
  (r) => r.blendedMarginPct < effectiveTarget - TARGET_TOLERANCE,
);
const suggestionInfeasible =
  (engineCallReturnedOptions && !usableSurgical && !usableGlobal) ||
  (!engineCallReturnedOptions && anyCellBelowTarget && anyTierBelowTarget);
```

Now `suggestion_infeasible` only fires when the tier ROLLUP agrees
with the cell-level classifier that there's tier-level fix work to
be done. Asymmetry cases fall through to… still need to define what
they fall through to. See §Message-quality below.

**Pros:** minimal change, targeted at the asymmetry corner.
**Cons:** the stuck-pending case P0 A2 was solving re-emerges for the
asymmetric cell-only-below case. Need a distinct action kind for it.

### Option B · New action kind `suggestion_manual_only`

Add a new `ActionKind` value with copy that describes the actual
situation and directs PM to recovery paths:

```
kind: "suggestion_manual_only"
label: "Manual adjustment required — {sku} on {tier(s)}"
sublabel: "The tier is above target overall, but {sku}'s margin on
  {tier} is {n%}, below target. Adjust cost inputs on Costs, or
  set a cell-level override, or request admin approval to send as-is."
```

Wire the classifier's asymmetry corner to this kind instead of
`suggestion_infeasible`. Reserve `suggestion_infeasible` for the
overflow / zero-revenue / missing-data cases.

**Pros:** message-quality fix and root-cause fix in one; clear PM
guidance; distinguishes the two shapes.
**Cons:** a new action kind requires ActionCard glyph, verifier
coverage, invariant test additions. Not tiny but not large.

### Option C · Per-cell surgical suggestion (largest change)

Extend the suggestion engine to emit `apply_cell_override` when the
tier blended is above target but a single cell drags. Engine would
propose "set bottle T3 sell price to $X to bring bottle T3 margin to
35%." Consumer applies via cell-override write path (already exists
per Slice 9.3).

**Pros:** actionable one-click apply for the asymmetry case.
**Cons:** architecturally largest — cell overrides don't compose with
tier adjustments the same way; needs engine-side rebuild + cell-scoped
apply path in the composer + testing. Out of scope for a hotfix.

## Recommendation

**Ship Option B** (new `suggestion_manual_only` action kind, wired
to the asymmetry corner). It solves both the root-cause misclassifi-
cation and the §4 message-quality gap in the same change. Overflow
and zero-revenue keep the `suggestion_infeasible` copy (which is
accurate for those). Asymmetry gets a message that names the SKU,
names the tier, and directs to the three recovery paths (Costs cost
adjustment, cell override, admin override).

Option A alone won't fix the message-quality gap — `calculating_
suggestion` reappears as the fallthrough, which is still misleading.

Option C is the eventual right shape but too large for a hotfix.
Bank as a follow-up.

## Awaiting CA disposition

- [ ] Confirm root cause is the asymmetry mechanism above (not the
  ±999% overflow, not D+T=$0).
- [ ] Disposition Option A / Option B / Option C (recommend B).
- [ ] Confirm scope: hotfix vs bundled with §4 layout batch.
- [ ] Any additional cases to cover (multi-cell asymmetry across
  multiple tiers with mixed blend statuses — my read is Option B
  message template handles it via `{sku} on {tier(s)}` list).

## Stray artifact

PR #118 (recovery of PRs #117 stranded commits — pdf-axis clone
+ production toggle fix) is queued and independent of this bug.
Can merge whenever ready.
