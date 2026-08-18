# Certification customer lineage

**Permanent validation infrastructure.** Not a fixture, not disposable, and not
to be cleaned up after a walk. See [`OPEN_DECISIONS.md` CERT-1](../OPEN_DECISIONS.md)
for why it exists.

## Why it has to exist

`sendQuote` fails closed unless `resolveGovernedPaymentTerms` returns
`governed`, which requires

```
HubSpot deal → associated company → verified NetSuite customer → Terms
```

Every synthetic Nexus project fails at the first hop. `no_company` is decided
from the local `hubspot_deals_cache` before NetSuite is contacted, and a
fabricated deal id has no cached company. So without a real lineage the SEND
path can only ever be exercised against **real client work** — which means a
certification either contaminates a client project with a validation quote, a
consumed firm-wide quote number and a stored PDF, or it does not run.

This lineage exists so neither of those is necessary, permanently.

## What must NOT be done instead

**Do not point a synthetic project at a real client's deal.** The frozen
snapshot records the customer relationship the quote was sent under. Borrowing a
client's lineage would make that record assert a relationship that does not
exist — corrupting the very artifact the certification is meant to prove. It is
worse than the inconvenience it removes.

**Do not delete the lineage after a walk.** Rebuilding it costs a HubSpot write
and a NetSuite write every time, and each rebuild is another chance to get the
naming wrong or to reach for a client record "just this once".

## The four links

| # | Link | Where it lives | Who can create it |
|---|---|---|---|
| 1 | Validation **company** | HubSpot | **human, in the UI** — see the scope note |
| 2 | Validation **deal**, associated to that company | HubSpot | write token (`crm.objects.deals.write`) |
| 3 | NetSuite **customer** with Terms set | NetSuite sandbox (`*_SB2`) | `createRecord`, sandbox-authorized |
| 4 | `netsuite_customer_map` row: company → customer | Nexus DB | the Quote surface's customer-match affordance |

Then the Nexus **project** is imported from the deal through the normal
project-import flow, and quotes are authored on it like any other.

### Scope note — why link 1 needs a human

Neither HubSpot token can create a company. Measured 2026-08-18 against portal
`21497798` via `/oauth/v2/private-apps/get/access-token-info`:

```
HUBSPOT_ACCESS_TOKEN        companies.read  YES   companies.write  no
HUBSPOT_WRITE_ACCESS_TOKEN  companies.read  no    companies.write  no
                            deals.write     YES   deals.read       YES
```

Either a human creates the company in the HubSpot UI, or
`crm.objects.companies.write` is added to the private app. Links 2–4 are all
reachable from existing scopes and existing operator surfaces.

`scripts/gate-1b/hubspot-scope-probe.ts` re-measures this. Run it rather than
trusting the table above if a write ever fails unexpectedly — the scopes on a
private app can change without anything in this repo changing.

## Naming

Unmistakable, so that nobody ever mistakes a certification artifact for client
work — in HubSpot, in NetSuite, in the Nexus project list, or on a PDF that
escapes into a folder.

The convention is a `ZZ-VALIDATION` prefix on all four links. `ZZ` sorts last
in every list the firm reads, which is the point.

## Verifying the lineage

```
node --env-file=.env.local --experimental-strip-types --conditions=react-server \
  --experimental-loader ./scripts/support/src-resolver.mjs \
  scripts/gate-1b/freeze-walk-terms-lineage.ts
```

Reads the deal → company → NetSuite-customer chain from the local cache for
every project and prints `lineage-ok` / `NO-COMPANY` / `no-nscust` per project.

It deliberately stops **before** the NetSuite Terms read. That read fails in a
headless harness for an unrelated reason — a Clerk ESM import — and a failed
read is not evidence of absence (OD-027). What is decidable locally is whether
the chain exists at all, and `no_company` is returned before NetSuite is
contacted. Only `no_company` is a fact about the data; `netsuite_unavailable`
from that script is a fact about the harness.

## What certification uses it for

- **SEND** — the frozen commercial line set (#300), and every later change to
  what SEND freezes
- **ACCEPT** — where the acceptance transition itself is under test rather than
  simulated. Note the production HubSpot deal-stage push: an acceptance walk on
  this lineage moves a **validation** deal's stage, not a client's, which is
  the other reason the lineage is worth keeping
- **NetSuite Sales Order projection** — once F1/F4 lands and projection is
  certifiable end to end
