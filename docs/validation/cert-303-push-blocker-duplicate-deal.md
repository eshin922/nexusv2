# BLOCKER — CERT-303 cannot push: its HubSpot deal already has a Sales Order

Found 2026-08-19 retrying the CERT-303 push after the Direct Service gate
repair. **Nothing was created in NetSuite.** Reported, not worked around.

---

## What happened

The push was refused twice, each time by a different guard, and each time
before anything existed at the provider.

**First refusal — the Direct Service item gate.** Fixed and shipped
(`75ea4ab`): a per-line destination is now exempt from the firm-wide mapping
requirement, keyed on the BV-011 destination rather than the fixed/other
identity split.

**Second refusal — DUPLICATED DEAL.**

> `[markComplete] DUPLICATED DEAL could not be reconciled: Sales Order 362441
> (SO2716) is already owned by a different Nexus quote… Adopting it would
> rewrite a completed order's commercial terms. Manual reconciliation
> required.`

---

## Why, measured

| | |
|---|---|
| CERT-303 | project `d9dc519a`, HubSpot deal **64142757296**, `accepted`, `soId` NULL |
| CERT-300 | project `d9dc519a`, HubSpot deal **64142757296**, `complete`, **SO2716** (362441) |

They are the same lineage. CERT-300 already consumed it.

**The constraint is NetSuite-side.** The account runs a duplicate-deal
UserEvent that refuses a second Sales Order for a `custbody_dps_deal_id` that
already has one. Nexus's own reconciliation then looked for the existing order,
found SO2716, and refused to ADOPT it because it belongs to a sibling quote.

Confirmed against the population, with a control so the count is not a failed
read reading as a small one:

```
SOs carrying deal 64142757296 : 1  (SO2716)
control (same query, id=362441): returned SO2716 — the query works
across all 25 projects        : no deal carries more than one pushed SO
```

**Both guards behaved correctly.** NetSuite refused the duplicate; Nexus
refused to adopt a completed order belonging to another quote rather than
rewriting its commercial terms. The attempt is parked
`needs_reconciliation` with `soId` NULL, which is the state that stops a blind
retry issuing a second CREATE.

---

## What this is NOT

Not the tax work, not the gate repair, not the Testing economics. Those are
proven up to the point of push. CERT-303 is `accepted` with its frozen line set
intact:

```
direct_service · SVC-TESTING-MICROS · testing_micros · otc_testing
Tier 1 · qty 2000 · rate 2.2400 · amount 4480.00 · selected 15323 / OTC-0016
```

---

## The V1 question this exposes

**A deal can carry several scenarios, but only one of them can ever reach
NetSuite.** Nexus's own model says a deal legitimately carries several
scenarios — the reconciliation message says so in as many words. The provider
says one deal, one order.

For certification that is merely inconvenient. For real use it decides
something: if a customer accepts a second scenario on a deal that already has an
order — a re-order, a revised scope, a second phase — Nexus cannot push it, and
the operator sees a DUPLICATED DEAL message about a sibling quote.

That may be exactly right (one deal = one order, and a second order belongs on a
second deal). It is not documented as a decision anywhere, which is the gap.

---

## Options for CERT-303, none taken

1. **Re-provision CERT-303 on a lineage with no Sales Order.** Cleanest.
   Requires either a new HubSpot deal — a **production HubSpot write**, which
   is not mine to make — or an existing unused deal. Several exist and are
   plainly disposable (`SMOKE-CB-DELETE-ME-…`, `SMOKE-CB-8B-DELETE-ME-…`), but
   picking one is a choice about what the permanent certification witness is
   anchored to.
2. **Free the deal by cancelling SO2716.** Rejected — SO2716 is the F1/F4
   terminal witness, and destroying evidence to unblock a test is the wrong
   trade in both directions.
3. **Certify the Testing path on a different fixture** whose deal is free, and
   keep CERT-303 as the authoring/freeze witness only. Loses the end-to-end
   push proof that is the point of the exercise.

Option 1 with an existing disposable deal needs no HubSpot write and is the
smallest step. It still needs a decision about which deal, because the result
becomes the permanent pure Direct Service certification witness.
