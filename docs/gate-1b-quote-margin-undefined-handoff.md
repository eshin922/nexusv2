# Quote-wide blended margin is undefined at zero revenue

**Status: implemented and proved.** This was the last package before A-6 closed
on the governing rule. Retained as the record of a classified semantic
correction — the first change in Gate 1B that moved a commercial scalar on
purpose.

## The defect

1. `blendedRevenue === 0` produced `blendedMarginPct = 0` (`costing.ts:2936`).
2. That synthetic `0` was passed to `computeStatus`.
3. `computeStatus(0, 0.35, 0.25)` returns **`BELOW_FLOOR`**.
4. Those quotes were counted as below-floor in firm-policy impact analysis
   (`getFirmPortfolioBands`, `previewFirmSettingsReband`).

Eight quotes stood accused of breaching the firm's margin floor because nobody
had entered revenue on them yet — and a change to the target or floor was
evaluated partly against quotes that had never been priced.

**Every step after the first was correct.** That is what made it durable:
nothing was broken except the premise. It is also why nullability alone would
not have fixed it — a null margin banded by a status that still had to choose
one of three bands just moves the fabrication one field over.

## The contract

> Quote-wide blended margin is `(blendedRevenue − blendedCost) / blendedRevenue`.
> When blended revenue is zero the margin is **undefined — not 0%**.

- `blendedMarginPct: number | null`.
- `blendedMarginStatus: MarginBand | "UNAVAILABLE"`, and `computeStatus` is
  **not called** for an undefined margin.
- Undefined quotes are **excluded** from GOOD / BELOW_TARGET / BELOW_FLOOR, and
  the excluded count is **reported** (`PortfolioBands.unassessed`) so that
  `good + belowTarget + belowFloor + unassessed === totalQuotes`. Excluding
  without reporting would make the portfolio smaller than the portfolio.

A margin of exactly `0` remains a real, terrible margin and still bands as
BELOW_FLOOR. Collapsing that with "no margin" is what went wrong.

## Consumers updated

| Site | Change |
|---|---|
| `costing.ts` — `QuoteSummary` | `number \| null`; new `MarginBand` / `QuoteMarginStatus` types |
| `costing.ts` — `computeQuoteSuggestion` | explicit UNAVAILABLE early return |
| `actions/firm-settings.ts` — `bucketQuotes` | excludes null, reports `unassessed` |
| `actions/firm-settings.ts` — reband preview | skips unassessed; `bandOf` stays `number`-only |
| `firm-settings-form.tsx` | unchanged — the affected lists are typed non-null, since only a banded quote can transition |
| `mark-accepted/page.tsx` | null-safe percent conversion; UNAVAILABLE never opens the below-floor gate |
| `mark-accepted/margin-verdict.tsx` | renders `—` and "UNAVAILABLE" instead of `0.0%` / BELOW FLOOR |
| `mark-accepted-host / -good / -locked / -pending` | prop widened to `number \| null` |
| `pricing/verdict-band.tsx` | `—` for the 96px number; neutral token, not the `bad` default |
| `global-price-adj-input.tsx` | coaching banner suppressed for UNAVAILABLE |
| `pricing-classifier-context.tsx` | **committed** and **preview** local `1 − cost / revenue` both deleted |

The last row was the remaining A-6 violation. Both reads now come from the
engine's own summary — committed from `quoteSummary`, preview from the
`evaluation: "preview"` run's `quoteSummary`.

## S-7 · classified semantic correction

Prior digest preserved independently at `docs/gate-1b/preserved/` **before** any
code changed. `scripts/gate-1b/classify-margin-undefined-movement.ts` then
proved four claims, with the prior digest and the eight quote ids pinned as
literals so it cannot agree with itself:

1. **16 revenue-bearing quotes byte-identical** to the prior baseline.
2. **Exactly the 8 authorised quotes moved** — and each authorised quote did
   move, checked in both directions.
3. **Only two fields differ on them**, on every one:
   - `quoteSummary.blendedMarginPct: 0 → null`
   - `quoteSummary.blendedMarginStatus: "BELOW_FLOOR" → "UNAVAILABLE"`
4. **Undoing precisely this correction reproduces
   `150d9f5ab0e8261da2ea3d6b292dbe5c835265f55e8a076af5fb0a65110717e0`** exactly.
   The strongest available statement that nothing else came along: the old
   baseline is recoverable from the new engine by reverting this one thing.

`suggestedAdj` did **not** move on the eight — it was already null via the
existing `blendedRevenue <= 0` guard, which confirms the new UNAVAILABLE early
return is behaviour-preserving.

Only then was the baseline recaptured: **`c85e555c1352c02928eaf30ec05686614294d8b3bc826dfa4e6e41e0b1eebfcb`**.

## Permanent coverage

`tests/unit/quote-margin-undefined.test.ts` — the scalar is null, the status is
UNAVAILABLE, no suggestion is produced, banding excludes and reports, a real
`0` still bands, revenue-bearing quotes are untouched, and — structurally,
against the source — `computeStatus` is not reached for an undefined margin and
no local `1 − cost / revenue` returns to the classifier. The structural
assertions exist because the value-level ones can all pass while a placeholder
is quietly reintroduced; that is the exact shape of the original defect.

## The per-tier twin — carved, then corrected separately

`QuotePerTierRollup.blendedMarginPct` carried the identical
`revenue > 0 ? … : 0` shape: **15 tiers across 10 quotes** reporting 0% and
banding BELOW_FLOOR. It was kept out of this package because two of those tiers
sit inside **revenue-bearing** quotes — `52bd0077` "Tier 4" and `93a5d4bb`
"Tier 2" — so correcting it here would have moved quotes this proof asserts do
not move, leaving neither transition independently attributable.

It was then corrected in its own package: `c85e555c…` → `a7e887ba…`, classified
by `scripts/gate-1b/classify-per-tier-margin-movement.ts`, which additionally
proves **no `quoteSummary` field moved** — so the quote-wide correction above
stands on its own record.

That package also split zero revenue into its two real meanings —
`UNAVAILABLE` (no cost either; nothing entered) and `COST_WITHOUT_REVENUE`
(cost incurred; a certain loss that blocks clearance) — across both scopes,
including the quote-wide margin defined here. The percentage stays undefined
in both. See `gate-1b-derivation-inventory.md` §3.2.5.
