# Decision 1 — explicit CUSTOM cost basis · implementation impact

Written 2026-08-19, **before any code**, per the Decision 1 gate. No production
code, schema, mapping or fixture has been touched.

---

## The headline

**The governed cost already exists in Nexus for both line kinds. No new
operator input is required, and no migration.**

That was the question worth asking, and the answer is unambiguous once traced —
for OTC lines the cost is not merely present, it is the value the customer sell
price is *computed from*.

---

## 1 · Where the cost already lives

### Direct Service — `contributionCostPerUnit`

A Direct Service is not a special case in the projection. It runs through the
**same unit-line branch as products** (`commercial-projection.ts:234-292`):

```ts
const rate = pt?.requiredSellPerUnit ?? null;
const cost = pt?.contributionCostPerUnit ?? 0;   // ← already governed
```

`contributionCostPerUnit` is the identical field that product lines already send
to NetSuite today as `custcol_dps_unit_cost` + `costEstimateRate`. It is
computed by the math layer, it is the certified cost authority, and it reaches
services already — that is precisely what `8433e07` ("a Direct Service's cost
never reached the engine") fixed.

**Why it isn't on the Sales Order today** is my own cutover, not an absence: I
excluded services from the live structure index (`liveByLeafId`) so a service
could never acquire a product line's quantity or rate, and set `unitCost: null`
for every non-product line. The exclusion is still correct for quantity and
rate. It over-reached on cost.

### OTC — the production-input column the sell is derived from

`commercial-projection.ts:329-350` computes an OTC line's price as:

```ts
const raw = row[fee.field];                      // ← the governed COST
const amount = raw * (1 + productionMarkupPct);  // ← the customer sell
```

`raw` is a column on `assembly_production_inputs`, per (assembly, tier):

| destination | column |
|---|---|
| `otc_setup` | `setup_fee_total` |
| `otc_tooling` | `tooling_total` |
| `otc_artwork` | `artwork_total` |
| `otc_formulation` | `rd_total` |
| `otc_other_service` | `other_service_total` |

That mapping is already governed and already in code as
`OTC_COLUMN_DESTINATION` (`bv011-destinations.ts:98`), and within
`line_kind = 'otc'` it inverts cleanly — each destination has exactly one source
column.

So for SO2716's Setup line: the $700 sell **is** `raw × (1 + markup)`. The cost
is not missing; it is the number the price was built on and then discarded.

### What this rules out

A new operator field would create a **second** cost authority for a number that
already has one — the shape Pattern 58 exists to prevent, and the one Edward's
instruction was guarding against. It should not be proposed.

---

## 2 · The one real design question: live or frozen?

The frozen snapshot (`quote_snapshot_line_tiers`) carries `quantity`,
`unit_rate`, `line_amount` — **commercial only**. It carries no cost. So the
cost must come from somewhere at push time, and there are two shapes.

### Option A — cost stays LIVE *(recommended)*

Read at push, exactly as product `unitCost` is today.

- **No schema change, no migration, no freeze widening.**
- Matches the treatment F1/F4 certified: *"`unitCost` stays live and stays
  non-commercial."*
- The F1/F4 structure guard says so explicitly: *"Historical cost-basis
  reproducibility, if it is ever wanted, is a SEPARATE governed snapshot rather
  than a widening of this one."* Option B is that widening.
- Draft-lock means production inputs cannot change after send anyway, so for a
  sent quote live and frozen coincide in practice — the same argument that made
  live product `unitCost` acceptable.

### Option B — freeze the cost alongside the commercial line

Add a cost column to `quote_snapshot_line_tiers`, written at send.

- Gives true historical cost reproducibility.
- **But** it puts a cost column inside the commercial freeze, which is exactly
  what #300 was scoped to exclude, and it makes Pattern 52's freeze-list a
  mixed commercial/cost record. It also needs a migration and a backfill
  decision for already-sent quotes.

**Recommendation: Option A.** Option B is a legitimate future want, but it is a
cost-governance slice in its own right, not a line item inside Accounting UAT —
which is the boundary Edward drew.

---

## 3 · Sub-questions that need answers before coding

**a · What is sent when the governed cost is zero?**
My cutover's current comment says a zero "would assert the fee is free". That
reasoning still holds where cost is *unknown*. But a governed cost of exactly
zero is a **statement**, not an absence — a 100%-margin line is a real thing.
The two need distinguishing:

- cost column is `NULL` → send nothing, let NetSuite default (today's behaviour)
- cost column is `0` → open question: send `0` (asserting free) or send nothing?

**b · Does a service with `contributionCostPerUnit = 0` mean uncosted?**
The projection already treats `rate === 0 && cost === 0` as *unpriced* rather
than free, so there is precedent for reading a double-zero as absence. A priced
service with zero cost is the ambiguous case.

**c · The legacy combined `tooling_artwork_total` needs nothing.**
It carries no BV-011 destination by design, so it already blocks the push with
`legacy_combined_otc` before any cost question arises. No work.

---

## 4 · What actually changes

Scoped against the certified F1/F4 emitter.

| # | change | where |
|---|---|---|
| 1 | carry `contributionCostPerUnit` for Direct Service lines | a service-cost index alongside `liveByLeafId`, kept out of the *structure* index so services still cannot acquire a product quantity or rate |
| 2 | resolve the OTC cost column at push from the frozen line's destination | new read of `assembly_production_inputs` by (assembly, accepted tier), inverting `OTC_COLUMN_DESTINATION` |
| 3 | set `unitCost` on accounting lines instead of hardcoded `null` | `mark-complete.ts`, the `if (!isProduct)` branch |
| 4 | assertions that cost cannot reach a commercial figure | tests |

**No migration. No new operator field. No change to the frozen record. No change
to rate, quantity, amount, REG-4 or the convergence gate.**

The payload builder already does the rest: a non-null `unitCost` emits
`costEstimateType: { id: "CUSTOM" }` and `costEstimateRate` — which is precisely
the `CUSTOM` basis Accounting asked for.

---

## 5 · Keeping cost non-commercial, and proving it

Edward's constraint: *"changing/reporting cost must not alter the frozen
customer sell amount or REG-4."*

Structurally this already holds — REG-4 reads only `frozenLine.rate`,
`frozenLine.amount`, `frozenLine.quantity` and `soLine.rate`, and none of the
four changes above writes any of them. But *"it already holds"* is the claim
that needs falsifying rather than asserting, so the slice must carry:

- a test that perturbing every fee-line cost leaves REG-4's inputs and the
  computed order total **bit-identical**;
- the existing negative assertions extended so a cost value appearing in
  `reg4Groups` or `reg4FlatLines` fails the build;
- a falsification run: set a fee cost, confirm the order total does not move.

That last one matters because live and frozen currently agree on this quote —
the same coincidence that made proof 8 nearly vacuous in the F1/F4 walk. A test
that only shows "the total didn't change" while nothing *could* have changed it
proves nothing.

---

## 6 · Recommendation

Proceed with **Option A**, four changes, no migration — once (a) and (b) in §3
are answered.

Those two are genuinely Accounting's: they decide what a zero cost *means* on a
fee line. Everything else is engineering, and the cost authority they asked us
to find already exists.
