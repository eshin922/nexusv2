# SO Unit Cost — REST CREATE writability probe

**Status:** probe complete, disposable artifacts deleted and verified gone.
SO2707/2708/2709 untouched. No PATCH performed, `patchSalesOrderLine` unchanged.
**Date:** 2026-08-13

---

## 1 · Result

**REST CREATE accepts the native cost fields on flat lines, and read-back agrees.**
**Item Group member lines are unreachable at CREATE.**

### Probe A — flat / Direct inventory lines (SO id 361841, deleted)

Sent on each line: `costEstimateType: { id: "CUSTOM" }`, `costEstimateRate: 0.625`.
Deliberately different sell rates on the **same product** so the instrument cannot
confuse `rate` with `costEstimateRate`.

| line | item | qty | `rate` (sell) | `costEstimateRate` | `costEstimate` | type |
|---|---|---|---|---|---|---|
| 1 | 10064-GNX-Box | 400 | **7.77** | **0.625** | **250** | CUSTOM |
| 2 | 10064-GNX-Box | 400 | **3.33** | **0.625** | **250** | CUSTOM |

Ground truth is a **GET read-back of the stored record**, not the CREATE response.

- ✅ per-unit cost stored exactly as sent
- ✅ `costEstimate` = `quantity × costEstimateRate` (400 × 0.625 = 250) — derived by
  NetSuite; we did not send it
- ✅ sell rate independent — **7.77 and 3.33 against an identical 0.625 cost**

**This is the SO2707/SO2709 invariant, proven directly in one artifact:** the same
product, two different commercial sell treatments, identical governed unit cost and
identical extended cost. Freight/commercial treatment does not touch product cost.

### Probe B — Item Group (SO id 361941, deleted)

Cost fields were sent **on the group line**. They were accepted and **silently
discarded** — no error, no storage.

| line | item | qty | rate | `costEstimateRate` | `costEstimate` | type |
|---|---|---|---|---|---|---|
| 1 | group header | 400 | — | **absent** | absent | absent |
| 2 | member — Fill service | 400 | 0 | 0 | 0 | **ITEMDEFINED** |
| 3 | member — Pouch | 400 | 0.132 | **0.088** | 35.2 | **AVGCOST** |
| 4 | member — OTC Freight/Duties | 400 | 0 | **253.41** | 101,364 | **LASTPURCHPRICE** |
| 5 | group total | — | — | absent | absent | absent |

- ✅ group header carries no cost fields — confirmed, and what we sent was dropped
- ✅ EndGroup / total line carries no cost fields
- ❌ **member lines cannot be given `costEstimateType = CUSTOM` at CREATE** — they do
  not exist in the payload. NetSuite expands them from the item group master.

**Three things Probe B establishes that the earlier read did not.**

**Members inherit cost basis per item, not uniformly.** Three members, three
different types — ITEMDEFINED, AVGCOST, LASTPURCHPRICE. The certified set showed
AVGCOST only because Box and Bottle happen to carry that default.

**Members can hold non-zero cost.** Pouch resolved 0.088 and OTC-0012 resolved
253.41. So the blank on SO2707 is not an Item Group limitation — it is those two
items having an empty average-cost basis.

**NetSuite's own derivation is not trustworthy for margin.** Line 4 derived
`253.41/unit` from LASTPURCHPRICE against a `0` sell rate — an extended cost of
**101,364** on a 400-unit line. That is NetSuite deriving, unprompted, on a real
group. It is a strong argument for sending governed `CUSTOM` cost rather than
leaving any line to inherit.

## 2 · Cleanup

```
DELETE 361841 → ok      VERIFY 361841 → gone (404) ✓
DELETE 361941 → ok      VERIFY 361941 → gone (404) ✓
```

Both disposable Sales Orders removed and their absence verified by read-back.

---

## 3 · Minimum projection change

### 3a · Direct / flat lines — small, and the governed value is already in hand

`sales-orders.ts:272` already computes `line.unitCost` and sends it to the custom
column `custcol_dps_unit_cost`. The native fields go alongside it:

```ts
...(line.unitCost !== null ? {
  custcol_dps_unit_cost: parseFloat(line.unitCost.toFixed(4)),
  costEstimateType: { id: "CUSTOM" },
  costEstimateRate: parseFloat(line.unitCost.toFixed(4)),
} : {}),
```

Do not send `costEstimate` — proven derived. Send only when `unitCost` is non-null,
matching the existing conditional: an absent governed cost must leave NetSuite's
default alone rather than assert a zero.

**Worth noting:** Nexus has been sending a unit cost all along, to a custom column
Accounting's UNIT COST column does not read. The data was already correct and
already flowing; only the destination field was wrong.

### 3b · Item Group members — blocked, and this is the reported case

**SO2707/2708/2709 are Item Group orders, so the reported artifact is the
constrained path, not the easy one.**

Members are created by NetSuite's expansion, so the only reachable mechanism is a
per-line PATCH after CREATE — which is exactly what Step 3 already does for
**rates**. Extending that pass to carry cost is the obvious candidate and is
**deliberately not attempted here**: it requires widening `patchSalesOrderLine`
beyond `{ rate }`, which this instruction forbids and which the function's own
construction exists to prevent (a full-sublist PATCH returns 204 while silently
adding a second group expansion).

That is a disposition for you, not a change I should make. The narrow shape —
adding `costEstimateType` + `costEstimateRate` to the **existing single-line PATCH
that already writes rate** — does not reach the sublist hazard, since it is the
same per-line URL with two more scalar fields. But it is still a widening of a
function narrowed on purpose, and it should be authorized explicitly rather than
assumed from this probe.

## 4 · Targeted regression package

Scope deliberately small; no full-suite run.

1. **Payload unit test** — flat line with `unitCost` non-null emits
   `costEstimateType: CUSTOM` + `costEstimateRate`, and **never** `costEstimate`.
2. **Null-cost control** — `unitCost === null` emits neither field, so NetSuite's
   own default is left intact.
3. **Rate/cost independence (the invariant)** — same product, two lines, different
   `rate`, identical `unitCost` → identical `costEstimateRate`. This is the
   SO2707/SO2709 assertion and the one that would catch a future regression that
   reached for `rate`.
4. **Freight-treatment invariance** — projected `costEstimateRate` for a product is
   unchanged between a bundled-freight quote and a pass-through-freight quote.
   Guards against freight-loaded economics leaking into a cost field.
5. **Group-path negative control** — the group branch still emits `item + quantity`
   only, and no cost field appears on the group line. Locks in Probe B.

Item Group member coverage is **explicitly absent** pending §3b disposition.

## 5 · Consequence for the certified set

Unchanged from the prior finding: the three Sales Orders are **incomplete, not
wrong**. No incorrect cost was written. With §3a alone they would still show blank,
because they are Item Group orders — closing Accounting's actual report requires
the §3b decision.
