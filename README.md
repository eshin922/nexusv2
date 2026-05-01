# Nexus v2 — DPS Quoting Tool

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
