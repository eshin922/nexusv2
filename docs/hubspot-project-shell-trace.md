# HubSpot → Nexus project shells — architectural trace

**Status:** trace only. Nothing implemented. Returned for disposition before any
work, per direction 2026-08-22.

**Question:** should relevant active HubSpot deals exist in Nexus automatically
as lightweight project shells, removing the routine *Import from HubSpot* step?

**Headline:** the proposed model is *smaller* than it sounds. Import is already
idempotent by HubSpot deal id, the project row is already little more than a
projection of cached HubSpot data, and **nothing in the codebase treats
"a project exists" as meaning somebody chose to import it.** The real work is
not materialisation — it is the lifecycle handling that does not exist today.

---

## 1 · Existing cache / sync architecture

`hubspot_deals_cache` — 27 columns keyed on `deal_id`, with `last_synced_at`.
Carries far more than the project row consumes: amounts, close dates, PM and
sales-rep identity, company, folder URL, service/category, sourcing location,
business segment, client PO, date estimates, priority, deal type.

Two write paths, **both manual, both button-driven. There is no cron.**

| path | scope | trigger |
|---|---|---|
| `refreshDealsCache()` | whole active pipeline | the Import page's refresh header |
| `syncDealById(dealId)` | one deal, upsert | called inside `importDeal` |

Freshness is advisory: `CACHE_STALENESS_MINUTES = 15`, surfaced by `isStale()`.
Nothing acts on it automatically.

"Relevant" is already defined in code — `ACTIVE_STAGE_IDS` in `hubspot.ts`:

    195274338  New (Acquiring Info)
    195274339  Development & Quoting
    195274340  Formal Quoting
    195274342  Project Setup

The cache-population search filters on exactly this set.

## 2 · What the manual Import actually creates

`importDeal` (`actions/projects.ts:62`) writes ONE `projects` row and one audit
row. No quote, no scenario, no cost, no spec, no tier.

The row is a **projection of cache fields** plus a few Nexus-owned ones:

| from cache | Nexus-owned |
|---|---|
| `hubspot_deal_id` | `project_category` — hardcoded `"packaging"` |
| `hubspot_owner_id` | `pm_user_id` — `null` |
| `deal_name` | `status` — `"active"` |
| `client_name` (company name) | `imported_by_user_id` |
| `deal_stage` | `last_hubspot_refresh_at` |
| `sales_rep_user_id` (resolved from cached owner email) | |

**It is already idempotent.** Find-or-create on `hubspot_deal_id`, redirecting
to the existing project when present, backed by
`uniqueIndex("projects_hubspot_deal_id_idx")`.

So the Import button's entire contribution beyond the cache is: *project the
cache row into `projects`, default three Nexus fields, and record who clicked.*

## 3 · Are active-pipeline deals already cached?

**Yes.** 76 cached rows, **73 at active stages** (the 3 others arrived via
`syncDealById` at import time, outside the active-stage search). Cache last
synced 2026-08-22 17:43.

**56 cached deals have no `projects` row.** Those are the deals the Organizer
does not show — 43 at Development & Quoting, 10 at Formal Quoting, 3 at New.

The data is already local. The gap is materialisation, not retrieval.

## 4 · How stage / owner / company changes propagate today

`refreshFromHubspot(projectId)` — a per-project button. Re-syncs that one deal,
then sets `deal_name`, `client_name`, `deal_stage`, `hubspot_owner_id`,
`sales_rep_user_id`, and audits `refreshed` with a field-level diff.

**That is the only propagation path to a project row.** A project's `deal_stage`
is a snapshot that drifts from HubSpot until a human presses the button. Nothing
reconciles it on a schedule, on page load, or on cache refresh.

## 5 · Can shell materialisation be idempotent by deal id?

**Yes — it already is.** The unique index plus find-or-create means
materialisation is an upsert on `hubspot_deal_id`. Running a sync repeatedly is
safe by construction, not by care.

## 6 · When a deal leaves the active pipeline

**No handling exists. Proven in production:**

`MISTR - Sachet Rollstock Test Roll` sits at stage `195274343` (Delivered),
which is **not** in `ACTIVE_STAGE_IDS`, and remains an ordinary project. The
cache-population search excludes it, so its `deal_stage` is frozen at whatever
the last per-project refresh saw.

Today this is nearly harmless: 21 projects, all hand-picked. Under
auto-materialisation it becomes the central question, because the estate grows
to ~77 and pipeline churn becomes continuous.

## 7 · When a deal is closed or deleted

**No handling exists.** Zero code for closed-won, closed-lost, or deleted deals.
`importDeal`'s own comment states the posture: *"closed deals coexist"*.

A deal deleted in HubSpot leaves an orphan project whose refresh throws
`Deal {id} not found in HubSpot` — a thrown error, not a handled state.

## 8 · Does any workflow rely on "somebody imported this"?

**No.** `imported_by_user_id` has exactly two references in the entire tree:

- written in `importDeal`
- `leftJoin`ed on the project detail page **to display a name**

No gate, no filter, no branch, no permission check. Project-existence carries no
intent semantics anywhere in Nexus.

**This is the finding that makes the proposal cheap.** The manual step is not
load-bearing; it is a data-entry ritual.

---

## Additional finding — `projects.status` is written but never read

`archiveProject` sets `status = 'archived'` and audits it. **Nothing filters on
it** — not the Organizer, not the rails, not search. Archiving a project today
hides it from nothing.

That is a latent gap now and a blocker under the shell model: without a
status filter, a shell for a deal that has left the pipeline can never leave the
Organizer.

---

## The delta

**What already exists:** idempotent materialisation, the cached data, a
propagation action, a projection shape, and no dependency on the manual click.

**What must be built:**

1. **A sync that materialises shells.** Mechanically the existing upsert, driven
   by the active-stage set rather than a click. The smallest honest version runs
   on the same manual refresh that already populates the cache — an automatic
   *schedule* is a separate decision from automatic *materialisation*, and
   conflating them makes this bigger than it is.

2. **Exit behaviour — the real new work.** What happens to a shell when its deal
   leaves `ACTIVE_STAGE_IDS`, closes, or is deleted. This has never been
   answered because it has never mattered. It must be answered before shells
   exist, and it must distinguish:
   - a shell with **no Nexus work** — safe to archive or drop;
   - a shell with **governed Nexus state** — a quote, pricing, an approval — which
     must never disappear because a CRM record moved. Nexus is authoritative for
     that state; HubSpot is not.

3. **Make `projects.status` load-bearing.** The Organizer must filter on it, or
   nothing can ever leave the surface.

4. **Distinguish shell from started work in the surface.** The loader already
   carries `hasAnyQuotes` and renders "No quote yet" — the distinction exists;
   the grouping does not yet use it.

## Migration implications

- **21 → 77 project rows in one step.** All 56 land at once, and every one is a
  shell with no quote. The Organizer's "No action required" band absorbs all of
  them, which is a real UX consequence: the surface built to stop test records
  dominating a production list would then be dominated by empty shells instead.
  A shell-aware band, or a default filter, has to land in the same change.
- **No backfill needed for the existing 21.** They already have exactly the
  shape a materialised shell would have.
- **`imported_by_user_id` becomes NULL** for synced shells. One display site
  must handle it — and the column's meaning narrows honestly from "who created
  this" to "who imported this by hand, if anyone".
- **Audit.** `created` on `entity_type = 'project'` currently implies a person.
  Materialised shells should keep the same action — it is a transition, not a
  mechanism — and carry `diff_json.source = 'hubspot_sync'` per the Slice 9.2
  source-namespace convention.
- **`project_category` is hardcoded `"packaging"` at import**, while the cache
  already holds `project_category` and `project_service_s` from HubSpot.
  Materialising 56 shells would stamp `packaging` on all of them without anyone
  choosing it. Worth resolving in the same change, since the manual flow's
  shrug is defensible at 21 and not at 77.
- **Stage drift gets worse before it gets better.** Propagation is manual
  per-project today; 77 shells with hand-pressed refresh is not viable, so
  materialisation realistically forces stage propagation to become part of the
  same sync.

## Open questions for disposition

1. Is "relevant" exactly `ACTIVE_STAGE_IDS`, or does the shell model want a
   different set? (`Delivered` is excluded today, yet one live project sits
   there.)
2. Automatic *materialisation* and automatic *scheduling* are separable. Is the
   target "shells appear when the cache refreshes" or "shells appear without
   anyone doing anything"? The second needs a scheduler Nexus does not have.
3. What is the disposition for a shell whose deal leaves the pipeline **with**
   governed Nexus state on it?
4. Should a shell with no quote be visible in the Organizer by default, or
   behind a filter?
