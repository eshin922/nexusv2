# Slice 9.4c brief — Quote-level client target

**Status.** Final pre-redesign-implementation prerequisite. Ships after Slice 9.5 (shipped) and before redesign-implementation RI.0.

**Effort estimate.** ~2-3 build days. Three sub-steps: schema migration; math layer extension; UI surfacing on QuoteSummaryCard.

**Dependencies.** Slice 9.4a (per-SKU breakdown row). Slice 9.4b (per-cell client target + two-axis verdict). Slice 9.5 (validation engine; not blocking but its rule set may add a quote-level client-target completeness rule). All shipped.

**Read first.**
- `docs/slice-9-4b-brief.md` — establishes per-cell client target patterns (lazy row writes, single action with value-or-null, two-axis verdict, NULL-as-empty-signal, optimistic store integration, editable prop threading)
- `nexusv2-handoff.md` Slice 9 section — flags `quote_tiers.client_target_price_per_unit` as the original column-name (different from per-cell variant which lives in `quote_sku_tier_targets` sister table per 9.4b-prep migration)
- `CLAUDE.md` "Slice 9 pricing-control columns" — sister-table reasoning + column-naming discipline

---

## 1. Frame — what this slice is and isn't

**What it is.** Adds the missing aggregate-style negotiation surface. PMs can now enter a customer's stated target at the quote level (e.g., "$150,000 total at Tier 2"), parallel to the per-cell targets shipped in 9.4b. System surfaces a quote-level competitive verdict on the QuoteSummaryCard and reconciles per-SKU targets (when set) against the quote-level target (when set) to flag mismatches.

**What it isn't.**

- **Not a replacement for per-cell client targets.** Per-cell targets shipped in 9.4b stay. Some negotiations are line-by-line ("what's your price for SKU-X?"); some are aggregate ("can you do this for $X total?"). 9.4b covers the first; 9.4c covers the second. They're complementary, not competing.

- **Not a reverse-solve at quote level.** 9.4b's reverse-solve writes `tier_price_adj_pct` to land per-cell targets. Quote-level reverse-solve would need a different solving heuristic (which adjustment lands the quote total at customer's stated target — through global_price_adj_pct, through tier_price_adj_pct, through allocation across SKUs?). That math is more complex and the workflow is unclear (PMs may not want auto-solve at quote level — preferred is to make manual decisions and observe the gap). Defer reverse-solve at quote level to UX_BACKLOG; ship competitive verdict + sum reconciliation only.

- **Not a customer-facing feature.** Client target is PM-internal. Customer view (Slice 10) and PDF (Slice 11) never render this field. Audit log captures changes; PMs see verdict; that's the surface.

- **Not the inbox surface.** Quote-level target completeness gaps could feed into "What's my move" inbox post-Slice-9.5 + post-redesign-implementation. Not in scope here.

---

## 2. Schema — `quote_tiers.client_target_price_total`

**Migration 0018** (or whatever's next at ship time per the brief amendment to redesign-implementation §1):

```sql
ALTER TABLE quote_tiers
  ADD COLUMN client_target_price_total NUMERIC(12,4) NULL;

-- No index needed; queried by quote_id + tier_id, both already covered.
-- NULL = no target set on this tier (NULL-as-empty-signal per CD's principle)
```

**Notes on schema:**

- **Column name.** Different from `quote_sku_tier_targets.client_target_price_per_unit`. The per-cell target is per-unit; the quote-level target is total. Math works at quote level on totals, not per-units. Naming is explicit.

- **NUMERIC(12,4).** Wider than per-cell to accommodate quote totals (six-figure deals are common). Four decimal places for math precision (matches firm_settings + markup_defaults precision).

- **Per-tier, not per-quote.** Customer's stated target may differ across tiers ("yes for $150k at 25k units, but $130k at 10k"). Stored per-tier matches both that variance AND the way PMs negotiate ("what target are you asking about?").

- **No `client_target_total_currency` or similar.** Currency is implied USD across the codebase; revisit if multi-currency becomes a real concern (post-MVP).

- **Direct column, not sister table.** Unlike per-cell targets (which got a sister table per 9.4b-prep), quote-level targets are on `quote_tiers` directly. Reasoning: `quote_tiers` already has `tier_price_adj_pct` as a directly-on-table nullable column shipped earlier; same pattern. Sister table for per-cell was justified by per-cell column count; quote-level is one column. No table.

**Migration sequencing.** Standard Drizzle migration. Verification script: round-trip insert/update/delete + readback.

---

## 3. Costing math — quote-level competitive verdict + sum reconciliation

**Location.** `src/lib/costing.ts` (extend existing module).

**Math is purely additive.** No changes to per-cell competitive verdict (preserved from 9.4b). New computation: per-tier quote-level verdict.

**Two new computations:**

**3.1 Quote-level competitive verdict.**

Given a tier with `client_target_price_total` set:

```typescript
quote_total_required_sell = Σ over (SKU × tier) of
  required_sell_per_unit × tier_qty

competitive_verdict_quote_level =
  none           if client_target_price_total IS NULL
  COMPETITIVE    if quote_total_required_sell <= client_target_price_total + ε
  OVER           otherwise

where ε = 0.50 (50 cents tolerance — matches per-cell ε per 9.4b discipline)
```

The ε tolerance avoids spurious "OVER by $0.0001" verdicts from floating-point math; same epsilon pattern as 9.4b cell-level.

**3.2 Sum-of-SKU-targets reconciliation.**

When BOTH per-cell targets and a quote-level target are set on the same tier, the sum of per-cell targets across SKUs at that tier should equal (within tolerance) the quote-level target. If not, surface a reconciliation warning.

```typescript
sum_of_cell_targets_at_tier = Σ over SKU of
  client_target_price_per_unit × tier_qty
  (only for SKUs with cell target set; SKUs without contribute zero)

target_reconciliation_status =
  not_applicable      if quote-level target is NULL
  not_applicable      if no per-cell targets set on this tier
  matches             if |sum_of_cell_targets - client_target_price_total| <= ε_total
  mismatched_high     if sum > quote_total + ε
  mismatched_low      if sum < quote_total - ε

where ε_total = 1.00 (one dollar tolerance; quote totals are larger, so wider epsilon)
```

The output type extends with new fields:

```typescript
type QuoteTierComputed = {
  // existing fields preserved
  ...
  // new in 9.4c
  client_target_price_total: number | null;
  quote_total_required_sell: number;
  competitive_verdict_quote_level: 'none' | 'COMPETITIVE' | 'OVER';
  target_reconciliation_status: 'not_applicable' | 'matches' | 'mismatched_high' | 'mismatched_low';
  sum_of_cell_targets_at_tier: number | null;  // populated if any cell targets set; NULL otherwise
};
```

**Why purely additive.** Per-cell competitive verdict (from 9.4b) and per-cell margin verdict (from 9.4a) stay unchanged. The two-axis verdict on per-cell rows already works. Quote-level adds a parallel verdict on the quote-level summary surface. Both can be set simultaneously without conflict.

**Architect spot-check needed.** The sum reconciliation rule fires only when both target types are set. Verify that's the right behavior — alternative is to fire when only quote-level target is set + per-cell targets are partially set ("you've set 3 of 5 cells; sum-so-far is $X, target is $Y, gap is $Z"). My read: defer that more-helpful-but-more-complex behavior to post-MVP; v1 surfaces reconciliation only when both target types are fully set. CC + architect validate before commit.

---

## 4. Validation engine integration

The validation engine shipped in Slice 9.5 has a quote-level scope. Worth adding two rules to it for 9.4c's surface:

**4.1 New rule: quote-level target completeness gap.**

```
Severity: info
Scope: quote
Trigger: at least one tier has cell-level targets set (any SKU × tier with cell target),
         BUT no tier has quote-level target set
Message: "Per-cell client targets are set on some tiers; consider entering quote-level
          target on Tier {N} for aggregate negotiation visibility."
```

This is a soft prompt — not a blocker, just a workflow nudge for PMs who entered cell-level but didn't think about quote-level yet. Severity `info` so it doesn't add to count chips.

**4.2 New rule: target reconciliation mismatch.**

```
Severity: review
Scope: line (tier-scoped, since reconciliation is per-tier)
Trigger: both quote-level target AND per-cell targets set on the same tier,
         AND target_reconciliation_status in ('mismatched_high', 'mismatched_low')
Message: "Sum of per-cell targets ($X) doesn't match quote-level target ($Y) on Tier {N}.
          Gap: ${X-Y}."
detail_json: {
  tier_id,
  tier_label,
  sum_of_cell_targets_at_tier,
  client_target_price_total,
  gap,
  reconciliation_status
}
```

PM can fix or accept with reason — same flow as other warnings. Reason candidates: "intentional cell-level negotiation diverges from quote framing" / "in-progress; reconciling later" / custom.

**Engine integration cost.** Two new rule functions in `src/lib/validation.ts`. ~30 lines added. Reuses existing patterns from rules already shipped. Updates to test fixtures cover the new rules.

**Architect note.** The reconciliation rule fires on data shape, not on user action — same as other engine rules. Won't fire from UI before client-side validation runs and persists per architect verdict (client fires immediate; server persists on commit). This is consistent.

---

## 5. UI surfaces — where quote-level target appears

**Two surfaces touched:**

**5.1 QuoteSummaryCard at top of Costing Sheet.**

The QuoteSummaryCard currently renders quote-level summary metadata + global_price_adj_pct + blended margin. Extend to add:

- **Client target field per tier** — inline editable, NUMERIC input with `$` prefix and 2-decimal display formatting. NULL-as-empty-signal per CD's principles: empty input box (no `$0.00` placeholder) when target is unset. Edit fires `updateQuoteLevelClientTarget` action.

- **Quote-level competitive verdict pill** — renders adjacent to the client target field when target is set. Reuses 9.4b's TwoAxisVerdict component shape: outline-style chip with `--paper-3` background + colored border per status. Status maps:
  - `COMPETITIVE` → green border
  - `OVER` → amber border
  - `none` → no pill rendered (NULL-as-empty-signal)

- **Reconciliation status icon** — small icon (warning triangle outlined for `review` severity) when `target_reconciliation_status` is `mismatched_*`. Hover shows tooltip with sum vs quote-level + gap. Click links to the validation warning panel where PM can fix or accept.

**Tier display.** When quote has multiple tiers, the client target field + verdict pill render per-tier — small grid layout matching the existing per-tier columns on QuoteSummaryCard. Active tier highlighted (matches existing per-cell active-tier treatment).

**5.2 Validation warning surfaces (Slice 9.5 components).**

The reconciliation mismatch warning surfaces through:
- Inline icon next to the affected tier's client target field on QuoteSummaryCard (when 9.5.5 ships inline icons; otherwise chip path only)
- Costing Sheet aggregation chip (already aggregates across all warnings)
- Per-page summary chip on the Costing Sheet itself

**Designer routing.** This is novel-state extension territory — quote-level competitive verdict is a small extension of 9.4b's per-cell verdict (same TwoAxisVerdict component, applied at quote level instead of cell level). Verify against CD's vocabulary before implementing:

- Confirm the verdict pill placement next to client target field is correct
- Confirm tier-grid layout when multiple tiers display targets
- Confirm reconciliation icon visual treatment matches Designer's CR-11 spec

Designer Pattern 2 invocation between schema + math (Phase A) and UI implementation (Phase C). Estimated 15-20 min Designer time.

**Editable prop threading.** Client target field subject to same `editable` prop pattern as 9.4b — `quote.status === 'draft'` + 9.5 frozen-during-pending-mark-accepted. UI proactively disables; action layer enforces.

---

## 6. Schema implications for downstream slices

- **Slice 10 (customer view + Lines Requiring Review)**: per-tier reconciliation mismatch surfaces on the Lines Requiring Review panel via the validation engine integration. PM fixes or accepts before Mark-Accepted.
- **Slice 12 (Mark-Accepted)**: target reconciliation warnings are `review` severity, not `action_required`, so they don't gate Mark-Accepted. They do appear in the audit log if accepted.
- **Redesign-implementation (RI.5 Costing Sheet rebuild)**: QuoteSummaryCard is being rebuilt as part of the cost stack panel + margin verdict band architecture. Quote-level client target field + verdict pill + reconciliation icon get rebuilt against CD's Round 6 design. Worth flagging in the redesign-implementation brief that 9.4c affordances need to be carried forward — not lost in the rebuild.

**Brief amendment to redesign-implementation §3.3 (Costing Sheet):** add quote-level client target affordance to the rebuild scope. CC notes this in the redesign-implementation tracking.

---

## 7. Smoke-test scope

For Edward to verify before merging Slice 9.4c:

1. **Schema migration applies cleanly.** Round-trip insert/update/delete on `client_target_price_total`.
2. **Set quote-level client target.** Pick a tier, enter target value, verify:
   - Action persists; row updated in `quote_tiers`
   - Audit log: new row with `quote_tier_target_updated`, diff_json captures from/to
   - Optimistic store updates immediately; verdict pill renders within wait-for-quiet
3. **Clear quote-level target.** Set target to empty (NULL); verify same audit shape with to=null.
4. **Quote-level competitive verdict — COMPETITIVE.** Set target $200k, total required sell $180k → expect green COMPETITIVE pill.
5. **Quote-level competitive verdict — OVER.** Set target $150k, total required sell $180k → expect amber OVER pill.
6. **Sum reconciliation — matches.** Set per-cell targets summing to $200k on Tier 2; set quote-level target to $200k on Tier 2 → reconciliation_status='matches'; no warning.
7. **Sum reconciliation — mismatched_high.** Per-cell sum $200k, quote-level $180k → reconciliation_status='mismatched_high'; warning fires.
8. **Sum reconciliation — mismatched_low.** Per-cell sum $180k, quote-level $200k → reconciliation_status='mismatched_low'; warning fires.
9. **Validation rule integration.** Mismatch reconciliation surfaces in 9.5's Costing Sheet aggregation chip + warning panel.
10. **Acceptance flow on reconciliation warning.** Accept with reason "intentional cell-level negotiation diverges from quote framing"; verify audit captures intent; warning suppressed per option (iii).
11. **Per-tier tier_qty change after target set.** Set quote-level target → change a tier's `tier_qty` → expected: required_sell recomputes; competitive verdict updates accordingly. Target itself doesn't auto-adjust.
12. **Multiple tiers with different targets.** Tier 1 $100k, Tier 2 $200k, Tier 3 $400k → each tier's competitive verdict computes against its own target; no cross-tier interference.
13. **Editable prop discipline.** When quote.status='sent', quote-level target field is disabled in UI; action layer rejects with appropriate error if forced.

**Edge states:**
- All targets NULL: no verdict pill renders; no reconciliation warning
- Quote-level target set on a tier with no per-cell targets: `target_reconciliation_status='not_applicable'`; no reconciliation warning, but competitive verdict still renders
- All cell targets set across all SKUs at a tier + matching quote-level target: matches; no warning

---

## 8. Open questions

**Q1. Should sum reconciliation fire on partial cell-target completeness?**

Currently spec'd to fire only when both target types are fully set. Alternative behavior: fire when quote-level target is set + ANY per-cell target is set, with `sum_of_cell_targets_at_tier` reflecting partial sum. PM sees "sum-so-far is $X of total $Y" framing.

Recommendation: defer partial-completeness behavior to post-MVP. v1 fires only on full completeness. Simpler mental model; less false-positive noise during in-progress quote building.

**Q2. ε tolerance values — 0.50 cents per-cell, 1.00 dollar quote-level reconciliation. Right values?**

Per-cell ε of 0.50 matches 9.4b discipline. Quote-level reconciliation ε of 1.00 is wider because quote totals are typically 1000× larger than per-unit values (and small per-unit ε rolled up creates spurious mismatches). 

Architect spot-check: is 1.00 the right tolerance for quote totals? Or should it scale with quote size (e.g., 0.1% of quote total)? Fixed dollar ε is simpler; percentage ε is more robust at extreme quote sizes.

Recommendation: ship with $1.00 fixed for v1; revisit if real quotes surface tolerance issues.

**Q3. Sum reconciliation when SKUs lack tier targets — partial sum as zero or as NULL?**

When some SKUs have cell-level targets and some don't, what's `sum_of_cell_targets_at_tier`?

Option A: sum the targets that exist; SKUs without targets contribute zero to the sum.
Option B: sum is NULL when not all SKUs have targets set; reconciliation rule fires only when all SKUs have targets.

Recommendation: Option A (matches the way per-cell targets compose: cells without targets aren't in the sum, cells with targets are). Reconciliation fires when sum-of-set-targets diverges from quote-level target. Aligns with NULL-as-empty-signal — sum is what's set, not what could-be-set.

**Q4. UI placement on QuoteSummaryCard — inline next to per-tier values, or as a separate row?**

Recommendation: inline next to per-tier values as a small grid. Matches existing pattern of per-tier columns on QuoteSummaryCard; doesn't introduce new row. Designer verifies during Pattern 2 invocation.

**Q5. Audit log entity_type for quote-level target updates.**

Per CLAUDE.md audit pattern, audit rows include entity_type. For quote-level target: entity_type = 'quote_tiers' with diff_json carrying client_target_price_total from/to.

Recommendation: yes, entity_type='quote_tiers'. Mirrors how tier_price_adj_pct updates audit.

---

## 9. Sub-step plan

**9.4c.1 — Schema + math layer (0.5-1 day)**
- Migration 0018 (sequential at ship time)
- Math layer extension: `src/lib/costing.ts` adds quote-level competitive verdict + sum reconciliation
- New types on QuoteTierComputed
- Pure-function tests added to `scripts/test-costing.ts`
- Verification script for migration

**9.4c.2 — Action layer + validation engine integration (0.5-1 day)**
- Server action: `updateQuoteLevelClientTarget(quoteId, tierId, value | null)` — same shape as 9.4b's updateClientTarget action; lazy write, audit pattern
- Validation engine: two new rules added to `src/lib/validation.ts` (info: target completeness gap; review: reconciliation mismatch)
- Action wired to fire reconcileWarnings (uses 9.5's pattern)
- Tests added to scripts/test-validation.ts

**9.4c.3 — UI surfacing (0.5-1 day)**
- QuoteSummaryCard extension: client target field + verdict pill + reconciliation icon per tier
- Designer Pattern 2 invocation before implementation (15-20 min)
- Optimistic store integration matching 9.4b cell-target pattern
- Editable prop threading

**9.4c.4 — Smoke + commit (0.5 day)**
- Edward walks 13 canonical scenarios from §7
- Verify warning rules fire correctly
- Verify audit pattern compliance
- Final commit + PR

---

## 10. Frame for CC

Slice 9.4c is the smallest of the Slice 9 family. Pattern-application work; no architectural novelty.

**Approach recommendations:**

1. **Reuse 9.4b patterns.** Lazy row writes (this time on `quote_tiers` directly via UPDATE instead of INSERT-on-sister-table), single action with value-or-null parameter, optimistic store integration, editable prop threading, NULL-as-empty-signal — all carry forward unchanged.

2. **Extend math purely additively.** Don't refactor existing per-cell verdict computation to share code with quote-level. Two parallel computations are fine; abstracting to a generic "compute competitive verdict" function risks coupling that won't reuse cleanly.

3. **Architect dispatch with three things:** (a) schema column placement (column on quote_tiers vs sister table — recommend direct column), (b) sum reconciliation epsilon tolerance ($1.00 fixed vs percentage), (c) sum reconciliation behavior on partial cell-target completeness (recommend Option A: sum-what's-set).

4. **Designer dispatch.** Pattern 2 invocation between schema/math (9.4c.1-2) and UI (9.4c.3). Designer verifies QuoteSummaryCard placement + verdict pill + reconciliation icon against CD's vocabulary and CR-11 (validation warning UI extension memo). Should be quick — extends 9.4b's TwoAxisVerdict component to quote-level scope.

5. **Two PRs proposed:**
   - PR 1: 9.4c.1 (schema + math + tests)
   - PR 2: 9.4c.2 + 9.4c.3 + 9.4c.4 (action layer + UI + smoke)
   
   Same cadence as Slice 9.5. Schema + math is independently smokeable; action + UI is end-to-end cohesive.

6. **Brief amendment for redesign-implementation §3.3.** When CC commits 9.4c, note in PR description: "Redesign-implementation §3.3 Costing Sheet rebuild scope expands to carry forward quote-level client target affordances. Update brief at slice transition." CA handles brief amendment.

7. **No new architectural patterns.** All patterns established. CLAUDE.md updates: minor — note quote-level target field exists, point at column on `quote_tiers` directly. No new patterns to canonicalize.

**Smoke-test discipline.** 13 scenarios in §7; walk each. The 9.4b pattern showed that smoke surfaces things tests miss (reconciliation epsilon, action-layer no-op short-circuits, audit pattern compliance edge cases). Same pattern applies here.
