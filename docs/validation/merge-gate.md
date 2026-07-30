# Authoritative validation merge gate

This is the sole authoritative acceptance checklist for changes affecting the
validation harness or its protected business promises. The exact execution
procedure is in [operational-runbook.md](operational-runbook.md).

## Result classifications

- **MERGE BLOCKER:** a test, compilation, migration, schema, fixture,
  isolation, diagnostics, cleanup, diff, or clean-tree assertion fails.
- **WARNING:** a non-protective diagnostic that does not contradict a business
  promise, such as Node's experimental type-stripping warning. Record it.
- **EXPECTED SAFETY-GATE REJECTION:** the harness refuses an unsafe or
  incomplete environment before mutation. This is successful protection, but
  the gate has not passed; correct the environment and rerun it.
- **ENVIRONMENT/SETUP ISSUE — NO TESTS RAN:** process environment, dependency,
  port, Docker ownership, or tool setup prevented test startup. Diagnose and
  correct setup without weakening tests, then rerun the affected gate.

## Checklist

All boxes are merge blockers unless explicitly classified otherwise.

### Repository and environment

- [ ] Confirm `git status -sb` is clean and the branch/base/head are expected.
- [ ] Fetch `origin` and confirm
      `git rev-list --left-right --count origin/main...HEAD`.
- [ ] Run `git diff --check` before validation.
- [ ] Create `.env.validation.local` from `.env.validation.example`, review it
      for loopback-only URLs, isolated providers, and absent real credentials.
- [ ] Generate a unique `NEXUS_VALIDATION_RUN_ID` and create a new, exclusive
      external root at `C:\Code\nexus-validation-runs\<run-id>`; reject an
      existing root rather than reusing it.
- [ ] Explicitly load that file into the PowerShell process used for database,
      migration, fixture, and isolation commands. Merely creating the file is
      insufficient. Follow the runbook's environment loader.
- [ ] Prove `.next`, `test-results`, `playwright-report`, and
      `.artifacts/validation` are absent before the run; record their exact
      absolute paths in the unique root's ownership manifest. A pre-existing
      path is a blocker and must not be deleted by validation.
- [ ] Run `npm.cmd run validation:prove-isolation` and retain its proof.

### Server-free gates

- [ ] `npm.cmd run test:unit`
- [ ] `node --experimental-strip-types scripts/test-costing.ts`
- [ ] `npm.cmd run prebuild`
- [ ] `npx.cmd tsc --noEmit`

### Isolated database and fixtures

- [ ] Inspect any existing `nexus-validation-db` container, network, and volume
      labels before startup; prove Compose ownership and isolation.
- [ ] Fix `COMPOSE_PROJECT_NAME` explicitly when reusing a verified stack from
      another worktree.
- [ ] `npm.cmd run validation:db:start`
- [ ] `npm.cmd run validation:db:migrate`; require the committed migration
      count and `schema-ready` assertion to pass.
- [ ] `npm.cmd run validation:seed`
- [ ] `npm.cmd run validation:fixtures:validate`

### Browser gates

- [ ] Start an explicitly owned validation server; record run ID, PID, process
      creation time, and exact command line beneath the unique external root.
      Redirect server stdout/stderr there and wait for an observable HTTP
      response on `127.0.0.1:3100`.
- [ ] Run every suite with `--workers=1 --retries=0 --max-failures=1`, a
      Playwright test ceiling, and a hard outer process timeout:
  - [ ] Quote deep links:
        `tests/e2e/smoke/quote-deep-links.spec.ts`,
        project `read-only`.
  - [ ] VAL-101:
        `tests/e2e/costing/basic-quote-persistence.spec.ts`,
        project `costing-serial`, grep `VAL-101`.
  - [ ] VAL-103:
        `tests/e2e/costing/basic-quote-persistence.spec.ts`,
        project `costing-serial`, grep `VAL-103`.
  - [ ] VAL-601:
        `tests/e2e/slice-12/primary-send-lifecycle.spec.ts`,
        project `lifecycle-serial`.
- [ ] Confirm strict console, page-error, request-failure, and outbound-network
      diagnostics remained active.

CLI `--retries=0` is mandatory: the current Playwright configuration selects
one retry when `CI` is set unless the merge-gate command overrides it.

### Cleanup on success and failure

- [ ] Before stopping the server, match its current PID, creation time, exact
      command line, expected validation-server command, and run marker. Stop
      only its owned descendant tree. A stale PID number alone authorizes
      nothing.
- [ ] Confirm port 3100 has no listener.
- [ ] Run `npm.cmd run validation:fixtures:reset`.
- [ ] Run `npm.cmd run validation:db:teardown`.
- [ ] Confirm the owned validation container is removed.
- [ ] Confirm the owned validation network is removed.
- [ ] Confirm the owned validation volume is removed.
- [ ] Confirm validation artifacts are removed.
- [ ] Remove the temporary `.env.validation.local` if the run created it.
- [ ] Remove generated directories only from the current run's ownership
      manifest, which proves each path was absent before execution. Use the
      same rule after success and failure; do not remove unknown or
      pre-existing paths.
- [ ] Run `git diff --check` after validation.
- [ ] Confirm `git status --short` is empty.
- [ ] Retain the unique run ID and external log/root path in the final report;
      do not delete durable external logs during normal cleanup.

Cleanup is required even after a merge blocker. Never delete a container,
network, volume, process, or directory without proving it belongs to the
current validation run.
