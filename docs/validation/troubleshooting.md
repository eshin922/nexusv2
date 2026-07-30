# Troubleshooting

Runtime safety failures mean a URL is not loopback, the database lacks its
validation marker, production mode is active, or a provider is not isolated.

Unexpected outbound requests are failures. Capture URL and initiator; exclude
only when trace evidence proves a specific expected browser cancellation.

On Windows, Playwright's owned Next server may hang after a passing test. This
is runner teardown, not a product failure. Use an explicit server, terminate
only its process tree, and retain logs outside tracked paths.

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
