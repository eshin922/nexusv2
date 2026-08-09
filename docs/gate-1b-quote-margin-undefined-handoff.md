# Handoff · quote-wide blended margin must be undefined at zero revenue

**Status:** specified and evidenced, not implemented. This is the last package
before A-6 closes on the governing rule.

## The defect

1. `blendedRevenue === 0` produces `blendedMarginPct = 0` (`costing.ts:2936`).
2. That synthetic `0` is passed to `computeStatus` (`costing.ts:2938`).
3. `computeStatus(0, 0.35, 0.25)` returns **`BELOW_FLOOR`**.
4. Those quotes are then counted as below-floor in firm-policy impact analysis
   (`firm-settings.ts:339-340`, `:458-459`).

A fabricated commercial verdict derived from an undefined quantity. Not merely
a displayed `0.0%` — eight quotes are asserted to breach the firm's margin floor
because nobody has entered revenue yet.

## The contract

> Quote-wide blended margin is `(blendedRevenue − blendedCost) / blendedRevenue`.
> When blended revenue is zero the margin is **undefined — not 0%**.

- `blendedMarginPct` undefined at zero revenue.
- `blendedMarginStatus` gains an explicit unavailable state, and `computeStatus`
  is **not called** for an undefined margin.
- Undefined quotes are **excluded** from GOOD / BELOW_TARGET / BELOW_FLOOR.
  That exclusion is part of the business contract and the resulting counts get
  asserted explicitly.

## The eight affected quotes

All currently `rev=0 · margin=0 · status=BELOW_FLOOR · suggestedAdj=null`:

```
180e6410  2de1dd81  600dd15c  9de0a19d
bfc6eebe  e33d0f54  f84334bd  f9c23c2f
```

## Consumers to update

| Site | Uses |
|---|---|
| `actions/firm-settings.ts:339-340` | bands quotes GOOD / belowTarget / belowFloor |
| `actions/firm-settings.ts:458-459` | `bandOf(...)` before/after a policy change |
| `admin/firm-settings/firm-settings-form.tsx:482,519` | displays `× 100` |
| `mark-accepted/page.tsx:182` | `summary.blendedMarginPct * 100` |
| store selectors + `MarginVerdictPill` | verdict UI |
| `pricing-classifier-context.tsx:~467` | **committed** local `1 − cost / revenue` |
| `pricing-classifier-context.tsx` `previewBlendedMargin` | **preview** local ditto |

The last two are the remaining A-6 violation. They agree with the engine on all
16 revenue-bearing quotes (≤1e-12) and disagree on the eight — the consumer
already returns `null` where the engine fabricates `0`, so the consumer is
currently *more* correct than the authority.

## S-7 · classified semantic correction

1. Preserve prior digest `150d9f5ab0e8261da2ea3d6b292dbe5c835265f55e8a076af5fb0a65110717e0`
   independently before touching anything.
2. Prove every non-zero-revenue quote stays byte-equivalent.
3. Prove exactly the eight above move, and report the precise fields that change
   on them.
4. Recapture the baseline **only after** that proof passes.

## Why this is not "make it nullable"

Nullability alone moves the fabrication one field over: `blendedMarginStatus`
would still band an absent margin. The status needs its own undefined state, and
every banding consumer needs to exclude rather than default.
