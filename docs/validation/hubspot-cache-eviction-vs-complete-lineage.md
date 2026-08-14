# HubSpot cache eviction can strand a quote that Complete still requires lineage for

**Status:** OPEN — recorded, **not repaired** (explicit disposition, 2026-08-13)
**Class:** data-lifecycle contract between two subsystems that each behave as
designed
**Found:** during the Accounting Unit Cost certification tail

---

## The mechanism

Two correct behaviours, no shared contract between them.

**`syncDeals` evicts by design.** It deletes every cached row whose stage is in
`ACTIVE_STAGE_IDS`, then inserts the current active page. `schema.ts` states the
intent plainly: *"Deals that left the active pipeline are evicted
automatically."* For an import-browser cache that is exactly right — a closed
deal should not clutter the picker.

**`markComplete` requires that cache as governed lineage.** It reads
`hubspot_deals_cache` for `associatedCompanyId`, `dealName`, `dealFolderUrl`,
`projectServiceS`, `projectCategory`, `sourcingLocation`, `businessSegmentId`,
`clientPo`, `invoiceDateEst`, `productionShipDateEst`, `priority`, `dealType` —
and throws without it (`mark-complete.ts:330`).

**The collision is structural.** A quote reaches Complete precisely *because* its
deal was won — which is exactly what moves the deal out of the active set and
makes it eligible for eviction. The lifecycle stage that qualifies a quote for
Complete is the same one that can remove the data Complete depends on.

`syncDealById` is the documented recovery ("closed deals reach the cache only via
this path"), but nothing calls it automatically after an eviction, and
`refreshFromHubspot` — the action wrapping it — **has no UI caller** (orphaned
export). So an operator has no in-app way to repair the state.

## Observed instance

Deal `63198467934` at stage `195607084` (*Won - In production*) had no cache row.
Symptom on the project page: **"Sales: HubSpot owner unavailable"** in red.
Restored by a direct `syncDealById` call; cache 70 → 71 rows.

`loadSalesOrderPreflight` already anticipates the state — its `hasHubspotCompany`
doc comment names "the deal cache row is stale" as a cause — so the failure was
foreseen at the type level without a mechanism to prevent or repair it.

## Why it is recorded and not repaired

Deliberate. The repair touches the eviction contract, and the shape of the fix is
a real design question, not a patch:

- exempt deals with a Nexus project from active-set eviction; or
- re-sync via `syncDealById` on demand when Complete finds no row; or
- snapshot the lineage fields onto the quote at Accept (Pattern 52 draft-lock
  family), so Complete never depends on a mutable cache at all.

The third is the most durable and the largest. None should be chosen while
Accounting's downstream Production/OTC/Freight decisions are outstanding.

## Severity

**Latent but real.** It does not corrupt data — Complete throws before any
NetSuite write, so it fails closed. But it can block a legitimate Complete with
an error naming HubSpot lineage, and the operator has no in-app remedy. On a
shared dev/prod database, any `syncDeals` run can produce it.

## Distinct from the fixture disqualification found the same day

`fa74cbe5` also turned out to have **no company association in HubSpot at all**
— verified authoritatively against a control deal that resolved through the
identical call. That is a *fixture* defect and is unrelated to this one: the
refresh restored its row correctly, and it still cannot complete because the
source data does not exist. Recorded here only so the two are not conflated
later.

## Cross-references

- `src/lib/hubspot-cache.ts` — `syncDeals`, `syncDealById`
- `src/db/schema.ts` — the eviction model comment
- `src/lib/netsuite/mark-complete.ts:330` — the lineage guard
- `src/app/actions/projects.ts:114` — `refreshFromHubspot`, no UI caller
- Pattern 52 — snapshot-immutability via draft-lock, the shape option 3 follows
