# Product Structure Slice 1 — Contract Implementation Checkpoint

## Status and scope

Implemented and rehearsed locally for review. Migration 0050 and Migration 0049
remain draft assets outside the Drizzle journal. Nothing was pushed, deployed,
or executed against production.

Contract makes `assembly_leaves.quote_leaf_id` mandatory while retaining
`assembly_leaves`, its primary key, its canonical pointer, and every existing
Costing, override, target, Setup, clone, customer, Completion, and NetSuite
foreign key. Direct-form `quote_leaves` remain structurally valid and have no
production writer.

## Controlled Migration 0050

`0050_product_structure_slice1_contract.sql` executes in one transaction:

1. Set a five-second lock timeout and acquire the Slice 1 Contract advisory
   lock.
2. Acquire `SHARE ROW EXCLUSIVE` locks on `assembly_leaves` and `quote_leaves`,
   draining/blocking membership writers while permitting ordinary reads.
3. Recompute all ten governed reconciliation counters inside the transaction.
4. Abort before DDL if any counter is nonzero, including any null pointer,
   reverse mismatch, parity drift, grouped orphan, duplicate, cross-Quote row,
   or specification-pin mismatch.
5. Add a temporary `CHECK (quote_leaf_id IS NOT NULL) NOT VALID` constraint.
6. Validate the check.
7. Promote `quote_leaf_id` to column-level `NOT NULL`.
8. Drop the temporary check and commit.

No row is inserted, updated, or deleted. No table, column, key, legacy foreign
key, or compatibility identifier is dropped.

## Lock behavior

The explicit `SHARE ROW EXCLUSIVE` locks are held for the transaction. They
block `ROW EXCLUSIVE` membership writers and allow `ACCESS SHARE` readers.
PostgreSQL may briefly upgrade to `ACCESS EXCLUSIVE` for the `ALTER TABLE`
catalog operations. The potentially longer validation scan uses the staged
validated-check path; after validation, `SET NOT NULL` can use the proven check
instead of rescanning the table. The five-second `lock_timeout` fails closed
rather than waiting indefinitely.

Representative-copy timings:

- first Contract application: 5.671 ms;
- nullable rollback: 1.416 ms;
- forward reapplication: 3.603 ms.

These are isolated-copy observations, not production estimates.

## Runtime contraction

The Drizzle schema now declares `assembly_leaves.quote_leaf_id` non-null. Shared
canonical/reverse lookups and grouped mutation boundaries already reject null,
missing, or drifting mappings without `leaf_id` fallback; that fail-closed path
remains. Dual representation and all compatibility IDs/consumers remain.

The nullable Drizzle field was the final transitional runtime tolerance. No
fallback implementation was removed because the approved Cutover boundary had
already made lookup failure explicit; Contract narrows the schema/domain type
without weakening that diagnostic behavior.

Rollback of runtime tolerance means redeploying the prior approved Cutover
runtime together with the nullable schema model. It does not remove canonical
rows, mapping values, or compatibility behavior.

## Rollback

`slice1-contract-rollback.sql` acquires the same advisory/table boundary and
executes only:

```sql
ALTER TABLE assembly_leaves ALTER COLUMN quote_leaf_id DROP NOT NULL;
```

It changes no row or commercial value. Runtime is rolled back before or with
this relaxation. If reconciliation is uncertain, canonical rows and pointers
remain in place; no data is guessed or deleted.

## Representative rehearsal

On the isolated representative compatibility copy:

- baseline reconciliation passed;
- Contract applied successfully;
- the column became non-nullable;
- protected-table hashes remained identical;
- rollback restored nullable schema with identical hashes;
- one controlled null pointer caused Contract to abort with
  `legacy_missing_mapping=1`;
- the failed transaction left nullability and data unchanged;
- restoring the original pointer returned every hash to baseline;
- forward reapplication succeeded;
- final reconciliation reported zero for all ten counters; and
- external calls were zero.

Protected hashes covered canonical/legacy memberships, packaging inputs,
overrides, targets, Quote snapshots, and NetSuite push evidence.

## Final Slice 1 production rollout and rollback points

| Stage | Required action and gate | Rollback point |
| --- | --- | --- |
| 1 | Deploy Expand-compatible runtime if the active runtime does not already understand additive 0048 columns. Confirm no behavior change. | Redeploy the prior runtime; 0048 remains additive and dormant. |
| 2 | Install the database-enforced Product Structure write pause. Drain every old writer and prove mutation rejection. | Remove the pause only if Backfill has not begun. |
| 3 | Run final production preflight and capture evidence. Stop on any undispositioned category 3–8 row or ceiling breach. | No mutation occurred; keep or remove the pause according to investigation needs. |
| 4 | Apply Migration 0049 through the controlled path. Preserve its run manifest. | While still paused, use only manifest-selected Backfill rollback; otherwise leave additive rows in place. |
| 5 | Run complete reconciliation. Require every counter to be zero. | Keep writes paused; roll Backfill back only when manifest selection is exact. |
| 6 | Deploy Compatibility and Cutover runtime while the database pause remains installed. | Redeploy the previous runtime while still paused; do not reopen writes. |
| 7 | Retire every old runtime instance and prove all production writers use the shared boundary. | Keep the pause and correct deployment/runtime inventory. |
| 8 | Remove the database write pause only after writer proof and reconciliation pass. | Reinstall the pause, drain writers, and reconcile the observed window. |
| 9 | Observe continuous reconciliation for the separately approved window. | On any drift, reinstall the pause and roll runtime back; retain canonical data for investigation. |
| 10 | Apply controlled Migration 0050. Its transaction drains/blocks membership writers and aborts on any nonzero invariant. | Run the schema-only rollback to drop `NOT NULL`, then redeploy the nullable Cutover runtime if required. |
| 11 | Repeat reconciliation and grouped attach/detach/reorder, Quote lifecycle, audit lookup, and downstream operator smoke. | Relax Contract and roll runtime back without deleting mappings. |
| 12 | Record Slice 1 operator approval and stop. | No later Product Structure capability is authorized by Slice 1 approval. |

Migration 0049 and 0050 activation requires a separate production-rollout
approval. Generic migration commands cannot see either while they remain absent
from `drizzle/meta/_journal.json`.

## Complete validation result

- Contract database invariant tests: 5 passed.
- Complete unit suite: 88 passed.
- Contracted-copy grouped attach, detach, quantity, reorder, injected-failure,
  concurrency, and clone/copy rehearsal: passed.
- Final representative reconciliation: all ten counters zero.
- TypeScript: passed.
- Customer-view boundary: passed.
- PDF containment and font coverage: passed.
- Pricing classifier: passed.
- Completion writer invariant: passed.
- NetSuite adapter regression: passed.
- Diff validation: passed.
- External calls: zero.

There is no divergence from the approved Contract scope.
