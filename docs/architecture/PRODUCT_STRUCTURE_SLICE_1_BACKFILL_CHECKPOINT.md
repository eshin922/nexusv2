# Product Structure Slice 1 — Backfill Implementation Checkpoint

## Status

Implemented and validated locally for review. Migration 0049 is a draft asset:
it is intentionally absent from `drizzle/meta/_journal.json` and cannot be
applied by the generic migration command. It has not run against production.

## Final Migration 0049 contract

`drizzle/0049_product_structure_slice1_backfill.sql` executes in one database
transaction and:

- records all eight governed preflight counts inside the execution boundary;
- aborts before domain mutation when categories 3–8 are nonzero;
- aborts above the approved 250-row ceiling, deriving created/reused counts
  from the execution database rather than hard-coding rehearsal counts;
- takes a transaction advisory lock and table locks;
- persists a run row and one manifest row per eligible legacy membership before
  changing commercial attachment data;
- reuses exact canonical rows without changing IDs, pins, or timestamps;
- creates one canonical row for each missing membership, copying Quote,
  Product, LEAF, quantity, position, and original creation time;
- populates exactly one `assembly_leaves.quote_leaf_id` pointer per legacy
  membership; and
- verifies identity, quantity, position, creation-time, and pin invariants
  before commit.

The manifest contains only structural IDs and governed structural values. It
does not contain customer content, credentials, payload bodies, or secrets.

## Representative rehearsal

The access-controlled PostgreSQL 17 representative copy was restored to its
saved Expand-only baseline before the finalized guarded run.

| Evidence | Result |
| --- | ---: |
| Legacy `assembly_leaves` | 129 |
| Existing `quote_leaves` | 9 |
| Missing canonical rows | 120 |
| Exact existing matches | 9 |
| Value conflicts | 0 |
| Duplicate candidates | 0 |
| Orphan grouped canonical rows | 0 |
| Cross-Quote references | 0 |
| Nested memberships | 0 |
| Invalid references | 0 |
| Canonical rows created | 120 |
| Canonical IDs reused | 9 |
| Compatibility pointers populated | 129 |
| Unmapped memberships afterward | 0 |
| Identity/value mismatches afterward | 0 |

Quote lifecycle counts were unchanged: 44 draft, 12 sent, 2 accepted, and 1
complete. The fixture had no superseded or dropped Quote rows.

Protected before/after hashes were identical:

| Surface | Hash |
| --- | --- |
| Quantities | `0658b3dbe2429f19f6386c111292e202` |
| Positions | `7979df43775a3d5e76800a7c0ff9fecd` |
| Specification pins | `d41d8cd98f00b204e9800998ecf8427e` |
| Costs | `bcc1ee296c47d8872f153562f2744960` |
| Overrides | `d41d8cd98f00b204e9800998ecf8427e` |
| Targets | `d41d8cd98f00b204e9800998ecf8427e` |
| Snapshots | `34fd136053dfe3876926a15c4f018f4b` |
| NetSuite push evidence | `fb4fe145ea0599017e8d402f94739e3c` |

Guarded finalized timing on the representative copy:

- database lock acquisition: 3.334 ms;
- transaction duration: 5.698 ms; and
- observed process wall time: 158.041 ms.

These measurements are rehearsal evidence, not a production guarantee.

## Idempotency, rollback, and forward reapplication

A second execution selected zero eligible rows, created zero canonical rows,
changed zero pointers, and retained 129 canonical rows with zero unmapped
memberships.

Rollback is selected by a completed, unrolled-back manifest run. It verifies
every current identity and governed value, clears all compatibility pointers
first, deletes only rows classified `created` by that run, and never deletes or
rewrites reused rows. Any incomplete or changed selection aborts; additive rows
remain rather than being guessed away.

The rehearsed rollback restored 9 canonical rows and 129 unmapped legacy rows.
Forward reapplication recreated 120 rows, reused 9, populated 129 pointers, and
reproduced all 129 original canonical IDs with zero mapping differences.

Deliberate failure fixtures also proved:

- one quantity conflict aborts with zero pointers and nine canonical rows; and
- 251 legacy rows abort at the ceiling with zero pointers and nine canonical
  rows.

Both failures rolled back their migration metadata and domain mutations.

## Exact production write-pause procedure

1. Announce the Product Structure maintenance window and disable Setup/Product
   Library mutation entry points while retaining read-only Quote access.
2. Apply `scripts/product-structure/slice1-write-pause.sql`. Its table locks
   drain prior writer transactions before commit; database triggers then reject
   every insert, update, or delete on `assembly_leaves` and `quote_leaves`.
3. Prove an ordinary application-role write is rejected. Capture active-session
   evidence showing no earlier Product Structure writer remains.
4. Run and retain final preflight. Stop for any category 3–8 row or a count over
   the approved ceiling.
5. Execute 0049 with the session-local governed bypass. The bypass exists only
   within its transaction; an old runtime cannot set it and remains blocked by
   the database triggers.
6. Run reconciliation read-only and compare the manifest, counts, lifecycle
   counts, and protected hashes.
7. Deploy the later-approved Compatibility runtime while the database guard
   remains installed. Retire every old runtime instance and prove the deployed
   version before allowing writes.
8. Only after Compatibility reconciliation passes, apply
   `scripts/product-structure/slice1-write-resume.sql`, reopen mutation entry
   points, and perform operator validation.

Application dual-write is not the mixed-version protection. The database guard
is the protection. If any step fails, keep the guard installed; use the
manifest rollback only after its selection proof passes.

## Activation safeguard

0049 remains excluded from `_journal.json`; the journal ends at 0048. Unit
validation asserts both facts, so `db:migrate` and `validation:db:migrate`
cannot discover the draft. Activation requires a later reviewed journal and
snapshot change. Direct execution is limited to the documented isolated
rehearsal procedure until that gate is approved.

## Scope confirmation

No Direct Component writer, Compatibility writer, Setup behavior, costing,
pricing, preview, PDF, completion, NetSuite, Item Group, PVS-020, or Epic 2
behavior is included.
