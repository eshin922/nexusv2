# Grouped-SO push — durable recovery contract

**2026-08-12 · design only · nothing implemented · SO2701 untouched**

Required before the API-driven Item Group path is built. The dangerous state is:

> **Sales Order created → groups expanded → member-rate PATCHes incomplete.**

A real SO exists, members may still sit at `$0.00`, the duplicate-deal
SuiteScript forbids a second CREATE, and a final assertion alone protects
nothing because a crash can precede it.

## Verdict — `netsuite_so_pushes` represents this cleanly, with no migration

`status` is a plain `text` column with **no CHECK constraint**
(`schema.ts:3048`), so a new value needs no DDL. The two properties that make
this work already exist, and both fall out of the lifecycle repair shipped in
`0065`:

```sql
-- netsuite_so_pushes_snapshot_attempt_unique_idx
quote_snapshot_id IS NOT NULL
  AND NOT (status = 'failed' AND error_class = 'validation')
```

A new status **`awaiting_rates`**:

1. **Satisfies the unique index** → the row keeps owning the snapshot → **no
   second attempt row can be inserted → no second CREATE is structurally
   possible.**
2. **Is elected by the durable-payload selector** (same predicate) → a retry
   replays the *same frozen payload*, sees `netsuite_so_id` populated, and
   branches to resume instead of create.

No parallel authority, no new table, no new index. The state is expressed by
`(status, netsuite_so_id)` — which the row already carries.

## State transitions

| # | state | `status` | `netsuite_so_id` | meaning |
|---|---|---|---|---|
| 0 | frozen | `pending` | `NULL` | plan + payload durable; group identities known; **nothing sent** |
| 1 | in flight | `pending` | `NULL` | POST issued, outcome unknown (response-loss window) |
| 2 | **created, incomplete** | **`awaiting_rates`** | **set** | **SO exists. Members may be `$0.00`. NOT commercially complete.** |
| 3 | verified | `succeeded` | set | every assertion passed |
| 4 | terminal pre-CREATE | `failed` | `NULL` | rejected before any SO existed |

**The load-bearing invariant:**

> **Once `netsuite_so_id` is non-null, the row may NEVER transition to
> `failed`.**

Any post-CREATE error — PATCH failure, read-back failure, verification failure —
lands in **`awaiting_rates`**, retaining the SO id, with the reason in
`error_detail`.

**Why this is not stylistic.** If a post-CREATE PATCH threw a `validation`
error and the existing handler set `failed` + `error_class='validation'`, the
row would be **excluded** from both the index and the selector. A retry would
then insert a *new* attempt row and attempt a *second* CREATE — caught by the
duplicate-deal SuiteScript (fail-closed), but surfacing as `DUPLICATED DEAL`
with the real SO id orphaned. The invariant prevents a correct-looking retry
path from becoming a duplicate-order path.

## Sequence, with the durability points marked

```
[0] freeze plan + payload + group identities        status=pending
     |
[1]  findOrCreateItemGroup per planned group        (idempotent: cache -> extId -> create)
     |
[2]  POST SO with GROUP LINES ONLY                  <- never group + explicit members
     |
[3]  *** PERSIST netsuite_so_id + tranid FIRST ***  status=awaiting_rates
     |                                                 ^ before any PATCH
[4]  SuiteQL transactionLine read-back               <- NOT expandSubResources
     |
[5]  for each planned member: PATCH /item/{lineIdx}  <- single-line only
     |
[6]  SuiteQL read-back + full verification
     |
[7]  all assertions pass ------------------------->  status=succeeded
     any assertion fails ----------------------->    status=awaiting_rates (SO id retained)
```

Step 3 is the recovery boundary. Everything after it is resumable; nothing
before it can strand an SO the row doesn't know about.

## Resume semantics

On any invocation where the elected attempt has `netsuite_so_id` set:

1. **Do not CREATE.** Not conditionally — the branch is taken on id presence.
2. Read the existing SO's lines via SuiteQL `transactionLine`.
3. Diff observed member rates against the **frozen plan**.
4. PATCH **only** members whose rate differs from plan.
5. Re-verify in full.

**Idempotency is by convergence, not by key.** `PATCH {rate: X}` against a line
already at `X` is a no-op write; the diff in step 4 skips it anyway. Repetition
is therefore harmless *and* avoided. Line indices come from the structural
read-back each time, never cached across invocations — a stale index is how a
"safe" PATCH writes the wrong line.

## Verification gate — all must hold before `succeeded`

| # | assertion |
|---|---|
| 1 | expected Group structure: `Group → members → EndGroup` per planned group |
| 2 | exact membership, matched on **item + planned rate**, not SKU alone |
| 3 | every negotiated member rate equals the plan |
| 4 | every group amount equals its `expectedAmount` |
| 5 | Σ group amounts = accepted total |
| 6 | no `$0.00` in any governed commercial field |
| 7 | no duplicate members (the Probe 7a / hazard-1 signature) |
| 8 | Item-derived Class preserved on members |

Failure of any one retains the SO id and holds `awaiting_rates`.

**No automatic destructive rollback.** The SO is never deleted or voided to
recover; that would need separate governance.

## Operator surface

`awaiting_rates` is a real state PMs can encounter, and it must not read as
either success or failure. The Sales Order sub-tab already renders a failed
variant from `quotes.netsuite_so_push_status`; this needs a third variant —
*order created, pricing incomplete, safe to retry* — carrying the tranid so
Accounting can find it. Mirroring the value onto the quote row follows the
existing non-fatal pattern.

## What this does not solve

**The response-loss window at state 1 is unchanged** — POST sent, response lost,
SO possibly created, no id captured. Existing protections still apply: the
prior-success check, the deterministic idempotency key, and the duplicate-deal
SuiteScript. This contract narrows the *post-CREATE* window to zero but does not
close the *during-CREATE* one, and does not claim to.

## Fit assessment

| requirement | met by |
|---|---|
| durable resumable state | `awaiting_rates` + `netsuite_so_id` |
| no parallel authority | existing row; no new table/index/column |
| never a second CREATE | attempt-unique index retains the snapshot |
| retry finds the same SO | selector elects the same row + frozen payload |
| partial patches resume | plan-vs-observed diff |
| repeat PATCH harmless | convergent write, and skipped by diff |
| failure ≠ discard | invariant: id set ⇒ never `failed` |
| no destructive rollback | not implemented |

**The model fits.** No migration, no schema change, one new status value and one
invariant.
