# HubSpot deal cache

Slice 5.6 added a Postgres mirror of HubSpot active-pipeline deals
(`hubspot_deals_cache`). The import-deals page reads from it; HubSpot
remains canonical for deal state.

## Why

The pre-cache `/import` page made 3 sequential HubSpot round-trips per
visit (search → associations + owners parallel → companies). Steady-state
~1s, search and pagination paid the same cost on every keystroke. The
cache makes search and pagination sub-100ms and confines the HubSpot cost
to one explicit (manual) or quasi-explicit (15-min staleness) sync.

## Schema

`hubspot_deals_cache` columns are denormalized at sync time so the read
query stays single-table:

| column | source / notes |
|---|---|
| `deal_id` (PK) | HubSpot deal object id |
| `deal_name` | `dealname` (defaults to `'(unnamed)'`) |
| `deal_stage` | `dealstage` — stage id; UI resolves the current label through the HubSpot provider stage catalog |
| `amount` | `amount` |
| `close_date` | `closedate` (cast to date) |
| `sales_rep_id` | `hubspot_owner_id` |
| `sales_rep_name` | denormalized from `owners.getPage` |
| `sales_rep_email` | denormalized from `owners.getPage` |
| `pm_id` | `process.env.HUBSPOT_PM_PROPERTY` (TBD — see UX_BACKLOG) |
| `pm_name` / `pm_email` | denormalized; populated when `pm_id` is set |
| `associated_company_id` / `_name` | associations + companies batch |
| `created_at_hubspot` | `createdate` |
| `updated_at_hubspot` | `hs_lastmodifieddate` |
| `last_synced_at` | `now()` at upsert |

Indexes: PK on `deal_id`, btree on `deal_name` (search), `deal_stage`
(filter), `last_synced_at` (staleness).

This is a cache — fields can be added/dropped freely; no inbound FK
references. `projects.hubspot_deal_id` is a soft reference; project rows
survive cache truncation.

## Sync model

### `syncDeals()` — full active-pipeline refresh

Delete-then-insert in a short transaction. The HubSpot fetch happens
**outside** the transaction so locks aren't held during the network walk.

```
1. Fetch owner details once (single owners.getPage; reused across pages).
2. Walk active-stage deal pages via search API until cursor exhausts.
3. Per page: associations + companies + build cache rows.
4. BEGIN; DELETE WHERE deal_stage IN (active_stages); INSERT all fresh; COMMIT.
```

Eviction is automatic: deals that have left the active pipeline aren't
in the fresh fetch and get wiped by the DELETE. If the HubSpot fetch
fails mid-walk the DB is never touched — no partial state.

### `syncDealById(dealId)` — single-row upsert

Fetches one deal via `deals.basicApi.getById`, builds a cache row,
upserts via `onConflictDoUpdate`. Used by:

- `importDeal` — imports always hit fresh HubSpot data.
- Retained `refreshFromHubspot` compatibility action — the single-deal refresh
  threads through cache so all read paths use the same source. It has no V1
  operator entry point pending an approved synchronization and overwrite
  contract.
- Implicit support for closed deals: `syncDealById` writes any deal,
  including closed ones, into the cache. They coexist with active rows
  and are not touched by `syncDeals` (its DELETE filter is the
  active-stage set).

## Staleness + auto-sync triggers

`CACHE_STALENESS_MINUTES = 15`. Three behaviors on `/import`:

| cache state | behavior |
|---|---|
| empty (count = 0) | block render via `<Suspense>`, await `syncDeals()`, then render |
| populated + fresh (≤15 min) | render cache instantly, no sync |
| populated + stale (>15 min) | render cache instantly, fire `syncDeals()` via `after()` (post-response, errors logged not thrown) |

The Import workspace cache refresh — clicking its cache badge or explicit
button calls the `refreshDealsCache` server action which forces
`syncDeals()` regardless of staleness, then `revalidatePath('/import')`.
This governed import-cache operation is distinct from manual refresh of an
already-imported project, which is intentionally excluded from V1.

### Badge polling

The "Last synced X ago" badge polls `/api/import/cache-status` every 2s
when it knows a sync is in flight (cache empty on mount OR stale on
mount). Polling stops on the first observed advance of `last_synced_at`
or after 30s. This is how the badge auto-updates from "Refreshing…" to
"Last synced just now" without a hard reload — `revalidatePath` from
inside `after()` doesn't push to open tabs in Next 15.

## Forward-compat (v2)

Per `STRATEGIC_VISION.md`, v2 collapses the HubSpot ↔ NetSuite product
sync and pushes Nexus → NetSuite directly. If/when that lands, the deal
cache may be retired (NetSuite becomes the source of truth) or repurposed
(local mirror of NetSuite Sales Order data). The schema is intentionally
fluid; no inbound FKs to make removal safe.
