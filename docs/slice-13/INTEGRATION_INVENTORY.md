# Slice 13 integration inventory

## Status and evidence rules

`Verified in repository` means executable code or configuration is present.
`Requires manual discovery` means the external system's active configuration
cannot be established from this repository. Owner names are not inferred.

## HubSpot

| Name | Owner | Trigger | Direction / systems | Business purpose | Status | Replacement / retirement | Cutover impact |
|---|---|---|---|---|---|---|---|
| Deal import and refresh | Requires manual discovery | User action | HubSpot → Nexus | Create/refresh projects and cached deal context | Verified in `src/app/actions/projects.ts`, `src/app/import/`, `src/lib/hubspot-pull.ts` | Retain until an approved replacement exists | Source freshness and field lineage |
| Deal-stage update | Requires manual discovery | Quote acceptance/reversal | Nexus → HubSpot | Reflect accepted lifecycle state and restore prior stage | Verified in `src/app/actions/quotes.ts` and `src/lib/hubspot.ts` | Cutover decision required; do not retire implicitly | Duplicate/missing stage writes |
| Deal amount update | Requires manual discovery | Successful quote completion | Nexus → HubSpot | Reflect selected-tier transaction amount | Verified; best-effort after completion in `src/lib/netsuite/mark-complete.ts` | Cutover decision required | Reporting may diverge if update fails |
| Product search/import mapping | Requires manual discovery | User search/pull | HubSpot → Nexus | Populate quote product/SKU context | Verified in `src/lib/hubspot.ts`, `hubspot-mapper.ts`, and quote actions | Product-master roadmap decision required | Item lineage and catalog pricing |
| Owner/company lookup | Requires manual discovery | Import, identity, and SO preparation | HubSpot → Nexus | Attribution and customer mapping context | Verified in HubSpot client/cache modules | Retain until source changes | User/customer resolution |
| Private apps/tokens | Requires manual discovery | API calls | Nexus ↔ HubSpot | Authenticate read, write, and development operations | Token variables are evidenced; external app definitions/scopes are not | Inventory scopes and rotation before cutover | Credential and least-privilege gate |
| HubSpot workflows | Requires manual discovery | External configuration | HubSpot → production NetSuite and/or HubSpot | Legacy authoritative transaction processing | Referenced by project docs; active definitions are not in repo | Retirement only after shadow/UAT/cutover approval | Authoritative writer and duplicate risk |
| Custom Code Actions | Requires manual discovery | External workflow | Unknown | Unknown | No versioned definition found | Determine dependencies before retirement | Potential hidden transformation |
| Webhooks | Requires manual discovery | External event | HubSpot → Nexus | Proposed two-way sync | No implemented endpoint/subscription found; backlog documents future work | Not part of current cutover unless separately approved | Do not assume inbound freshness |

## NetSuite

| Name | Owner | Trigger | Direction / systems | Business purpose | Status | Replacement / retirement | Cutover impact |
|---|---|---|---|---|---|---|---|
| REST/SuiteQL client | Requires manual discovery | Nexus integration calls | Nexus → NetSuite | Read mappings/items and create Sales Orders/Item Groups | Verified under `src/lib/netsuite/` | Retain; production credentials activated only at approved cutover | Permissions, account environment, rate limits |
| Sales Order completion pipeline | Requires manual discovery | Accepted-tier completion action | Nexus → NetSuite | Create idempotent SO and freeze quote | Verified | Candidate replacement for legacy SO creation after parity | Primary cutover writer |
| Customer map | Requires manual discovery | Preflight/completion | Nexus DB → NetSuite reference | Deterministic HubSpot company-to-customer linkage | Verified in schema, resolver, admin actions | Maintain as governed master data | Missing/wrong mapping blocks or misroutes |
| Leaf-item resolution | Requires manual discovery | Completion | Nexus ↔ NetSuite | Resolve sellable SO lines by SKU | Verified and active | Retain with parity evidence | Price and item correctness |
| Item Group find/create primitive | Requires manual discovery | Operator smoke; not invoked by completion | Nexus ↔ NetSuite | Create/cache composition-addressed groups | Verified code and smoke path; completion explicitly bypasses it after recorded API failure | Completed Item Groups are the approved future visible change, but require an implementation decision | Invoice presentation, pricing, and cutover blocker |
| Segment/source resolvers | Requires manual discovery | Completion | HubSpot cache/Nexus → NetSuite | Translate classifications to NetSuite IDs | Verified | Retain with parity evidence | Configuration drift blocks writes |
| User Event Scripts | Requires manual discovery | NetSuite record events | NetSuite internal/external | Unknown | No SuiteScript source found | Inventory before cutover | May mutate Nexus-created SOs |
| Scheduled Scripts | Requires manual discovery | NetSuite schedule | NetSuite internal/external | Unknown | No SuiteScript source found | Inventory before cutover | Hidden delayed mutations |
| NetSuite workflows | Requires manual discovery | NetSuite workflow triggers | NetSuite internal/external | Legacy/defaulting/approval behavior unknown | Referenced indirectly by parity comments; definitions absent | Compare production/sandbox before cutover | Field defaults and downstream behavior |

## Infrastructure and external services

| Name | Owner | Trigger | Direction / systems | Business purpose | Status | Replacement / retirement | Cutover impact |
|---|---|---|---|---|---|---|---|
| PostgreSQL/Drizzle | Requires manual discovery | Application and CLI | Nexus ↔ database | Operational persistence, audit, mapping, idempotency | Verified in `src/db/`, `drizzle/`, package scripts | Retain | Migration, backup, connection safety |
| Supabase Storage/Realtime | Requires manual discovery | App artifact/realtime operations | Nexus ↔ Supabase | Production artifacts and live UI updates | Verified by dependencies/provider modules | Retain; isolated alternatives in validation | Artifact access and session consistency |
| Clerk | Requires manual discovery | User request/session | Clerk → Nexus | Authentication and identity | Verified by dependency/provider modules | Retain unless separately approved | Access and role readiness |
| Local validation providers | Validation harness maintainers | Validation execution | Nexus → local DB/files/JSONL | Deterministic fake auth, providers, artifacts, ledgers | Verified under `tests/harness/` | Never used as production integration | Merge safety only |
| Background jobs | Requires manual discovery | Unknown | Unknown | Unknown | No queue/worker framework found | Inventory deployment platform separately | Hidden processing risk |
| Scheduled tasks | Requires manual discovery | Operator/platform schedule | Unknown | Historical scripts exist, but no active scheduler is evidenced | Requires manual discovery | Identify and retire deliberately | Duplicate processing |
| GitHub Actions | Requires manual discovery | Repository events | GitHub → build/deploy services | CI/CD | No `.github` directory exists in this checkout | Inspect repository settings/external checks | Merge/deployment gate ownership |
| Deployment/hosting | Requires manual discovery | Deployment | Hosting platform ↔ Nexus | Serve application | Environment references exist; authoritative configuration absent | Document before go-live | Runtime variables, networking, rollback |

## Manual-discovery actions

1. Export HubSpot workflows, Custom Code Actions, private-app scopes, webhook
   subscriptions, owners, and activation state.
2. Export NetSuite scripts, deployments, workflows, forms, roles, custom
   fields/segments, tax/terms, and production/sandbox differences.
3. Inventory repository settings, external CI checks, hosting, secrets
   ownership, schedules, alerts, and support escalation.
4. Obtain business owner approval before assigning replacement or retirement
   dates.
