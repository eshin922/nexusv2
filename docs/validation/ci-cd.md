# CI/CD

CI runs server-free tests before browser jobs. Browser jobs use isolated
database/providers, one worker for critical lifecycles, zero retries, fail-fast,
and bounded execution. Logs/traces may be uploaded but never committed.

Integrity gates: no skips/only/sleeps; no real provider or remote traffic;
fixture validation; strict diagnostics; `git diff --check`; and updated
scenario documentation. Validation never authorizes deployment or regeneration
of immutable sent artifacts.

Required critical-scenario failure blocks merge and deployment promotion.
Retries are zero so deterministic failures remain visible. CI publishes
stdout/stderr, traces, and screenshots for diagnosis while excluding fixture
credentials and provider ledgers containing sensitive production-shaped data.
Harness and business-domain owners review gate changes.
