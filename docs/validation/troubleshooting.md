# Troubleshooting

Runtime safety failures mean a URL is not loopback, the database lacks its
validation marker, production mode is active, or a provider is not isolated.
They can also mean `.env.validation.local` exists but was never loaded into the
current database/fixture CLI shell. This rejection occurs before product tests
or mutation and is successful protection. Load the environment exactly as
shown in the runbook and rerun the blocked gate.

A Docker name conflict across worktrees is not permission to delete the
container, network, or volume. Inspect Compose labels first. During final Slice
12 verification, resources owned by project `nexusv2` collided with the
reconstruction worktree's default `nexusv2-val601-clean` identity. Verified
reuse with explicit `COMPOSE_PROJECT_NAME=nexusv2` was safe; destructive
replacement would not have been. Cleanup targets only the identity proved to
belong to the run.

Unexpected outbound requests are failures. Capture URL and initiator; exclude
only when trace evidence proves a specific expected browser cancellation.

On Windows, Playwright's owned Next server may hang after a passing test. This
is runner teardown, not a product failure. Use an explicit server, terminate
only its process tree after matching the current process to the saved run ID,
PID, creation time, and exact command line. A stale PID file or matching number
alone must never trigger termination. Retain the unique external run root and
logs outside tracked paths.

If a generated directory predates validation, stop. Do not delete it. The
supported procedure requires exclusive worktree use, proves managed paths
absent before execution, and records them in the current run root. An
interrupted run root is evidence: never reuse it, and never apply its cleanup
records to a new run.

For fixture drift, validate IDs, statuses, snapshots, review events, artifacts,
and ledgers. Do not repair drift in browser tests.

If one of two rapid cost edits disappears, inspect both Server Action requests
and receipts. A missing second request indicates a remount canceled its
debounce; two requests with one lost value indicates a stale whole-row update.
Production autosave must not depend on RSC refresh. VAL-103 distinguishes the
causes through request, receipt, database, reload, and audit evidence.

Traces explain timing and cancellations; screenshots explain visible state;
durable stdout/stderr explain server failures; fake-provider JSONL proves
isolated side effects. Keep these outside tracked paths. Do not replace
snapshots or add exclusions until trace evidence proves expected behavior.

For exact environment, ownership, process-tree, and cleanup commands, use
[operational-runbook.md](operational-runbook.md). For result classification,
use [merge-gate.md](merge-gate.md).
