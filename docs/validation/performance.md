# Performance

Use the fastest relevant layer first. Keep fixtures small and deterministic.
Record browser/lifecycle wall runtime. Never improve runtime by weakening
assertions, adding retries, sharing mutable fixtures, or hiding diagnostics.
Explicit servers separate test runtime from Windows teardown behavior.

Record test-body and total wall runtime for critical browser scenarios. Current
reference observations on the reconstruction branch are: quote deep links
12.7 seconds total, VAL-601 3.9 seconds total, and VAL-101 10.1 seconds total.
Treat sustained material regression as a diagnostic signal, not a reason to
raise timeouts automatically. The 90-second per-test ceiling is a deadlock
guard, not a performance target.
