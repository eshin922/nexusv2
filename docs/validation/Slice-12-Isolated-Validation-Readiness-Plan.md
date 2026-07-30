# Slice 12 Isolated Validation Readiness Plan

## Document Header

| Field | Value |
|---|---|
| Document | Slice 12 Isolated Validation Readiness Plan |
| Purpose | Define the smallest safe, repeatable capability needed to complete the Slice 12 adversarial browser release gate |
| Investigation date | 2026-07-29 |
| Repository | `eshin922/nexusv2` |
| Inspected branch | `feat/slice-12-step-10-walk-fixes` |
| Inspected commit | `5fbe2b14f2f1f0c291078baaa49ae2266936cec8` |
| Default branch observed | `main` at `8aa0ba306a1747aa31911011e84ee6e99aadb5e7` |
| Investigation mode | Repository-only, read-only |
| External systems accessed | None |
| Implementation performed | None |
| Authoritative recommendation | Option A, reduced to a validation-only local harness |

## Executive Summary

The minimum viable isolated Slice 12 harness is:

1. Nexus running locally through its normal Next.js development command;
2. a disposable local PostgreSQL database created per validation run;
3. a validation-only local user/auth seam that does not call Clerk;
4. a local PDF artifact adapter used by Send instead of Supabase Storage;
5. deterministic HubSpot and NetSuite adapters selected only by an explicit validation configuration;
6. an installed Playwright runner and one serial adversarial lifecycle suite;
7. a seed/reset command that creates a true draft quote and all required local mappings without contacting an external system;
8. a hard outbound-network deny so accidental real integrations fail before making a request.

This is a narrow Option A. It retains the real UI, server actions, database transactions, quote state machine, PDF rendering, audit writes, idempotency logic, and Sales Order persistence. Only the external boundaries and authentication are substituted.

Option B—pre-seeding states and bypassing external calls—can validate rendering, deep links, refresh, Back/Forward, and some freeze behavior. It cannot complete the release gate because Accept, Rollback, and Sales Order Complete are intentionally coupled to external-first operations. Skipping those calls inside the actions would test a validation-only state machine rather than the shipped orchestration.

Option C—an explicitly authorized sandbox walkthrough—has the highest end-to-end integration fidelity but is not isolated, is less repeatable, requires cleanup and reconciliation across three external systems, and was not executed. It should remain a later integration-parity exercise, not the primary browser regression harness.

Estimated implementation size for the recommended harness is **medium**: approximately two to four focused engineering days plus one review/validation day, assuming migrations apply cleanly to a standard local PostgreSQL container. The estimate is dominated by safe auth and artifact-storage substitution, explicit integration dependency seams, deterministic seed data, and Playwright coverage—not by the database container itself.

## Current Blocker

Slice 12’s final browser gate cannot currently run without external access.

The repository’s Step 10 provisioner:

- connects to `DATABASE_URL`;
- requires a HubSpot write token;
- creates a HubSpot deal;
- seeds remote Nexus data around that external deal;
- expects Mark Accepted to update the HubSpot deal stage and amount;
- expects Sales Order completion to create a real NetSuite sandbox Sales Order;
- requires cleanup across the database, HubSpot, and NetSuite.

The local application has additional dependencies:

- every protected route goes through Clerk middleware;
- every lifecycle action calls `ensureUser()`, which calls Clerk and may call HubSpot during first-user provisioning;
- every page and action reads or writes PostgreSQL through the globally initialized Drizzle client;
- Send renders a real PDF and uploads it to Supabase Storage before its database transaction;
- browser-side Supabase Realtime may attempt external subscriptions on applicable surfaces;
- no installed browser automation package, config, or E2E suite exists.

Therefore “start Nexus locally and run the fixture” is not an isolated operation.

## Repository Evidence

### Normal local startup

The normal development command is:

```text
npm run dev
```

It executes:

```text
cross-env NODE_OPTIONS=--max-old-space-size=8192 next dev
```

The production-style local path is:

```text
npm run build
npm run start
```

Repository convention warns not to run `npm run build` while `npm run dev` is live because both write incompatible artifacts into `.next/`.

Evidence:

- `package.json`
- `CLAUDE.md`, “Never npm run build while npm run dev is live”

### Required environment variables and services

#### Required for normal application boot/use

| Area | Variables | Current use |
|---|---|---|
| PostgreSQL | `DATABASE_URL`; development prefers `DIRECT_URL` when present | All route data and lifecycle persistence |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Middleware session, current user, protected routes |
| Authorization configuration | `ALLOWED_EMAILS`, `ADMIN_EMAILS` | Middleware allowlist and initial Nexus role |
| Supabase Storage/Realtime | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Browser Realtime; PDF and attachment storage |
| Application URL | `NEXT_PUBLIC_APP_URL`; optionally `NEXT_PUBLIC_DEPLOYED_URL` | Local URL/deep-link behavior |

#### Required by lifecycle integrations

| Area | Variables | Trigger |
|---|---|---|
| HubSpot read | `HUBSPOT_ACCESS_TOKEN` | Owner fallback, stage reads, pipeline label reads |
| HubSpot write | `HUBSPOT_WRITE_ACCESS_TOKEN` | Accept, rollback, post-completion amount patch |
| HubSpot IDs/config | `HUBSPOT_PROD_HUB_ID`, `HUBSPOT_DEV_HUB_ID`, `HUBSPOT_DEV_ACCESS_TOKEN`, optional `HUBSPOT_PM_PROPERTY` | Wider integration/cache behavior |
| NetSuite | `NETSUITE_ACCOUNT_ID`, `NETSUITE_CONSUMER_KEY`, `NETSUITE_CONSUMER_SECRET`, `NETSUITE_TOKEN_ID`, `NETSUITE_TOKEN_SECRET`, `NETSUITE_ENV` | Item lookup/group creation/Sales Order submission and readback |

Evidence:

- `.env.example`
- `src/db/index.ts`
- `src/middleware.ts`
- `src/lib/auth/ensure-user.ts`
- `src/lib/supabase-browser.ts`
- `src/lib/supabase-server.ts`
- `src/lib/hubspot.ts`
- `src/lib/netsuite/client.ts`

### Database portability

The application uses PostgreSQL through `postgres-js` and Drizzle. The generated migrations are PostgreSQL SQL and use features available in a standard modern PostgreSQL image, including:

- UUID columns with `gen_random_uuid()`;
- sequences;
- JSONB;
- partial/unique indexes;
- foreign keys;
- transactions;
- `pg_trgm` from migration `0019`.

A disposable local PostgreSQL database is feasible. Docker is available in the inspected workstation; the Supabase CLI and standalone `psql` were not found. Drizzle migration tooling is already installed through project dependencies.

Important caveats:

- manual migrations that alter `supabase_realtime` publications are Supabase-specific and should not run against plain local PostgreSQL;
- manual migration `0034_canonical_scenario_create_storage.sql` references Supabase `storage` and `auth` schemas and should not run against plain local PostgreSQL;
- the main Drizzle migration journal must be reconciled and tested from empty database to current state;
- `pg_trgm` must be available in the selected PostgreSQL image;
- local test data must include the active `firm_settings` row, user, project, HubSpot cache projection, customer mapping, quote, scenario, assemblies/leaves, tier, pricing/cost inputs, and any prerequisite audit/review rows.

Evidence:

- `drizzle.config.ts`
- `src/db/index.ts`
- `drizzle/*.sql`
- `drizzle/0019_ri_1_workspace_scenarios_audit_bulkraw.sql`
- `drizzle/manual/*realtime*.sql`
- `drizzle/manual/0034_canonical_scenario_create_storage.sql`

### Browser automation availability

Browser automation does not currently exist as an executable project capability.

`package-lock.json` mentions `@playwright/test` only as an optional peer dependency of Next.js. It is not declared in `package.json`, is not installed in `node_modules`, and no Playwright configuration or browser spec was found. Puppeteer and Cypress were also not installed.

Evidence:

- `package-lock.json:3559-3573`
- `package.json`
- absence of `playwright.config.*` and browser/E2E specs

### Existing non-external test seams

Some useful building blocks exist:

- `scripts/test-netsuite-adapter.ts` tests pure NetSuite payload/error primitives without database or network;
- NetSuite client functions accept optional `NetsuiteConfig` values;
- `_resetNetsuiteConfigForTests()` resets cached NetSuite configuration;
- NetSuite request classification and payload construction are separable pure logic;
- `computeIdempotencyKey()` is pure;
- dev-only Quote Umbrella state simulation can visually simulate complete/record states, but comments explicitly state it is cosmetic and does not exercise writes or lifecycle gating.

These are useful but insufficient for browser lifecycle validation. The full orchestrator imports concrete external functions directly, and HubSpot functions use module-level concrete SDK clients.

Evidence:

- `scripts/test-netsuite-adapter.ts`
- `src/lib/netsuite/client.ts`
- `src/lib/netsuite/sales-orders.ts`
- `src/lib/netsuite/mark-complete.ts`
- `src/components/quote-umbrella/quote-umbrella.tsx`

### Existing fixture convertibility

`scripts/provision-cb-step10-fixture.ts` is structurally useful because it already knows how to create:

- a project;
- a quote and tier;
- assembly/leaf costing input;
- review-feed state;
- HubSpot cache projection;
- customer-map prerequisites;
- calculated above-floor pricing;
- a handoff payload with IDs and deep link.

It is not safely reusable unchanged because it:

- requires the remote database and HubSpot write token;
- creates a real HubSpot deal;
- uses fixed real external company/customer/item identifiers;
- starts the quote in `sent`, skipping a true first Send;
- expects real NetSuite item resolution and order creation;
- requires cross-system cleanup.

The smallest conversion is to extract its **local row-building portion** into a deterministic seed module and replace its real external identifiers with validation-only identifiers understood by fake adapters. It should create two independent scenarios:

1. a true `draft` quote for Preview and first Send;
2. a `sent` quote for revision/rollback attack setup, if reducing suite time is useful.

The primary serial test should still drive one quote through the entire lifecycle.

Evidence:

- `scripts/provision-cb-step10-fixture.ts`
- `scripts/cleanup-cb-step10-fixture.mjs`

## Integration Boundary Map

### End-to-end boundary diagram

```text
Browser
  │
  ├─ Clerk middleware ──> Clerk API
  │
  └─ Next route / Quote Umbrella
       │
       ├─ ensureUser()
       │    ├─ PostgreSQL users/projects
       │    ├─ Clerk auth/currentUser
       │    └─ HubSpot owner lookup on first-user creation
       │
       ├─ Preview / Client Review
       │    └─ PostgreSQL reads
       │
       ├─ Send
       │    ├─ PostgreSQL reads
       │    ├─ optional HubSpot owner lookup
       │    ├─ React-PDF render
       │    ├─ Supabase Storage upload + signed URL
       │    └─ PostgreSQL transaction:
       │         quote, snapshot, audit, review event
       │
       ├─ Accept
       │    ├─ PostgreSQL reads + durable pending-stage write
       │    ├─ HubSpot stage read
       │    ├─ HubSpot stage + amount update
       │    └─ PostgreSQL transaction:
       │         accepted status, tier/channel, audit, review events
       │
       ├─ Rollback / accepted revision
       │    ├─ PostgreSQL audit/project reads
       │    ├─ HubSpot stage rollback
       │    └─ PostgreSQL transaction:
       │         sent status, acceptance core fields, audit, review event
       │
       ├─ Sent revision
       │    └─ PostgreSQL transaction:
       │         draft status, version increment, superseded snapshot, audit
       │
       └─ Sales Order Complete
            ├─ PostgreSQL reads: quote, tier, project, cache, settings,
            │                   customer map, costing/tree, prior pushes
            ├─ NetSuite reads: item, business segment/project-source lookup
            ├─ NetSuite read/create: item groups
            ├─ PostgreSQL pending-push write
            ├─ NetSuite Sales Order POST
            ├─ NetSuite Sales Order GET for tranId
            ├─ PostgreSQL success/failure ledger and quote mirrors
            ├─ PostgreSQL freeze transaction + audit
            └─ optional HubSpot amount correction
```

### Lifecycle boundary table

| Path | Database writes | HubSpot | NetSuite | Supabase Storage | Safe without substitutes? |
|---|---|---|---|---|---|
| Preview | Visit/presence writes may occur outside core quote action; quote content is read | Page may resolve display labels depending route data | Preflight is skipped unless accepted/complete | Customer PDF rendering reads no storage for fresh draft | No, because DB and auth are remote-coupled |
| Send | Quote status/snapshots, quote number, audit, review event | Owner lookup only if local `salesRepUserId` cannot resolve prepared-by | None | Upload PDF and create signed URL | No |
| Client Review | Review-event additions mutate DB; ordinary viewing reads | None for basic view | None | Historical PDF re-sign can call Storage | No |
| Accept | Durable pending stage, accepted status/tier/channel, audit/review rows | Stage read; stage + amount write | None | None | No |
| Rollback | Sent status and audit/review rows | Stage rollback | None | None | No |
| Revise from sent | Draft status, version, snapshot supersede, audit | None | None | Prior artifact remains referenced | No, DB/auth required |
| Revise from accepted | Runs rollback first, then sent → draft revision | Stage rollback | None | Prior artifact remains referenced | No |
| SO Pending | Inserts `netsuite_so_pushes` pending row; failure mirrors may write | None before completion patch | Multiple reads/creates and SO POST begin | None | No |
| SO Complete | Push ledger, quote mirrors, frozen accepted tier/status, audit | Best-effort amount patch after completion | SO POST and tranId GET; item/group resolution | None | No |

### Exact external call paths

#### HubSpot

| Operation | Call site |
|---|---|
| Resolve sales owner during Send fallback | `sendQuote()` → `findHubspotOwnerById()` |
| Resolve/create Nexus user owner association on first sign-in | `ensureUser()` → `findHubspotOwnerByEmail()` |
| Read current deal stage | `markAccepted()` → `getDealStage()` |
| Read pipeline stages/labels | `getDealStage()` / page label resolution → `loadPipelineStages*()` |
| Write accepted stage and amount | `markAccepted()` → `updateDealStage(..., { amount })` |
| Roll back deal stage | `unmarkAccepted()` → `updateDealStage()` |
| Correct amount after SO completion | `runMarkComplete()` → `runAmountPatchIfNeeded()` → HubSpot write client |

Evidence:

- `src/lib/auth/ensure-user.ts`
- `src/app/actions/quotes.ts:1290-1771`
- `src/app/actions/quotes.ts:2019-2427`
- `src/app/actions/quotes.ts:2447-2595`
- `src/lib/hubspot.ts:86-255`
- `src/lib/netsuite/mark-complete.ts:760-863`

#### NetSuite

| Operation | Call path |
|---|---|
| Resolve leaf SKU | `runMarkComplete()` → `resolveNetsuiteItem()` → SuiteQL |
| Resolve business segment | `resolveBusinessSegmentLabel()`; may fall back to HubSpot and update cache |
| Resolve project source | `resolveProjectSourceIdByLabel()` → NetSuite lookup |
| Find/reuse/create Item Group | `findOrCreateItemGroup()` → local cache, SuiteQL, record create |
| Create Sales Order | `createSalesOrder()` → NetSuite REST record create |
| Read transaction number | `fetchSalesOrderTranid()` → NetSuite Sales Order GET |

Evidence:

- `src/lib/netsuite/mark-complete.ts`
- `src/lib/netsuite/item-resolver.ts`
- `src/lib/netsuite/business-segment-resolver.ts`
- `src/lib/netsuite/project-source-resolver.ts`
- `src/lib/netsuite/item-groups.ts`
- `src/lib/netsuite/sales-orders.ts`
- `src/lib/netsuite/client.ts`

### Database write map

All lifecycle mutations use the configured PostgreSQL database:

| Lifecycle action | Principal tables written |
|---|---|
| Send | `quotes`, `quote_snapshots`, `audit_log`, `quote_review_events`; sequence `quote_number_seq` |
| Add review event | `quote_review_events`, `audit_log` |
| Revise | `quotes`, `quote_snapshots`, `audit_log`, `quote_review_events` |
| Accept | pre-write to `quotes`; transaction writes `quotes`, `audit_log`, `quote_review_events` |
| Rollback | `quotes`, `audit_log`, `quote_review_events` |
| SO attempt | `netsuite_so_pushes`; on error, quote push-status mirrors |
| SO success/freeze | `netsuite_so_pushes`, `quotes`, `audit_log`; potentially `netsuite_item_groups` and cache backfills |

No lifecycle action is safe to invoke while `DATABASE_URL` or `DIRECT_URL` points at the remote database.

## Options Analysis

## Option A — Local Nexus + Mocked Integrations

### Shape

- Local Next.js application server
- Disposable local PostgreSQL
- Validation-only local auth identity
- Local artifact store for quote PDFs
- Fake HubSpot adapter
- Fake NetSuite adapter
- Supabase Realtime disabled or redirected locally
- Playwright browser suite
- Outbound-network deny

### Setup effort

**Medium.** Estimated two to four focused engineering days plus review/validation.

### Code changes

Required, but narrow:

1. Introduce explicit auth identity seam for `middleware` and `ensureUser`.
2. Introduce a quote-PDF storage interface with real Supabase and local validation implementations.
3. Introduce HubSpot lifecycle interface for owner lookup, stage read, stage/amount update, and label resolution.
4. Introduce NetSuite orchestration dependencies for item resolution, source/segment resolution, item-group handling, Sales Order creation, and `tranId` lookup.
5. Select fakes only under a fail-closed validation mode.
6. Disable browser Realtime in validation mode or provide a local substitute.
7. Add local database bootstrap/seed/reset scripts.
8. Add Playwright configuration and tests.

The real production implementations remain defaults. The fake implementations should not be reachable from production builds.

### Data-safety risk

**Low if guardrails are mandatory; high if selection is an informal environment convention.**

Required guardrails:

- validation startup refuses non-loopback DB hosts;
- real external credential variables must be absent;
- fake integration mode must be explicit;
- outbound HTTP is denied except loopback;
- a production/Vercel environment must refuse validation mode;
- seed/reset checks the database name/host before destructive cleanup;
- generated IDs are visibly validation-only.

### Fidelity

**High for Nexus behavior; medium for external-system parity.**

It exercises:

- real routes and components;
- real server actions;
- real Drizzle queries and transactions;
- real quote guards and freezes;
- real PDF rendering;
- real snapshots/audit/review-event writes;
- real payload construction and idempotency;
- real pending/succeeded/failed state persistence;
- browser navigation, refresh, multi-tab, duplicate actions, console, and network behavior.

It does not prove:

- actual HubSpot API semantics/scopes;
- actual NetSuite validation and accounting configuration;
- actual Supabase Storage/RLS behavior;
- production deployment configuration.

### Repeatability

**High.** A fresh database and deterministic fake responses can reproduce success, retry, timeout, malformed-response, and partial-failure cases.

### Cleanup requirements

- Stop local Next server and mock services.
- Drop the disposable database/container volume.
- Delete local PDF artifact directory.
- Delete Playwright traces/screenshots for a clean rerun when desired.

No cross-system reconciliation is required.

### Limitations

- Requires small production-code seams unless orchestration is duplicated, which should be avoided.
- Plain local PostgreSQL does not exercise Supabase Realtime or Storage.
- A process-local fake can be inconsistent across workers; deterministic adapters should use one server-side instance or a small loopback mock service.
- External API contract tests remain separate.

### Recommendation

**Recommended.** This is the smallest approach capable of completing the actual browser release gate safely and repeatedly.

## Option B — Local Nexus + Seeded Database Only

### Shape

- Local Next.js server and local PostgreSQL
- Pre-seeded rows for draft, sent, accepted, pending, failed, and complete states
- External calls bypassed
- Browser validates rendering and navigation around each state

### Setup effort

**Small to medium.** Approximately one to two engineering days for database bootstrap, local auth, seeding, and browser tooling.

### Code changes

- Local auth seam remains required.
- Local PostgreSQL bootstrap remains required.
- Supabase Storage must still be bypassed for a true Send, or Send must be pre-seeded.
- Accept, Rollback, and Complete must either be pre-seeded or contain validation-only bypass branches.
- Browser automation must be added.

### Data-safety risk

**Low** with a loopback-only database guard.

### Fidelity

**Medium for UI-state rendering; low for lifecycle orchestration.**

It can validate:

- deep links;
- refresh;
- Back/Forward;
- tab reachability;
- complete receipt rendering;
- visual/copy states;
- read-only/freeze affordances;
- some invalid transitions against pre-seeded status.

It cannot honestly validate:

- Send’s render/upload/transaction ordering;
- Accept’s external-first then DB transaction behavior;
- Rollback’s stage recovery and external-first behavior;
- Sales Order pending → succeeded/failed persistence;
- idempotency around the real orchestration;
- post-completion amount patch handling.

### Repeatability

**High** for rendering fixtures.

### Cleanup requirements

- Reset/drop local database.
- Remove local screenshots/traces.

### Limitations

Pre-seeding the expected end state can validate that the UI renders the state, but not that the action reaches it correctly. Adding direct bypasses inside each server action risks creating a second, validation-only state machine.

### Recommendation

**Use as a companion visual-state matrix, not as the Slice 12 final lifecycle gate.** It is valuable for fast coverage of receipt, failed, pending, and complete variants after Option A exists.

## Option C — Explicitly Authorized Sandbox Walkthrough

### Shape

- Deployed or local Nexus connected to the remote database
- Real HubSpot sandbox deal
- Real NetSuite sandbox customer/items/order
- Real Supabase Storage
- Human or automated browser walk

### Setup effort

**Medium per run.** Provisioning is partly scripted, but authorization, valid external fixtures, deployment selection, observation, and cleanup are operationally significant.

### Code changes

Potentially none for the current happy path. Automation and safer reconciliation scripts would still be advisable.

### Data-safety risk

**Medium to high.**

Risks include:

- wrong token/hub selection;
- writes to shared remote Nexus data;
- real sandbox deal/order residue;
- duplicate Sales Orders;
- cleanup failure after partial execution;
- fixture collisions;
- mismatch between deployed commit and tested commit.

### Fidelity

**Highest for external integration parity.**

It is the only option that can prove the real HubSpot/NetSuite/Supabase boundary for the configured sandbox.

### Repeatability

**Low to medium.** It depends on external state, rate limits, credentials, item/customer configuration, deployment availability, and cleanup success.

### Cleanup requirements

At minimum:

1. record exact deployment SHA and environment;
2. record generated Nexus project/quote IDs;
3. record HubSpot deal ID and before/after stage;
4. record NetSuite Sales Order internal ID and `tranId`;
5. reconcile `netsuite_so_pushes`, quote mirrors, audit rows, and snapshots;
6. delete or archive the HubSpot fixture according to approved policy;
7. void/delete the NetSuite sandbox order according to approved policy;
8. remove remote fixture rows only through an explicitly approved cleanup;
9. verify no orphan PDF remains in Storage;
10. produce before/after reconciliation evidence.

### Limitations

- Not isolated
- Not safe for routine adversarial concurrency tests
- Failure injection is difficult
- Cleanup is multi-system and may be irreversible
- Cannot substitute for a deterministic regression suite

### Recommendation

**Do not execute for this task.** Use later as a separately authorized integration-parity checkpoint after Option A passes.

### Options comparison

| Dimension | Option A | Option B | Option C |
|---|---|---|---|
| Initial effort | Medium | Small–medium | Medium per run |
| Nexus lifecycle fidelity | High | Low–medium | High |
| External API fidelity | Medium through contract fakes | Low | High |
| Data-safety risk | Low with hard guards | Low | Medium–high |
| Repeatability | High | High | Low–medium |
| Failure injection | High | Medium, mostly visual | Low |
| Multi-tab/duplicate testing | Safe | Safe but shallow | Risky |
| Cleanup | Local only | Local only | Cross-system |
| Can complete browser release gate | **Yes** | No, companion only | Yes, but not safely/repeatably |
| Recommended role | Primary gate | Visual fixture supplement | Later parity verification |

## Recommended Approach

Implement **Option A as a narrow validation-only dependency boundary**, then use Option B-style pre-seeded variants as additional browser cases.

### Minimum viable isolated validation harness

```text
Playwright
  │
  ├─ starts local Postgres container
  ├─ applies canonical Drizzle migrations
  ├─ seeds one validation PM + draft quote
  ├─ starts Nexus with VALIDATION_MODE=isolated
  └─ drives the browser
       │
       ├─ local auth identity
       ├─ local PDF artifact adapter
       ├─ fake HubSpot lifecycle adapter
       ├─ fake NetSuite lifecycle adapter
       └─ real Nexus database/actions/UI/state machine
```

### Why this is the minimum

- A database is unavoidable because page loaders, actions, guards, snapshots, audit, review feed, push ledger, and freeze state all depend on PostgreSQL.
- Auth substitution is unavoidable because middleware and `ensureUser()` call Clerk.
- PDF storage substitution is unavoidable because Send uploads before its transaction.
- HubSpot substitution is unavoidable because Accept and Rollback intentionally fail closed when HubSpot fails.
- NetSuite substitution is unavoidable because Complete performs multiple reads/writes before freezing the quote.
- Browser tooling is unavoidable for console, network, Back/Forward, refresh, multi-tab, and screenshots.

### Adapter granularity

Use business-operation interfaces rather than mocking global `fetch`.

HubSpot minimum:

```text
findOwnerById
findOwnerByEmail
getDealStage
updateDealStageAndAmount
updateDealAmount
resolveStageLabel
```

NetSuite minimum:

```text
resolveItemBySku
resolveBusinessSegment
resolveProjectSource
findOrCreateItemGroup
createSalesOrder
fetchSalesOrderTranid
```

Artifact storage minimum:

```text
putQuotePdf
getQuotePdfUrl
```

Auth minimum:

```text
getRequestIdentity
requireRequestIdentity
```

The fake adapters must expose deterministic call logs and programmable outcomes, but the real actions must still perform all local pre-writes, transactions, audits, retry checks, and state guards.

### Fail-closed safety rules

Validation mode should start only when all are true:

- `VALIDATION_MODE=isolated`;
- database host is `localhost`, `127.0.0.1`, or a named local container;
- database name includes an unmistakable validation suffix;
- no HubSpot, NetSuite, Supabase service-role, or Clerk secret is loaded;
- application is not running under `VERCEL_ENV=production`;
- adapters report `kind: fake`;
- outbound HTTP is blocked except loopback.

If any condition fails, startup must stop before serving a page.

## Required Implementation Tasks

The following are proposed tasks only. No task was implemented during this investigation.

### Task 1 — Pin the validation target

**Complexity:** Small

- Decide whether validation targets PR #160 head or `main` after merge.
- Record exact commit SHA in every trace and report.
- Do not use a branch run as evidence for a different default-branch state.

### Task 2 — Add disposable PostgreSQL bootstrap

**Complexity:** Medium

- Define a local PostgreSQL container with `pg_trgm`.
- Create an isolated database/volume per run.
- Apply only canonical Drizzle migrations in journal order.
- Exclude Supabase publication/storage manual migrations.
- Add a readiness query and schema-version assertion.
- Add a loopback/database-name guard before reset/drop.

### Task 3 — Extract deterministic local fixture builder

**Complexity:** Medium

- Reuse the data-construction logic from `provision-cb-step10-fixture.ts`.
- Remove all external API calls and real external IDs.
- Seed:
  - validation user;
  - active firm settings;
  - project with numeric-looking fake HubSpot deal ID;
  - HubSpot deal cache and company projection;
  - NetSuite customer map;
  - scenario/quote;
  - at least one assembly and resolvable leaf;
  - at least one above-floor tier;
  - cost/pricing inputs;
  - deterministic fake external lookup keys.
- Start the primary quote at `draft`, not `sent`.
- Return IDs and canonical deep links as machine-readable output.

### Task 4 — Add validation-only auth seam

**Complexity:** Medium

- Keep Clerk as the default production provider.
- Under isolated validation mode only, accept a deterministic local identity.
- Ensure both middleware and `ensureUser()` use the same provider.
- Seed the corresponding `users` row so no first-sign-in HubSpot lookup occurs.
- Refuse validation auth in production/Vercel environments.

### Task 5 — Add local PDF artifact adapter

**Complexity:** Small–medium

- Preserve real React-PDF rendering.
- Write the generated buffer to a run-scoped local temporary directory.
- Return a loopback URL that the browser can open.
- Preserve unique per-send paths so snapshot/version tests remain meaningful.
- Provide cleanup through deletion of the run directory.

### Task 6 — Introduce HubSpot lifecycle adapter

**Complexity:** Medium

- Route Send owner fallback, Accept stage read/write, Rollback, and completion amount patch through one interface.
- Real implementation delegates to existing `src/lib/hubspot.ts`.
- Fake implementation maintains deterministic stage/amount state and call logs.
- Support programmable success, failure, timeout, and “external succeeded/local tx failed” recovery scenarios.

### Task 7 — Introduce NetSuite lifecycle dependencies

**Complexity:** Medium–large

- Keep payload builders, hash/idempotency code, push-ledger writes, and freeze transaction real.
- Substitute only external reads/creates.
- Return deterministic IDs such as validation-only internal ID and `SO-VALIDATION-0001`.
- Support:
  - item found/not found/ambiguous;
  - item-group cache hit/external hit/create;
  - SO timeout/failure/success;
  - successful POST with failed `tranId` fetch;
  - retry convergence.

### Task 8 — Disable or localize Supabase Realtime

**Complexity:** Small

- Prevent external browser websocket/HTTP attempts in isolated mode.
- Rely on page refresh/navigation for the Slice 12 lifecycle suite.
- Clearly mark real-time cross-PM parity as outside this harness unless a local Supabase stack is later added.

### Task 9 — Add Playwright

**Complexity:** Medium

- Add `@playwright/test` explicitly; the optional Next peer reference is insufficient.
- Pin browser version through the lockfile.
- Configure:
  - local web server;
  - serial lifecycle project;
  - trace on failure;
  - screenshots on each mandatory state;
  - video optional;
  - console error and React warning collection;
  - failed-request collection;
  - deterministic timeout budget.

### Task 10 — Implement the adversarial lifecycle suite

**Complexity:** Medium–large

One serial primary walk:

1. Preview draft
2. Send
3. Client Review
4. Revise from sent
5. Re-send
6. Accept
7. Roll back acceptance
8. Re-accept or revise-from-accepted as a separate reset case
9. Sales Order Pending
10. Sales Order Complete
11. Complete receipt deep link

Attacks at each applicable state:

- reload/hard reload;
- Back/Forward;
- direct tab URLs;
- two browser pages/contexts;
- rapid duplicate clicks;
- repeated server-action requests;
- stale-tab action after another tab advances;
- modal cancel/confirm;
- invalid transitions;
- fake external timeout/failure;
- retry/convergence;
- persisted audit and database invariant assertions.

### Task 11 — Add teardown and evidence packaging

**Complexity:** Small

- Capture traces, screenshots, console, failed requests, and database invariant output.
- Remove local PDF artifacts.
- Drop disposable database/volume.
- Confirm no non-loopback network request occurred.
- Generate/update the final Pattern 71 report from the exact run.

## Acceptance Criteria

The isolated validation harness is ready only when:

### Safety

- [ ] Startup refuses any non-local database.
- [ ] Real HubSpot, NetSuite, Supabase service-role, and Clerk secrets are absent.
- [ ] Non-loopback outbound traffic fails the run.
- [ ] Reset/cleanup cannot target an unrecognized database.
- [ ] Production/Vercel refuses isolated validation mode.
- [ ] Test artifacts contain no secrets.

### Environment

- [ ] A clean workstation can start the database and application using documented commands.
- [ ] All canonical migrations apply from an empty database.
- [ ] Fixture seed is deterministic and idempotent or reset-scoped.
- [ ] Local auth reaches the Quote route without Clerk.
- [ ] Send stores and reopens a local PDF artifact.

### Lifecycle

- [ ] Draft Preview renders.
- [ ] Send transitions draft → sent exactly once.
- [ ] Client Review persists after refresh and direct linking.
- [ ] Sent revision transitions sent → draft, increments version, and supersedes the prior snapshot.
- [ ] Accept transitions sent → accepted only after fake HubSpot success.
- [ ] HubSpot failure leaves the quote unaccepted.
- [ ] Rollback transitions accepted → sent and records the fake stage rollback.
- [ ] Revise from accepted completes rollback then revision with coherent audit history.
- [ ] SO submission writes pending before fake submission.
- [ ] Fake NetSuite failure persists a truthful failed state and does not complete the quote.
- [ ] Retry succeeds or converges without a duplicate fake order.
- [ ] Completion persists internal ID and `tranId`.
- [ ] Completion freezes the quote and rejects invalid mutations.
- [ ] Post-completion fake HubSpot amount failure does not undo completion and remains observable.

### Adversarial browser behavior

- [ ] Deep links resolve correctly for every valid state.
- [ ] Invalid/unreachable tabs degrade consistently.
- [ ] Refresh does not lose or fabricate state.
- [ ] Back/Forward cannot reopen mutable behavior incorrectly.
- [ ] Two tabs cannot create duplicate transitions or Sales Orders.
- [ ] Duplicate clicks are guarded/idempotent.
- [ ] AdvanceBar does not remain actionable over irreversible modals.
- [ ] Complete Sales Order receipt remains reachable at its canonical URL.

### Evidence

- [ ] Zero unexpected console errors.
- [ ] Zero unexpected React warnings.
- [ ] Zero unexplained failed requests.
- [ ] Required screenshots exist.
- [ ] Playwright trace exists for every failure.
- [ ] Database/audit assertions are attached.
- [ ] Exact commit SHA and environment are recorded.
- [ ] Final report distinguishes implemented, technically verified, business parity verified, operationally ready, and production approved.

Passing the isolated harness establishes Nexus technical browser behavior against deterministic integration contracts. It does **not** by itself establish real HubSpot/NetSuite business parity or production approval.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Validation mode accidentally uses real credentials | P0 | Refuse startup if any real integration secret is present |
| Reset script targets remote DB | P0 | Loopback host and validation database-name assertions |
| Fake adapter bypasses too much orchestration | P1 | Substitute only external operations; keep real actions/transactions |
| Local auth becomes reachable in production | P0 | Compile/runtime production guard plus negative test |
| Plain PostgreSQL migration drift from Supabase | P1 | Fresh-schema test; explicitly list excluded manual migrations |
| Local artifact adapter changes Send semantics | P1 | Preserve render-before-transaction and unique artifact paths |
| Process-local fake state diverges across Next workers | P1 | Single deterministic adapter service or persisted run-scoped fake state |
| Realtime disabled hides cross-tab behavior | P2 | Test stale action/refresh explicitly; track realtime parity separately |
| Browser suite passes a branch not merged to `main` | P1 | Pin SHA and re-run exact release candidate |
| Mocks drift from real HubSpot/NetSuite contracts | P1 | Keep pure payload tests and later authorized sandbox parity run |
| Fixture math becomes unrealistic | P2 | Use real costing computation and assert above-floor result |
| Test-only code increases production attack surface | P1 | Narrow interfaces, production refusal, review security boundary |

## Proposed Next Execution Prompt

```text
Task: Implement the Slice 12 Minimum Isolated Validation Harness

Use:
docs/validation/Slice-12-Isolated-Validation-Readiness-Plan.md
as the authoritative implementation plan.

Scope:
- Implement Option A only: local Nexus, disposable local PostgreSQL,
  validation-only local auth, local PDF artifact storage, fake HubSpot,
  fake NetSuite, and Playwright.
- Do not access HubSpot, NetSuite, Supabase, Clerk, production, sandbox
  integrations, or any remote database.
- Block all non-loopback outbound network access during validation.
- Preserve the real Quote Umbrella UI, server actions, database
  transactions, audit writes, idempotency logic, PDF rendering, and
  freeze behavior.
- Mock only external boundaries.
- Use a true draft fixture and execute:
  Preview → Send → Client Review → Revise → Re-send → Accept →
  Rollback → Re-accept → Sales Order Pending → Sales Order Complete.
- Attack deep links, refresh, Back/Forward, multiple tabs, duplicate
  actions, invalid transitions, external failure/retry, and complete
  receipt reachability.

Before implementation:
1. Confirm the exact target commit/branch.
2. Present the proposed file-change list.
3. Identify any migration that does not apply to plain PostgreSQL.
4. Prove the startup guard will reject remote database hosts and real
   integration credentials.

Required outputs:
- documented local validation commands;
- deterministic seed/reset;
- Playwright config and adversarial specs;
- traces/screenshots/console/network evidence;
- updated
  docs/validation/Browser-Validation-Slice-12-Final.md
  with PASS or FAIL based only on the executed run.

Do not execute an authorized-sandbox walkthrough. Do not claim business
parity or production approval from mocked integration results.
```

## Final Recommendation

Proceed with the narrow Option A harness. Do not attempt to close the Slice 12 browser gate using pre-seeded visual states alone, and do not use Option C as the routine test path.

The immediate human decisions required before implementation are:

1. Which exact commit is the release-candidate validation target?
2. Is adding validation-only auth code to the application acceptable, or must auth be handled through a separate local reverse-proxy/test mechanism?
3. Is a local filesystem PDF adapter acceptable for the technical gate?
4. Should NetSuite fake state live in-process or in a loopback mock service?
5. Is Playwright the approved browser runner and dependency?

Until those decisions are made and the harness is implemented, Slice 12 remains blocked at the adversarial browser-validation gate.
