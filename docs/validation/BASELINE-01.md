# BASELINE-01 — immutable CB suite reference

**Established:** 2026-08-10 · **Status: IMMUTABLE.**

**This document is not updated when a scenario is fixed.** A baseline that moves
when its subject moves measures nothing. When the suite changes intentionally —
specs added, fixtures reshaped, the world redefined — a **new** baseline is
established alongside this one, and this one stays exactly as written.

> **BASELINE-01 measures. Classification explains.**
> No cause, diagnosis or judgement appears in this document. Not now, and not
> later. Explanation lives in the classification records; if it creeps back in
> here, the baseline stops being a measurement.

---

## Admission criterion satisfied

> A trusted baseline exists only when two consecutive executions from identical
> clean environments produce identical outcomes.

| run | environment | pass | fail | unmeasured |
|---|---|---|---|---|
| A | clean | 9 | 10 | 3 |
| B | clean, identical procedure | 9 | 10 | 3 |

Identical. Same passes, same failures, same unmeasured set.

## Pinned revisions

Everything that determines the outcome, fixed at the values that produced it.

| | revision |
|---|---|
| **Implementation commit** | **`4f3110bcf343ce89b0f6186711174a8d765bf528`** |
| **Fixture revision** | `tests/harness/fixtures/world.ts` — blob `4eca785`, 935 lines |
| **Seed revision** | `scripts/validation/fixtures.ts` — blob `8a0004c`, 220 lines |
| **Harness revision** | `tests/harness/global-setup.ts` — blob `c9d2160`, 47 lines |
| | `playwright.config.ts` — blob `891fd4e`, 53 lines |
| | `tests/e2e/` tree digest — `2d6e52f71929` |
| **Environment revision** | `docker-compose.validation.yml` — blob `78d74ed`; Postgres 16.14 on `127.0.0.1:55432` |
| **Schema revision** | 64 migrations on disk; 62 applied; `schema-ready` asserted |

A run whose revisions differ from these is **not** comparable to BASELINE-01.
That is the point of pinning them: a green run against a different fixture
revision is a different measurement wearing the same number.

## Expected outcome

**22 scenarios. 9 pass · 10 fail · 3 unmeasured.**

### Pass — 9

| project | scenario |
|---|---|
| `read-only` | `quote-deep-links` — draft deep link renders without browser failures |
| `read-only` | `quote-deep-links` — sent |
| `read-only` | `quote-deep-links` — accepted |
| `read-only` | `quote-deep-links` — complete |
| `read-only` | `quote-deep-links` — failed |
| `lifecycle-serial` | `lifecycle-surface-consistency` — PB-001/PB-005 completion updates canonical status and activity surfaces |
| `lifecycle-serial` | `primary-send-lifecycle` — draft Preview to Send to Client to Client Review |
| `lifecycle-serial` | `workspace-governance` — governed quote, owner, stage and creation language |
| `lifecycle-serial` | `workspace-governance` — PVS-017 Organizer excludes dropped history |

### Fail — 10

| project | scenario |
|---|---|
| `lifecycle-serial` | `product-library-create-component` — hierarchy preserves the approved ASY default |
| `lifecycle-serial` | `product-library-create-component` — PVS-018 creation through every catalog state |
| `lifecycle-serial` | `pvs-020-refresh-performance` — production-shaped refresh is responsive, singular, complete |
| `lifecycle-serial` | `pvs-020-refresh-performance` — failed mutation rolls back its batch and exposes a retry cursor |
| `costing-serial` | `basic-quote-persistence` — **VAL-101** creates and persists basic production pricing inputs |
| `costing-serial` | `bulk-pricing-lift` — **VAL-208** previews, applies and exactly undoes a bulk pricing lift |
| `costing-serial` | `costs-reconciliation-ordering` — rapid Packaging multi-cell entry survives reconciliation |
| `costing-serial` | `phase-2-component-freight` — selected worksheet break saves actual freight and derives billable per unit |
| `costing-serial` | `phase-2-component-freight` — unified Costs Workspace renders at 1, 6 and 10 SKU scales |
| `costing-serial` | `phase-2-component-freight` — worksheet matches the source-authoritative nested comparison surface |

### Unmeasured — 3

Serial execution stops a file at its first failure, so these are never reached.
**They are neither passing nor failing**, and a report counting them as either
is wrong.

| project | scenario |
|---|---|
| `costing-serial` | `basic-quote-persistence` — **VAL-103** concurrent debounced cost edits persist without save loss |
| `costing-serial` | `basic-quote-persistence` — **VAL-104** governed Pricing Vendor persists without exposing dormant Pricing Date |
| `costing-serial` | `basic-quote-persistence` — PHASE2 Packaging targets each SKU and omits the Bulk Raw surface |

All three follow VAL-101 in one file.

## Procedure that produces a comparable run

```powershell
npm.cmd run validation:db:reset      # destroys the volume; rebuilds; migrates
npm.cmd run validation:prove-isolation
npm.cmd run validation:seed
npm.cmd run test:e2e
```

**Not** `validation:fixtures:reset` — that clears one `runId` namespace, not the
database. A run started from it is not comparable to BASELINE-01.

Expected seed counts, which are part of the measurement:

```
projects 10 · quotes 10 · tiers 24 · canonical_attachments 44
invalid_identity_mappings 0 · invalid_external_ids 0
freight: 11 subcategories · 22 destinations · 64 breaks · 43 memberships · 52 customs breaks
```

## How future runs use this

**Compare against BASELINE-01, never against the previous run.** Comparing to
the previous run makes drift invisible: each step looks small, and the distance
travelled is never measured.

- Scenario moves fail → pass: **an improvement against BASELINE-01.** Recorded
  in the classification record. **BASELINE-01 is not edited.**
- Scenario moves pass → fail: **a change against BASELINE-01**, and the most
  important signal this system produces.
- Unmeasured becomes measured: recorded as such. It was never a pass.

## When a successor baseline is created

**Only when the suite intentionally changes** — specs added or removed, fixture
world reshaped, seed contract changed, environment revised.

Not when a scenario is fixed. Not when a failure is explained. Not to make the
numbers look current.

A successor is `BASELINE-02`, established by the same admission criterion,
recorded in its own document, and citing which pinned revision changed and why.
BASELINE-01 remains readable and correct for its moment.
