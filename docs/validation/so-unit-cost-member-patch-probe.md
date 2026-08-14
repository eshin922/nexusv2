# Item Group member cost PATCH — provider probe

**Status:** probe complete and **PASSED (12/12)**. Disposable SO deleted and
verified gone. SO2707/2708/2709 untouched. `patchSalesOrderLine` **not yet
widened** — no implementation performed.
**Date:** 2026-08-13

**Classification (corrected, adopted):** this is a **cost-field projection
mismatch**, not missing cost data. Nexus already transmits the governed unit cost
to `custcol_dps_unit_cost`. It does not also project it into the standard costing
fields Accounting's UNIT COST column and margin basis read, so NetSuite substitutes
its own item-master basis — which can be zero, or commercially unrelated.

---

## 1 · Probe design

Disposable Item Group SO `362041`, created through the **same bare-group expansion
path** production uses (`item + quantity` only). Values chosen so the instrument
cannot confuse the three quantities:

| | line 2 | line 3 |
|---|---|---|
| item-master default | ITEMDEFINED → **0** | AVGCOST → **0.088** |
| sell `rate` | **0** | **0.132** |
| governed cost PATCHed | **0.777** | **1.234** |

Line 4 (`OTC-0012`, LASTPURCHPRICE → 253.41) was **deliberately left unpatched** as
a negative control.

PATCH body carried **cost fields only** — no `rate` — to the individual member-line
URL `/record/v1/salesOrder/{id}/item/{address}`. **No full-sublist PATCH.**

## 2 · Read-back result — ground truth

```
BEFORE  line=2 rate=0     cER=0       cE=0       ITEMDEFINED
        line=3 rate=0.132 cER=0.088   cE=22      AVGCOST
        line=4 rate=0     cER=253.41  cE=63352.5 LASTPURCHPRICE

AFTER   line=2 rate=0     cER=0.777   cE=194.25  CUSTOM
        line=3 rate=0.132 cER=1.234   cE=308.5   CUSTOM
        line=4 rate=0     cER=253.41  cE=63352.5 LASTPURCHPRICE   ← untouched
```

| Assertion | Result |
|---|---|
| line count unchanged — **no duplicate group expansion** | **PASS** 5 → 5 |
| exactly one Item Group present | **PASS** 1 → 1 |
| member identities unchanged | **PASS** |
| member quantities unchanged | **PASS** |
| **sell rates unchanged by the cost PATCH** | **PASS** |
| `costEstimateType = CUSTOM` (lines 2, 3) | **PASS** |
| `costEstimateRate` = governed value | **PASS** 0.777 / 1.234 |
| `costEstimate` = qty × rate | **PASS** 194.25 / 308.5 |
| group header + EndGroup structurally unchanged | **PASS** |

**The sublist-expansion hazard did not occur.** The per-line URL with a scalar body
is a materially different operation from the full-sublist PATCH that returns 204
while silently doubling the order.

**The unpatched sibling is the strongest single line of evidence:** line 4 kept
`LASTPURCHPRICE / 253.41` untouched, proving the write is scoped to the addressed
line and does not disturb siblings.

**Cleanup:** `DELETE 362041 → ok`, `VERIFY → gone (404) ✓`.

---

## 3 · Minimum unified projection change

**Governing invariant:** the same governed Nexus product unit cost must reach
NetSuite's Accounting cost basis regardless of Direct vs Item Group structure and
regardless of freight/customs treatment. **Never** send freight, duty, tariff, sell
rate, or any commercial addition into `costEstimateRate`.

### 3a · Direct / flat lines — at CREATE

`sales-orders.ts:272`, alongside the existing custom column, conditional on the
same non-null guard so an absent governed cost leaves NetSuite's default alone
rather than asserting a zero:

```ts
...(line.unitCost !== null ? {
  custcol_dps_unit_cost: parseFloat(line.unitCost.toFixed(4)),   // retained
  costEstimateType: { id: "CUSTOM" },
  costEstimateRate: parseFloat(line.unitCost.toFixed(4)),
} : {}),
```

Do not send `costEstimate` — proven derived in both probes.

### 3b · Item Group members — per-line PATCH after expansion

`patchSalesOrderLine` widens from `{ rate }` to accept optional cost fields.
**The property that made it safe must be preserved literally:** the body is built
key-by-key from known scalars and **never spread from the argument**, so no caller
can smuggle `item.items` through it.

```ts
const body: Record<string, unknown> = {};
if (patch.rate !== undefined) body.rate = patch.rate;
if (patch.unitCost !== undefined) {
  body.costEstimateType = { id: "CUSTOM" };
  body.costEstimateRate = patch.unitCost;
}
```

**[REC] Write cost as a separate one-shot pass, NOT inside `runRateConvergence`.**
Rate convergence exists because rates must sum to the accepted total — it re-reads,
compares and re-patches until a gate passes. **Cost has no such invariant**; it is a
straight projection with nothing to converge toward. Folding it into the loop would
subject a one-shot value to a retry mechanism designed for a different problem, and
would make a cost mismatch capable of failing a commercial gate it has no bearing
on. One pass, one write per member, verified by read-back.

**[VERIFY AT IMPLEMENTATION]** The grouping plan's member shape carries `quantity`
and `rate`; whether it also carries the governed unit cost was not established in
this probe. If absent, it must be threaded through from the same rollup that
produces the member rate — that is the one piece of plumbing this change may need,
and it should be confirmed before estimating the work as trivial.

### 3c · `custcol_dps_unit_cost` — retained

No evidence Accounting has stopped needing it, and it may feed reporting not
visible from this side. Keep it until someone says otherwise; the native fields are
**added alongside**, not substituted for it.

## 4 · Targeted regression package

1. Flat payload with non-null `unitCost` emits `costEstimateType: CUSTOM` +
   `costEstimateRate`, and **never** `costEstimate`.
2. Null-cost control — neither field emitted; NetSuite's default left intact.
3. **Rate/cost independence** — same product, two lines, different `rate`,
   identical `unitCost` → identical `costEstimateRate`.
4. **Freight-treatment invariance** — projected `costEstimateRate` unchanged
   between a bundled-freight and a pass-through-freight quote. This is the
   SO2707/SO2709 assertion.
5. **Direct vs Item Group parity** — the same product at the same governed cost
   projects the identical `costEstimateRate` through both structures.
6. Group CREATE negative control — group branch still emits `item + quantity` only.
7. PATCH body shape — cost-only patch emits no `rate`; rate-only patch emits no
   cost fields; neither can carry `item.items`.

## 5 · Consequence for the certified set

With **3a and 3b together**, SO2707/2708/2709's structure becomes fully
projectable. The existing orders remain as they are — **incomplete, not wrong** —
and whether to leave them with the gap recorded or produce a fresh artifact is
Accounting's call.
