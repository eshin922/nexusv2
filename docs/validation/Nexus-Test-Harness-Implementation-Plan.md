# Nexus Test Harness Implementation Plan

## Document Status

| Field | Value |
|---|---|
| Status | Approved implementation plan — permanent platform branch |
| Created | 2026-07-29 |
| Repository | `eshin922/nexusv2` |
| Implementation base | `main` after PR #160 |
| Base commit | `aee51153545083444dd1f1ebb9b4d203c94d503b` |
| Base relationship to `main` | Exact branch point |
| Implementation branch | `feat/nexus-validation-platform` |
| Slice 12 dependency | PR #160 merged at the base commit |
| External access | Prohibited |

## Phase 0 Repository Assessment

### Original assessment

- Current branch: `feat/slice-12-step-10-walk-fixes`
- Current commit: `5fbe2b14f2f1f0c291078baaa49ae2266936cec8`
- Merge base with `main`: `8aa0ba306a1747aa31911011e84ee6e99aadb5e7`
- Staged files: none
- Modified tracked files: none
- Untracked files: extensive documentation, transcript, design-prototype, scratch, validation, planning, and three historical script files
- Stashes:
  - `stash@{0}` — Step 8c-4 probe/backlog drafts
  - `stash@{1}` — migration/realtime diagnostic instrumentation

All existing untracked and stashed work is user work. It will be preserved and excluded from harness commits unless a file is an explicitly requested harness artifact.

### Open pull requests

| PR | State | Relationship | Overlap |
|---|---|---|---|
| #160 — Step 10 close bundle | Open; head is current branch | Required implementation base | Touches `quotes.ts`, Quote Umbrella UI, NetSuite completion, and existing Step 10 fixtures |
| #159 — Step 10 CB fixture | Open; stated as subsumed by #160 | Obsolete as independent base | Touches only the two Step 10 fixture scripts |
| #94 | Open, stale/divergent | Unrelated product hotfix | No planned harness overlap identified |
| #63 | Open, stale/divergent | Historical documentation | No planned harness overlap identified |

### Stabilized state

- PR #160 merged into `main` as
  `aee51153545083444dd1f1ebb9b4d203c94d503b`.
- Local `main` was fast-forwarded to that exact commit.
- `feat/nexus-validation-platform` was created from that exact commit.
- Completed reusable checkpoints were transplanted with `cherry-pick -x`.
- The pre-DI authentication spike remains preserved only on
  `feat/nexus-isolated-test-harness` at `59a69cf`; it is not part of this
  branch and must not be transplanted verbatim.
- Existing untracked documents and stashes remain untouched.

## Implementation Target

The permanent platform branch is:

```text
feat/nexus-validation-platform
base: aee51153545083444dd1f1ebb9b4d203c94d503b
```

This is the lowest production commit containing the Slice 12 lifecycle behavior
required by the first complete feature suite. The reusable platform remains
conceptually independent of Slice 12; Slice 12 is its first consumer.

## Proposed Architecture

```text
Production composition                         Isolated composition
──────────────────────                         ────────────────────
ClerkIdentityProvider                          IsolatedIdentityProvider
HubSpotProvider                                FakeHubSpotProvider
NetSuiteProvider                               FakeNetSuiteProvider
SupabaseArtifactStorage                        LocalArtifactStorage
SupabaseRealtimeProvider                       DisabledRealtimeProvider
         │                                               │
         └──────── controlled composition root ──────────┘
                                  │
                    existing Nexus routes/actions
                                  │
               Drizzle + disposable local PostgreSQL
                                  │
                            Playwright UI
```

### Architectural rules

1. Production providers remain the default.
2. Isolated providers are selected only at process start.
3. No request field—query string, cookie, header, form field, or public route—may select isolated mode.
4. Routes, actions, components, and domain modules depend only on shared
   interfaces and receive dependencies through injection.
5. Tests do not reproduce quote lifecycle logic.
6. Fakes do not write Nexus lifecycle tables.
7. Real payload builders, state guards, transactions, audits, idempotency, reconciliation, PDF rendering, and freeze behavior remain in execution.
8. Test-only modules must be absent from production client bundles and unreachable from production server composition.
9. Only the process-start composition root may read provider-selection or
   validation-mode configuration.
10. Production modules must not contain validation-mode conditionals.

## Planned File Changes

The list may be refined during implementation; any material addition must be classified in `Nexus-Test-Harness-Architecture.md`.

### Shared production/test architecture

- `src/lib/config/runtime-config.ts`
- `src/lib/config/runtime-config.test.ts`
- `src/lib/integrations/provider-kind.ts`
- `src/lib/integrations/composition.ts`
- `src/lib/integrations/hubspot-provider.ts`
- `src/lib/integrations/hubspot-production.ts`
- `src/lib/integrations/netsuite-provider.ts`
- `src/lib/integrations/netsuite-production.ts`
- `src/lib/artifacts/artifact-storage.ts`
- `src/lib/artifacts/supabase-artifact-storage.ts`
- `src/lib/realtime/realtime-provider.ts`
- `src/lib/realtime/supabase-realtime-provider.ts`
- `src/lib/auth/identity-provider.ts`
- `src/lib/auth/clerk-identity-provider.ts`
- `src/lib/integration-errors.ts`
- targeted changes to existing HubSpot, NetSuite, auth, storage, Quote action, and Realtime composition call sites

### Test-only runtime

- `tests/harness/providers/fake-hubspot.ts`
- `tests/harness/providers/fake-netsuite.ts`
- `tests/harness/providers/isolated-identity.ts`
- `tests/harness/providers/local-artifact-storage.ts`
- `tests/harness/providers/disabled-realtime.ts`
- `tests/harness/network/guard.ts`
- `tests/harness/network/ledger.ts`
- `tests/harness/fixtures/*`
- `tests/harness/invariants/*`
- `tests/e2e/quote-umbrella/*`
- `playwright.config.ts`

### Development tooling

- `docker-compose.validation.yml`
- `scripts/validation/assert-isolation.ts`
- `scripts/validation/db-start.ts`
- `scripts/validation/db-migrate.ts`
- `scripts/validation/seed.ts`
- `scripts/validation/reset.ts`
- `scripts/validation/teardown.ts`
- `scripts/validation/run.ts`
- `.env.validation.example`

### Unit/database/contract tests

- `tests/unit/*`
- `tests/integration/*`
- `tests/contracts/*`
- test runner configuration selected during implementation

### CI-only infrastructure

- `.github/workflows/isolated-validation.yml`

### Documentation

- `docs/validation/Nexus-Test-Harness-Architecture.md`
- `docs/validation/Nexus-Test-Harness-Implementation.md`
- `docs/validation/Nexus-Test-Harness-Runbook.md`
- `docs/validation/Local-Database-Migration-Compatibility.md`
- `docs/validation/Authorized-Sandbox-Parity-Runbook.md`
- `docs/validation/Browser-Validation-Slice-12-Final.md`

## Package and Dependency Changes

Expected additions:

- `@playwright/test` — explicit pinned browser runner
- a lightweight TypeScript-capable unit runner only if Node’s built-in runner cannot load the server-only/alias graph safely

Expected non-additions:

- no HubSpot/NetSuite mock server package unless the provider-interface approach proves insufficient;
- no Supabase CLI requirement for the primary harness;
- no Clerk testing package;
- no external service emulator.

Package changes will be isolated in their own reviewable commit. Browser binaries will be installed through documented Playwright commands and will not be committed.

## Migration Strategy

1. Start an empty local PostgreSQL container with `pg_trgm`.
2. Require a validation-marked database name and approved local hostname.
3. Apply canonical Drizzle migrations in journal order.
4. Classify every SQL migration:
   - canonical/local-compatible;
   - Supabase-only excluded;
   - order-dependent;
   - defective;
   - adapted for isolated use.
5. Never ignore a canonical migration failure.
6. Do not execute Supabase publication or Storage-schema SQL on plain PostgreSQL.
7. Assert migration head and critical Slice 12 constraints before seeding.
8. Record findings in `Local-Database-Migration-Compatibility.md`.

No production migration is planned solely for the harness. A production migration will be added only if the empty-database exercise proves the current canonical schema is defective and the fix is independently justified.

## Safety Controls

The centralized safety gate must prove:

- explicit process-start isolated mode;
- local/approved-container database host;
- validation marker in database name;
- no production mode;
- no Vercel production mode;
- no Clerk secret;
- no HubSpot tokens;
- no NetSuite credentials;
- no Supabase service-role credential;
- every provider reports isolated kind;
- outbound request guard installed before application service begins;
- test browser permits loopback only;
- destructive commands repeat database host/name checks.

Negative tests are release-blocking. A failed safety assertion stops the application before serving a route.

## Implementation Phases

### Phase A — Safety and composition foundation

- runtime configuration parser;
- provider-kind assertions;
- production refusal tests;
- application outbound guard;
- architecture artifact.

### Phase B — Disposable database

- local container;
- empty-schema migration;
- compatibility report;
- guarded reset/teardown.

### Phase C — Auth, artifacts, and Realtime

- production and isolated identity providers;
- production and local artifact providers;
- production and disabled Realtime providers.

### Phase D — HubSpot and NetSuite boundaries

- production wrappers;
- deterministic fakes;
- structured errors;
- call ledgers;
- failure injection;
- contract tests.

### Phase E — Fixtures and invariants

- reusable factories;
- deterministic run manifest;
- lifecycle state variants;
- database/audit invariant library.

### Phase F — Browser platform

- Playwright;
- server/global setup and teardown;
- request interception;
- evidence capture.

### Phase G — Slice 12 suite

- primary lifecycle;
- revisions and rollbacks;
- concurrency/duplicate attacks;
- failure/retry paths;
- permissions and data-edge cases.

### Phase H — CI and operations

- GitHub Actions workflow;
- runbooks;
- authorized sandbox design;
- repeatability runs;
- final verdict.

## Reviewable Commit Plan

1. `docs(validation): pin isolated harness architecture and safety plan`
2. `feat(validation): add fail-closed runtime configuration`
3. `chore(validation): add disposable local postgres lifecycle`
4. `feat(integrations): introduce production provider boundaries`
5. `test(validation): add isolated providers and deterministic fixtures`
6. `test(validation): add unit database and contract coverage`
7. `test(e2e): add Playwright platform and Quote Umbrella lifecycle`
8. `ci(validation): add isolated test workflow and evidence upload`
9. `docs(validation): publish runbooks and final Slice 12 verdict`

Commits may be subdivided if a phase is too large to review safely.

## Rollback Strategy

- Production wrappers initially delegate directly to existing implementations.
- Each shared abstraction lands with equivalence/contract tests.
- Test-only modules live outside application runtime directories where practical.
- If a provider refactor changes production behavior, revert that phase commit without reverting local database or Playwright work.
- No production data migration or external-system mutation is part of this work.
- Local state is disposable: stop containers, remove only the validation volume, and delete only the run-scoped artifact directory after safety assertions.
- Existing untracked/stashed user work is never included in rollback operations.

## Expected Commands

Names may be refined, but the runbook must expose:

```text
npm install
npx playwright install chromium
npm run validation:db:start
npm run validation:db:migrate
npm run validation:seed
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e -- --headed
npx playwright show-trace <trace.zip>
npm run validation:reset
npm run validation:teardown
npm run validation:prove-isolation
```

No command may read `.env.local` by default.

## Risks and Decision Points

| Risk/decision | Disposition |
|---|---|
| PR #160 lifecycle dependency | Resolved: merged into the permanent branch base at `aee5115` |
| Large untracked worktree | Preserve; stage only explicit harness paths |
| Auth seam could weaken Clerk | Shared interface plus dependency injection; Clerk remains the default production implementation; validation identity and UI adaptations land together with production-refusal and negative tests |
| Fake providers could ship in bundles | Test-only paths plus controlled dynamic resolution; bundle verification |
| Plain PostgreSQL migration incompatibility | Stop and document; never silently skip canonical SQL |
| Process-local fake state under Next workers | Prefer database-backed/run-scoped fake ledger or one server-side composition instance |
| Application outbound guard portability | Install before serving; retain browser and container layers as independent controls |
| Unit runner choice | Prefer Node built-in; add one runner only if alias/server-only graph requires it |
| Docker availability in CI | Use service container in CI; local compose for developer workflow |
| Exact external parity | Explicitly out of isolated PASS; separate authorized runbook |

## Stop Conditions

Implementation must stop immediately on:

- any evidence of a remote connection attempt;
- any non-loopback request not blocked;
- any safety gate that can be activated through a request;
- any destructive command whose target cannot be proven local and validation-marked;
- an ambiguous implementation base;
- overlapping tracked user changes in a file required by the harness;
- migration failure that would require silently skipping canonical schema.

