# Regression policy

A feature is protected only when relevant inputs, calculations, persistence,
permissions, side effects, artifacts, and failure states are covered at proper
layers. Every confirmed defect receives a permanent regression test. Critical
tests must fail when protected behavior is intentionally broken.

Assertions change only with evidence. Skips, retries, sleeps, broad exclusions,
and unexplained snapshot replacement are prohibited. Sent snapshots and PDFs
are historical records: inspect them, never update or regenerate them.

Per-cell autosave returns a canonical receipt to the local store and relies on
realtime for other sessions. It must not refresh the quote tree and remount
sibling inputs while their debounced saves are pending.

VAL-103 protects the save-loss defect: the former per-cell
`revalidateQuoteTree()` remounted the production drawer after the first save,
canceling a sibling cell's pending debounce. Autosave patches only its named
field, returns database-canonical values, and writes one canonical audit diff.
The editing session reconciles from receipts; other production sessions use
realtime.

Obsolete tests may be retired only after their unique valid promises move to
the registered suite. Record replacement files and rationale in the same
change; never delete a failing verifier merely to make a gate green.
