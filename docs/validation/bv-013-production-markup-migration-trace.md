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

---

# APPENDIX A · Steps 1–3 as executed, and the Step 4 consumer trace

## Executed

| Step | Migration | Witness vs baseline |
|---|---|---|
| 1 · backfill `Production` pin rows | `0085` | **bit-identical**, authority changed 0 |
| 2 · live `Production = 0.40` | `0086` | **bit-identical**, authority changed 0 |
| 3 · cutover + fail-visible | code | see below |

### Step 3 result

```
prod=Production default@0.3 : 21     raw=Production default@0.3 : 21
prod=Production default@0.4 : 15     raw=Production default@0.4 : 15
pkg rungs .......................... IDENTICAL to baseline
economics moved .................... 6     (all draft, all source=live)
pinned quotes ...................... 25    pinned moved: 0
production ownership digest ........ UNCHANGED
```

**Every** production and bulk-raw resolution now reports `Production default`.
No `Manufacturing`, no `Other`, no firm fallback survives anywhere on the
production path. Pinned quotes changed the NAME of their authority while
keeping the 0.30 rate the backfill preserved; drafts adopted 0.40.

### The one judgement call in Step 3

When the governed default is missing, `resolveMarkupStrict` yields no rate. The
arithmetic then uses **0** so the page can still render — not because zero is
the rate. Paired consequences, all deliberate:

- the Markup cell shows an em-dash, because the display keys off "was a
  candidate chosen", not off the node's effective number;
- the section prices at COST;
- the quote is unsendable, via the unresolved-cost readiness path.

Zero rather than a substitute rate because it fails toward a **visible**
problem: an unmarked section drags the margin verdict red, where a plausible
30% would have looked like a priced quote. Flagged as a judgement call rather
than buried.

### One invariant widened, precisely

The node-graph validator required every `resolution` to have exactly one chosen
candidate. Zero chosen is now legitimate — but **only when nothing was
available to choose**. Two chosen is still a defect, and so is zero chosen
while an available candidate sat unpicked, which would mean the resolver
skipped a rung it should have taken.

### One superseded premise, rewritten rather than patched

`cost-stack-bulk-raw-section.test.ts` (T-4) rested on two claims. Bulk Raw
being its own governed QUANTITY survives untouched. Bulk Raw having its own
markup AUTHORITY does not — BV-013 removes it by decision.

Worth stating plainly: **T-4's sharpest evidence is weakened by this.** Its
falsification showed that folding raw into production produced a blended rate
belonging to neither authority. With one authority the fold now produces
exactly that authority's rate, so the arithmetic no longer objects to folding.
The section split now stands on the structural argument alone — own node, own
cost. The test says so, so a future reader does not rediscover the weakened
falsification and conclude the split was never justified.

---

## Step 4 · consumer trace — what still references the old names

Requested before retiring anything. **Recommendation: retire nothing from
`markup_defaults`.** Only one consumer is obsolete, and it is code, not data.

### `Manufacturing`

| consumer | still legitimate? |
|---|---|
| `markup_defaults` row (0.30) | **KEEP.** No longer Production authority, but it is the value every backfilled historical pin was derived from, and deleting the row destroys the account of how those rates were reached. |
| `production-drilldown.tsx:108-109,326` — line `category` on Filling/blending and CM assembly rows | **KEEP.** Display taxonomy on a production LINE. Never consulted for pricing; the section resolves `Production`. |
| `commercial-settings.ts:120` — hardcoded into the pinned category set | **OBSOLETE.** See below. |
| pin rows (135) | **KEEP.** Historical record. |

### `Raw ingredients`

| consumer | still legitimate? |
|---|---|
| `markup_defaults` | **no row has ever existed** — nothing to retire. |
| `hubspot-product-options.ts:35` | **KEEP.** A HubSpot product-type option. Unrelated vocabulary that happens to share a string. |
| `spec-schema-mapping.ts:58` | **KEEP.** Maps the product type to `NO_SCHEMA`. Specification, not pricing. |
| `commercial-settings.ts:121` — hardcoded into the pinned category set | **OBSOLETE.** |
| pin rows (135) | **KEEP.** Historical record. |

### `Tooling` and `R&D`

Both are line `category` values in the production drilldown's virtual-line
metadata (`Setup fee → Tooling`, `Tooling / artwork → Tooling`, `R&D fee →
R&D`), plus `R&D` as a customer-view service-fee label. **Neither has ever been
a Production markup authority** — the engine marks the whole section at one
category. `Tooling` also has a live `markup_defaults` row at 0.20, which
packaging may consult; that is packaging's authority and out of BV-013's scope.

**Nothing to retire.** Retiring them would be a display decision.

### The one obsolete reference

`commercial-settings.ts:118-122` hardcodes `"Manufacturing"` and
`"Raw ingredients"` into the category set every NEW pin captures, alongside
whatever `markup_defaults` contains. Since Step 2 that set already includes
`Production`, so new pins are correct — but they also pin two categories
nothing prices from any more.

Harmless, and not proposed for removal in this slice: those two names are what
makes a new pin comparable with the 26 that predate BV-013. Removing them would
make pins taken before and after this migration structurally different for no
gain. Recorded as a v1.1 cleanup with that reasoning attached, rather than done
quietly now.
