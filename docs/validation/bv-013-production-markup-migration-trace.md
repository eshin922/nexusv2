# BV-013 — Production markup authority: migration trace

**Status:** trace. Nothing implemented. Measured against the live shared
database 2026-08-18.
**Requested by:** Edward, 2026-08-18 (BV-013 slice open).
**Out of scope:** Production / OTC NetSuite SO projection.

---

## 1 · What resolves Production today

`resolveMarkup` (`src/lib/costing.ts:959`) is a four-rung ladder:

| # | rung | for Production today | for Bulk Raw today |
|---|---|---|---|
| 1 | Line override | never — `assembly_production_inputs` has no markup column | never |
| 2 | `{category}` default | **`Manufacturing` = 0.30** ✓ wins | `Raw ingredients` — **no row** ✗ |
| 3 | `{fallbackCategory}` default (`Other`) | not reached | **`Other` = 0.30** ✓ wins |
| 4 | Firm fallback `FALLBACK_MARKUP = 0.3` | not reached | not reached |

Live `markup_defaults` (7 rows, no `Production`, no `Raw ingredients`):

```
Primary 0.4500   Secondary 0.5000   Soft Goods 0.3500
Manufacturing 0.3000   Other 0.3000   Tooling 0.2000   Freight 0.2000
```

**So Bulk Raw already prices through `Other`** — silently, and correctly only
because `Manufacturing` and `Other` both happen to be 0.30. The code comment at
`costing.ts:907` says so outright: *"falls back to Other today."*

**Rung 4 can never be unavailable**, so resolution cannot fail. That single
property is the mechanism behind every silent substitution in this list: there
is no state in which the engine reports that it does not know a rate.

### Where the two categories are named

`PRODUCTION_MARKUP_CATEGORY` and `RAW_MARKUP_CATEGORY` are declared once each
and consumed at `costing.ts:1773/1777/1876/1907` (engine) plus
`production-drilldown.tsx` and `cost-stack-header.tsx` (display, label only).
The display sites read the constant rather than restating it, so a rename
propagates without touching them — which is what Stage 3 A bought.

**Tooling and R&D are NOT Production markup authorities.** They are the
`category` of individual production LINES (Setup fee → Tooling, R&D fee → R&D)
in the drilldown's virtual-line metadata, but the engine marks the whole
production section at `PRODUCTION_MARKUP_CATEGORY` and bulk raw at
`RAW_MARKUP_CATEGORY` — those two only. Verified by enumerating every
`lookupMarkup` / `resolveMarkup` call on the production path. The line
`category` strings are display taxonomy; retiring them is not required by
BV-013 and is not proposed here.

---

## 2 · The pin hazard, stated precisely

26 pinned quotes. `quote_commercial_markup_pins` holds per-(leaf, tier,
category) rows which `resolveQuoteCommercialSettings` collapses into a
`Record<category, number>` — a *defaults map*, same shape the live path uses.

Pinned category inventory:

```
Freight 0.2000 · Manufacturing 0.3000 · Other 0.3000 · Primary 0.4500
Raw ingredients 0.3000 · Secondary 0.5000 · Soft Goods 0.3500 · Tooling 0.2000
primary_packaging 0.3000   (6 rows — see §5)
```

135 rows per category. **No pin carries `Production`.**

### What happens to a pinned quote if the code simply starts asking for `Production`

Not what I first assumed. The pinned map has no `Production` key, so rung 2 is
unavailable and resolution falls to **rung 3 — the pin's own `Other`, 0.30**.
It does *not* fall through to the live 40%, because a pinned quote resolves
against its own map.

Today that coincidentally equals the historical Manufacturing rate. Had a pin
carried `Manufacturing = 0.35` and `Other = 0.30`, the same code would have
silently repriced it to 0.30 with nothing to notice.

### And what happens once the ladder is made fail-visible

This is the ordering constraint, and it is the sharper consequence.

BV-013 requires that a missing governed `Production` default **fail visibly**
rather than price through `Other` or the firm 30%. Remove those rungs for the
Production path and an old pin — which has no `Production` key — stops
resolving at all. **All 26 pinned quotes become unresolvable**, not
mispriced.

So the backfill is not a nicety that can follow the code change. It gates it.

---

## 3 · Is the backfill unambiguous?

Under BV-013, `Production` must serve BOTH the production section and bulk
raw. Those historically had two authorities, so one backfilled `Production` pin
row can only be correct if the two never disagreed.

Measured across every pin:

```
Manufacturing vs Raw ingredients divergent within a pin ....... 0
rows across both categories .................................. 270
pins where the two have different row counts ................. 0
pins already carrying Production .............................. 0
```

**Unambiguous on this population.** But they agree by COINCIDENCE, not by
construction: `Manufacturing` has a 0.30 default and `Raw ingredients` has no
row and lands on `Other`, also 0.30. Pattern 56 — a property that holds because
nothing has yet made it false.

The backfill is therefore safe *here*, and the migration must assert the
zero-divergence census at run time rather than trust this document. If a
divergent pin is ever found, one `Production` row cannot represent both and the
migration must stop rather than choose.

---

## 4 · Proposed migration order

Each step leaves the system resolvable. No step depends on a later one.

| # | Step | Class | Why this position |
|---|---|---|---|
| 1 | Backfill `Production` pin rows from each pin's historical `Manufacturing` rate, asserting zero divergence first | additive | Old pins must answer `Production` BEFORE anything asks. Existing `Manufacturing` / `Raw ingredients` rows are RETAINED — they are the record of what was actually pinned, and deleting them would destroy the evidence the backfill was derived from. |
| 2 | Insert live `markup_defaults` row `Production = 0.4000` | additive | Must exist before the code asks, or drafts hit the fail-visible path. |
| 3 | Switch `PRODUCTION_MARKUP_CATEGORY` and `RAW_MARKUP_CATEGORY` to `Production`; remove rungs 3 and 4 for the Production path | behavioural | The repricing moment. Drafts move 0.30 → 0.40; pins resolve their backfilled 0.30. |
| 4 | Retire `Manufacturing` and `Raw ingredients` from the LIVE defaults | destructive-ish | Only after nothing reads them live. Pinned rows keep their historical copies. |

Step 4 needs a disposition: `Manufacturing` may still be referenced as a
display category on packaging lines. Trace before deleting.

### The fail-visible shape

Rung 4 currently guarantees success. For Production the ladder becomes:

```
line override (never set on production) → Production default → FAIL
```

"Fail" should be the existing **unresolved-cost readiness** state, not a throw:
`UnresolvedQuoteCostsError` and the Client Send readiness path (#266) already
exist for exactly "the quote cannot be priced yet, and here is why". A new
error shape would be a second vocabulary for the same condition.

Packaging keeps all four rungs. Nothing in BV-013 touches its authority.

---

## 5 · Two findings outside BV-013, recorded not actioned

1. **`primary_packaging` — a second vocabulary in the same column.** 6 pin rows
   at 0.30, lowercase and underscored, against the Title Case used by every
   other category. Every other value matches a `markup_defaults.category`; this
   one does not. It resolves through rung 3 (`Other`) today. Not Production, so
   out of scope — but it means the pinned category vocabulary is not closed,
   and a future reader should not assume it is.

2. **Tooling / R&D line categories.** Display taxonomy on production lines, not
   markup authorities. Named here because the BV-013 brief lists them as
   candidates for retirement and the trace found they are already not acting as
   Production pricing authority — so there is nothing to retire, and a change
   there would be a display decision rather than a pricing one.

---

## 6 · Harness plan

Fresh witness from `main` before anything, then after each of steps 1, 2 and 3
— because the interesting failures are between them, not at the end.

Required outcomes:

- **after step 1** (pin backfill): bit-identical. A backfill that moves a number
  is a backfill that got the historical rate wrong.
- **after step 2** (live `Production = 40%`): bit-identical. Adding a default
  nothing reads yet must change nothing; if it moves, something was already
  resolving `Production`.
- **after step 3** (cutover): pinned quotes bit-identical; drafts carrying
  Production MOVE, by exactly the 0.30 → 0.40 delta and nowhere else.

Plus, as explicit assertions rather than digest side-effects:

- no Production resolution whose chosen rung is `Other`, `Manufacturing`, or
  `Firm fallback`;
- Packaging rollups unchanged on every quote, pinned and draft alike;
- the draft delta attributable per quote, so "it moved" can be checked against
  "it moved by the right amount".

The witness already captures per-quote economics and per-row production
ownership. It needs one addition: the **chosen rung** per Production
resolution, so "resolved through the right authority" is asserted directly
rather than inferred from a total that happens to match.
