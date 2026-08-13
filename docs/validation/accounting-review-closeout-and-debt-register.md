# Accounting review — B/C/D closeout and engineering-debt register

**Fixture seeding is COMPLETE and PAUSED.** No further Accounting fixtures
without an explicit request. Accounting reviews SO2707 / SO2708 / SO2709 first.

---

## 1 · Preserved sandbox artifacts

| | SO | Total | Shape |
|---|---|---|---|
| **B** | **SO2707** (361542) | **$3,500** | single Item Group · Box @ $1.25 + Bottle @ $2.25 |
| **C** | **SO2708** (361642) | **$5,550** | two Item Groups · same Bottle independently priced **$2.40** and **$2.05** |
| **D** | **SO2709** (361741) | **$4,150** | Item Group + **$500** Freight + **$100** Duty + **$50** Tariff |

All three created through the **governed Nexus path** with production HubSpot
synchronization **suppressed and verified unchanged** — deal stage, amount,
closedate and `hs_lastmodifieddate` re-read after every transition on all three
deals, none moved.

**Do not delete, mutate or re-run these.** They are the review artifacts.

---

## 2 · Accounting interpretation point — SO2709

**Not a D certification failure.** D passed every check; the SO is commercially
correct at $4,150.

Freight, Duty and Tariff **do not appear as separate NetSuite SO lines** under
the current model. Nexus carries product economics **$3,500**, Freight **$500**,
Duty **$100**, Tariff **$50**. NetSuite receives total commercial economics of
**$4,150**, with the $650 absorbed into the governed **anchor member**:

```
Box line   $1.90/unit   =   $1.25 product  +  $0.65 Freight/Duty/Tariff
```

**NetSuite cannot reconstruct the $3,500 / $650 split from the SO lines alone.**
Nexus holds that split; the Sales Order does not carry it.

Full record: [`order-d-freight-certification-record.md`](order-d-freight-certification-record.md).

---

## 3 · Production downstream projection — OPEN

Registered at `65a92c0`. Awaiting Accounting disposition of how these charges
should appear in NetSuite / invoicing.

**Proven gap:** Production charges **not allocated** into component/unit
economics currently have **no downstream NetSuite representation**.

**Preserved invariant:**

> Every governed customer charge must project downstream **exactly once**.
>
> - allocated Production → member economics
> - unallocated Production → explicit downstream representation required
> - **never both** · **never neither**

**Do not implement OTC / service-SKU mapping until Accounting answers.**
**Bulk Raw classification stays explicitly OPEN.**

Full record:
[`v1-finding-unallocated-production-projection-gap.md`](v1-finding-unallocated-production-projection-gap.md).

---

## 4 · Banked engineering debt

None of these reopens the completed B/C/D set. Each is independent work.

| # | Item | State | Record |
|---|---|---|---|
| 1 | **OD-022 operator governance** — `detail_level` is presented as customer/PDF configuration while the runtime also uses it as ERP grouping authority; and its draft select is session-transient, silently reverting to `itemized` before Send | OPEN | [`od-022-detail-level-operator-governance.md`](od-022-detail-level-operator-governance.md) |
| 2 | **Grouped ambiguous-response provider walk** — the recovery repair's rules and classifier are unit-proven and mutation-checked; the **live** provider walk of the adoption branch is uncertified. The existing harness is stale (creates no `quote_snapshots` row, provisions `detail_level = itemized`) | OPEN | [`netsuite-ambiguous-create-recovery-implementation.md`](netsuite-ambiguous-create-recovery-implementation.md) · [`recovery-harness-stale.md`](recovery-harness-stale.md) |
| 3 | **Order A — Filling Product-master gap** | BLOCKED | `netsuite-accounting-review-runbook.md` |
| 4 | **Production downstream projection** | OPEN — §3 above | [`v1-finding-unallocated-production-projection-gap.md`](v1-finding-unallocated-production-projection-gap.md) |

### Closed during this programme, for context

- **OD-028** — post-OD-017 SO projection identity mismatch (`75e6ba0`). Third
  instance of the OD-017 same-type identity-space class.
- **COSTS-RENDER-1** — Packaging rows did not identify the component they cost
  (`2eddae0`). First instance of that class.
- **Provider request-idempotency** — measured: `X-NetSuite-Idempotency-Key` is
  **not honoured** by account `7924416_SB2`. It carries **no safety claim**.
  The effective duplicate/recovery model is Nexus attempt ownership →
  pre-retry provider reconciliation → duplicate-deal UserEvent →
  adoption → resume/convergence/final gate.

---

## 5 · Standing constraint

`NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC` remains **ACTIVE**. Re-enabling it before
go-live is **BLOCKER 1** in
[`production-go-live-checklist.md`](production-go-live-checklist.md), and
`/api/certification-status` must be disposed of per **BLOCKER 2**.
