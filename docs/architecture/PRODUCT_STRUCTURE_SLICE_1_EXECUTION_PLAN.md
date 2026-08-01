# Product Structure — Implementation Slice 1 Execution Plan

## Status

**Approved governing engineering plan for Slice 1.**

Current execution authority is limited to the first review checkpoint: contract
status corrections, Expand schema and migration code, deterministic preflight
and reconciliation tooling, migration and invariant tests, and the file-level
Compatibility boundary plan. Production migration, compatibility runtime,
push, merge, and deployment require later explicit approval.

## Goal

Establish `quote_leaves.id` as the canonical quote-scoped commercial attachment
identity for every LEAF attached to a Quote.

This plan is governed by BV-006, BV-007, BV-008, and the Product Structure
Implementation Map. It authorizes only the bounded checkpoint stated above and
does not authorize a production migration.

## Scope boundary

Slice 1 establishes identity and compatibility only.

In scope:

- the canonical attachment row and constraints;
- deterministic reconciliation of existing ASY-backed memberships;
- a stable compatibility mapping from `assembly_leaves` to `quote_leaves`;
- compatible writes and reads needed to keep current consumers correct;
- rollout, rollback, validation, and rehearsal controls; and
- the contract that later slices may rely on.

Out of scope:

- Product Setup behavior or operator workflow changes;
- Direct Component attach/detach UI or actions;
- grouping, regrouping, Undo Grouping, or Dissolve Product;
- costing formula or cost-input ownership changes;
- pricing behavior or Product selling-price authority;
- Customer Preview or PDF projection changes;
- completion behavior changes;
- NetSuite detailed-line or Item Group projection changes; and
- deletion of `assembly_leaves` or rewiring of its current consumers.

## Current-state constraints

1. `assembly_leaves.id` is the current Product-member attachment identity used
   by costing inputs, sell overrides, targets, Setup, cloning, and completion.
2. `quote_leaves.id` currently serves primarily as a specification-pinning
   identity.
3. `quote_leaves.assembly_id` is currently required, so Direct Components cannot
   be represented.
4. `quote_leaves` has no uniqueness constraint covering one commercial
   membership.
5. `quote_leaves` and `assembly_leaves` both carry `quantity` and `position`.
6. Current application writers create and mutate `assembly_leaves`; they do not
   maintain a canonical `quote_leaves` row.
7. Existing cost and pricing foreign keys must remain on `assembly_leaves.id`
   during Slice 1.

## Target Slice 1 contract

At the end of Slice 1:

- every existing top-level `assembly_leaves` membership maps to exactly one
  `quote_leaves` row;
- every `assembly_leaves` row has exactly one stable `quote_leaf_id` mapping;
- `quote_leaves.id` is the canonical commercial attachment identity;
- `quote_leaves.quote_id` and `quote_leaves.leaf_id` are required;
- `quote_leaves.assembly_id` is nullable;
- `assembly_id IS NULL` means a Direct Component;
- `assembly_id IS NOT NULL` means a Product-member Component;
- grouped compatibility rows retain the same Quote, Product, LEAF, quantity,
  and position in both representations;
- specification pinning remains on the canonical `quote_leaves` row;
- current ASY-backed Setup, costing, pricing, cloning, completion, and NetSuite
  behavior remains unchanged; and
- no production action creates a Direct Component yet.

## Accepted temporary compatibility divergence

During Slice 1, `assembly_leaves` remains the operational source for current
ASY-backed behavior, while `quote_leaves.id` becomes the canonical commercial
attachment identity through the governed compatibility mapping in this plan.

This is a temporary compatibility decision. It does not redefine the approved
business model, authorize ASY-only Product Structure, or permit later consumers
to treat `assembly_leaves.id` as the long-term commercial identity.

## Exact schema changes

### `quote_leaves`

1. Change `assembly_id` from `NOT NULL` to nullable.
2. Retain:
   - `id uuid PRIMARY KEY` as canonical commercial attachment identity;
   - `quote_id uuid NOT NULL`;
   - `leaf_id uuid NOT NULL`;
   - `leaf_spec_version_id uuid NULL`;
   - `pinned_at timestamptz NULL`;
   - `quantity numeric NOT NULL DEFAULT 1`;
   - `position integer NOT NULL DEFAULT 0`; and
   - `created_at timestamptz NOT NULL DEFAULT now()`.
3. Retain the existing foreign keys:
   - `quote_id → quotes.id ON DELETE CASCADE`;
   - `leaf_id → leaves.id ON DELETE RESTRICT`; and
   - `leaf_spec_version_id → leaf_specs.id`.
4. Replace the standalone `assembly_id → assemblies.id` foreign key with a
   Quote-consistent relationship that guarantees a non-null Product belongs to
   the same Quote as the attachment. This requires a candidate key on
   `assemblies (id, quote_id)` and a composite foreign key from
   `quote_leaves (assembly_id, quote_id)` to `assemblies (id, quote_id)`.
   PostgreSQL composite-FK null semantics allow Direct rows because
   `assembly_id` may be null while `quote_id` remains required.
5. Add a direct-membership uniqueness index:

   ```sql
   UNIQUE (quote_id, leaf_id)
   WHERE assembly_id IS NULL
   ```

6. Add a grouped-membership uniqueness index:

   ```sql
   UNIQUE (quote_id, assembly_id, leaf_id)
   WHERE assembly_id IS NOT NULL
   ```

7. Add an ordered grouped-membership lookup index:

   ```sql
   INDEX (quote_id, assembly_id, position, id)
   ```

8. Add an ordered direct-membership lookup index:

   ```sql
   INDEX (quote_id, position, id)
   WHERE assembly_id IS NULL
   ```

9. Retain the existing Quote and LEAF/spec-version lookup indexes unless query
   analysis proves one is wholly covered. Index removal is not part of Slice 1.

### `assemblies`

Add a unique candidate-key constraint or unique index on:

```sql
UNIQUE (id, quote_id)
```

This exists solely to enforce Quote-consistent grouped attachment references.
It does not change Product identity or Product behavior.

### `assembly_leaves`

Add:

```sql
quote_leaf_id uuid NULL
```

Then add:

```sql
UNIQUE (quote_leaf_id)
```

and:

```sql
FOREIGN KEY (quote_leaf_id)
REFERENCES quote_leaves(id)
ON DELETE CASCADE
```

The column is nullable during Expand and Backfill. It becomes `NOT NULL` only in
Contract after reconciliation proves complete coverage.

`assembly_leaves.quote_leaf_id` is a compatibility pointer, not a second
commercial identity. Existing cost/pricing foreign keys continue referencing
`assembly_leaves.id` in Slice 1 and resolve the canonical identity through this
pointer.

### Explicitly unchanged schema

Slice 1 does not alter:

- `assembly_leaf_inputs.assembly_leaf_id`;
- `assembly_leaf_overrides.assembly_leaf_id`;
- `assembly_leaf_targets.assembly_leaf_id`;
- `assembly_production_inputs.assembly_id`;
- `leaf_specs`;
- `quote_snapshots`;
- `netsuite_so_pushes`;
- Product/LEAF master fields; or
- any NetSuite Item Group table.

## Backfill source of truth

For current runtime memberships, `assembly_leaves` is the structural source of
truth because active Setup, costing, pricing, cloning, and completion all use it.
For specification history, an existing matching `quote_leaves` row is the source
of truth for `leaf_spec_version_id` and `pinned_at`.

The backfill must combine those responsibilities without overwriting conflicts:

- Quote identity comes from `assemblies.quote_id`.
- Product identity comes from `assembly_leaves.assembly_id`.
- LEAF identity comes from `assembly_leaves.leaf_id`.
- Current membership quantity and position come from `assembly_leaves`.
- Existing specification pin and pin timestamp remain on the matching
  `quote_leaves` row.
- Existing `quote_leaves.id` is preserved when there is one unambiguous match.
- A new `quote_leaves.id` is generated only when no matching row exists.
- No conflicting quantity, position, duplicate, or orphan condition is resolved
  automatically.

## Required preflight classifications

Before Backfill, classify every relevant row into exactly one category:

1. **Missing canonical row:** one top-level `assembly_leaves` row has no matching
   `(quote_id, assembly_id, leaf_id)` `quote_leaves` row.
2. **Exact existing match:** exactly one matching `quote_leaves` row exists and
   quantity/position agree.
3. **Value conflict:** exactly one matching row exists but quantity or position
   differs.
4. **Duplicate canonical candidates:** more than one matching `quote_leaves` row
   exists.
5. **Orphan canonical grouped row:** a grouped `quote_leaves` row has no matching
   `assembly_leaves` row.
6. **Cross-Quote Product reference:** `quote_leaves.quote_id` disagrees with the
   referenced `assemblies.quote_id`.
7. **Nested legacy membership:** `assembly_leaves.parent_assembly_leaf_id IS NOT
   NULL`.
8. **Invalid required reference:** Quote, Product, or LEAF reference is missing.

Production Backfill is blocked unless categories 3 through 8 are zero or each
row has a separately approved, recorded business disposition. Slice 1 does not
invent a disposition.

## Deterministic backfill mapping

For each eligible top-level `assembly_leaves` row:

1. Resolve `quote_id` through its Product's `assemblies.quote_id`.
2. Match existing `quote_leaves` on exact
   `(quote_id, assembly_id, leaf_id)`.
3. If one exact row exists and quantity/position agree:
   - preserve `quote_leaves.id`;
   - preserve specification pin fields; and
   - set `assembly_leaves.quote_leaf_id` to that ID.
4. If no row exists:
   - insert one `quote_leaves` row with a new UUID;
   - copy Quote, Product, LEAF, quantity, position, and
     `assembly_leaves.created_at` exactly;
   - leave specification pin fields null because no historical pin evidence
     exists; and
   - set `assembly_leaves.quote_leaf_id` to the inserted ID.
5. If more than one candidate or any value conflict exists, fail closed and do
   not mutate that Quote's membership graph.

The backfill is idempotent: a rerun follows the persisted one-to-one mapping and
creates no additional canonical rows.

## Migration sequence

The sequence is divided into independently reversible database changes. Exact
migration identifiers are assigned only when implementation begins.

### Migration A — Expand identity capacity

1. Add `assemblies (id, quote_id)` candidate key.
2. Make `quote_leaves.assembly_id` nullable.
3. Add `assembly_leaves.quote_leaf_id` nullable.
4. Add the compatibility FK and unique index on `quote_leaf_id`.
5. Add new lookup indexes that do not require clean backfilled data.
6. Add the Quote-consistent composite Product FK as `NOT VALID`, then validate it
   only after preflight confirms existing grouped rows are consistent.

No uniqueness constraint over commercial membership is added until duplicate
preflight is clean.

### Migration B — Backfill canonical rows and mappings

1. Acquire the approved Product Structure write pause or equivalent deployment
   maintenance gate.
2. Run preflight classification and persist the evidence artifact outside the
   migration transaction.
3. Abort if blocking categories are nonzero.
4. In bounded transactions, map exact existing rows and create missing canonical
   rows.
5. Populate `assembly_leaves.quote_leaf_id`.
6. Run full reconciliation after each batch and at completion.
7. Release the write pause only after all invariants pass.

### Migration C — Enforce commercial membership constraints

1. Create the grouped-membership unique index.
2. Create the direct-membership unique index.
3. Validate the Quote-consistent composite Product FK.
4. Verify all existing `assembly_leaves.quote_leaf_id` values resolve to a
   grouped `quote_leaves` row with identical Quote, Product, and LEAF identity.

### Migration D — Contract compatibility mapping

After the compatibility runtime has been deployed and observed:

1. Re-run full production reconciliation.
2. Set `assembly_leaves.quote_leaf_id NOT NULL`.
3. Retain `assembly_leaves`, its primary key, and all existing downstream foreign
   keys.
4. Retain the compatibility pointer and dual-write behavior for later Costing,
   Setup, and projection slices.

No legacy table or column is dropped in Slice 1.

## Phase plan

## Phase 1 — Expand

### Database changes

- Apply Migration A only.
- All changes are additive except making `quote_leaves.assembly_id` nullable,
  which broadens accepted data.
- Do not backfill or add membership uniqueness constraints yet.

### Runtime changes

- None required before the database migration.
- Existing application versions continue using `assembly_leaves` unchanged.
- New runtime types may recognize nullable `quote_leaves.assembly_id`, but no
  Direct writer is enabled.

### Validation gates

- Migration applies to an empty database and a representative restored copy.
- Existing application build and current ASY workflows remain green.
- Existing grouped rows still resolve through original foreign keys.
- New columns/indexes match the approved DDL exactly.

### Production safety gates

- Lock and statement-timeout review completed.
- Index creation method selected to remain within the approved production lock
  budget.
- Database backup/PITR checkpoint confirmed.
- No Product Structure write pause is required if Migration A is demonstrably
  metadata-only within the approved lock budget; otherwise use the write pause.

### Rollback point

- Revert the application type awareness first, if deployed.
- Drop only the new nullable compatibility column, new indexes, and candidate
  key after confirming none is in use.
- Restore the original standalone Product FK if the composite FK had replaced
  it.
- Returning `assembly_id` to `NOT NULL` is safe because no Direct writer exists
  in Slice 1.

### Operator validation

- Open existing Product Setup and Product Library workflows.
- Attach and detach an existing LEAF from an ASY.
- Confirm current Costing, Pricing, Preview, and Completion eligibility are
  unchanged.

### Expected invariants

- No existing row changes.
- No current action behavior changes.
- Direct canonical rows remain absent.

## Phase 2 — Backfill

### Database changes

- Apply Migration B.
- Preserve exact existing canonical IDs and spec pins.
- Create only missing canonical grouped rows.
- Populate the one-to-one compatibility pointer.

### Runtime changes

- No consumer cutover.
- Product Structure writes are paused during the final production backfill, or
  a delta reconciliation must prove no writes escaped the backfill boundary.

### Validation gates

- Source count equals mapped compatibility count.
- Every source membership maps exactly once.
- Every mapped canonical row resolves to the same Quote, Product, and LEAF.
- Quantity and position match exactly.
- Existing specification pin IDs and timestamps are unchanged.
- No accepted, sent, complete, superseded, dropped, or lost Quote changes
  commercial meaning.
- Backfill rerun inserts zero rows and changes zero resolved mappings.

### Production safety gates

- Preflight classifications 3–8 are zero or have approved row-level
  dispositions.
- Batch size and transaction duration pass rehearsal limits.
- Replication lag and lock monitoring are active.
- Backfill has a resumable checkpoint and emits per-batch counts.
- A before/after evidence package is retained.

### Rollback point

- Before compatibility runtime uses canonical IDs, rollback may clear
  `assembly_leaves.quote_leaf_id` and remove only rows created by the recorded
  backfill run.
- Existing pre-backfill `quote_leaves` rows and all spec pins must never be
  deleted or rewritten by rollback.
- If selective removal cannot be proven, leave additive canonical data in place
  and roll runtime back to legacy-only behavior.

### Operator validation

- Sample draft, sent, accepted, complete, superseded, dropped, and lost Quotes.
- Confirm visible Component membership, order, quantity, specs, prices, and
  artifacts are unchanged.
- Confirm no duplicate Product or Component appears.

### Expected invariants

- One canonical row per existing top-level Product membership.
- One compatibility pointer per source membership.
- Zero Direct rows.
- Zero commercial-value changes.

## Phase 3 — Compatibility

### Database changes

- Apply Migration C after duplicate and consistency gates pass.
- Keep `assembly_leaves.quote_leaf_id` nullable until Contract.

### Runtime changes

- Introduce one shared compatibility boundary for grouped membership writes.
- Existing attach behavior creates the canonical `quote_leaves` row and legacy
  `assembly_leaves` row in one database transaction and stores their mapping.
- Existing detach behavior deletes the canonical row in one transaction; the
  compatibility FK cascades deletion to the legacy membership and its existing
  dependent rows, preserving non-draft guards and audit behavior.
- Quantity and ordering mutations write the canonical row and mirror the legacy
  row in the same transaction.
- Canonical identity is included in internal action results and audit context,
  but operator behavior is unchanged.
- Existing Setup, Costing, Pricing, Preview, Completion, and NetSuite consumers
  continue reading their current sources.
- No Direct attachment action is exposed.

### Validation gates

- Attach creates one and only one row in each representation.
- Duplicate attach fails without a partial row.
- Detach removes both representations without deleting the reusable LEAF.
- Reorder/quantity changes remain equal in both representations.
- Forced failure between writes rolls the full transaction back.
- Concurrent duplicate writes converge on one membership or fail clearly with
  no orphan.
- Old and new runtime versions can read the database during the deployment
  window.

### Production safety gates

- Compatibility deployment precedes any canonical consumer cutover.
- Mixed-version deployment behavior is rehearsed.
- A reconciliation monitor reports missing pointer, identity mismatch,
  quantity mismatch, and position mismatch counts.
- All mismatch counters remain zero through the observation window.

### Rollback point

- Roll application runtime back to legacy readers/writers.
- Keep additive canonical rows and mappings; do not destructively reverse them.
- Because Slice 1 exposes no Direct writer, legacy behavior remains complete.
- Reconcile any writes made during rollback before retrying deployment.

### Operator validation

- Perform the existing ASY-backed attach, detach, reorder, clone, send-preview,
  and completion-preflight workflows.
- Confirm identical visible behavior and no duplicate membership.
- Confirm audit evidence includes a stable canonical attachment ID without
  changing operator terminology or workflow.

### Expected invariants

- Every new grouped membership is dual-represented atomically.
- Canonical and compatibility identity never drift.
- Existing consumers remain behaviorally unchanged.

## Phase 4 — Cutover

### Database changes

- No destructive database change.
- Membership uniqueness and Quote-consistency constraints are active.

### Runtime changes

- Declare `quote_leaves.id` authoritative in shared identity lookup and domain
  types.
- All newly written audit/reference payloads that need commercial attachment
  identity use `quote_leaf_id` as the canonical ID while retaining legacy ID
  context during compatibility.
- Compatibility joins expose `assembly_leaves.id ↔ quote_leaves.id` for current
  Costing, Pricing, cloning, and projection consumers.
- Current consumers continue their existing business behavior; this phase does
  not change Setup, formulas, pricing, or NetSuite payloads.

### Validation gates

- Canonical lookup by ID resolves exactly one Quote, LEAF, and optional Product.
- Legacy lookup resolves exactly one canonical ID.
- Direct-form canonical rows can be inserted and validated in isolated database
  tests, but no production runtime path creates them.
- Existing grouped workflows remain green under canonical identity logging.
- No consumer treats `leaf_id` as commercial attachment identity.

### Production safety gates

- Reconciliation counters have remained zero for the approved observation
  period.
- All code paths that create/mutate grouped membership use the shared
  compatibility boundary.
- A repository scan and runtime instrumentation find no ungoverned production
  writer to `assembly_leaves`.
- Operator smoke passes before canonical identity is declared available to later
  slices.

### Rollback point

- Switch identity lookup and new audit/reference emission back to compatibility
  mode.
- Preserve canonical rows and mappings.
- Continue legacy consumers without data loss.
- Do not accept Direct production writes until a later slice closes this
  rollback dependency.

### Operator validation

- Validate representative Quote membership and audit lookup by canonical ID.
- Confirm all existing screens, prices, specifications, customer artifacts, and
  completion preflight remain unchanged.

### Expected invariants

- `quote_leaves.id` is the only canonical commercial attachment identity.
- `leaf_id` remains reusable master identity only.
- `assembly_leaves.id` remains a compatibility identity only.
- Business behavior remains ASY-backed until later slices.

## Phase 5 — Contract

### Database changes

- Apply Migration D.
- Enforce `assembly_leaves.quote_leaf_id NOT NULL`.
- Retain compatibility table, IDs, and all current downstream foreign keys.
- Do not remove the nullable direct capability from `quote_leaves`.

### Runtime changes

- Remove transitional fallback that tolerates an unmapped `assembly_leaves` row.
- Fail closed if a grouped legacy consumer cannot resolve its canonical
  attachment.
- Retain dual-write mirroring until the later Costing, Setup, cloning, and
  projection slices move off legacy identity.

### Validation gates

- `assembly_leaves WHERE quote_leaf_id IS NULL` count is zero.
- One-to-one mapping, identity, quantity, and position reconciliation is zero-
  difference.
- No grouped canonical orphan exists.
- All current downstream foreign keys still resolve.
- Full existing regression and new database invariant suite pass.

### Production safety gates

- Contract migration is rehearsed against the production-size copy.
- No mismatches have occurred during the compatibility observation window.
- Rollback runtime has been tested against the retained compatibility model.
- Operator approval is recorded for unchanged ASY-backed workflows.

### Rollback point

- Drop only the `NOT NULL` requirement and restore compatibility tolerance.
- Keep mappings and canonical data.
- If the contract constraint exposes unexpected legacy writes, roll runtime back
  and reconcile before attempting Contract again.

### Operator validation

- Repeat grouped attach/detach/order and representative Quote lifecycle smoke.
- Confirm canonical ID lookup and legacy consumer behavior.
- Approve Slice 1 identity readiness only; do not approve later Product Setup,
  Costing, or NetSuite behavior from this evidence.

### Expected invariants

- No unmapped grouped membership can exist.
- Canonical identity is stable and mandatory for all legacy memberships.
- Compatibility remains lossless and reversible.

## Compatibility strategy

### First-checkpoint file-level boundary

No compatibility runtime is implemented at this checkpoint. The approved
Compatibility phase is bounded to the following repository surfaces when that
phase is separately authorized:

- `src/lib/product-structure/compatibility.ts` (new): the single transactional
  boundary for creating, deleting, and mutating a grouped canonical attachment
  together with its retained `assembly_leaves` projection. It will own reverse
  identity lookup and fail closed on any mismatch.
- `src/app/actions/assemblies.ts`: route existing grouped attach, detach,
  quantity, and ordering writes through the shared boundary without changing
  guards, action contracts, revalidation, or operator behavior.
- `src/app/actions/quotes.ts`: route Quote clone/revision membership creation
  through the same grouped compatibility boundary. No clone semantics change is
  authorized.
- `src/db/schema.ts`: consume only the additive mapping and constraints defined
  by this plan; downstream commercial foreign keys remain unchanged.
- `scripts/product-structure/slice1-preflight.ts`: remain the read-only release
  classifier and post-write reconciliation oracle.
- `tests/unit/product-structure-slice1-compatibility.test.ts` (future): prove
  atomic grouped create/delete/mutate, rollback on injected failure,
  concurrency behavior, and stable reverse lookup.
- existing action and lifecycle suites: prove current ASY-backed behavior and
  guards remain unchanged.

The current writers identified by repository inspection are the grouped
membership operations in `src/app/actions/assemblies.ts` and the Quote-copy
writer in `src/app/actions/quotes.ts`. Current Costing, Pricing, Setup, Preview,
PDF, Completion, Library, and NetSuite readers are deliberately not cut over in
Slice 1. A repository writer scan is a release-blocking gate before the
Compatibility phase begins.

### Compatibility direction

`quote_leaves` is authoritative; `assembly_leaves` is the retained compatibility
projection for current consumers.

During Slice 1:

- every grouped canonical attachment has one legacy membership;
- every legacy membership points to one canonical attachment;
- legacy cost/pricing tables continue using `assembly_leaves.id`;
- identity-aware code resolves `quote_leaf_id` through the compatibility pointer;
- all grouped writes maintain both rows atomically; and
- no read fallback may synthesize canonical identity from `leaf_id` alone.

### Mixed-version deployment

The deployment must avoid an interval where an old runtime can create an
unmapped `assembly_leaves` row after Backfill.

Approved safe choices are:

- a brief Product Structure write pause spanning final Backfill and compatibility
  runtime deployment; or
- a temporary database-enforced compatibility writer proven in rehearsal and
  removed before Contract.

The implementation must choose one before production. Application-only dual
write without a write pause is insufficient during a mixed-version rollout.

### Compatibility exit

Slice 1 does not exit compatibility. Later slices may remove legacy references
only after Setup, Costing, Pricing, cloning, customer projection, Completion,
and NetSuite projection independently cut over and reconciliation proves no
consumer remains.

## Rollout strategy

1. Rehearse all migrations and reconciliation against an isolated production
   copy.
2. Deploy Expand without behavior change.
3. Run production preflight and resolve every blocking exception outside the
   migration.
4. Establish the Product Structure write pause.
5. Run Backfill and full reconciliation.
6. Deploy compatibility runtime before reopening writes.
7. Observe dual writes with automated reconciliation.
8. Enforce membership and Quote-consistency constraints.
9. Cut canonical identity lookup and evidence emission over without changing
   business consumers.
10. After the observation gate, enforce the non-null compatibility mapping.
11. Stop and obtain operator approval for Slice 1 only.

## Rollback strategy

### General rule

Rollback is runtime-first and non-destructive. Canonical rows and stable mappings
remain unless they were created by a fully recorded, pre-cutover Backfill and
selective removal is proven safe.

### Before Backfill

- Revert additive Expand DDL after dependency checks.
- No data rollback is required.

### After Backfill, before compatibility writes

- Return to legacy runtime.
- Clear mappings/remove newly inserted rows only with an exact backfill manifest
  and proof that no pre-existing pin row is touched.
- Prefer leaving additive data dormant.

### During Compatibility or after Cutover

- Roll runtime back to legacy consumers.
- Relax `quote_leaf_id NOT NULL` if Contract was applied.
- Keep mappings and canonical rows.
- Reconcile the write window before another rollout.

### Rollback boundary

Slice 1 must not permit production Direct Component writes. Once a later slice
creates Direct rows that have no legacy representation, rollback to a purely
legacy runtime is no longer complete and requires that later slice's own
rollback contract.

## Validation strategy

### Static and migration validation

- Schema snapshot matches approved DDL.
- Forward and rollback migrations apply cleanly on empty and restored databases.
- Constraint names and delete behavior are explicit.
- Migration lint rejects destructive or table-rewrite surprises.

### Database invariant suite

The release-blocking suite proves:

1. every `assembly_leaves` row has one `quote_leaf_id` after Contract;
2. no two `assembly_leaves` rows share a canonical ID;
3. every mapped canonical row has the same Product and LEAF;
4. canonical Quote equals `assemblies.quote_id`;
5. quantity and position match across compatibility rows;
6. no duplicate direct membership exists;
7. no duplicate grouped membership exists;
8. every pinned specification belongs to the same LEAF as the attachment;
9. no grouped canonical orphan exists;
10. no legacy cost, override, or target FK becomes orphaned;
11. row counts by Quote lifecycle state reconcile before and after; and
12. rerunning Backfill is a no-op.

### Runtime contract tests

- grouped attach success and duplicate rejection;
- grouped detach success;
- quantity/order mirror;
- transaction rollback on injected failure;
- concurrent attach convergence;
- draft/authentication guards unchanged;
- non-draft mutation rejection unchanged;
- canonical lookup and reverse compatibility lookup;
- no Product Setup behavior change; and
- no real external call.

### Existing regression

Run the existing isolated suites covering:

- Product Library attach/detach;
- ASY/LEAF Setup and ordering;
- Costing and Pricing calculations;
- clone/copy operations;
- customer preview and PDF artifact;
- send/revision/acceptance lifecycle;
- completion preflight and NetSuite adapter; and
- audit evidence.

The expected result is byte/semantic equivalence where IDs are not intentionally
added to internal evidence.

### Browser validation

Use existing ASY-backed fixtures only. Prove no visible workflow, labels, order,
quantity, price, or navigation changes. Slice 1 does not introduce a Direct
Component browser scenario because it does not expose Direct behavior.

## Production rehearsal plan

### Rehearsal data

Use an isolated, access-controlled copy representative of production, including:

- draft, sent, accepted, complete, superseded, dropped, and lost Quotes;
- Products with zero, one, and multiple Components;
- repeated LEAF use across Quotes and Products;
- populated cost inputs, overrides, targets, specs, and pinned specs;
- cloned and revised Quote histories;
- Quotes with customer PDFs and accepted snapshots; and
- Quotes with successful, failed, and pending NetSuite push records.

### Rehearsal stages

1. Record database size, row counts, lifecycle counts, and all preflight
   classifications.
2. Restore the copy into the isolated validation database.
3. Apply Expand and measure lock duration.
4. Run preflight; stop on every unapproved conflict.
5. Apply Backfill with production batch and timeout settings.
6. Run before/after reconciliation and hash stable business values.
7. Deploy compatibility runtime against the rehearsed database.
8. Exercise attach, detach, reorder, clone, send preview, and completion
   preflight with isolated providers.
9. Apply constraints and Contract.
10. Exercise runtime rollback and relax Contract as documented.
11. Reapply forward path to prove repeatability.
12. Retain query output, timings, locks, counts, exception lists, and validation
    artifacts for release review.

### Required rehearsal evidence

- exact before/after counts for `assembly_leaves` and `quote_leaves`;
- counts grouped by Quote lifecycle status;
- exact count of reused versus inserted canonical rows;
- zero count for duplicate, orphan, cross-Quote, nested, and value-conflict
  categories;
- zero changes to quantities, positions, specification pins, costs, overrides,
  targets, Quote totals, snapshot payloads, and NetSuite push payloads;
- Backfill rerun no-op evidence;
- rollback and forward-reapply evidence;
- maximum lock and transaction duration;
- replication-lag observation; and
- operator smoke evidence.

## Production release gates

Release is blocked unless all are true:

- BV-006, BV-007, BV-008, and this Slice 1 plan are approved;
- production preflight has zero undispositioned conflicts;
- rehearsal completed against representative production data;
- backup/PITR and runtime rollback are verified;
- write-pause or database-enforced mixed-version protection is approved;
- all invariant, runtime, regression, and browser gates pass;
- no current business projection changes;
- no Direct production writer is enabled;
- reconciliation monitoring is operational; and
- the operator approves unchanged ASY-backed behavior after deployment.

## Slice 1 exit contract

Slice 1 is complete only when:

1. `quote_leaves.id` is documented and enforced as canonical commercial
   attachment identity.
2. Every existing `assembly_leaves` row has a unique, non-null canonical mapping.
3. Direct-form canonical rows are structurally valid but unreachable through
   production workflow.
4. Existing Product-member behavior is unchanged.
5. Existing cost, pricing, cloning, customer, completion, and NetSuite consumers
   remain compatible.
6. Historical specification pins and Quote evidence are unchanged.
7. Reconciliation and rollback evidence is complete.
8. No legacy identity or table has been removed.
9. Later slices can adopt canonical identity without repeating historical
   attachment reconciliation.
10. Operator approval is recorded for Slice 1 and no later slice has begun.
