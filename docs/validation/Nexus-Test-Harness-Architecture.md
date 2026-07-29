# Nexus Test Harness Architecture

## Status and Objective

This document classifies the proposed Nexus isolated validation platform before implementation and defines its production/test exposure boundary.

The objective is production-quality integration boundaries, lifecycle safety, configuration validation, reconciliation support, and observability, combined with strictly test-only identities, fakes, fixtures, local storage, failure injection, network containment, and browser automation.

## Architecture Principles

1. Production behavior remains the default and must remain functionally equivalent.
2. Shared abstractions must solve a real production boundary or operational problem.
3. Test-only capability is selected only at process start.
4. No request-controlled input may activate isolated behavior.
5. Tests drive production routes, components, actions, transactions, audits, guards, payload builders, idempotency, and freeze logic.
6. Fakes substitute external effects only.
7. Test-only destructive tooling is never imported by a route or server action.
8. Production and Vercel production refuse isolated mode.
9. All isolation rules have automated negative tests.

## Runtime Classification

### Classification 1 — Production Runtime

| Path/code path | Purpose | Production exposure |
|---|---|---|
| `src/lib/integrations/hubspot-production.ts` | Delegate business operations to existing HubSpot SDK behavior | Server-only production runtime |
| `src/lib/integrations/netsuite-production.ts` | Delegate business operations to existing NetSuite client/orchestrator dependencies | Server-only production runtime |
| `src/lib/artifacts/supabase-artifact-storage.ts` | Preserve current Supabase PDF artifact behavior | Server-only production runtime |
| `src/lib/realtime/supabase-realtime-provider.ts` | Preserve current Supabase Realtime behavior | Production client/server boundary as currently used |
| `src/lib/auth/clerk-identity-provider.ts` | Preserve Clerk request identity behavior | Server-only production runtime |
| Existing HubSpot, NetSuite, Supabase, Clerk modules | Concrete external clients | Unchanged default implementations |

### Classification 2 — Shared Production/Test Architecture

| Path/code path | Purpose | Why production-reusable |
|---|---|---|
| `src/lib/config/runtime-config.ts` | Parse and validate startup configuration | Prevents invalid production combinations and creates explicit readiness diagnostics |
| `src/lib/integrations/provider-kind.ts` | Provider identity and capability metadata | Enables health/readiness and operational visibility |
| `src/lib/integrations/composition.ts` | Controlled server-only dependency resolution | Removes concrete external SDK coupling from business actions |
| `src/lib/integrations/hubspot-provider.ts` | HubSpot business-operation contract | Centralizes stage/amount/owner operations, errors, audit metadata, and future reconciliation |
| `src/lib/integrations/netsuite-provider.ts` | NetSuite business-operation contract | Centralizes item/group/SO operations, errors, idempotency observations, and future reconciliation |
| `src/lib/artifacts/artifact-storage.ts` | Quote artifact contract | Makes artifact lifecycle, metadata, and retrieval explicit beyond Supabase SDK details |
| `src/lib/realtime/realtime-provider.ts` | Realtime capability contract | Makes enabled/disabled/degraded readiness observable |
| `src/lib/auth/identity-provider.ts` | Request identity contract | Separates application authorization/audit identity from Clerk SDK mechanics |
| `src/lib/integration-errors.ts` | Structured external error classification | Improves production failure handling, operator copy, retry decisions, and audit consistency |
| Lifecycle transition/invariant helpers | Centralize allowed transitions and frozen-field checks | Prevents future admin/reconciliation paths from bypassing guards |
| Idempotency/reconciliation helpers | Describe uncertain and converged external outcomes | Supports production retry/reconciliation features, not just tests |
| Readiness/health summaries | Report provider configuration and degraded state | Operational production value |

### Classification 3 — Test-Only Runtime

| Path/code path | Purpose | Isolation |
|---|---|---|
| `tests/harness/providers/fake-hubspot.ts` | Stateful programmable HubSpot fake | Imported only by isolated composition |
| `tests/harness/providers/fake-netsuite.ts` | Stateful programmable NetSuite fake | Imported only by isolated composition |
| `tests/harness/providers/isolated-identity.ts` | Deterministic PM/admin/unauthorized identities | Refused in production |
| `tests/harness/providers/local-artifact-storage.ts` | Run-scoped PDF storage | Local path and loopback URL only |
| `tests/harness/providers/disabled-realtime.ts` | No-external Realtime substitute | Isolated mode only |
| `tests/harness/fixtures/*` | Deterministic data factories and manifests | Never imported by application routes/actions |
| `tests/harness/invariants/*` | Database/audit truth assertions | Test process only |
| `tests/harness/network/*` | Outbound guard and ledger | Installed before isolated server/test start |
| `tests/e2e/*` | Playwright suites | Test runner only |
| `playwright.config.ts` | Browser orchestration | Test runner only |

### Classification 4 — Development Tooling

| Path/code path | Purpose | Safety boundary |
|---|---|---|
| `docker-compose.validation.yml` | Local disposable PostgreSQL | Local-only network/volume |
| `scripts/validation/db-start.ts` | Start and verify local DB | Loopback/marker assertions |
| `scripts/validation/db-migrate.ts` | Apply canonical migrations | Validation DB only |
| `scripts/validation/seed.ts` | Seed deterministic fixtures | Validation DB only |
| `scripts/validation/reset.ts` | Reset by run ID or database | Repeats destructive-target proof |
| `scripts/validation/teardown.ts` | Stop container/remove local artifacts | Explicit validation resources only |
| `scripts/validation/run.ts` | Orchestrate complete local run | No `.env.local`; isolated config only |
| `.env.validation.example` | Safe placeholder configuration | Contains no secrets |

### Classification 5 — CI-Only Infrastructure

| Path/code path | Purpose | Isolation |
|---|---|---|
| `.github/workflows/isolated-validation.yml` | Run lint, unit, DB, migration, E2E, artifact upload | Local CI service container; no real secrets |
| CI artifact collection steps | Upload reports/traces/screenshots/logs/manifests | Secret scan before upload |
| CI network policy step | Deny unexpected outbound traffic where runner permits | Loopback/service-container allowlist |

## Controlled Composition Boundary

Provider selection is process configuration, evaluated in server-only code before the application begins serving.

Forbidden selectors:

- query parameters;
- cookies;
- request headers;
- form fields;
- route parameters;
- user roles;
- public or administrative routes;
- browser local/session storage.

Allowed selector:

- validated process-start environment passed by the isolated runner.

Production code imports shared contracts and production implementations. Test-only implementations are loaded only by the isolated composition root after the safety gate proves isolated mode. Direct imports from `tests/harness` into ordinary routes/actions are forbidden and verified structurally.

## Shared Abstraction Review

### HubSpot business-operation interface

**Production problem solved:** HubSpot owner, stage, amount, rollback, and retry semantics are currently spread across SDK call sites. A business-operation boundary makes failure classification, audit detail, and reconciliation consistent.

**Not merely for Playwright:** Slice 13 retry/reconciliation/admin workflows need the same operation semantics and observable outcomes.

**Behavior preservation:** The production implementation delegates to existing functions and SDK clients. Contract/equivalence tests pin current return/error behavior.

**Fake substitution:** The fake implements only owner/stage/amount effects and operation logs. Quote status, audits, pending capture, and transactions remain in Nexus.

### NetSuite business-operation interface

**Production problem solved:** Item resolution, source/segment lookup, group creation, SO creation, and transaction retrieval need one classified operational boundary for uncertain outcomes and reconciliation.

**Not merely for Playwright:** Production retries, duplicate prevention, and operator reconciliation depend on these distinctions.

**Behavior preservation:** Payload construction, hashes, pending ledger, success/failure persistence, quote mirrors, audit, and freeze remain in existing Nexus orchestration.

**Fake substitution:** The fake returns external lookup/create/read outcomes only and never mutates Nexus tables.

### Artifact-storage interface

**Production problem solved:** Quote artifact identity, metadata, retrieval, historical access, and cleanup are business concerns currently expressed as Supabase SDK calls.

**Not merely for Playwright:** Production artifact observability, expiry/re-sign behavior, and future storage migration benefit from a stable contract.

**Behavior preservation:** Supabase remains the production implementation; real PDF rendering and render-before-send ordering are unchanged.

**Fake substitution:** Local storage persists the real PDF buffer and returns a loopback URL.

### Identity-provider interface

**Production problem solved:** Application identity, database user, role checks, and audit actor attribution should not require Clerk SDK calls at every boundary.

**Not merely for Playwright:** A clear identity contract improves production authorization review and future provider changes.

**Behavior preservation:** Clerk remains the production provider. Existing allowlist and role semantics remain enforced.

**Fake substitution:** The isolated provider returns only seeded deterministic identities and is impossible to select in production.

### Realtime-provider interface

**Production problem solved:** Enabled, disabled, and degraded Realtime capability should be explicit rather than implicit SDK construction.

**Not merely for Playwright:** Production readiness and degraded-state handling benefit from observable Realtime status.

**Behavior preservation:** Supabase subscriptions remain the production implementation.

**Fake substitution:** Isolated mode reports disabled and makes no network connection.

### Runtime configuration validation

**Production problem solved:** Invalid pooler, credential, environment, or provider combinations currently fail late. Central validation produces early actionable failures and health metadata.

**Fake substitution:** Isolated mode adds stricter proofs; it does not weaken production validation.

### Lifecycle, idempotency, and reconciliation helpers

**Production problem solved:** New admin/retry paths can otherwise bypass freeze and transition rules or misclassify uncertain external results.

**Behavior preservation:** Helpers consolidate existing rules before new use; equivalence tests pin outcomes.

**Fake substitution:** Fakes supply external outcomes; helpers still decide Nexus transitions.

## Security Controls

- Process-start selection only
- Production/Vercel refusal
- Credential absence assertions
- Local database host/name assertions
- Provider-kind assertions
- Application request guard
- Playwright interception
- Container/network restriction where feasible
- Structural import checks
- Production bundle checks
- Negative tests for every rule
- Secret scanning before evidence upload

## Production Bundle and Runtime Exposure

- Shared interfaces and production implementations are expected in production server bundles.
- Test-only providers, fixtures, failure injection, local storage, network ledger, and Playwright suites should not appear in production client bundles.
- Server bundle exclusion will be verified where practical through build output/import-boundary checks.
- Isolated composition must throw during production startup even if test-only files are present on disk.

## Operational Benefits

- Classified integration errors
- Consistent retry/reconciliation decisions
- Provider health/readiness visibility
- Central audit metadata
- Explicit artifact lifecycle
- Safer future Slice 13 administrative actions
- Repeatable database and lifecycle verification

## Known Remaining Coupling

The first implementation may retain:

- existing Drizzle singleton construction;
- existing action-module breadth in `quotes.ts`;
- existing PDF resolver composition;
- browser Realtime disabled rather than locally emulated;
- production HubSpot/NetSuite SDK details inside production wrappers.

These are acceptable if the isolated boundary remains complete and no lifecycle logic is duplicated. Any remaining external call outside a provider is a release blocker for the isolated harness.

