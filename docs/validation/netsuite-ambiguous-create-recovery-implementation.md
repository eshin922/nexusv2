# Ambiguous-CREATE recovery — implementation record

Steps 2 and 3 implemented. **1025/1025 unit tests, `tsc --noEmit` clean**, both
run after the final edit.

Order B (DPS-1048) untouched and **not used to test the recovery path**: still
Accepted · `turnkey_only` · $3,500 · `netsuite_so_id = NULL`.

---

## What changed

| File | Change |
|---|---|
| `create-reconciliation-rules.ts` | **new** · pure decisions: `evaluateAdoptionCandidate`, `decideReconciliation` |
| `create-reconciliation.ts` | **new** · provider query by `custbody_dps_deal_id` + structure read-back |
| `attempt-lifecycle-rules.ts` | `needs_reconciliation` status; `mustNotCreate` widened |
| `attempt-lifecycle.ts` | `recordNeedsReconciliation` writer |
| `errors.ts` | `duplicate_deal` class + `isDuplicateDealDetail`; blocking, never retryable |
| `mark-complete.ts` | pre-CREATE reconciliation gate; `DUPLICATED DEAL` branch |

The pure/impure split mirrors `attempt-lifecycle{,-rules}.ts`, so every decision
is testable without a database or a network.

---

## The rule

> Once an external Sales Order **may** exist, the attempt must not enter a state
> that permits a fresh CREATE until provider reconciliation has established
> whether it does.

Encoded as a widening of `mustNotCreate` from a test of **knowledge** to a test
of **possibility**:

```ts
mustNotCreate = netsuiteSoId !== null || status === "needs_reconciliation"
```

Case 2 is the one the id-presence-only rule could not express, and it is the
live defect: a CREATE that committed and lost its response leaves no id to key
on. This **supplements** the existing invariant (`netsuite_so_id` non-null ⇒
never `failed`), which is unchanged.

---

## Pre-CREATE reconciliation (Step 2)

Runs only for an **inherited** attempt at `pending + netsuite_so_id = NULL`. A
row inserted during the current invocation has provably not been POSTed and is
excluded — only `durableAttempt` reaches the gate.

Queries `custbody_dps_deal_id`, **status deliberately unfiltered** (SO2624 is
`Closed` and still blocks, so a status filter could report zero while the
provider refuses).

| candidates | outcome |
|---|---|
| 0 | `create` — positive evidence of absence |
| 1 | candidate only; adopted **only** if verification passes |
| >1 | `fail_closed` |

On adoption the attempt rejoins the lifecycle through the **same
`recordSalesOrderCreated` recovery boundary** a fresh CREATE uses → `awaiting_rates`
→ existing convergence loop → **unweakened** final gate. No CREATE is issued.

### What adoption asserts — and deliberately does not

Asserts: transaction type, governed deal id, customer, group count, no ungrouped
members, Item Group membership and quantities per group.

**Does not assert rates or total.** A response can be lost immediately after the
bare grouped CREATE, when the order legitimately carries item-derived default
rates and therefore *not* the accepted commercial total. Requiring either would
refuse adoption in exactly the case adoption exists to serve, stranding the order
it was meant to recover.

Commercial correctness is **relocated, not waived**: an adopted order must still
pass `evaluateSuccessGate` before `succeeded`. Adoption answers *"is this the
intended order?"*; the final gate answers *"is it commercially correct?"*
Regression 14 asserts that separation directly — it adopts an order whose rates
are `$0` and then asserts the economics are still wrong and convergence still
owed.

Structure comparison **reuses `matchGroupMembership`** rather than re-deriving
it, so the request-vs-provider representation gap (request sends Group lines;
the provider expands Group → members → EndGroup) is interpreted by the one
implementation already certified for it. Raw JSON equality is never used. Group
identity is asserted through membership because `PlannedGroup` carries a
composition hash and external id, not a NetSuite item id — the same route
`evaluateSuccessGate` takes.

### Flat orders

A flat/itemized order offers no grouped structure to correlate against, so
adoption is **refused** rather than granted on deal + customer alone.
Reconciliation still runs, so the duplicate CREATE is still prevented; the
outcome is fail-closed with the order's id in hand, which is strictly better
than today's silent orphan. Grouped adoption is the certified path.

---

## `DUPLICATED DEAL` (Step 3)

Detected by the UserEvent's own marker, **not** by status code — the status is
shared with every other 4xx and cannot carry the meaning — and tested *before*
the generic validation fallthrough.

| provider state | outcome |
|---|---|
| one verified candidate | adopt and resume |
| zero candidates | **contradiction** — fail closed, never create |
| multiple candidates | fail closed |
| one candidate failing verification | fail closed |

Every refusal writes `needs_reconciliation`, which **retains snapshot
ownership** (`ownsSnapshot` excludes only `failed + validation`) and satisfies
`mustNotCreate`. Ownership is never released on the basis of an HTTP 400.

---

## Regression 12 — ordinary validation is untouched

`isDuplicateDealDetail` is deliberately narrow (`/duplicated\s+deal/i`).
Everything else that was `validation` remains `validation`, and
`failed + validation` remains terminal and releasable exactly as migration 0065
governs — that release is what lets a repaired payload be re-elected. The change
narrows which responses *reach* the classification; it does not change what the
classification does.

---

## Regressions

`tests/unit/netsuite-ambiguous-create-recovery.test.ts` — 20 tests covering all
14 required cases plus flat-order refusal, single-candidate-never-on-count, and
wrong transaction type.

**The falsification** reconstructs the historical sequence — CREATE commits →
response lost → retry → `DUPLICATED DEAL` → `failed/validation` → ownership
released → orphan — and asserts it unreachable by either route (adopted, or
parked while still owning the snapshot). It asserts on **CREATE suppression and
snapshot ownership**, not merely final status, because a status-only assertion
would pass against an implementation that still emitted a second CREATE before
settling.

**Mutation-checked.** Reverting the `duplicate_deal` classification and
`mustNotCreate` widening fails 3 tests including the falsification; restoring
passes 20/20.

One pre-existing test needed updating: `grouped-so-recovery-core.test.ts` #5
pinned the *literal* old expression `return attempt.netsuiteSoId !== null;`. The
invariant it protects still holds and is now stronger, so it was rewritten to
assert behaviour — including the new `needs_reconciliation` case — rather than
source text.

---

## Not done, deliberately

- **`custbody_nxs_idempotency_key` is NOT a prerequisite** and is not assumed to
  exist. Recorded separately as an integration improvement: if the NetSuite
  administrator creates it, writing the deterministic attempt key onto the Sales
  Order would make adoption an **identity match** rather than a correlation, and
  would retire this ambiguity class. Do not depend on it until created and
  verified.
- **`X-NetSuite-Idempotency-Key` remains in the code and carries no safety
  claim.** It is measured not to be honoured by this account. Whether to retain
  the inert header for observability is a separate decision; it must not appear
  in any safety argument.

---

## Still open before Complete

The implementation and its regressions are green. What has **not** been done is
an end-to-end exercise of the recovery against a live provider — the pure rules
and the classifier are proven, the wiring is typechecked and reviewed but not
walked. That, and authorization, are what stand between here and Completing the
Accounting artifact.

**Do not Complete DPS-1048 without returning for authorization.**
