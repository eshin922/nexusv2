# Slice 12 validation harness handover

## Purpose and current state

The validation harness is the isolated regression subsystem for Nexus quote
construction, costing, persistence, lifecycle, customer artifacts, permissions,
and external-provider boundaries. Slice 12 implementation and code validation
are complete. PR #161 merged the reconstructed harness and costing hardening
into `main`; this documentation follow-up closes the durability and operational
handover gap identified after that merge.

The verified merge state included:

- TypeScript, prebuild, 31 registered unit tests, and the legacy costing
  verifier passing.
- Isolation proof, 47-migration/schema verification, deterministic fixture
  validation, and clean teardown.
- Quote deep links: five lifecycle states passing.
- VAL-101: basic production-pricing persistence passing.
- VAL-103: concurrent debounced cost edits persist without save loss.
- VAL-601: Preview → Send → Client Review with sent state, review event,
  immutable snapshot, local PDF, and fake HubSpot ledger.
- `git diff --check` and final clean working tree passing.

## Architecture and ownership

The harness uses isolated authentication, database, realtime composition,
artifact storage, fake HubSpot/NetSuite providers, loopback-only networking,
deterministic fixtures, and strict browser diagnostics. See
[architecture.md](architecture.md) and ADRs 008–012.

Costing owners review formulas and action contracts; lifecycle owners review
state, snapshots, and artifacts; integration owners review provider ledgers;
CI/harness maintainers review isolation, execution, and cleanup changes. The
owner of each protected business promise and a harness maintainer approve gate
changes.

## Known risks and remaining gaps

- VAL-102 still needs action/browser coverage for invalid numeric input.
- VAL-202 needs customer-projection and artifact coverage.
- VAL-203–VAL-207 retain the statuses recorded in the
  [scenario registry](scenario-registry.md).
- Windows-owned Next teardown can outlive the wrapper unless the complete owned
  process tree is stopped after PID, creation-time, command-line, and run-ID
  verification.
- Database/fixture CLI wrappers require the caller's validation environment;
  they do not load `.env.validation.local` themselves.
- Compose identity can differ across worktrees and must be verified explicitly.
- Generated directories require absence-before-run ownership manifests; an
  existing path is never deleted by validation.
- Every run requires a unique external log/PID root that is retained as durable
  evidence and never reused.
- Playwright currently selects one retry under `CI`; authoritative merge-gate
  commands override this with `--retries=0`.

These limitations do not invalidate the verified Slice 12 harness, but they
must remain visible until resolved.

## Explicit non-goals

- Using validation as a general development database.
- Exercising production credentials, state, or uncontrolled providers.
- Literal production-versus-sandbox byte identity.
- Recreating costing formulas in browser expectations.
- Operational actuals reconciliation or mutation of sent artifacts.
- Broadening exclusions, adding retries, or parallelizing mutable fixtures for
  speed.

## Slice 13 entry requirement

Before new Slice 13 feature work, complete Sales Order data lineage and
behavioral-parity analysis across:

`HubSpot → Nexus → NetSuite sandbox`

For every accounting-relevant Sales Order field, trace its source,
transformation, destination, and observed result, then classify it:

- `PARITY`
- `INTENTIONAL CHANGE`
- `ENVIRONMENT DIFFERENCE`
- `SOURCE DATA GAP`
- `MAPPING GAP`
- `NETSUITE CONFIG GAP`
- `UNKNOWN / BLOCKER`

Literal production-versus-sandbox identity is not required where environments
legitimately differ. Every difference must still be traced to its root source.
Completed Item Groups are the only intended Accounting-visible behavioral
change. All other relevant Sales Order data must remain commercially and
operationally equivalent or have a documented environment distinction.

The Item Group path requires valid item-level pricing. A `$0.00` upstream
catalog price is sufficient to satisfy NetSuite validation, but it is only a
technical placeholder and must never become the commercial transaction price.

Approved follow-on work is the lineage/parity inventory, evidence capture,
classification, blocker disposition, and permanent regression coverage for
confirmed contracts. New Slice 13 product features wait until that gate is
complete.

## Definition of done for future validation additions

A validation addition is done only when its business promise is registered,
the lowest sufficient test layer protects it, fixtures/providers remain
deterministic, strict diagnostics remain active, relevant documentation changes
in the same review, the [merge gate](merge-gate.md) passes, and cleanup leaves
no residue.
