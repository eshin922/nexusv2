# CB Suite Health

**The operational view while Track B is completed.** Updated per run, not on a
schedule.

**Last run:** 2026-08-10 · **Baseline:** **NOT ESTABLISHED**

> **No failure below is classified.** Classification into regression /
> implementation defect / specification issue is deferred until a trusted
> baseline exists. Naming a cause before the harness is trustworthy is how a
> fabricated failure category gets into a report — this project has paid for
> that once already.

---

## Status at a glance

| | status | evidence |
|---|---|---|
| **Harness** | ✅ Runs end-to-end from governed commands | 22 specs execute; isolation proven per run |
| **Seed** | ✅ **Deterministic** | Two reset→seed cycles, byte-identical counts |
| **Reset** | ⚠️ **Namespace-scoped, not absolute** | Clears its own `runId` world only; foreign-runId rows survive |
| **Clean environment** | ✅ **Reproducible** | `db:reset` → migrate → seed yields absolute counts **equal to** fixture counts |
| **Green baseline** | ❌ **Not established** | Two identical clean runs **disagree** |
| **Classified failures** | **0** — by instruction | — |
| **Unclassified failures** | **10 stable · 1 non-deterministic** | Both clean runs |
| **Blocked / did not run** | **3** | Serial-project abort after failures |

---

## The blocking finding: two identical clean runs disagree

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
run 2 and failed in run 3**, on identical inputs. That is the one that blocks the
baseline. The other ten failed in both.

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

### Non-deterministic — 1

`lifecycle-serial › lifecycle-surface-consistency` — PB-001/PB-005 completion
updates canonical status and activity surfaces. **Passed run 2, failed run 3.**

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

**One thing, in order:**

1. **Make `lifecycle-surface-consistency` deterministic.** It is the single
   scenario preventing a baseline. Everything else can be counted once it is
   settled.
2. Re-run twice from `db:reset` and require the two runs to agree **exactly** —
   same passes, same failures, same unmeasured set.
3. **Only then** classify. Until step 2 agrees, classification would be applied
   to a number that moves.

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
| 3 | 2026-08-10 | clean | 8 | 11 | 3 | **Disagrees with run 2** — baseline blocked |
