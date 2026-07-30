# Architecture

The harness has four layers: pure unit tests for formulas and parsing;
action/integration tests for persistence, authorization, audits, and providers;
browser tests for valuable UI workflows; and lifecycle/artifact tests for
snapshots, PDFs, review events, and provider ledgers.

`playwright.config.ts` selects validation configuration. Global setup asserts
runtime isolation and provisions deterministic fixtures. Composition roots
select validation identity, fake HubSpot/NetSuite, local artifact storage, and
isolated realtime. Both global and quote-local costing subscriptions receive
the same composition decision; isolated pages never construct a Supabase
browser client. Production modules never import harness modules.

Network access is deny-by-default. Browser diagnostics retain strict console,
page-error, request-failure, and outbound checks. Any exclusion must be
trace-supported and narrowly matched.

Quote calculations remain production-owned in `src/lib/costing.ts`; customer
projection remains in `src/lib/customer-view-resolver.ts`. Tests use explicit
outcomes and never reproduce formulas in presentation or browser code.

Playwright projects are path-scoped: `smoke/` is read-only, `slice-12/` is
lifecycle-serial, and `costing/` is serial form/persistence coverage. Adding a
new scenario group requires an explicit project and this documentation update.

Deterministic fixtures use stable local record IDs and numeric fake HubSpot
IDs. Fake providers record calls in JSONL beneath the validation artifact root;
local artifact storage holds PDFs beneath the same root. Sent snapshots and PDF
bytes are immutable evidence. Browser tests may inspect them but never
regenerate expected historical output.
