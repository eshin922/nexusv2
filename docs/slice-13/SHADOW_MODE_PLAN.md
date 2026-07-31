# Operational shadow-mode plan

## Operating contract

- Business continues operating normally.
- The legacy HubSpot → production NetSuite path remains authoritative.
- Nexus uses NetSuite sandbox credentials only.
- Every in-scope authoritative production transaction is recreated in sandbox
  with a correlation record.
- Nexus does not create, update, or delete production NetSuite data.
- Differences use the classifications in
  [SALES_ORDER_PARITY_PLAN.md](SALES_ORDER_PARITY_PLAN.md).

## Preconditions

- Integration inventory and owners are verified.
- Sandbox account identity and credential restrictions are independently
  proven.
- The parity field universe, evidence handling, transaction correlation, and
  representative cohort are approved.
- Item/customer mappings and Item Group behavior are ready.
- Duplicate processing, rate limiting, sensitive-data handling, and cleanup
  controls are reviewed.

## Transaction procedure

1. Record the authoritative production transaction ID and immutable source
   evidence without altering it.
2. Recreate the same business intent through Nexus against sandbox only.
3. Capture HubSpot source, Nexus persisted/payload evidence, sandbox result,
   timestamps, software version, and correlation ID.
4. Populate the parity matrix and classify every difference.
5. Route blockers to an owner; add a regression test for verified defects.
6. Never “correct” production from shadow mode.

The mechanism that identifies every production transaction is **Requires
manual discovery**; it must prove completeness without adding a production
writer.

## Measures

- Coverage: authoritative transactions paired / in-scope transactions.
- Field completeness: classified required fields / required fields.
- Parity rate excluding approved intentional/environment differences.
- Blocker, mapping-gap, source-gap, and configuration-gap counts and age.
- Duplicate/missed sandbox recreations.
- Nexus attempts to contact production endpoints (target: zero).
- Time from authoritative transaction to classified shadow result.

## Exit criteria

Exit requires an agreed observation window and minimum transaction mix
(**Requires manual discovery**) plus:

- 100% in-scope transaction pairing.
- 100% required fields classified.
- zero `BLOCKER` and zero `UNKNOWN`.
- zero unexplained commercial-total, rate, quantity, customer, item, tax, date,
  or classification differences.
- zero production mutations or production credential use by Nexus.
- completed Item Groups approved as the intended visible change.
- Nexus commercial rates proven independent of `$0.00` catalog placeholders.
- stable results across retries/idempotency and representative transaction
  variants.
- Accounting, Operations, Sales, PM, IT, and product owner approval.

## Failure handling

A production-write attempt, missed transaction, duplicate sandbox transaction,
unexplained commercial difference, or evidence-integrity failure stops the
shadow gate. Legacy production operation continues; the issue is diagnosed and
  retested in sandbox.
