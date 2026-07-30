# Validation lessons learned

These are durable engineering lessons from building and proving Slice 12.
Procedural recovery steps live in the
[operational runbook](operational-runbook.md) and
[troubleshooting guide](troubleshooting.md).

## Environment files are not process environments

Creating `.env.validation.local` does not load it into an existing shell.
`validation:app` and the npm Playwright wrappers load the file themselves;
database, migration, fixture, and isolation CLI wrappers inherit the caller's
environment. Future engineers must make environment loading explicit and prove
isolation before mutation.

An early rejection for missing variables is the safety system succeeding. It
means no browser scenario or database mutation ran. Correct the setup and rerun
the blocked gate; do not relax the guard.

## Compose identity belongs to a project, not a folder name alone

Compose derives its project identity from context unless
`COMPOSE_PROJECT_NAME` is fixed. In the final gate, existing validation
resources belonged to project `nexusv2`, while the reconstruction worktree
defaulted to `nexusv2-val601-clean`. The right response was to inspect labels,
prove isolation, and safely reuse the verified project identity—not to delete
resources whose ownership was unknown.

Multiple worktrees therefore require an ownership check before startup and
cleanup. A familiar container name is not ownership proof.

## Determinism requires serialization where state is mutable

Read-only scenarios can be logically independent, but lifecycle and costing
scenarios mutate deterministic quote fixtures. One worker, zero retries, and
fail-fast execution expose causal failures instead of masking them with races
or reruns.

Stable fixture UUIDs and numeric fake HubSpot IDs matter. Numeric IDs exercise
the real production linkage guard; decorative test-only prefixes would bypass
the behavior the harness is meant to protect.

## Cleanup is an assertion

A passing browser line is not the end of a run. Owned servers, listeners,
fixture rows, containers, networks, volumes, artifacts, environment files, and
generated directories are part of the result. Residue makes the next run
non-deterministic and can cause unsafe ownership assumptions.

Artifacts and fake-provider ledgers stay beneath one disposable owned root.
Every execution uses a unique external directory derived from its validation
run ID for server identity, PID evidence, stdout/stderr, and suite logs. Fixed
or reused log roots let interrupted runs overwrite the evidence needed to prove
ownership.

Generated directory names are not ownership evidence. The safe lesson is to
prove managed paths absent before validation, record their absolute paths in
the unique external root, and remove only those manifest-listed paths. If a
path predates the run, validation leaves it untouched and stops.

On Windows, stopping only the npm wrapper may leave the Next child process
alive. A PID can also be reused. Record PID, creation time, exact command line,
and run ID at startup; compare all of them before discovering descendants and
stopping only that owned tree. A stale PID file never authorizes termination.

Interrupted run roots remain read-only evidence until their markers, process
identity, and generated-path manifest are reconciled. They are never reused by
a new execution and normal cleanup never deletes their durable logs.

## Browser exclusions require causal evidence

Chromium can report a request abort after a successful PDF download, and an RSC
request can be superseded by navigation. These are not licenses for broad
request filtering. Preserve strict diagnostics and add only exact,
trace-supported exclusions for the proven route and browser behavior.

## Autosave has two synchronization audiences

The editing session reconciles an autosave from the Server Action's canonical
receipt. Other sessions reconcile through realtime. Quote-tree revalidation
after each cost-cell save can remount sibling fields and cancel pending
debounces; VAL-103 permanently protects against that save-loss class.
