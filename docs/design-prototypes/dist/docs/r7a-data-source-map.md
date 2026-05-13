# Round 7a — Data-source map (Navigation IA)

R7a is structural design — the rules govern how surfaces relate, not what data they show. This map captures the new IA-layer reads/writes added by the round.

## Home surface

### Resume card (new in R7a)

| Field | Source | Notes |
|---|---|---|
| `last_surface` | `user_surface_visits.surface_key` (new table, RI.9 commitment) | Most recent visit per user. |
| `last_project_id` | `user_surface_visits.project_id` | Joined to `projects` for display name. |
| `last_scenario_label` | JOIN `quotes` ON `user_surface_visits.quote_id = quotes.id`, read `quotes.scenario_label` | Scenarios are denormalized onto `quotes` per current schema (`quotes.scenario_label`, `quotes.scenario_status`). Slice 14 will normalize scenarios into their own table and may re-key `user_surface_visits` to `(scenario_id)` per `schema.ts:1158` todo. v1 quote-grain identity is sufficient. |
| `last_visit_at` | `user_surface_visits.visited_at` | Drives "12m ago" copy. |
| `last_change` | `audit_log` filtered to `(scenario_id, *)` ordered by `created_at DESC LIMIT 1` | The string we render is the same `summary` the Audit log surface (R5) renders. |
| Margin pip + status | `quotes.blended_margin_pct` + firm policy bands | Reuses R5 firm settings (target / floor). |
| Resume CTA href | derived: `surface_href` per the surface-routes table | See below. |

### "What's my move" inbox (Round 4 surface; R7a wires next-move jump)

| Field | Source | Notes |
|---|---|---|
| Urgency tier | derived from quote_warnings + age | (Slice 9.5) |
| Project / scenario | `projects` + `scenarios` joined to the warning | |
| Detail string | `quote_warnings.detail` | |
| **Next move + href** | derived via the surface-routes table per warning kind | New in R7a — see below |

## Surface-routes table (new, R7a-defined)

This is the canonical map from warning-kind / surface-state to surface URL. RI.9 implements as a small lookup either in code or as a config table.

| Surface key | Route | Forward-from | Forward-to (next move) | Backward-to |
|---|---|---|---|---|
| `setup` | `/projects/:id/quotes/:qid` | — | `cost_build` | — |
| `cost_build` | `/projects/:id/quotes/:qid/cost-build` | `setup` | `costing` | — |
| `costing` | `/projects/:id/quotes/:qid/costing` | `cost_build` | `customer_view` | — |
| `customer_view` | `/projects/:id/quotes/:qid/customer-view` | `costing` | `mark_accepted` | `costing` |
| `mark_accepted` | `/projects/:id/quotes/:qid/mark-accepted` | `customer_view` | — (terminal) | `cost_build` (override flow) |

## Surface-render rules (new, R7a-defined)

Per-surface metadata that drives breadcrumb + rail visibility + action cluster:

| Surface | `rail.visible` | `breadcrumb.visible` | Action cluster primary | Action cluster secondary | Back-direction |
|---|---|---|---|---|---|
| Setup | true | false | Save draft | + New scenario | — |
| Cost build | true | false | Save draft | View as customer · + New version | — |
| Costing | true | false | Mark Accepted *(gated)* | Customer accepted (manual) · Preview | — |
| Customer view | **false** | **true** | Send to customer | ↓ Download PDF · Edit notes | — |
| Mark-Accepted | true | false | Confirm acceptance *(gated)* | Request admin override | ← Resume Cost build |

The breadcrumb-when-rail-shed rule is **load-bearing** — RI.9 implementation should encode this as a single function (`shouldShowBreadcrumb(surface) = !shouldShowRail(surface)`) rather than independent per-surface decisions.

## New schema: `user_surface_visits`

Minimal table for the Resume card. RI.9 commitment.

```sql
create table user_surface_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  scenario_id uuid references scenarios(id),     -- nullable for project-level surfaces
  quote_id uuid references quotes(id),
  surface_key text not null,                      -- 'setup' | 'cost_build' | etc.
  visited_at timestamptz not null default now()
);

create index on user_surface_visits (user_id, visited_at desc);
```

Write path: every quote-scoped page-load on the server side. Read path: Home Resume card reads `SELECT … ORDER BY visited_at DESC LIMIT 1 WHERE user_id = me`.

Trim policy: keep last 50 entries per user (cron job, weekly). The Resume card only needs the latest; older entries are useful if we ever expose "recent activity" — not required for v1.

## Existing schema referenced

| Source | Used for |
|---|---|
| `projects.client_name`, `projects.deal_name` | Resume card label, breadcrumb display |
| `scenarios.label` | Resume card scenario name |
| `scenarios.status` | Inner rail dropped/active styling (R4 carry-forward) |
| `quotes.version_number`, `quotes.status` | Inner rail version label |
| `quotes.blended_margin_pct` | Margin pip on Resume card |
| `firm_settings.target_margin_pct`, `.floor_margin_pct` | Margin band classification |
| `audit_log.summary` | Last-change line on Resume card |

## Nothing wishful in R7a

Everything here either references existing schema (R5 firm settings, R4 scenarios + inner rail data, audit log) or commits one new small table (`user_surface_visits`). The IA rules are structural — they don't add data, they govern how existing data is presented.
