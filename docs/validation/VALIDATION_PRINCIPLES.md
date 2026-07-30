# Nexus validation principles

The validation harness is a first-class project subsystem. It exists to prove
that Nexus protects business promises across calculations, persistence,
permissions, lifecycle state, customer artifacts, and provider boundaries. It
is not a convenience environment for feature development.

## Governing principles

1. **Validation proves correctness.** A rendered page or happy path is not
   sufficient. Relevant inputs, calculations, persisted state, audit events,
   artifacts, permissions, and provider effects must agree.
2. **Validation is physically and logically isolated.** It never depends on
   production state, production credentials, or uncontrolled external
   services. Local databases, isolated identities, fake providers, and
   deny-by-default networking are mandatory.
3. **Every run is deterministic and reproducible.** Stable fixture IDs,
   explicit inputs, zero retries, bounded execution, and independently
   understandable outcomes make failures repeatable.
4. **Safety-gate rejection is successful protection.** Refusal caused by a
   missing isolation marker, unsafe database URL, real provider, leaked
   credential, or remote network target means the guard worked. No test ran
   and no product mutation should be inferred.
5. **Failures are diagnosed, never bypassed.** A failing assertion, safety
   gate, or cleanup check must be classified and traced to its root cause.
6. **Assertions change only with evidence.** An exclusion or assertion may be
   narrowed only when trace evidence proves expected browser behavior. Broad
   console, request, or network exclusions are prohibited.
7. **Mutable lifecycle fixtures run with one worker.** Serialization prevents
   independent scenarios from racing over shared quote state. Critical browser
   runs also use zero retries and fail fast.
8. **Cleanup is part of correctness.** A run is incomplete until its owned
   processes, port listeners, fixture rows, database resources, artifacts, and
   temporary files are gone. Ownership must be established before creation or
   reuse; a familiar name or stale PID is not proof.
9. **A run leaves no residue.** The repository must have no tracked changes,
   and the run must leave no process, port, database, Docker container,
   network, volume, artifact, generated build/test directory, or temporary
   environment-file residue.
10. **Scenarios express business promises.** Tests use the lowest sufficient
    layer and explicit expected outcomes. They do not copy production formulas
    into browser code or create a second implementation of business logic.
11. **Evidence is disposable and owned.** Validation PDFs, traces, screenshots,
    logs, and fake-provider JSONL ledgers live beneath one run-owned artifact
    root or a unique external log/PID root. Repository output is removed only
    when a pre-run manifest proves the path was absent. External logs may be
    retained for diagnosis, but never become application state or tracked
    source.

These principles govern all future harness architecture, fixtures, providers,
scenarios, CI behavior, and maintenance. The acceptance checklist is
[merge-gate.md](merge-gate.md); the execution procedure is
[operational-runbook.md](operational-runbook.md).
