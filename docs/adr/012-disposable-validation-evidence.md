# ADR 012: Disposable artifacts, ledgers, and owned-root cleanup

**Status:** Accepted

## Context

PDFs, snapshots, traces, screenshots, videos, fixture manifests, and fake
provider ledgers are essential evidence but can pollute later runs or expose
production-shaped data if treated as durable application state.

## Decision

Run evidence lives beneath one validation-owned artifact root. Durable process
logs and process identity live in a unique external directory derived from the
validation run ID. Repository-generated paths are owned only when a pre-run
manifest proves they were absent. Repository artifacts, fixture evidence, and
Docker state are disposable; cleanup is an acceptance assertion and targets
only ownership-proven resources.

## Alternatives considered

- Store artifacts beside source or commit golden outputs.
- Share one persistent ledger across runs.
- Reuse a fixed external log/PID directory.
- Delete conventional generated-directory names without a pre-run manifest.

These alternatives create stale evidence, accidental tracking, or destructive
cleanup risk.

## Consequences

Operators must preserve external diagnostics intentionally before cleanup and
must verify process, port, Docker, filesystem, and Git residue.

## Operational implications

Every success and failure path invokes the same cleanup. The external run root
records run metadata, generated-path ownership, and server PID plus creation
time and command line. Cleanup validates those records before deletion or
termination. Unknown and pre-existing resources are left untouched and
reported rather than guessed at. Durable external logs survive normal cleanup;
stale roots are investigated and archived, never reused.

## Failure modes prevented

Stale fixtures influencing later runs, tracked logs or secrets, artifact
overwrite confusion, orphaned Windows servers, and deletion of another
worktree's Docker resources, pre-existing build output, or an unrelated process
that reused a stale PID.
