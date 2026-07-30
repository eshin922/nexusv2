# CI/CD

CI runs server-free tests before browser jobs. Browser jobs use isolated
database/providers, one worker for critical lifecycles, zero retries, fail-fast,
and bounded execution. Logs/traces may be uploaded but never committed.

The sole merge-acceptance checklist is [merge-gate.md](merge-gate.md). CI must
implement that checklist using the exact supported procedure in
[operational-runbook.md](operational-runbook.md); this document does not define
a competing list. Validation never authorizes deployment or regeneration of
immutable sent artifacts.

Required critical-scenario failure blocks merge and deployment promotion.
Retries are zero so deterministic failures remain visible. CI publishes
stdout/stderr, traces, and screenshots for diagnosis while excluding fixture
credentials and provider ledgers containing sensitive production-shaped data.
Harness and business-domain owners review gate changes.

Current `playwright.config.ts` selects one retry when `CI` is set. The
authoritative commands therefore pass `--retries=0` explicitly. Reconciliation
of that configuration default is a separate runtime-policy change, not part of
this documentation follow-up.
