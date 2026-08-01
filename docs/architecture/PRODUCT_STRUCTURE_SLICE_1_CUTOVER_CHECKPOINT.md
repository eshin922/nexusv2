# Product Structure Slice 1 — Cutover Implementation Checkpoint

## Status and scope

Implemented locally for review. This checkpoint declares `quote_leaves.id` the
canonical quote-scoped commercial attachment identity in shared lookup, domain
types, action results, and new audit evidence. Existing grouped workflows and
all downstream business behavior remain compatibility-backed.

Migration 0049 remains a draft asset outside the Drizzle journal. No migration,
deployment, external call, production write, Direct Component workflow, or
operator-visible change is part of this checkpoint.

## Canonical identity boundary

`canonical-attachment-identity.ts` defines branded, non-interchangeable
`CanonicalQuoteLeafId` and `LegacyAssemblyLeafId` types. `leaf_id` is exposed
only as reusable master-data context on the resolved attachment; it is never an
accepted lookup key for commercial attachment identity.

The authoritative lookup by `quote_leaf_id` returns exactly one Quote, reusable
LEAF, optional Product (`assembly_id`), and optional legacy compatibility ID. A
Direct-form canonical row is valid when Product and compatibility IDs are both
null. A grouped row must resolve one legacy membership with identical Quote,
Product, LEAF, quantity, and position.

The reverse lookup accepts only a branded `assembly_leaf_id`, joins through the
governed pointer, and applies the same parity checks. Missing, null, duplicate,
cross-Quote, or drifting mappings fail closed. There is no fallback through
`leaf_id` or tuple synthesis.

## Complete identity-usage inventory

Every source file containing `assembly_leaf`, `quote_leaf`, `leaf_id`, or
`junctionId` identity tokens is classified below. A release-blocking inventory
test fails when a new matching file lacks a classification.

### Converted to canonical

| Files | Cutover disposition |
| --- | --- |
| `src/lib/product-structure/canonical-attachment-identity.ts` | Canonical/reverse lookup, branded domain identity, Direct-form read support, fail-closed parity |
| `src/lib/quote-guards.ts` | Legacy-keyed cost guards resolve and return canonical attachment evidence before mutation |
| `src/app/actions/assemblies.ts` | Attach result and membership audit entity identity are canonical; reorder and Product-delete evidence list canonical IDs first |
| `src/app/actions/assembly-leaf-inputs.ts` | Packaging-input audits carry canonical ID plus legacy compatibility context |
| `src/app/actions/costing.ts` | Override/target results and audits expose canonical ID while preserving compatibility fields |
| `src/lib/product-structure/grouped-membership-compatibility.ts` | Write evidence returns canonical ID and legacy context atomically |

### Intentionally legacy-compatible during Slice 1

| Files | Current dependency retained without behavioral change |
| --- | --- |
| `src/db/schema.ts` | Cost inputs, overrides, and targets retain legacy FKs; pointer stays nullable until Contract |
| `src/app/actions/quotes.ts`, `src/lib/scenario-copy-loader.ts` | Clone writes are governed; cost-input clone maps/source projection retain legacy IDs |
| `src/lib/costing-adapter.ts`, `src/components/costing-store-provider.tsx`, `src/components/costs/production-drilldown.tsx`, `src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx` | Costing formulas, UI keys, overrides, and targets remain legacy-backed pending Costing identity migration |
| `src/lib/assembly-tree.ts`, `src/components/assembly-tree/asy-row.tsx`, `src/components/assembly-tree/leaf-context-menu.tsx`, `src/app/projects/[id]/quotes/[quoteId]/page.tsx` | Setup tree and operator form fields retain junction IDs pending Product Setup work |
| `src/lib/library-browse-loader.ts`, `src/components/library/library-browse-modal.tsx` | Library membership projection retains legacy junction context; its writer is governed |
| `src/lib/addendum-loader.ts` | Customer addendum remains grouped/legacy-backed pending projection work |
| `src/lib/netsuite/mark-complete.ts` | Completion/NetSuite rollup matching retains legacy junction IDs pending its later slice |
| `src/lib/nav/home-queries.ts`, `src/lib/workspace-queries.ts` | Readiness/existence joins retain legacy cost FKs and emit no attachment identity |
| `src/app/actions/markup-defaults.ts` | Draft-impact query joins legacy cost rows and emits no identity |

### Reusable LEAF master identity — correct and unchanged

| Files | Reason `leaf_id` is not attachment identity |
| --- | --- |
| `src/app/actions/leaves.ts`, `src/app/actions/leaf-specs.ts`, `src/lib/leaf-spec-loader.ts` | LEAF library and specification master-data operations |
| `src/components/add-product/add-product-modal.tsx`, `src/components/spec-entry/change-type-modal.tsx`, `src/components/spec-entry/spec-entry-surface.tsx`, `src/components/spec-entry/spec-panel.tsx`, `src/components/spec-entry/type-picker.tsx` | Product creation/specification UI passes reusable LEAF identity |
| `src/app/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs/page.tsx` | Existing specification route is keyed by reusable LEAF identity |
| `src/lib/netsuite/item-resolver.ts` | Resolves reusable catalog LEAF to NetSuite item; not a Quote attachment |

There are no usages classified as incorrect and left unfixed. Deferred entries
are explicit later-slice dependencies, not ambiguous shared-domain identity.

### Non-production executable inventory

| Files | Classification |
| --- | --- |
| `scripts/product-structure/slice1-preflight.ts`, `slice1-compatibility-rehearsal.ts`, `slice1-cutover-rehearsal.ts` | Governed Slice 1 classification, reconciliation, compatibility, and isolated Cutover evidence |
| `scripts/parity/so-field-parity.ts`, `scripts/smoke/mark-complete.ts` | Isolated parity/smoke fixture construction and legacy downstream verification; not production writers |
| `scripts/provision-cb-step8b-fixture.ts`, `provision-cb-step8c4-fixture.ts`, `provision-cb-step10-fixture.ts`, `seed-sample-order.mjs` | Disposable fixture/seed writers; deliberately excluded from production writer inventory and must not target production |
| `scripts/verify/costing-adapter.ts`, `sample-order-margin.ts`, `slice-11-5-1-warnings-parity.ts` | Read-only or in-memory legacy downstream verification, deferred with the consumers they verify |

Test fixtures, generated/historical Drizzle snapshots, migration assets, and
documentation also contain identity field names. They are evidence or database
definitions rather than runtime identity consumers. The executable inventory
test covers every matching `src` and `scripts` file; migration invariants are
covered by the existing Slice 1 migration tests.

## Audit and action evidence

- Grouped attach/detach audits use `entity_type = quote_leaf` and canonical
  `entity_id`; `assembly_leaf_id` remains compatibility context.
- Product-delete and reorder evidence identifies canonical rows first and also
  records legacy IDs needed by existing forensic consumers.
- Packaging-input, override, and target audits include `quote_leaf_id`.
- Attach, override, and target results add `quoteLeafId` while preserving their
  existing compatibility fields and operator behavior.
- Clone/copy internal writer evidence already returns both IDs.

## Deferred consumers

Costing persistence/formulas, Product Setup, Customer Preview, PDF, Completion,
NetSuite projection, and clone/revision cost-reference migration remain deferred
to their approved later slices. Their legacy reads are not reinterpreted here.
No formula, payload, snapshot, lifecycle rule, or visible workflow changes.

## Validation gates

- Branded canonical and compatibility IDs cannot be interchanged by shared
  TypeScript callers without an explicit boundary conversion.
- Canonical and reverse lookups fail closed on absent or drifting mappings.
- Controlled isolated rehearsal inserts, resolves, and removes a Direct-form
  row without exposing a production writer.
- Repository inventory has no unclassified identity-bearing source file.
- Compatibility reconciliation reports zero drift after runtime rehearsal.
- Migration 0049 remains inactive and normal migration execution cannot apply it.
