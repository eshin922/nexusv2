# Maintenance

For fixture, provider, configuration, or scenario changes:

1. Identify affected promises and registry entries.
2. Update fixture validation before browser behavior.
3. Run server-free tests first, then affected browser/lifecycle scenarios.
4. Inspect artifacts and fake-provider ledgers.
5. Run `git diff --check` and inspect tracked files for secrets or outputs.
6. Update this documentation in the same change.

Never mutate shared development/production data. Fixture reset is allowed only
against a runtime-safety-validated local database. Ledgers and artifacts remain
beneath the validation artifact root.

Fixture validation counts deterministic local record IDs, not display labels or
provider-ID prefixes. Fake HubSpot object IDs remain numeric so validation
exercises the real linkage predicate.

Reset removes deterministic records plus every random-ID audit row associated
with fixture quote IDs. This prevents stale artifact references from surviving
quote deletion in the non-FK `audit_log` table.

After schema or action-receipt changes, update fixture types, seed validation,
browser persistence assertions, and audit assertions together. Per-cell
autosave stays receipt-driven in the editing session and realtime-driven for
other production sessions; do not restore quote-tree revalidation as its
synchronization mechanism.

Test ownership follows production ownership: costing maintainers review
formula/action tests, workflow owners review browser scenarios, and integration
owners review fake-provider ledgers. Deprecate a scenario only when its promise
is obsolete or protected elsewhere; update the registry with its replacement
and remove test/documentation in one reviewable change.
