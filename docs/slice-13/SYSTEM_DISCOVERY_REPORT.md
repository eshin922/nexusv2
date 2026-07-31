# Slice 13 system discovery report

## Evidence boundary

This report describes repository state at Slice 13 kickoff. A path citation is
a discovered fact. External SaaS configuration that is not versioned here is
marked **Requires manual discovery**.

## Repository capabilities

### Quote pipeline

- `src/app/actions/quotes.ts` implements create/tier editing, send, revise,
  acceptance/reversal, customer acceptance, completion, and PDF re-signing.
- `src/lib/quote-guards.ts` enforces lifecycle write guards.
- `src/db/schema.ts` persists quote status, accepted tier, immutable
  `quote_snapshots`, append-only `quote_review_events`, audit rows, and
  NetSuite completion identifiers.
- `src/lib/customer-view-resolver.ts`,
  `src/lib/customer-view-to-cpdf.ts`, `src/types/quote.ts`, and
  `src/components/pdf/` form the customer-facing projection/artifact path.
- Slice 12 validation covers construction persistence, concurrent autosave,
  deep links, and the primary send lifecycle; see
  `docs/validation/scenario-registry.md`.

### Sales Order pipeline

`src/lib/netsuite/mark-complete.ts` is the orchestrator invoked by
`markComplete` in `src/app/actions/quotes.ts`. The observed sequence is:

1. require an accepted quote and tier;
2. load canonical costing and project/HubSpot cache context;
3. resolve the HubSpot company through `netsuite_customer_map`;
4. resolve item SKUs, business segment, and project source;
5. build the Sales Order payload;
6. check/persist `netsuite_so_pushes` and use a deterministic idempotency key;
7. create the NetSuite Sales Order and fetch its display transaction ID;
8. freeze completion state and write audit evidence in a database transaction;
9. perform a best-effort HubSpot amount update after completion.

`src/lib/netsuite/sales-orders.ts` is the payload builder and REST-create
boundary. It maps customer, subsidiary, status, payment text, deal provenance,
selected cached deal fields, classification/segment, project manager, dates,
and item lines. Item rates and unit costs are rounded to four decimals.

`src/lib/netsuite/sales-order-preflight.ts` performs DB-only customer-map and
prior-push checks. SKU resolution is deliberately deferred to completion.

### Integration layer and clients

- `src/lib/integrations/composition.ts` selects production or isolated
  authentication, artifact, HubSpot, and NetSuite providers after
  `src/lib/config/runtime-config.ts` safety checks.
- `src/lib/integrations/hubspot-provider.ts` and
  `src/lib/integrations/netsuite-provider.ts` are provider contracts.
- `src/lib/hubspot.ts` uses `@hubspot/api-client` for deals, owners, companies,
  and products with separate read/write and production/development tokens.
- `src/lib/hubspot-cache.ts`, `src/lib/hubspot-pull.ts`, and
  `src/lib/hubspot-mapper.ts` cache deal context, import data, and map product
  records.
- `src/lib/netsuite/client.ts` implements Token-Based Authentication REST and
  SuiteQL requests, environment inference, retries, and record operations;
  `src/lib/netsuite/oauth.ts` signs OAuth 1.0 HMAC-SHA256 requests.
- NetSuite resolvers live under `src/lib/netsuite/`: customer map, items,
  Item Groups, project source, and business segment. The completion
  orchestrator currently resolves leaf items but deliberately does not invoke
  Item Group creation because its recorded REST/SOAP probes failed Sales Order
  creation. The Item Group primitive and smoke script remain available.

### DTOs, mappings, and validation

- `SalesOrderPayloadInput` and `SalesOrderLine` in
  `src/lib/netsuite/sales-orders.ts` are the current Sales Order input DTOs.
- Provider DTOs/interfaces are local to `src/lib/integrations/`; quote/customer
  view types are distributed across their source modules and `src/types/`.
- Mapping is implemented in the payload builder and specialized NetSuite
  resolvers. There is no discovered versioned, field-level Sales Order lineage
  registry.
- Validation is distributed across quote guards, costing/numeric validators,
  preflight, resolvers, database constraints, provider runtime safety, and
  NetSuite response classification. There is no discovered single Sales Order
  schema validator at the external boundary.

### Feature flags and environment

- No general feature-flag service or repository-level flag registry was found.
- Provider selection and isolation are environment-controlled by
  `NEXUS_ISOLATED_TEST` and `NEXUS_*_PROVIDER`; see `.env.validation.example`
  and `src/lib/config/runtime-config.ts`.
- `.env.example` documents database, Supabase, Clerk, HubSpot read/write, and
  HubSpot development variables. NetSuite variables are consumed in code but
  are not documented in that example: configuration documentation is
  incomplete.
- Some non-production UI access is gated by `NODE_ENV`, `VERCEL_ENV`, or query
  parameters. These are environment guards, not a formal rollout system.

## Current capabilities

- Deterministic isolated provider composition and regression validation.
- Immutable sent snapshots/PDF artifact references and append-only review feed.
- Reversible HubSpot acceptance-stage transition before completion.
- Direct sandbox-capable NetSuite Sales Order creation with dual idempotency.
- Explicit customer, item, segment, and project-source resolution failures.
- Persistent push status, payload snapshots, error classification, and retry
  convergence.
- A separately testable Item Group find/create primitive; it is not part of the
  current completion path.
- Existing exploratory field-diff probe:
  `scripts/parity/so-field-parity.ts`.

## Missing capabilities

These are absent from repository evidence:

- A permanent, approved field-level parity matrix and evidence store.
- Automated pairing of every authoritative production transaction to a Nexus
  sandbox recreation.
- A shadow-mode ledger/dashboard and measurable exit gate.
- A complete external integration/automation inventory.
- Formal production cutover, rollback, monitoring, UAT, training, and
  hypercare execution records.
- Completed Item Groups in the Sales Order completion path. Current code emits
  flat leaf lines and documents a mandatory manual NetSuite wrapping step.
- Inbound NetSuite reconciliation and HubSpot webhook synchronization; both are
  described as future work in `docs/quote-umbrella-brief.md` and
  `docs/UX_BACKLOG.md`.

## Unknowns and required investigations

- Active HubSpot workflows, Custom Code Actions, private apps, subscriptions,
  and webhooks: **Requires manual discovery**.
- Active NetSuite User Event/Scheduled scripts and workflows:
  **Requires manual discovery**.
- Complete production-versus-sandbox forms, roles, tax, terms, custom records,
  custom segments, item, and workflow configuration: **Requires manual
  discovery**.
- Named business/technical owners, production support model, transaction
  volumes, service levels, and cutover authority: **Requires manual discovery**.
- Whether the fixed SO2646 reference remains representative:
  **Requires manual discovery**.

## Technical debt and investigation areas

- `scripts/parity/so-field-parity.ts` embeds a fixed reference SO and
  hand-maintained intentional-difference rules while operating against real
  external credentials. It is useful evidence, not yet the permanent audit
  system.
- Payload mapping, lineage commentary, and classification knowledge are spread
  across the orchestrator, builder, cache schema, resolvers, scripts, and docs.
- Historical provisioning/cleanup/probe scripts under `scripts/` are
  operator-run utilities, not an owned background-job framework.
- Several code comments retain Slice/Step chronology. The parity matrix should
  replace chronology as the durable field contract without rewriting behavior
  during discovery.
- `src/lib/netsuite/mark-complete.ts` contains stale nearby commentary that
  describes assembly/Item Group lines even though its explicit Step 5 decision
  and actual line builder use flat leaf lines. That documentation drift must
  be resolved with the approved Item Group implementation, not interpreted as
  current behavior.
