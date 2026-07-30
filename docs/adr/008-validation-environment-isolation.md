# ADR 008: Physical production and validation isolation

**Status:** Accepted

## Context

Quote validation exercises destructive fixture reset, lifecycle transitions,
artifacts, and provider-shaped writes. Sharing production or development state
would make results non-deterministic and could damage real records.

## Decision

Validation uses a local marker-named database, isolated identity and provider
composition, loopback URLs, absent production credentials, and startup safety
assertions. It is a separate subsystem, not a mode layered over production
state.

## Alternatives considered

- Test against production-shaped shared development data.
- Mock only the browser while retaining real server providers.
- Depend on naming conventions without executable safety gates.

These alternatives cannot prove ownership or prevent accidental external
effects.

## Consequences

Fixtures and providers require maintenance, and setup is more explicit.
In return, runs are reproducible, destructive cleanup is bounded, and a failed
safety check prevents mutation.

## Operational implications

Operators prove isolation before startup and before destructive cleanup. A
safety-gate rejection is protection, not permission to bypass the guard.

## Failure modes prevented

Production data mutation, credential leakage, real provider calls, remote
database targeting, and cleanup against an unmarked database.
