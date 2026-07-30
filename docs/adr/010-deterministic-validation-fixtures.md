# ADR 010: Deterministic validation fixtures

**Status:** Accepted

## Context

Lifecycle and persistence tests need production-shaped records in known states.
Random or shared records make exact database, audit, artifact, and provider
assertions unreliable.

## Decision

Fixtures use stable run-derived local IDs, five explicit lifecycle states,
known tier counts, deterministic snapshots/events, and numeric fake external
IDs. Seed, validate, and reset are first-class operations.

## Alternatives considered

- Create random records inside each browser test.
- Reuse whatever development data exists.
- Prefix fake external IDs with nonnumeric test markers.

These options hinder reproducibility or bypass real linkage predicates.

## Consequences

Schema and workflow changes must update fixture types, validation counts,
scenarios, and audits together. Fixture mutation requires serialized projects.

## Operational implications

Validate fixture counts before browser execution and reset them on every exit
path. Display labels are not fixture identity.

## Failure modes prevented

Order-dependent tests, stale audit/artifact references, accidental shared-data
mutation, and test-only IDs that fail to exercise production guards.
