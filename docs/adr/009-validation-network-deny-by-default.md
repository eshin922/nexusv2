# ADR 009: Deny-by-default validation networking

**Status:** Accepted

## Context

Browser and server workflows naturally traverse authentication, artifacts,
realtime, HubSpot, NetSuite, and application URLs. An overlooked production
adapter could otherwise turn an isolated test into a real side effect.

## Decision

Validation permits only approved loopback hosts. Server outbound traffic is
guarded, browser traffic is observed, providers are isolated, and unexpected
requests fail the scenario. Exclusions require narrow, trace-supported proof.

## Alternatives considered

- Allow networking and rely on fake credentials.
- Maintain a broad domain denylist.
- Ignore aborted or failed requests globally.

Allow-by-default approaches cannot enumerate future integrations and broad
request exceptions hide genuine failures.

## Consequences

New legitimate local endpoints require an explicit review. Browser-specific
cancellations sometimes need evidence-backed narrow treatment.

## Operational implications

Unexpected destinations are diagnosed by URL and initiator. Network policy is
not relaxed to obtain a green run.

## Failure modes prevented

Real provider calls, credential-dependent tests, silent outbound drift, and
assertion weakening that masks failed application requests.
