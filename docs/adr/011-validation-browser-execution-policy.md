# ADR 011: Browser execution uses one worker, zero retries, and fail-fast

**Status:** Accepted

## Context

Critical costing and lifecycle scenarios mutate deterministic quote fixtures.
Parallel mutation creates races; retries can conceal deterministic defects; a
long run after the first failure adds noise and state drift.

## Decision

Merge-gate browser suites run with one worker, zero retries,
`--max-failures=1`, per-test ceilings, and hard outer timeouts. Read-only
project configuration does not override the merge-gate serialization policy.

## Alternatives considered

- Maximize workers for speed.
- Retry flaky tests automatically.
- Continue all suites after a concrete failure.

Those choices optimize throughput at the cost of causal evidence.

## Consequences

The gate takes longer but has deterministic failure ordering and trustworthy
results. Performance improvements must come from smaller fixtures and the
lowest sufficient test layer.

## Operational implications

CLI bounds remain explicit. The current config's CI retry default is overridden
with `--retries=0` until configuration policy is reconciled separately.

## Failure modes prevented

Shared-fixture races, masked flaky defects, duplicate provider/audit effects,
and diagnostics contaminated by post-failure mutations.
