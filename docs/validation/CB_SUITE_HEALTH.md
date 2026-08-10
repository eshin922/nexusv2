# CB Suite Health

**The operational view while Track B is completed.** Updated per run, not on a
schedule.

**Last run:** 2026-08-10 · **Baseline:** **BASELINE-01 — ESTABLISHED**

## Admission criterion

> **A trusted baseline exists only when two consecutive executions from
> identical clean environments produce identical outcomes.**

One criterion, stated once, and nothing else counts as a baseline. Not "mostly
agrees," not "agrees on the failures that matter." **Identical outcomes** —
same passes, same failures, same unmeasured set.

## Sequence

Strictly ordered. Each step is meaningless before the one above it holds.

| | step | status |
|---|---|---|
| 1 | **Deterministic environment** | ✅ Established |
| 2 | **Deterministic harness** | ✅ Established |
| 3 | **Trusted baseline** | ✅ **BASELINE-01** — criterion met |
| 4 | **Scenario classification** | ⏳ **Now unlocked.** Not started |

> **No failure below is classified, and none is discussed as anything.**
> Classification is step 4. Naming a cause before the harness is deterministic
> is how a fabricated failure category gets into a report — this project has
> paid for that once already.

---

## Status at a glance

| | status | evidence |
|---|---|---|
| **Harness** | ✅ Runs end-to-end from governed commands | 22 specs execute; isolation proven per run |
| **Seed** | ✅ **Deterministic** | Two reset→seed cycles, byte-identical counts |
| **Reset** | ⚠️ **Namespace-scoped, not absolute** | Clears its own `runId` world only; foreign-runId rows survive |
| **Clean environment** | ✅ **Reproducible** | `db:reset` → migrate → seed yields absolute counts **equal to** fixture counts |
| **Harness determinism** | ✅ **Established** | Runs A and B agree exactly |
| **Trusted baseline** | ✅ **BASELINE-01** | Two consecutive clean runs, identical outcomes |
| **Classified failures** | **0** | Step 4 not started |
| **Unclassified failures** | **10** | Identical set in runs A and B |
| **Unmeasured (did not run)** | **3** | All in `basic-quote-persistence.spec.ts`, after VAL-101 |

---

## BASELINE-01 — the criterion is met

| run | environment | pass | fail | unmeasured | agrees? |
|---|---|---|---|---|---|
| **A** | clean | **9** | **10** | **3** | — |
| **B** | clean, identical procedure | **9** | **10** | **3** | ✅ **identical** |

Same passes, same failures, same unmeasured set. **BASELINE-01 is the trusted
baseline**, and a delta against it is now a measurement.

**It is a baseline, not a clean bill of health.** Ten scenarios fail in it and
three are unmeasured. What changed is that those numbers now mean something.

### What made the harness deterministic

One assertion was racing a client-side navigation. `lifecycle-surface-consistency`
clicked through to a destination route and asserted on its content immediately;
whether the RSC render beat the 5s expect timeout decided the outcome, so
identical inputs produced different results.

Fixed by waiting for the navigation to **commit** before asserting — at both
client-side transitions the spec deliberately exercises. **The assertion itself
is unchanged.** PB-005 is a claim about not needing a hard reload, not a claim
about how fast a soft navigation streams, so waiting for the URL asserts the
same behaviour deterministically rather than weakening it.

### The three unmeasured scenarios are precisely located

All three live in `basic-quote-persistence.spec.ts` **after** VAL-101, which
fails: **VAL-103** (concurrent debounced cost edits), **VAL-104** (governed
Pricing Vendor without dormant Pricing Date), and **PHASE2 Packaging targets
each SKU**. Serial execution stops the file at its first failure.

They are not passing and not failing. **They are unmeasured** — and VAL-104
carries more weight than the other two: it is REG-1's browser-level evidence,
and REG-1 is the one register gate claiming V1 COMPLETE.

---

## Superseded — why the criterion was not met before

| run | environment | passed | failed | did not run |
|---|---|---|---|---|
| 1 | dirty (residual foreign-runId world) | 7 | 12 | 3 |
| 2 | **clean** (`db:reset` → migrate → seed) | **9** | **10** | 3 |
| 3 | **clean** — identical procedure to run 2 | **8** | **11** | 3 |

**Runs 2 and 3 were produced by the same commands against the same rebuilt
environment and did not agree.** Until they do, no number this suite produces is
evidence, and a delta against it is not a measurement.

Two separate effects are visible, and they are different problems:

**Environment sensitivity (runs 1 → 2).** Two specs — `workspace-governance` and
`lifecycle-surface-consistency` — passed once the environment was rebuilt.
Residual state from a previous `runId` was reaching them. This is now controlled
by rebuilding rather than by fixture reset.

**Non-determinism (runs 2 ↔ 3).** `lifecycle-surface-consistency` **passed in
run 2 and failed in run 3**, on identical inputs. **Resolved** — see
BASELINE-01 above. The other ten failed in both.

## Failure inventory — recorded, not classified

### Stable across both clean runs — 10

| project | spec |
|---|---|
| `lifecycle-serial` | `product-library-create-component` · ASY default |
| `lifecycle-serial` | `product-library-create-component` · PVS-018 catalog states |
| `lifecycle-serial` | `pvs-020-refresh-performance` · responsive/singular/complete |
| `lifecycle-serial` | `pvs-020-refresh-performance` · rollback + retry cursor |
| `costing-serial` | `basic-quote-persistence` · **VAL-101** |
| `costing-serial` | `bulk-pricing-lift` · **VAL-208** |
| `costing-serial` | `costs-reconciliation-ordering` |
| `costing-serial` | `phase-2-component-freight` · worksheet break saves actual freight |
| `costing-serial` | `phase-2-component-freight` · 1/6/10 SKU scales |
| `costing-serial` | `phase-2-component-freight` · nested comparison surface |

**Stable ≠ real.** A stable failure can still be a stale spec. That
determination is classification and has not been made.

### Non-deterministic — 0

`lifecycle-surface-consistency` was the only one. It now passes in both
consecutive clean runs.

### Did not run — 3

Both serial projects abort remaining specs after failures, so three are never
reached. They are neither passing nor failing; they are **unmeasured**, and a
report that counts them as either would be wrong.

## What is already established, and holds

**Seed determinism — proven.** Two `reset` → `seed` cycles produced identical
counts:

```
projects 10 · quotes 10 · tiers 24 · canonical_attachments 44
invalid_identity_mappings 0 · invalid_external_ids 0
freight: 11 subcategories · 22 destinations · 64 breaks · 43 memberships · 52 customs breaks
```

**Clean environment — reproducible.** After `validation:db:reset` (docker volume
destroyed) → `migrate` → `seed`, the **absolute** database counts equal the
fixture counts: 10 projects, 10 quotes, 24 tiers, and nothing else. That
equality is the definition of clean, and it is checkable in one query.

**Reset is namespace-scoped, and that is by design but not sufficient.**
`resetFixtureWorld(runId)` deletes only rows in its own deterministic
namespace — every id is `uuid(runId, …)`. A world seeded under a different
`runId`, and any row a spec created with a random id, survives it. **Fixture
reset is therefore not a clean-environment primitive.** `validation:db:reset`
is. That distinction was what separated run 1 from run 2.

## Known related decision

**OD-011 · order-dependent browser fixture state in
`basic-quote-persistence.spec.ts`** — already open, already recorded, and
consistent with what runs 2 and 3 show. It is not being re-litigated here; it is
named because the next investigator should read it before starting.

## Next step

**Step 4 — scenario classification — is now unlocked.** Steps 1 to 3 hold.

Classification has **not** started, and nothing in this document names a cause
for any of the ten. When it starts, the order that costs least is:

1. **VAL-101 first.** It is the only failure that also hides three unmeasured
   scenarios behind it, so settling it converts four rows rather than one — and
   one of those three is REG-1's browser evidence.
2. The three `phase-2-component-freight` failures next: one file, one surface,
   plausibly one cause.
3. The remainder individually.

Every classification re-runs against BASELINE-01 and amends only the rows it
touches.

## Procedure that produces a comparable run

```powershell
npm.cmd run validation:db:reset      # destroys the volume; rebuilds; migrates
npm.cmd run validation:prove-isolation
npm.cmd run validation:seed
npm.cmd run test:e2e
```

**Not** `validation:fixtures:reset` — that clears one namespace, not the
database, and a run started from it is not comparable to one started from
`db:reset`.

## Run log

| # | date | environment | pass | fail | unmeasured | note |
|---|---|---|---|---|---|---|
| 1 | 2026-08-10 | dirty | 7 | 12 | 3 | Governed seed repaired to make this possible at all |
| 2 | 2026-08-10 | clean | 9 | 10 | 3 | Environment sensitivity resolved |
| 3 | 2026-08-10 | clean | 8 | 11 | 3 | **Disagrees with run 2** — criterion not met |
| A | 2026-08-10 | clean | **9** | **10** | 3 | After the navigation-commit fix |
| B | 2026-08-10 | clean | **9** | **10** | 3 | **Identical to A — BASELINE-01 established** |
