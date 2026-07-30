# Writing tests

- Assign a stable VAL ID and update the registry.
- State visible, persisted, numerical, audit, artifact, provider, and security outcomes.
- Use the lowest sufficient layer; numerical matrices belong in unit tests.
- Use deterministic fixtures and isolated providers.
- Preserve strict diagnostics and deny unexpected traffic.
- Never use `test.skip`, `test.only`, arbitrary sleeps, retries, broad
  exclusions, or unexplained snapshot replacement.
- Every defect fix needs a regression test that fails if reintroduced.
- Update applicable `docs/validation` files in the same diff.

New work must conform to
[VALIDATION_PRINCIPLES.md](VALIDATION_PRINCIPLES.md), register its promise in
[scenario-registry.md](scenario-registry.md), and pass
[merge-gate.md](merge-gate.md). Do not copy operational command sequences into
test-writing guidance.

Browser runs use one worker, zero retries, fail-fast, an explicit server, hard
process ceilings, and durable untracked logs.

To add or update a scenario, define the business promise and every registry
field first, select the lowest sufficient layer, extend only deterministic
fixtures/providers required by the promise, and prove persisted, audit,
artifact, provider, network, and permission outcomes that apply. Retiring a
test requires registry rationale and equivalent coverage mapping.
