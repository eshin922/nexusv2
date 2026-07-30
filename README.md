# Nexus v2 — DPS Quoting Tool

## Validation subsystem

The isolated validation harness is a first-class project subsystem and is
required before merge for changes to protected quote behavior. The sole
acceptance checklist is
[`docs/validation/merge-gate.md`](docs/validation/merge-gate.md); the
authoritative execution procedure is
[`docs/validation/operational-runbook.md`](docs/validation/operational-runbook.md).
Core documentation intentionally does not duplicate those instructions.

Slice 12 implementation and code validation are complete; the documentation
handover records the current state and transition in
[`docs/validation/slice-12-handover.md`](docs/validation/slice-12-handover.md).
Before new Slice 13 feature work, complete field-level Sales Order lineage and
behavioral-parity analysis across HubSpot → Nexus → NetSuite sandbox.

## Verification scripts

DB-level invariant checkers in `scripts/verify/`. Each is a self-contained
Node script that connects to `DATABASE_URL` and reports PASS / FAIL per
assertion. Run when the linked condition applies; they're cheap (~1s) and
the executable form of the smoke test plan.

```bash
node --env-file=.env.local --experimental-strip-types scripts/verify/<script>.ts
```

| Script | When to run |
| --- | --- |
| `firm-settings-invariant.ts` | After any change to `updateFirmSettings`, after `firm_settings` schema migrations, or when debugging "wrong margin status threshold" reports (verifies single-current row + no overlapping ranges). |
| `audit-log.ts` | After any `audit_log` schema change, after any change to admin action audit shape, or when investigating "missing/duplicate audit row" reports (verifies per-action shape, no double-logs within 1s, no revert pairs). |

These scripts are the seed of Slice 8.6 (smoke-test automation). Don't
delete them — when the next admin entity ships, extend `audit-log.ts`'s
`WHERE entity_type IN (...)` clause to cover it.
