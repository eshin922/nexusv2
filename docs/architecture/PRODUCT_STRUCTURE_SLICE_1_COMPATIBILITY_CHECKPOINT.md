# Product Structure Slice 1 — Compatibility Implementation Checkpoint

## Status

Implemented and validated locally for review. Migration 0049 remains a draft
asset absent from the Drizzle journal. Nothing in this checkpoint has been
pushed, deployed, or executed against production.

## Governed writer inventory

| Existing operation | Repository entry point | Compatibility disposition |
| --- | --- | --- |
| Attach grouped LEAF | `attachAssemblyLeaf` | Shared canonical-first attach |
| Detach grouped LEAF | `detachAssemblyLeaf` | Shared explicit legacy-then-canonical detach |
| Delete Product | `deleteAssembly` | Shared detach for every membership before Product delete |
| Reorder Product members | `reorderAssemblyLeaves` | Shared canonical-first mirrored reorder |
| Quantity mutation | No current operator/runtime writer | Shared mirrored primitive established; no UI exposed |
| Quote clone/copy | `cloneQuoteGraph`, used by both copy actions | Shared canonical-first attach per cloned membership |
| Delete Quote | Parent aggregate deletion | Existing independent Quote/Product cascades remove both representations; no standalone membership writer |

Repository validation finds no direct insert, update, or delete of either
membership table outside the shared compatibility boundary.

## Transaction design

All operator actions retain their existing authentication, draft, validation,
audit, response, and revalidation behavior. Their membership mutation and audit
now share one database transaction.

### Attach and clone/copy

1. Reject an existing legacy or canonical tuple.
2. Verify Product and Quote identity.
3. Insert canonical `quote_leaves` first.
4. Insert legacy `assembly_leaves` with its `quote_leaf_id` pointer.
5. Record the canonical ID in internal audit evidence where the action has an
   audit event.

The existing partial unique index on top-level `(assembly_id, leaf_id)` is the
concurrency arbiter. A losing concurrent transaction rolls back its canonical
insert, so no orphan remains.

### Quantity and reorder

The boundary resolves and verifies the one-to-one mapping before mutation. It
updates canonical rows first and legacy rows second inside one transaction.
Any missing pointer, identity mismatch, quantity mismatch, or position mismatch
fails closed before mutation.

### Detach and Product deletion

Actual delete order is deliberate:

1. Verify legacy and canonical identity/value parity.
2. Delete `assembly_leaves` explicitly.
3. Existing `ON DELETE CASCADE` foreign keys remove
   `assembly_leaf_inputs`, `assembly_leaf_overrides`, and
   `assembly_leaf_targets`, preserving current dependent-cost behavior.
4. Delete the corresponding `quote_leaves` row explicitly.

The implementation does not rely on deleting canonical first, even though the
temporary compatibility FK from `assembly_leaves.quote_leaf_id` has
`ON DELETE CASCADE`. The reusable `leaves` row is protected by the existing
legacy `ON DELETE RESTRICT` relationship and remains untouched.

Deleting a Product applies this sequence to every membership before deleting
the Product row. Every step, including audit, is in the same transaction.

## Mixed-version production safety

The approved sequence remains unchanged:

1. Install the database write pause and drain old writers.
2. Run final preflight.
3. Run draft Migration 0049 only after its later activation approval.
4. Reconcile.
5. Deploy this Compatibility runtime while writes remain database-blocked.
6. Retire every old runtime and prove the deployed version contains the shared
   boundary.
7. Remove the database write pause.
8. Reconcile again.

There is no application-only mixed-version window.

## Isolated representative-copy evidence

The runtime rehearsal used a disposable clone of the backfilled representative
copy. The database write-pause guard was removed only in that disposable clone
to exercise the new runtime.

Proven:

- attach created exactly one canonical and one legacy row;
- failure after canonical attach rolled back both rows;
- duplicate attach left no partial data;
- two concurrent duplicate attaches produced one success and one clean failure,
  with one canonical and one legacy row afterward;
- quantity changed identically in both rows;
- failure between quantity writes preserved both original values;
- reorder changed both representations identically;
- failure between reorder writes preserved the original order;
- detach removed canonical, legacy, input, override, and target rows;
- failure after legacy delete restored both memberships and all dependents;
- reusable LEAF count remained one after detach;
- clone/copy-style membership creation produced one distinct canonical mapping
  for every cloned legacy membership; and
- no external provider was invoked.

Final reconciliation reported zero for all ten invariants, including unmapped
legacy rows, identity/quantity/position mismatch, duplicate mapping, grouped
canonical orphan, and pinned-spec mismatch.

## Regression evidence

- Compatibility and Expand/Backfill invariant tests: 12 passed.
- Complete repository unit suite: 79 passed.
- TypeScript: passed.
- Prebuild boundary, PDF, completion-writer, pricing, and NetSuite adapter
  suites: passed.
- Customer Preview/PDF and completion/NetSuite source files were not modified.
- Isolated rehearsal reported `externalCalls: 0`.

## Scope confirmation

No Direct Component workflow, Product Setup behavior, costing identity,
pricing authority, customer projection, PDF, completion, NetSuite projection,
Item Group, PVS-020, Epic 2, Cutover, or Contract work is included.
