# ADR 012: Disposable artifacts, ledgers, and owned-root cleanup

**Status:** Accepted

## Context

PDFs, snapshots, traces, screenshots, videos, fixture manifests, and fake
provider ledgers are essential evidence but can pollute later runs or expose
production-shaped data if treated as durable application state.

## Decision

Run evidence lives beneath one validation-owned artifact root. Durable process
logs may live in an explicit external run directory. Repository artifacts,
fixture evidence, and Docker state are disposable; cleanup is an acceptance
assertion and targets only ownership-proven resources.

## Alternatives considered

- Store artifacts beside source or commit golden outputs.
- Share one persistent ledger across runs.
- Delete broadly by conventional names without ownership checks.

These alternatives create stale evidence, accidental tracking, or destructive
cleanup risk.

## Consequences

Operators must preserve external diagnostics intentionally before cleanup and
must verify process, port, Docker, filesystem, and Git residue.

## Operational implications

Every success and failure path invokes cleanup. Unknown resources are left
untouched and reported rather than guessed at.

## Failure modes prevented

Stale fixtures influencing later runs, tracked logs or secrets, artifact
overwrite confusion, orphaned Windows servers, and deletion of another
worktree's Docker resources.
