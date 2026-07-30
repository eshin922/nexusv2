# CC Comm — Pricing Reframe Second-Round Fixes (PR #38 follow-up)

**To:** CC (Claude Code)
**From:** CA (Claude Advisory)
**Re:** Second smoke walk findings + fix package
**Status:** Five items to land before continuing Pricing reframe impl steps 4/6/7/8/9/10/11/12
**Source:** CB re-smoke walk against PR #38 fix branch + +990% Tier 1 test data

---

## Headline

CB's second smoke walk revealed two HIGH-severity bugs that didn't surface in round one, plus a real architectural insight on Gates 1 & 4. PR #38's core fixes are solid (Gates 2 applicable-path, 3, 5, 6, 7 all pass); two new bugs need patches before merge.

This comm packages five fixes for a second commit on the same PR, plus the unit-test gates that replace the unreachable smoke gates.

## What stays solid from PR #38

- ✅ Bug #2 (α) — apply-boundary pre-check (`assertNewAdjFitsBound`)
- ✅ Bug #2 (β) — suggestion engine disabled-with-reason pattern
- ✅ Bug #3 — error toast variant infrastructure
- ✅ Atomic-fail Global semantic (confirmed twice across two data states)
- ✅ Bug #1 misinterpretation diagnosis (closed)

Don't unwind any of this. The fix package extends, doesn't replace.

---

## Item 1 — Gates 1 & 4 reframe (smoke → unit tests)

### Architectural insight from CB

PR #38 changed the write-path semantics enough that **the overflow condition is no longer reachable through realistic workflow.** For `assertNewAdjFitsBound` to fire on Surgical, you'd need:
- Tier at high override (~990%+)
- AND that same tier below target
- AND cost stack so extreme that even 9.9x markup doesn't lift margin to firm target

That requires synthetic data. CB confirmed across -990, +990, 0% adj states with multiple apply attempts — no realistic path reaches overflow.

This is **healthy** — PR #38 fixed the underlying math semantics; `assertNewAdjFitsBound` is now defensive insurance, not the primary safety mechanism.

### Disposition

**Retire Gates 1 & 4 from smoke walks.** Replace with unit tests at the action layer.

### Unit test specifications

**Test 1 — `assertNewAdjFitsBound` contextual error:**
```typescript
describe('assertNewAdjFitsBound', () => {
  it('throws ActionGuardError with contextual message when newAdj exceeds upper bound', () => {
    expect(() => assertNewAdjFitsBound(15.0, 'Tier 1')).toThrow(
      /Cannot reach target.*Tier 1.*1500%.*±999% field range/
    );
  });

  it('throws ActionGuardError when newAdj exceeds lower bound', () => {
    expect(() => assertNewAdjFitsBound(-15.0, 'Tier 1')).toThrow(
      /Tier 1.*-1500%.*±999% field range/
    );
  });

  it('passes when newAdj within ±9.99', () => {
    expect(() => assertNewAdjFitsBound(9.99, 'Tier 1')).not.toThrow();
    expect(() => assertNewAdjFitsBound(-9.99, 'Tier 1')).not.toThrow();
  });
});
```

**Test 2 — Error toast variant fires on action failure:**
Use the existing test scaffolding for `ReframeStateProvider` + `failApply`. Mock action returns failure; verify `lastApplyError` populated; verify ApplyToast renders with red variant.

These two unit tests cover the verification path Gates 1+4 attempted but couldn't reach via smoke. Cleaner: smoke walks verify realistic flows; unit tests verify defensive guards.

---

## Item 2 — Bug #D [HIGH] — Float-precision no-op loop

### What CB observed

Tier displays at exactly 40.0% (raw value 39.99997%). SuggestionEngine surfaces:
> "Apply +0.0% to Tier 3 only · lands Tier 3 at target" ★ RECOMMENDED

Click Apply:
1. Writes a +0.0% per-tier override to DB (real DB write, audit log entry)
2. Shows success toast: "Lifted Tier 3 by +0.0pp"
3. Tier still fractionally sub-target internally
4. Suggestion re-fires same +0.0% recommendation
5. PM can click indefinitely; each click writes audit_log

PM stuck in BLENDED SENDABLE · 1 TIER RISK state with no path forward via the recommended action.

### Severity escalated from MEDIUM → HIGH

Production-impacting: audit log noise + user confusion + stuck-state. Reproducible reliably after any Global apply that lands a tier on the threshold boundary.

### Fix — two-part guard

**Part 1 — Threshold tolerance at predicate:**

In the suggestion-engine ranking logic (likely `pricing-suggestions.ts`):

```typescript
const TARGET_TOLERANCE = 0.001;  // 0.1% — matches display precision

const isBelowTarget = (tierMarginPct: number, targetMarginPct: number) =>
  tierMarginPct < targetMarginPct - TARGET_TOLERANCE;

const isBelowFloor = (tierMarginPct: number, floorMarginPct: number) =>
  tierMarginPct < floorMarginPct - TARGET_TOLERANCE;
```

Apply consistently across `isBelowTarget` + `isBelowFloor` predicates.

**Part 2 — Minimum-delta guard at suggestion-engine boundary:**

After suggestion math computes `applyDelta`:

```typescript
const MIN_DELTA_PP = 0.5;  // suggestions must move tier ≥ 0.5pp to surface

// In rankPricingSuggestions or where Surgical/Global options are built:
const surgicalDeltaPp = computeSurgicalDeltaPp(tier, target);
if (surgicalDeltaPp < MIN_DELTA_PP) {
  // Don't surface — would be a no-op
  return null;  // or filter from options array
}
```

Same pattern for Global.

### Why both

- **Part 1** catches "tier is effectively at target" at the predicate — no suggestion fires
- **Part 2** is the backstop — even if the predicate passes due to a different threshold path, the suggestion must have meaningful delta to render

Combined: eliminates the infinite no-op loop completely.

### Unit tests for Bug #D

```typescript
describe('Bug #D guards', () => {
  it('isBelowTarget returns false for tier at 39.99997% with target 40%', () => {
    expect(isBelowTarget(0.3999997, 0.40)).toBe(false);
  });

  it('isBelowTarget returns true for tier at 39.0% with target 40%', () => {
    expect(isBelowTarget(0.39, 0.40)).toBe(true);
  });

  it('rankPricingSuggestions does not surface Surgical when delta < MIN_DELTA_PP', () => {
    const result = rankPricingSuggestions({
      tiers: [{ id: 'T1', marginPct: 0.3999, /* ... */ }],
      target: 0.40,
      // ... other inputs that would produce <0.5pp surgical delta
    });
    expect(result.find(o => o.kind === 'surgical')).toBeUndefined();
  });

  it('rankPricingSuggestions surfaces Surgical when delta >= MIN_DELTA_PP', () => {
    const result = rankPricingSuggestions({
      tiers: [{ id: 'T1', marginPct: 0.35, /* ... */ }],
      target: 0.40,
      // ... inputs producing ~5pp delta
    });
    expect(result.find(o => o.kind === 'surgical')).toBeDefined();
  });
});
```

### Tolerance value calibration

`TARGET_TOLERANCE = 0.001` (0.1%) is intentionally one decimal beyond the display precision (which is 1dp). Justification:
- Display rounds to 1dp (e.g., 39.99997% → "40.0%")
- Tolerance at 0.1% means a tier displaying at "40.0%" cannot be flagged below-target — the raw value would have to be < 39.9% to be meaningfully below
- A tier displaying at "39.9%" CAN still be flagged below-target (raw value ~39.85-39.95) — preserves real below-target detection

`MIN_DELTA_PP = 0.5` (0.5pp) is the "noise floor" — suggestions below this don't materially change quote state. PMs care about pp moves, not basis points.

Both values are starting points; if CB re-smoke surfaces edge cases on real data, calibrate up/down. Bank as v1 measurement items.

---

## Item 3 — Bug #E [HIGH] — Surgical absent from DOM on below-floor

### What CB observed

When any tier is below floor (≤25%):
- FloorBlock renders ✅
- Accept-risk unavailability banner renders ✅
- BUT: Surgical option absent from DOM entirely
- AND: Global option absent from DOM entirely (per CB earlier walk)
- Only the accept-risk banner is visible — no suggestion cards rendered at all

### Why this is a regression

Three reference points all expected Surgical visible:

1. **Original CC walkthrough spec:**
   > "Below floor: SuggestionEngine renders below TCB. Surgical is ★ Recommended (per ranking: below-floor → surgical first)"

2. **Legacy Pricing surface** (pre-reframe, per the screenshots that prompted Edward's "un-shippable" review):
   - Tier 1 below floor → Surgical + Global both rendered with cards + accept-risk-unavailable banner

3. **PR #38 Bug #2 (β) fix intent:**
   - "Disabled options surface with reason populated rather than being filtered out (discoverability preserved)"

All three say Surgical should render. CB observes it absent.

### Root cause hypothesis

The `rankPricingSuggestions` filter logic likely conflates two states:
- **"out-of-range overflow"** → should be disabled-with-reason (per Bug #2 β)
- **"tier below floor"** → currently filtered entirely (incorrect)

Below-floor doesn't suppress the suggestion — Surgical is exactly the path to lift the tier ABOVE floor.

### Fix direction

Investigate `rankPricingSuggestions` for any branch that filters when below-floor is true. Surgical should render below-floor as:

- **Active + ★ Recommended** — if surgical math can lift the tier above floor at a feasible adjustment (within ±9.99 bound)
- **Disabled-with-reason** — if the surgical math would overflow the bound
- **Never filtered entirely**

Same logic for Global. Accept-risk stays suppressed-with-banner when below floor (this part is correct).

### Likely shape of fix

Wherever the rank logic checks `tier.isBelowFloor`, audit the branch — confirm it's not returning `[]` or filtering options. The below-floor condition should affect:
- Accept-risk availability (suppress with banner — already correct)
- Surgical/Global RANKING (Surgical ★ Recommended over Global per spec) — but not their PRESENCE

If the current code has something like:
```typescript
if (hasTierBelowFloor) {
  return { surgical: null, global: null, acceptRisk: { disabled: true, reason: '...' } };
}
```
That's the bug. Fix to:
```typescript
if (hasTierBelowFloor) {
  return {
    surgical: buildSurgicalOption({ ... }),  // can be disabled-with-reason if math overflows
    global: buildGlobalOption({ ... }),
    acceptRisk: { disabled: true, reason: 'Cannot accept risk while a tier is below floor' }
  };
}
```

### Unit tests for Bug #E

```typescript
describe('rankPricingSuggestions below-floor', () => {
  it('renders Surgical with ★ Recommended when a tier is below floor (and math is feasible)', () => {
    const result = rankPricingSuggestions({
      tiers: [
        { id: 'T1', marginPct: 0.10, isBelowFloor: true, currentAdjPct: 0 },  // feasible lift
        { id: 'T2', marginPct: 0.45, isBelowFloor: false, currentAdjPct: 0 },
      ],
      target: 0.40,
      floor: 0.25,
    });
    const surgical = result.find(o => o.kind === 'surgical');
    expect(surgical).toBeDefined();
    expect(surgical.disabledReason).toBeNull();
    expect(surgical.isRecommended).toBe(true);
  });

  it('renders Surgical disabled-with-reason when below-floor lift would overflow', () => {
    const result = rankPricingSuggestions({
      tiers: [
        { id: 'T1', marginPct: 0.05, isBelowFloor: true, currentAdjPct: 9.5 },  // would overflow
      ],
      target: 0.40,
      floor: 0.25,
      currentAdjByTier: { T1: 9.5 },
    });
    const surgical = result.find(o => o.kind === 'surgical');
    expect(surgical).toBeDefined();
    expect(surgical.disabledReason).toMatch(/exceeds.*field range/);
  });

  it('keeps accept-risk suppressed with banner when below floor', () => {
    const result = rankPricingSuggestions({
      tiers: [{ id: 'T1', marginPct: 0.10, isBelowFloor: true }],
      target: 0.40,
      floor: 0.25,
    });
    const acceptRisk = result.find(o => o.kind === 'accept_risk');
    expect(acceptRisk).toBeDefined();
    expect(acceptRisk.disabledReason).toMatch(/below floor/);
  });
});
```

---

## Item 4 — Bug #B [LOW] — Stale delta chip after state degrades

### What CB observed

PM applies Surgical → tier gains green `+58.0pp` delta chip ✅. PM then manually edits the tier's override via PerTierOverrideCard (changes qty, cost, or direct override value). Tier margin shifts. The green delta chip persists, still showing the prior `+58.0pp` even though the tier is now in a different state. Confusing — looks like the tier is still "just applied" when it isn't.

Session-only (clears on hard-refresh per Gate 5 finding). Not a persistence bug, just a state-lifecycle gap.

### Fix

When `lastApply.targetTierId` matches a tier whose value subsequently changes via path OTHER than the apply itself, clear `lastApply` (or just clear `lastApply.deltaPp` for that tier).

Pattern: in `ReframeStateProvider`, subscribe to tier state changes. When a tier referenced in `lastApply` has its `tier_price_adj_pct` updated by anything other than the apply mutator (e.g., manual edit via PerTierOverrideCard), reset the relevant `lastApply` slice.

Alternative simpler pattern: invalidate `lastApply` on ANY tier state change after the apply timestamp. Clears the chip on any subsequent edit; simpler to reason about.

CA lean: **simpler pattern** (invalidate `lastApply` on any subsequent tier change). The delta chip is meaningful immediately after apply; it loses meaning the moment state moves. Aggressive clearing is correct.

### Unit test

```typescript
describe('lastApply lifecycle', () => {
  it('clears lastApply when target tier state changes via manual edit', () => {
    // Set lastApply for Tier 1
    const { result } = renderHook(() => useReframeState(), { wrapper });
    act(() => result.current.recordApply({ targetTierId: 'T1', deltaPp: 5.8, ... }));
    expect(result.current.lastApply).not.toBeNull();

    // Simulate manual tier update
    act(() => result.current.updateTierAdj('T1', 0.5));
    expect(result.current.lastApply).toBeNull();
  });
});
```

---

## Item 5 — Bug #C [QUESTION → CONFIRMED] — Allow negative manual input

### Edward disposition

**Allow negative manual input** in price adj field. PMs need manual control over price reductions for promotional pricing / low-target customer accommodations.

### Fix

Locate the input regex / validation for the price adj field (likely in PerTierOverrideCard or a shared NumericInput component). Update to permit leading minus.

If current pattern is something like `/^[0-9.]*$/`, update to `/^-?[0-9.]*$/`.

Verify:
- Typing `-` as first character is accepted
- Typing `-` mid-string is rejected (only leading minus)
- Existing positive entries continue to work
- Submission of negative values writes correctly to DB (numeric(5,4) supports ±9.9999)

### Unit test

```typescript
describe('PriceAdjInput', () => {
  it('accepts negative input with leading minus', () => {
    const { getByRole } = render(<PriceAdjInput value={0} onChange={onChange} />);
    const input = getByRole('textbox');
    userEvent.type(input, '-5.5');
    expect(input).toHaveValue('-5.5');
  });

  it('rejects minus mid-string', () => {
    const { getByRole } = render(<PriceAdjInput value={0} onChange={onChange} />);
    const input = getByRole('textbox');
    userEvent.type(input, '5-5');
    // Whatever behavior the input has for invalid chars — verify minus is stripped or rejected mid-string
  });
});
```

---

## Sequencing

```
1. CC fixes Item 2 (Bug #D — HIGH) — tolerance + minimum-delta guard + unit tests
2. CC fixes Item 3 (Bug #E — HIGH) — rank logic investigation + fix + unit tests
3. CC fixes Item 4 (Bug #B — LOW) — lastApply lifecycle + unit test
4. CC fixes Item 5 (Bug #C) — input regex allow leading minus + unit test
5. CC adds Item 1 (Gates 1 & 4 unit tests) — assertNewAdjFitsBound + error toast variant
6. CC commits to PR #38 (second commit on same PR)
7. CB re-smokes:
   - Bug #D fix: tier at exact threshold → no Surgical surface (or surface only when delta ≥ 0.5pp)
   - Bug #E fix: below-floor state → Surgical visible (active ★ Recommended OR disabled-with-reason)
   - Bug #B fix: manual edit after apply → delta chip clears
   - Bug #C fix: type "-5.5" in price adj field → accepted
8. CC continues Pricing reframe impl steps 4/6/7/8/9/10/11/12
9. Final smoke + merge to main
```

**Estimated CC effort:** 1.5-2 days for all five items + unit tests.
**Estimated CB effort:** 30-45 min for focused re-smoke of fixed paths.

## What's NOT in this fix package (banked for later)

- Bug #A (toast auto-fade): closed as intentional design
- Anomalies #1/#2/#4: scope OUT, supersede in CD Pricing surface redesign
- Anomaly #3 (stale delta chip on hard-refresh): closed (same root as Bug #1 misinterpretation)

## Standing pattern reminders

- **PR comm doc** at `docs/cc-comm-pricing-reframe-fix-round-2.md` summarizing what landed
- **Unit tests required for defensive guards** — going forward, smoke gates that exercise unreachable-via-workflow code paths get retired; unit tests fill the gap
- **Don't expand scope** — fix the 5 items above; new issues during fixing surface to CA before absorbing

Standing by for fix PR comm.

— CA
