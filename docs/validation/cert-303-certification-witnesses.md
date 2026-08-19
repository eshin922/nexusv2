# CERT-303 — the pure Direct Service / Testing certification witnesses

Two orders, both retained. One certifies the path; the other certifies that
reconciliation alone cannot.

---

## POSITIVE witness — SO2718

Lineage III · deal `64189597288` · project `e3791f00` · quote `1812bd65` ·
**DPS-1057** · NetSuite **SO2718** (internal `362542`).

A quote carrying **no Item Group and no product** — authored, priced, sent,
accepted and pushed through the governed path.

```
FROZEN   SVC-TESTING-MICROS  direct_service  otc_testing
         qty 2000 · unitRate 2.2400 · amount 4480.00 · selected 15323

POSTED   OTC-0016 OTC - Micro Testing (15323)
         qty 2000 · rate 2.24 · amount 4480 · taxCode -Not Taxable-
         costEstimateType CUSTOM · costEstimateRate 1.6 · custcol_dps_unit_cost 1.6
         header subtotal 4480 · total 4480 · taxTotal 0
```

| | |
|---|---|
| quantity = 2,000 | PASS |
| rate = $2.24 | PASS |
| amount = $4,480.00 | PASS |
| CUSTOM cost type | PASS |
| cost rate = $1.60 | PASS |
| tax code = -8 | PASS |
| tax total = $0 | PASS |
| item = OTC-0016 / 15323 | PASS |
| selected intent = posted provenance | PASS (15323 → 15323 → 15323) |
| REG-4 exact | PASS (448000c = 448000c) |
| **posted qty/rate match the frozen shape** | **PASS** (2000 × 2.2400) |

The last row is the one SO2717 failed, and it is asserted **independently** of
REG-4 — the frozen quantity and unit rate are compared to the posted ones
directly, because the total cannot tell the two shapes apart.

**Two proofs here are non-vacuous rather than merely green:**

- **Tax.** `taxTotal = 0` while customer 388800 still carries `taxable: true`.
  The configuration that produced $1,030.50 on SO2716 is unchanged; the payload
  is what suppressed it. No master data was touched.
- **Cost.** `costEstimateType CUSTOM` at 1.6 — the governed live cost
  ($3,200 ÷ 2,000). SO2716's OTC lines fell back to `LASTPURCHPRICE` and
  `ITEMDEFINED`, which is exactly what Decision 1 closed.

---

## NEGATIVE witness — SO2717 · retained unaltered

Lineage II · deal `64184909493` · **DPS-1056** · NetSuite **SO2717** (`362541`).

```
FROZEN   qty 2000 · unitRate 2.2400 · amount 4480.00
POSTED   qty 1    · rate     4480   · amount 4480
```

**Total reconciliation was exact. Unit representation was wrong.**

`1 × 4480` and `2000 × 2.24` are the same total, so REG-4 passed — and the
Sales Order still stated something the accepted quote did not. This is the
standing case, in production data, that **REG-4 alone is insufficient to
certify line-shape fidelity**.

Kept as a harness fixture for that reason. Not to be altered or deleted: its
value is precisely that it is a real order which reconciles and is wrong.

The regression it produced (`tests/unit/accounting-line-shape.test.ts`) drives
REG-4 link B over both the correct and the mis-shaped order and asserts it
accepts **each** — so the limitation is stated in code rather than remembered.

---

## Lineage inventory

| lineage | deal | Sales Order | role |
|---|---|---|---|
| ZZ-VALIDATION (original) | `64142757296` | SO2716 | F1/F4 terminal witness — untouched |
| ZZ-VALIDATION II | `64184909493` | SO2717 | **negative** — REG-4 passes, shape wrong |
| ZZ-VALIDATION III | `64189597288` | **SO2718** | **positive** — pure Direct Service, 11/11 |

One deal, one Sales Order — the V1 rule that made each new lineage necessary.
Every deal sits at stage `195274338 New (Acquiring Info)`; none was ever moved
to `195607084 Won - In production`, which enrols the production SO workflow.

---

## Still open

- **Base→Custom price level.** SO2718 posted `Base Price` (id 1), as SO2716 and
  SO2717 did. Nexus sets `rate` and never `price`; NetSuite fills the label.
  Unimplemented per instruction, pending a test of its effect on Item Group
  member PATCH.
- **Four operational fields** — Sales Rep, Customer PO Number, Estimated Invoice
  Date, Segment. Authority traces not yet done.

---

## TERMINAL INTEGRATION witness — SO2721

Lineage IV · deal `64198590286` · project `1f0aa7c5` · quote `ee09b4fc` ·
**DPS-1058** · NetSuite **SO2721** (internal `362741`).

The proof that all five mechanisms coexist in **one real `markComplete`
transaction** — non-taxable enforcement, the frozen Direct Service line shape,
CUSTOM cost basis, per-line item selection, and Custom price level. Each had
been proven individually; none had run together until this order.

```
FROZEN   SVC-TESTING-MICROS  direct_service  otc_testing
         qty 2000 · unitRate 2.2400 · amount 4480.00 · selected 15323

POSTED   OTC-0016 OTC - Micro Testing (15323)
         qty 2000 · rate 2.24 · amount 4480 · priceLevel -1
         taxCode -Not Taxable- · CUSTOM · costEstimateRate 1.6 · custcol 1.6
         subtotal 4480 · total 4480 · taxTotal 0
```

| | |
|---|---|
| quantity = 2,000 | PASS |
| rate = $2.24 | PASS |
| amount = $4,480.00 | PASS |
| cost type = CUSTOM | PASS |
| cost rate = $1.60 | PASS |
| tax code = -8 | PASS |
| tax total = $0 | PASS |
| item = OTC-0016 / 15323 | PASS |
| selected intent = posted provenance | PASS |
| REG-4 exact | PASS (448000c) |
| **price level = -1 / Custom** | **PASS** |
| subtotal / total = $4,480.00 | PASS |
| **provider qty/rate match frozen qty/rate** | **PASS** |

**13 of 13.** The last row remains asserted independently of REG-4, and the tax
proof remains non-vacuous — customer 388800 still carries `taxable: true`.

Grouped-order price level was **not** re-proven end-to-end here, per
disposition: the member PATCH was measured directly on SO2715 with SO2714 as an
untouched control, rate, amount and both subtotals unchanged.

## Lineage inventory (final)

| lineage | deal | Sales Order | role |
|---|---|---|---|
| ZZ-VALIDATION | `64142757296` | SO2716 | F1/F4 terminal witness |
| II | `64184909493` | SO2717 | **negative** — REG-4 passes, shape wrong |
| III | `64189597288` | SO2718 | pure Direct Service, 11/11 |
| IV | `64198590286` | **SO2721** | **terminal integration, 13/13** |

Probe artifacts, not witnesses: **SO2720** (disposable CREATE probe, no deal id)
and **SO2715** (member line left at price level -1).
