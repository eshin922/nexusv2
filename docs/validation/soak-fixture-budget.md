# Soak fixture budget

**2026-08-26.** Why the soak needs more than one lineage, what is available,
and what was provisioned.

## The constraint

One HubSpot deal produces at most one Nexus Sales Order
(`cert-303-push-blocker-duplicate-deal.md`). So **a completed W9 spends its
deal permanently** — the lineage can never run W9 again.

The gate needs **two consecutive clean full runs on the same release**, and a
full run ends at W9. Two clean runs therefore need **two unconsumed lineages**,
and they must be available at the same time, because a repair between them
would break the same-release condition.

Run 3 spent UAT Case 5 on SO2725, leaving one.

## What "available" actually requires

A free deal is not enough. W9 refuses without a governed customer identity, so
a usable lineage needs **both**:

1. a HubSpot deal carrying **no** Sales Order, and
2. an entry in `netsuite_customer_map` binding its company to a NetSuite
   customer.

Measured across every validation and smoke lineage in the estate:

```
FREE   deal=PSR-SMOKE-FIXTURE   ns_cust=NONE     PSR Smoke Test
FREE   deal=63235924086         ns_cust=NONE     SMOKE-CB-8B-DELETE-ME
FREE   deal=63198467934         ns_cust=NONE     SMOKE-CB-DELETE-ME
FREE   deal=64200019819         ns_cust=388800   ZZ-VALIDATION — UAT Case 6
SPENT  deal=64203121535         ns_cust=388800   ZZ-VALIDATION — UAT Case 5
...
```

**Exactly one qualified.** The three other free deals have no customer map.

### Why the SMOKE deals were not used

Mapping one of them would mean writing a `netsuite_customer_map` row asserting
that a `SMOKE-CB-DELETE-ME` company IS some NetSuite customer. That is an
accounting-identity claim, and inventing one to unblock a test is precisely the
fabrication that is not ours to make. The deals are disposable; their
identities are not ours to assign.

## What was provisioned

**One HubSpot deal**, on the company that already carries the governed binding:

| | |
|---|---|
| deal | **64362942065** — "ZZ-VALIDATION — Soak Lineage VI" |
| pipeline / stage | Sales · **New (Acquiring Info)** (`195274338`) |
| company | `57628110136` — ZZ-VALIDATION — Nexus Certification Customer |
| NetSuite customer | `388800` — **reused**, not created |
| Sales Orders on the deal | **none** |

**No NetSuite or accounting authority was created.** The customer existed, the
map row existed, and the two products already resolve. Steps 3 and 4 of the
provisioning script report `reused existing customer` and a no-op binding — the
new lineage inherits the governed chain rather than asserting a new one.

The stage is the pipeline's FIRST by displayOrder, never
`195607084 "Won - In production"` — the stage that enrols the production
workflow `NETSUITE: Auto create NetSuite sales order from won deal` and would
create a PRODUCTION order. The script reads the pipeline and takes the first
stage rather than naming one, so it cannot drift onto the dangerous one.

### The verification that failed, and why it is not evidence against

The script's final step, `resolveGovernedPaymentTerms`, reported
`netsuite_unavailable` — with a Clerk ESM resolution error as the detail. That
is the harness, not the lineage: step 3 read NetSuite customer `388800`
successfully through the same client seconds earlier.

An instrument that cannot run is not a verdict, so the chain was verified
piecewise instead, and each link separately:

```
deal cached          64362942065 · stage 195274338 · company 57628110136
customer map         57628110136 → 388800
NetSuite customer    388800 exists · terms 7
Sales Orders on deal []
```

## The budget now

| lineage | deal | customer | state |
|---|---|---|---|
| ZZ-VALIDATION — UAT Case 6 | `64200019819` | 388800 | free → **run 4** |
| ZZ-VALIDATION — Soak Lineage VI | `64362942065` | 388800 | free → **run 5** |

Two runs can now each complete W9 on the same frozen release. **After run 5
both are spent**, and a third consecutive run would need another lineage
provisioned the same way.

## Standing note for whoever plans run 6

Provisioning is cheap and governed — one deal on the existing company, via
`cert-lineage-build <companyId> --name="..." --commit`, idempotent on the name.
What is NOT cheap is discovering mid-run that the deal is unusable, so check
both conditions before a run starts rather than at W9.
