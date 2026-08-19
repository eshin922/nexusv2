# BLOCKER — a Testing Direct Service has no economics

Found 2026-08-19 during the CERT-303 walk, at Costs → Pricing. Reported, not
worked around. CERT-303 remains a pure Direct Service quote.

---

## What happens

Authoring a Testing Direct Service works. Pricing it does not.

| step | result |
|---|---|
| attach `SVC-TESTING-MICROS` | works |
| enter cost `3,200.00` on Costs → Production | **saves, displays, persists across reload** |
| select `OTC-0016` Micro Testing per line | works, resolves to id 15323 |
| Pricing | **"— NOT PRICED"**, blended margin `—`, every sell row `$0.0000` |

The cost is written, shown, and stored. It reaches the pricing engine nowhere.

---

## Why

`DIRECT_SERVICE_PRODUCTION_INPUT` routes each service identity to its own cost
column (`direct-service.ts:71`). Four of the five land in a column the math
layer sums. Testing does not.

| identity | column | summed into | reaches pricing |
|---|---|---|---|
| `formulation` | `rdTotal` | `oneTimeServiceFeeTotal` | yes |
| `filling_blending` | `fillingBlendingCost` | `internalProductionCogsTotal` | yes |
| `packout_assembly` | `cmAssemblyTotal` | `internalProductionCogsTotal` | yes |
| `other_service` | `otherServiceTotal` | `oneTimeServiceFeeTotal` | yes |
| **`testing_micros`** | **`testingMicrosTotal`** | **nothing** | **NO** |

`costing.ts:1815-1821` sums setup, legacy tooling+artwork, tooling, artwork, R&D
and other service. `testingMicrosTotal` is absent. It is absent from
`internalProductionCogsTotal` too, and from `costing-adapter.ts` and
`commercial-projection.ts` entirely.

Every reference to the column in `src/`:

```
markup-defaults.ts:33    COALESCE(...testingMicrosTotal, 0) <> 0     "is anything set?"
markup-defaults.ts:307   COALESCE(api.testing_micros_total,0)) <> 0  same
schema.ts:3197           the column definition
direct-service.ts:78     testing_micros: "testingMicrosTotal"        the write route
```

A write route, a schema line, and two "is it non-zero" checks. **No consumer
that prices it.** Migration 0083 added the column; nothing added it to the math.

---

## It is also not separately billable

`testingMicrosTotal` is absent from `OTC_FEES` as well, so it cannot become a
separately billed OTC line either. Testing currently has:

- a BV-011 destination (`otc_testing`, now per-line by Accounting's Case 0
  disposition)
- a cost column
- an authoring surface
- a per-line NetSuite item picker

…and **no economics at all**. It is stranded between the two buckets rather
than sitting in either.

---

## This is the #298 family, again

`8433e07` — *"a Direct Service's cost never reached the engine"* — fixed a
production loader that inner-joined `assemblies`, dropping service rows before
the math saw them. Its own commit message called it the *fourth* instance of the
same shape in that slice.

This is another: a cost authored, displayed and stored, then silently absent
from the arithmetic. The earlier one was a join dropping rows; this one is a sum
omitting a column. **The failure signature is identical from the operator's
side** — the number is on screen and changes nothing.

CERT-300 could never have caught it: its Direct Service is `formulation`, which
maps to `rdTotal`, which is summed.

---

## Why this is not mine to fix

Adding `testingMicrosTotal` to a sum changes what customers are charged, and the
choice of WHICH sum is a business decision, not an engineering one:

- **`internalProductionCogsTotal`** — Testing becomes part of per-unit cost,
  allocated across quoted units, invisible as its own line.
- **`oneTimeServiceFeeTotal`** — Testing behaves like Setup and R&D: allocated
  when the policy says so, and separately billable when it does not. This is
  the bucket its BV-011 destination and per-line item selection imply, but
  implying is not deciding.

There is a third possibility: that a Testing *Direct Service* is meant to price
through a different route entirely, and the column is vestigial.

**Do not infer the answer from the destination map.** BV-011 governs where a
charge POSTS, not how it is priced — that distinction is the whole point of the
destination model.

---

## Walk state

CERT-303 is left at draft, pure Direct Service, with the cost and the per-line
selection both saved. Everything up to Pricing is proved:

- Costs → Production renders with **zero Item Groups** ✓
- the Testing Direct Service row is present ✓
- governed cost accepted and persisted (`3,200.00`) ✓
- `OTC-0016` selected and resolved to id `15323` ✓
- both survive a full reload ✓

SEND and everything downstream are blocked: sending now would freeze a
`quote_on_request` line and the push would refuse for the right reason at the
wrong stage.

---

## What unblocks it

One decision: **which bucket does a Testing Direct Service's cost belong to?**
Then a one-line change to the corresponding sum, a falsification that the other
four identities' economics do not move, and the walk resumes from SEND.
