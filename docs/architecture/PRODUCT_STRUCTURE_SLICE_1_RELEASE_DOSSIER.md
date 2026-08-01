# Product Structure Slice 1 — Release Dossier

## Release-candidate status

**Ready for final approval to push and open a PR.**

Reviewed branch: `feat/product-structure-slice-1`

Reviewed base: `origin/main` at `bf52214c2bf0899a8ee711e7052702b6a8c0b971`

Implementation head reviewed: `0d07ce089751b98709c7bb38f7a19854ef7345da`

This dossier is the documentation-only carrier for the completed release review;
its local commit SHA is recorded in the review handoff after the file is committed.

Slice 1 changes quote attachment identity and grouped-membership compatibility
only. It does not expose Direct Components or alter Product Setup, Costing
formulas, Pricing authority, customer-facing projections, PDF behavior,
Completion behavior, or NetSuite projection behavior.

## Governing contracts

- [BV-006 — Product Structure Contract](../business-validation/BV-006-product-structure-contract.md)
- [BV-007 — Product Setup Workflow](../business-validation/BV-007-product-setup-workflow.md)
- [BV-008 — Commercial Product Transition](../business-validation/BV-008-commercial-product-transition.md)
- [Product Structure Implementation Map](PRODUCT_STRUCTURE_IMPLEMENTATION_MAP.md)
- [Slice 1 Execution Plan](PRODUCT_STRUCTURE_SLICE_1_EXECUTION_PLAN.md)

BV-006, BV-007, and BV-008 remain approved and frozen. The Implementation Map
is the approved pre-implementation repository mapping; later-slice gaps remain
explicit and are not silently closed by Slice 1.

## Final implementation commit inventory

Commits are ordered coherently from governing contracts through contraction:

1. `f9c9d466c4b7f0d2a2304fe5311acc4145d48399` — `docs(product-structure): freeze governing contracts`
2. `4db75b3045e426071928c8bfe7681e4f0da4e22b` — `feat(model): expand canonical quote attachment identity`
3. `1b53d610479e592c150a757fa983f4ea7526a18b` — `test(model): add slice 1 preflight invariants`
4. `725097d634196b2383349b2258a70d484062fc97` — `feat(model): backfill canonical quote attachments`
5. `66e22fa277e0aab01d16cc0ceae6e786aca593cd` — `feat(model): mirror grouped membership compatibility`
6. `9dbdd8e27de5a547ea1121274a3cc32f0639d8df` — `feat(model): cut over canonical attachment identity`
7. `0d07ce089751b98709c7bb38f7a19854ef7345da` — `feat(model): enforce canonical attachment contract`

The branch contains only approved Slice 1 contracts, architecture, schema,
controlled migration assets, compatibility runtime, identity evidence, and
validation. No unrelated feature or production-validation work is included.

## Migration inventory and activation status

| Migration | Role | Normal journal status | Production status |
| --- | --- | --- | --- |
| `0048_product_structure_slice1_expand.sql` | Add canonical attachment structure and nullable compatibility pointer | **Active**; journal index 48 and snapshot present | Not applied by this review |
| `0049_product_structure_slice1_backfill.sql` | Controlled manifest-backed canonical mapping | **Inactive**; absent from `_journal.json` | Not applied |
| `0050_product_structure_slice1_contract.sql` | Controlled mandatory compatibility mapping | **Inactive**; absent from `_journal.json` | Not applied |

The active Drizzle journal ends at `0048_product_structure_slice1_expand`.
Drizzle snapshot validation passes. Generic migration execution cannot discover
0049 or 0050. A normal Vercel deployment alone must not attempt either
controlled migration.

## Schema and runtime outcomes

- `quote_leaves.id` is the canonical quote-scoped commercial attachment ID.
- `leaf_id` remains reusable master-data identity only.
- `assembly_leaves.id` remains compatibility context for existing consumers.
- `assembly_leaves.quote_leaf_id` is mandatory after controlled Contract.
- Direct-form `quote_leaves` remain structurally valid but unreachable from
  production runtime.
- Every explicit grouped attach, detach, quantity, reorder, and clone/copy write
  uses the governed atomic compatibility boundary.
- Canonical rows are created/mutated first except the explicitly proven detach
  order needed to preserve dependent legacy cascades.
- Canonical and reverse lookup fail closed on missing, null, duplicate,
  cross-Quote, or drifting mappings.
- No lookup synthesizes quote attachment identity from `leaf_id`.
- Audit and internal action evidence use `quote_leaf_id` canonically while
  retaining `assembly_leaf_id` only where compatibility consumers require it.

Existing downstream foreign keys, formulas, lifecycle rules, screens, labels,
navigation, customer artifacts, and NetSuite payload behavior remain unchanged.

## Controlled production rollout sequence

1. Deploy Expand-compatible runtime if required.
2. Install the database-enforced Product Structure write pause.
3. Drain every old writer.
4. Run final production preflight; stop on any undispositioned conflict or
   ceiling breach.
5. Apply Migration 0049 through its controlled path and retain its manifest.
6. Reconcile; require every counter to be zero.
7. Deploy Compatibility and Cutover runtime while writes remain paused.
8. Retire all old runtime instances and prove every writer uses the shared
   boundary.
9. Remove the write pause.
10. Observe continuous zero-drift reconciliation for the approved window.
11. Apply controlled Migration 0050.
12. Repeat reconciliation and unchanged-workflow operator smoke.
13. Record Slice 1 operator approval.
14. Stop before every later Product Structure slice.

Production rollout requires separate explicit approval and controlled database
execution. Push, PR, merge, Vercel deployment, and migration execution are not
authorized by this dossier.

## Rollback sequence

- Before Backfill: remove the write pause if appropriate; 0048 remains additive.
- During Backfill: keep writes paused and use only manifest-selected rollback
  when selection is exact; otherwise retain additive canonical data.
- Before runtime cutover: redeploy the prior runtime while writes remain paused.
- After reopening writes: reinstall the pause, drain writers, and reconcile the
  entire observed window before any retry.
- After Contract: roll runtime back and run only
  `ALTER COLUMN quote_leaf_id DROP NOT NULL`; preserve all rows and mappings.
- Never guess rollback selection, delete pre-existing canonical rows, or permit
  Direct writes during Slice 1 rollback.

## Release gates and validation evidence

### Repository and contract review

- Seven implementation commits reviewed against refreshed `origin/main`.
- Commit order and scopes are coherent; unrelated changes found: zero.
- BV-006/BV-007/BV-008 status and governing progression are consistent.
- Mixed Quotes remain an architectural capability, not the initial operator
  workflow.
- Complete identity-usage inventory has no unclassified runtime or script file.
- Explicit grouped writers outside the governed boundary: zero.
- Direct production writers: zero.
- Changed Product Setup UI, Customer View, PDF, Completion, or NetSuite files:
  zero.
- Costing changes are limited to canonical identity evidence/result context;
  formulas and Pricing authority are unchanged.

### Authoritative code suite

- Full unit suite: **88 passed, 0 failed**.
- TypeScript `--noEmit`: passed.
- Prebuild: passed.
- Customer-view boundary: passed across 19 governed files.
- React PDF containment: passed.
- PDF font registration coverage: passed.
- Autosave focus stability: passed.
- Pricing classifier: passed across 21 scenarios.
- Completion status-writer invariant: passed.
- NetSuite adapter regression: passed.
- Drizzle snapshot/journal check: passed.
- `git diff --check`: passed.

### Controlled representative-data evidence

- Expand preflight: 129 legacy memberships; 9 exact canonical matches; 120
  canonical rows required; blocking categories 3–8 all zero.
- Backfill: 9 IDs reused, 120 rows created, 129 pointers populated.
- Backfill rerun: data-hash no-op.
- Manifest rollback: restored 129 legacy rows, 9 pre-existing canonical rows,
  and 129 null pointers without deleting pre-existing canonical data.
- Forward Backfill reapplication: restored 9 reused/120 created and zero null
  mappings.
- Conflict injection: one value conflict classified; Backfill aborted with all
  129 baseline mappings still unmapped and no partial mutation.
- Ceiling injection: 251 source rows; Backfill aborted before mutation; canonical
  and unmapped counts remained at the injected baseline.
- Write pause: blocked both canonical and legacy mutations; only the governed
  Migration 0049 bypass succeeded.
- Compatibility rehearsal: attach, duplicate/concurrent attach, detach,
  quantity, reorder, clone/copy, and injected rollback passed.
- Cutover rehearsal: canonical/reverse lookup matched; missing lookup failed;
  Direct-form read was isolated and left no residue.
- Contract rehearsal: success, deliberate null-mapping abort, nullable rollback,
  unchanged protected hashes, and forward reapplication passed.
- Final reconciliation: all ten counters zero.
- Real outbound calls during isolated validation: zero.

### Repository hygiene

- Changed-document relative links: valid.
- Migration and journal references: valid.
- High-confidence tracked-secret scan: clean.
- Tracked `.artifacts`, manifests, representative databases, production copies,
  dumps, backups, SQLite/database files, or customer evidence: zero.
- `.artifacts/` and environment files remain ignored.
- Added outbound provider/network code: zero.
- Isolated runtime rejects remote hosts, production mode, production
  credentials, and real-provider selection.

## Known deferred work

Slice 1 does not authorize or complete:

- Direct Component production creation or detachment;
- Product Setup workflow changes;
- grouping, regrouping, Undo Grouping, or Dissolve Product;
- canonical Costing persistence migration or formula changes;
- Pricing authority or commercial-price transitions;
- Customer Preview or PDF Direct Components projection;
- Completion support for Direct Components;
- NetSuite detailed-line changes, Item Groups, or Assemblies;
- PVS-020, Epic 2, or later Product Structure slices.

Open BV questions remain assigned to the later slices they gate.

## Operator-validation scope

Production operator validation for Slice 1 is limited to proving unchanged
ASY-backed behavior after the controlled rollout:

- grouped attach, detach, and reorder;
- representative Quote cloning/revision;
- unchanged Costing and Pricing outputs;
- unchanged customer preview and PDF;
- unchanged completion preflight and NetSuite projection;
- canonical audit lookup and stable compatibility evidence; and
- continuous zero-drift reconciliation.

Operator approval of Slice 1 is identity/compatibility approval only. It must
not be interpreted as approval of Direct Components, Item Groups, Costing
identity migration, or any later Product Structure capability.
