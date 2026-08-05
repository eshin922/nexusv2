# Nexus v2 — DPS Quoting Tool

Internal quoting tool for The DPS. Replaces the Excel cost worksheets with a
governed quote lifecycle: Setup → Costs → Pricing → Quote, terminating in a
NetSuite Sales Order.

---

## Start here

**If you are new to this repository, read these four documents in order.** They
are designed to make the repository self-sufficient — you should be able to
reach the project's architectural conclusions from them alone, without any
conversation history.

| Order | Document | Answers |
|---|---|---|
| 1 | [`docs/NEXUS_IMPLEMENTATION_STANDARD.md`](docs/NEXUS_IMPLEMENTATION_STANDARD.md) | How work is done here. The governing principle, the eight gates, the five-tier precedence model, and what to do when authorities conflict |
| 2 | [`docs/AUTHORITY_MAP.md`](docs/AUTHORITY_MAP.md) | Which document governs what, **right now**. Every document classified governing / superseded / historical / informational |
| 3 | [`docs/AUTHORITY_TIMELINE.md`](docs/AUTHORITY_TIMELINE.md) | Why the project is organised as it is, what each change replaced, and what would justify changing it again |
| 4 | [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) | What is **not** decided, who decides it, and what evidence would settle it |

Keep [`docs/GLOSSARY.md`](docs/GLOSSARY.md) open alongside them — the repository
uses vocabulary (`CA`, `CC`, `CD`, `LEAF`, `ASY`, `pin`, `Slice 13`) that is not
decodable from context.

The single most load-bearing sentence in the project:

> **Nexus records what the operator determined. It does not recreate the
> operator's reasoning.**

---

## Current state

Work is organised into **four independently deployable phases**, not the
numbered slice sequence used until 2026-07. Where you find slice numbering or a
"v1 release path" in older documents, it is historical.

| Phase | Scope | Status |
|---|---|---|
| **1 · Quote Commercial Integrity** | Immutable commercial pins; a sent quote means what it meant when sent | **Frozen and shipped** |
| **2 · Costs Workspace** | Every cost entry point on one page; worksheet-driven Freight | **In progress** — freight persistence accepted; design fidelity open |
| **3 · Pricing Workspace** | Compliance grid, progressive traceability, staged adjustment | Not started — blocked on Phase 2 operator acceptance |
| **4 · Margin Approval** | Governed below-floor exception | Not started — blocked on Phase 3 and a BV-005 amendment |

Authority per phase, the dependency graph, and per-phase reversibility:
[`CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md).

Production launch readiness is tracked separately from implementation:
[`docs/slice-13/GO_LIVE_READINESS_CHECKLIST.md`](docs/slice-13/GO_LIVE_READINESS_CHECKLIST.md).

---

## Business authority

Business requirements are settled **before** implementation, in
[`docs/business-validation/`](docs/business-validation/). A technical capability
is not authorization to change a business rule.

> A field being technically writable does not establish Nexus ownership.
> — [`docs/architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md`](docs/architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md)

One known defect: **BV-009 is cited as authority in eleven places, including
production code, and has never existed.** A reconstruction from citations —
unratified — is at
[`docs/business-validation/BV-009-freight-treatment.md`](docs/business-validation/BV-009-freight-treatment.md).

---

## Design authority

Where authoritative implementation artifacts exist — JSX, CSS, component
hierarchy — **they are executable specification, not reference material.**

> **Assemble. Do not reinterpret.**
> Never implement from screenshots or prose. Screenshot comparison is the final
> acceptance step, not the implementation strategy.

Registered bundles, checksums, approved deviations and supersession history:
[`docs/design-authority/MANIFEST.md`](docs/design-authority/MANIFEST.md).

---

## Validation subsystem

The isolated validation harness is a first-class project subsystem and is
required before merge for changes to protected quote behavior. The sole
acceptance checklist is
[`docs/validation/merge-gate.md`](docs/validation/merge-gate.md); the
authoritative execution procedure is
[`docs/validation/operational-runbook.md`](docs/validation/operational-runbook.md).
Core documentation intentionally does not duplicate those instructions.

---

## Verification scripts

DB-level and source-level invariant checkers in `scripts/verify/`. Each is a
self-contained Node script reporting PASS / FAIL per assertion. They are the
executable form of invariants that TypeScript cannot express.

Seven run automatically on `npm run prebuild`:

```
verify:boundaries                  customer-view import boundary
verify:react-pdf-containment       react-pdf bundle containment
verify:font-register-coverage      StyleSheet variants vs Font.register
verify:autosave-focus-stability    Pattern 47 — disabled={...pending} on inputs
verify:complete-status-writer      completion status write path
verify:pricing-classifier-invariants
test:netsuite-adapter
```

Others run on demand against a database:

```bash
node --env-file=.env.local --experimental-strip-types scripts/verify/<script>.ts
```

| Script | When to run |
| --- | --- |
| `firm-settings-invariant.ts` | After any change to `updateFirmSettings`, after `firm_settings` migrations, or when debugging "wrong margin threshold" reports |
| `audit-log.ts` | After any `audit_log` schema change, after any change to admin action audit shape, or when investigating missing/duplicate audit rows |
| `realtime-readiness.ts` | When realtime events stop arriving for a table — checks publication membership and RLS state |

When a new admin entity ships, extend `audit-log.ts`'s
`WHERE entity_type IN (...)` clause to cover it.

---

## Environment

Two constraints that cause real incidents if forgotten. Both are documented in
full in [`CLAUDE.md`](CLAUDE.md).

- **Dev and production share one Supabase project.** A migration applied
  locally applies to production. Treat every DB or Supabase-config change as a
  production change.
- **Both environments use the session-mode pooler (`:5432`).** Transaction mode
  (`:6543`) has a response-correlation race that hangs one query out of a
  parallel burst indefinitely.
