# SO2707 incident — a certification quote overwrote a preserved order

**Date:** 2026-08-13 · **Status:** restored; both root causes repaired
**Severity:** high — a completed Sales Order's commercial terms were rewritten
by an unrelated quote

---

## What happened

The mixed-structure certification quote (`a4c36959…`, scenario
`CERT-MIXED-DELETE-ME-2026-08-13T20-26-37`) was seeded on the **Root - 2 Side
Seal Sachets** project because that project's lineage was already verified. That
deal (`59153706532`) **already carried SO2707** from a sibling quote.

At Complete, the ambiguous-create reconciliation searched NetSuite for orders
carrying the deal id, found exactly one — SO2707 — **adopted it**, and ran rate
convergence against it.

| SO2707 line | before | after adoption |
|---|---|---|
| `1024` 10064-GNX-Box | rate **1.25** | rate **0.5365** |
| `66476` DPS-BOTTLE-0001 | rate **2.25** | rate **1.8705** |
| order total | **3,500** | **2,407** |

The run then failed its own gate (`Σ group amounts 2407 ≠ accepted total
6075.5`) and stopped at `awaiting_rates`. **SO2708 and SO2709 were untouched**
(`lastModifiedDate` = `createdDate`). No second Sales Order was created.

## Restoration

Damaged state was preserved read-only first, then **only the two commercial
rates** were restored through the narrow per-line scalar PATCH. Each patch was
refused unless the addressed line still held the expected item, so a shifted
index could not be written blind.

Verified by read-back: `1024` → **1.25**, `66476` → **2.25**, total
**3,500**. Cost fields (`AVGCOST` / 0), structure, quantities, customer, memo
and group identity were not written and are unchanged.

**This is a recovery, not a byte-identical restoration.** SO2707's
`lastModifiedDate` is now 2026-08-13T21:01Z and carries an audit trail of both
the damage and the repair. The commercial content is restored; the record that
it was temporarily mutated is permanent and should stay that way.

## Root cause 1 — adoption was scoped to the DEAL, not the quote

`findSalesOrdersByDealId` matches on `custbody_dps_deal_id`:

```sql
WHERE type = 'SalesOrd' AND custbody_dps_deal_id = '<deal id>'
```

A HubSpot deal legitimately carries **many Nexus scenarios** — that is the
scenario model working as designed. So "exactly one Sales Order carries this
deal id" does **not** mean "this attempt's Sales Order"; it may be a sibling
quote's completed order.

Structural verification could not separate them, and could not be expected to:
a sibling scenario on the same deal is structurally plausible by construction.

**Repair.** `decideReconciliation` gains an ownership veto, checked **before**
verification so no verification outcome can override it. A candidate whose
NetSuite id is already durably associated with a different Nexus quote —
present in another quote's `netsuite_so_id` or another `netsuite_so_pushes`
row — fails closed. `reconcileBeforeCreate` now requires the attempting
`quoteId`; without one it treats every candidate as foreign, because the
permissive reading of that ambiguity is what caused this incident.

Existing checks are unchanged: an unowned candidate still goes through full
structural verification, and multi/zero-candidate behaviour is untouched.

### Residual — correlation, not identity

**This repair is a veto, not an identity.** An **unowned** provider Sales Order
matched only by deal id is still correlation: it says "some order for this deal
exists and no Nexus quote claims it", which is weaker than "this is my order".
That gap is real and is deliberately left open here.

The durable closure is a **provider-side deterministic identity** written at
CREATE and read back at reconciliation — a quote/snapshot-scoped key such as
`custbody_nxs_idempotency_key`. `computeIdempotencyKey(quoteId, quoteSnapshotId)`
already exists and is already deterministic per accepted snapshot; what is
missing is a provider field to carry it, so reconciliation can match on the
attempt rather than on the deal. **No other provider-side identity was found in
the current code** — the only body-level identifiers traced are
`custbody_dps_deal_id` (deal-scoped) and `memo` (descriptive).

Deliberately not done here, and deliberately not broadened into NetSuite
master-data redesign.

## Root cause 2 — the success gate only measured the grouped half

`evaluateSuccessGate` treated **every** ungrouped line as an error and summed
**only** Item Group amounts against the full accepted total. Correct while all
lines were grouped; wrong the moment Direct Products became a peer projection.

Two consequences, and the second is the dangerous one:

- a **correct** mixed order could never pass;
- an order **missing its Direct line** reconciles perfectly against its own
  remaining lines, so a totals-only gate cannot see the omission at all.

**Repair.** The gate takes the accepted `plannedDirectLines` and checks the
whole structure:

- Σ group amounts **+ Σ Direct amounts** = accepted total;
- each planned Direct line present **exactly once** as a flat line, at the
  accepted quantity and rate;
- a planned Direct line found **inside a group** is reported as
  misattribution, not as absence — different cause, different remedy;
- an ungrouped line that was never accepted still fails (narrowed, not removed);
- a grouped member also appearing flat fails — Probe 7a doubling, caught from
  the provider side rather than only prevented at the payload.

Falsification: `tests/unit/mixed-order-verification-and-ownership.test.ts`
asserts that the mixed order missing its Direct line fails **with an explicit
absence failure**, and — in the adjacent test — that the same provider state
passes cleanly when the Direct line was never accepted. The only thing
separating the healthy case from the incident is whether the line was declared
as accepted, which is exactly why totals alone are insufficient.

## My error

The fixture reused a project whose deal already had a completed Sales Order. The
check was trivially available (`netsuite_so_id` on sibling quotes) and the
prerequisite list in `netsuite-certification-matrix.md` §4 did not include it.
The defect was pre-existing; exposing it this way was avoidable.

**Added to the fixture prerequisites:** the deal must carry **no existing Sales
Order**, or the fixture must use a deal that does not.

## State

- SO2707 restored; SO2708 / SO2709 untouched throughout.
- Certification quote `a4c36959…` remains `accepted`, `accepted_tier_id` null,
  push at `awaiting_rates`. **Not retried** — a retry would converge against
  SO2707 again. Whether to recover or discard it is an open decision.
- Governed suite 1136/1136, `tsc` clean, prebuild green.
