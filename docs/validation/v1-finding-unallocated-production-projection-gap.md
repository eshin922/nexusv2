# V1 finding — unallocated Production charges have no downstream NetSuite projection path

**Status: OPEN · registered 2026-08-13.** Not implemented; awaiting Accounting /
business disposition of the required NetSuite representation.

**This is the defect.** An OTC / service-SKU model is a *proposed solution*, not
the finding. The finding is the absence of a projection path for a state the
system can legitimately be in.

---

## The current contract

1. Production charges **allocated** into component/unit economics have a
   downstream representation — through the commercial SKU rates that carry them.
2. Production charges **not allocated** into unit economics may still form part
   of the **accepted Nexus commercial amount**.
3. Complete has **no explicit downstream line or SKU representation** for those
   unallocated charges.

Therefore Nexus lacks **projection completeness** for state 2: a governed
customer charge can exist inside the accepted amount with nothing on the Sales
Order that represents it.

---

## The governing invariant

> **Every governed customer charge in the accepted Nexus commercial amount must
> project downstream exactly once.**

For Production charges specifically:

| state | required downstream representation |
|---|---|
| **allocated** | component / member economics |
| **unallocated** | explicit downstream representation *(to be dispositioned)* |

**Never both. Never neither.**

Both halves are failures of the same invariant, and they fail in opposite,
equally undetectable directions — double-counting inflates the order while
reconciling internally; dropping deflates it while every surviving line looks
correct. Neither is visible to a totals check that only sums what is present.

---

## What is deliberately left open

- **The NetSuite representation itself.** Accounting will disposition it —
  potentially category-specific OTC / service SKUs, a single common OTC SKU, or
  another accounting structure. Nexus must not pre-empt that choice.
- **Bulk Raw classification** stays explicitly **open** pending
  Accounting/business disposition.

---

## When the mapping decision arrives

Convert this finding into the **minimum** projection implementation, plus a
fixture proving the invariant in both directions:

- an allocated charge appears in member economics and **not** as a separate
  line — no double-count;
- an unallocated charge appears **exactly once** in its dispositioned
  representation — no drop;
- and a case carrying both kinds simultaneously, since that is where a
  half-correct implementation reconciles by accident.

The fixture must assert on **per-charge attribution**, not on the order total —
a totals assertion passes a double-count offset by a drop, which is precisely
the failure mode this invariant exists to exclude.

---

## Scope

**Does not block Order D.** D exercises Item Group + Freight/Duty/Tariff and
carries no Production charges.

Cross-references: the standing rule *"exact reconciliation is necessary but not
sufficient"*; OD-025 (attribution must not change economics).
