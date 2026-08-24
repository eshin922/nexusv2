import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

const classifiedIdentityFiles = new Set([
  "src/app/actions/assemblies.ts", "src/app/actions/assembly-leaf-inputs.ts",
  // Client Target authority. Uses BOTH source identities on purpose and keeps
  // them apart: `assemblies.id` addresses an Item Group finished good and a
  // direct `quote_leaves.id` addresses a Direct Product, which are the two
  // top-level sellable units. A member leaf is refused, so the legacy junction
  // never enters — there is nothing here for it to address.
  "src/app/actions/client-targets.ts",
  // CLASSIFIED — recovery-election writer, canonical identity only. It reads
  // `quote_leaves.id` for the quote so it can also find the production rows of
  // top-level Direct Services, which store their policy on `quote_leaf_id`
  // rather than on an assembly; without that half, a Direct Service's
  // allocation state would be invisible to the refusal check and the election
  // could be accepted while mis-pricing it. `assembly_leaves` is never queried,
  // and the row it writes carries no leaf identity at all.
  "src/app/actions/commercial-recovery.ts",
  "src/app/actions/costing.ts", "src/app/actions/freight-worksheet.ts",
  // CLASSIFIED — transitional. actions/freight.ts writes component-tier costs
  // keyed on canonical quoteLeafId, with the fail-closed identity guards
  // covered by phase-2-freight-lifecycle. Transitional compatibility
  // infrastructure retained until F3 Stage 4, not enduring V1 authority.
  "src/app/actions/freight.ts",
  // CLASSIFIED — canonical, and the first write path that is. `quote_leaf_lifts`
  // keys on `quote_leaves.id`, so a lift is addressed the same way from the
  // staging key through `CostingLift` to the stored row, and the persisted row
  // reconstructs the in-effect lift with nothing to translate.
  //
  // It names the LEGACY id too, in exactly one place and for one reason: a
  // direct price still lives on `assembly_leaf_overrides` (OD-017), so Apply
  // must cross canonical → junction to write one. That crossing is a single
  // query scoped through `quote_leaves`, it fails closed on both absent and
  // duplicate, and it refuses the whole Apply rather than dropping one chip.
  // Retire the crossing when the cost-input tables re-key on quote_leaf_id.
  "src/app/actions/pricing-lifts.ts",
  "src/app/actions/leaf-specs.ts", "src/app/actions/leaves.ts",
  "src/app/actions/markup-defaults.ts", "src/app/actions/quotes.ts",
  "src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/leaves/[leafId]/specs/page.tsx",
  "src/app/projects/[id]/quotes/[quoteId]/page.tsx", "src/components/add-product/add-product-modal.tsx",
  "src/components/assembly-tree/asy-row.tsx", "src/components/assembly-tree/leaf-context-menu.tsx",
  "src/components/costing-store-provider.tsx", "src/components/costs/freight-drilldown.tsx", "src/components/costs/production-drilldown.tsx",
  // CLASSIFIED — enduring. The packaging drilldown addresses graph nodes by
  // `line.quoteSkuId`, which IS the assembly_leaf id and IS the id the engine
  // keys its SKU rollups on for a grouped attachment. Naming the identity is
  // what makes the read addressable; it is the node-key contract, not a legacy
  // reference. Becomes a canonical quoteLeafId read when OD-017 is settled and
  // cost inputs stop being keyed on assembly_leaf_id.
  "src/components/costs/packaging-drilldown.tsx",
  "src/components/library/library-browse-modal.tsx",
  "src/components/spec-entry/spec-entry-surface.tsx", "src/components/spec-entry/spec-panel.tsx",
  "src/db/schema.ts", "src/lib/addendum-loader.ts",
  "src/lib/assembly-tree.ts",
  // Client Target resolution. Pure, and identity-aware without being
  // identity-resolving: it groups rows by whichever of the two sellable-unit
  // columns is set and never translates between them.
  "src/lib/client-target.ts",
  "src/lib/costing-adapter.ts",
  // CLASSIFIED — enduring. costing.ts carries canonicalQuoteLeafId on
  // CostingSku; the math layer keys on canonical identity by design.
  "src/lib/costing.ts",
  // CLASSIFIED — enduring, and NOT an attachment identity. Each builds a leaf
  // predicate from the bundle's `skus` (`skuRole === "leaf"`) so a charge is
  // counted at the owner that holds it rather than again at the parent rollup
  // carrying the merge. Math-layer sku identity; they resolve and join
  // nothing, and translate between no identity spaces.
  //
  // `recovery-persistence-walk.ts` deliberately is NOT here: it names no
  // identity token, and the sweep rejects a registry entry it cannot match --
  // which is what keeps this list from accumulating stale claims.
  "scripts/gate-1b/frozen-instruction-contrast.ts",
  "scripts/gate-1b/recovery-impact-certify.ts",
  "scripts/gate-1b/recovery-walk-state.ts",
  // CLASSIFIED — enduring, and NOT an attachment identity. The recovery impact
  // preview builds `leafIds` from `input.skus` where `skuRole === "leaf"` —
  // MATH-LAYER sku ids, so that a charge is summed once at the owner that holds
  // it rather than a second time at the parent rollup carrying the merge. It
  // resolves nothing, joins nothing, and translates between no identity
  // spaces. Registered rather than renamed around: the sweep exists so every
  // appearance is consciously classified, and "rename the variable" would
  // satisfy the checker while removing the record.
  "src/lib/commercial-recovery/impact.ts",
  // CLASSIFIED — enduring. Gate 1B node keys are built from canonical
  // identity (quoteLeafId / tierId / lineGroupId) BY DESIGN: a key must be a
  // pure function of position in the computation so two graphs can be joined
  // for staged-vs-committed deltas. Naming the identity here is the contract,
  // not a legacy reference — positional keys would break that join.
  "src/lib/costing-nodes.ts",
  // CLASSIFIED — enduring, canonical-only. COSTS-RENDER-1. Resolves which
  // governed component a Packaging cost row is costing, so an operator can see
  // it on the row. Keys STRICTLY on quoteLeafId, because that is the identity
  // every assembly_leaf_inputs row carries post-OD-017; it names assemblyLeafId
  // only to document the id space it must NOT key on. Deliberately has no
  // legacy fallback — a permissive lookup would silently re-absorb the next
  // re-key, which is the defect this module exists to prevent. Nothing to
  // retire: it should be canonical-only forever.
  "src/lib/costs/packaging-row-identity.ts",
  // CLASSIFIED — canonical, session-scoped. The staging model addresses a
  // staged lift or direct price by `quote_leaf_id x tier_id`, which is the
  // canonical commercial attachment Phase 3 §1a requires lifts to persist
  // against. Naming it here is the contract rather than a legacy reference:
  // keying staging on the legacy grouped-membership id would stage a change
  // against an identity the lift itself may not resolve to.
  //
  // Resolution happens in the engine, once, and fails closed. This layer only
  // carries the address; it writes nothing and resolves nothing.
  "src/lib/pricing-staging.ts",
  // CLASSIFIED — canonical, and resolves nothing. The Apply plan decides WHICH
  // rows change by comparing two maps of composite cell ids. It names the
  // canonical identity because that is what a lift's address is made of, and it
  // never touches the legacy one: the single canonical → junction crossing an
  // Apply needs lives in the action, where the database is.
  //
  // The one thing it is careful about is that its address is NOT the staging
  // key. `:` here, `::` there — a durable entity id and a browser-session
  // address are not interchangeable, and a shared separator invites one to be
  // parsed as the other.
  "src/lib/pricing-apply-plan.ts",
  // CLASSIFIED — canonical, and it never resolves. The cost-base fingerprint
  // names `quoteLeafId` only as part of a freight component row's composite
  // identity, so that two rows for different commercial lines cannot digest to
  // the same string. It reads the id, writes nothing, and asserts no mapping
  // between the canonical and legacy identities.
  "src/lib/pricing-cost-base.ts",
  // CLASSIFIED — the compatibility window made legible, and the one place both
  // identities appear ON PURPOSE. A-2 asks who set a governed input; the graph
  // addresses that input canonically while four of the thirteen writers record
  // it against the legacy junction, so the lookup cannot be written without
  // holding both and stating which is which.
  //
  // It is a BRIDGE, not a mapping it invents: every crossing is looked up in an
  // index the loader built from real rows, and a miss resolves to `thin` rather
  // than to a guess. An inferred id here would attribute one commercial line's
  // price to another and read as an answer. Shrinks to nothing when the cost
  // inputs re-key on quote_leaf_id (OD-017).
  "src/lib/pricing-provenance.ts",
  // CLASSIFIED — read-only, and the place the bridge is BUILT. Reads
  // `quote_leaves` left-joined to `assembly_leaves` to learn, per SKU, both the
  // canonical id and the legacy one the audit rows use. It resolves nothing on
  // its own and writes nothing; it hands the pairs to the classifier, which is
  // the only thing entitled to cross between them.
  "src/app/actions/pricing-provenance.ts",
  "src/components/pricing-surface/pricing-staging-context.tsx",
  // CLASSIFIED — carries, does not resolve. The staging bar renders one chip
  // per pending change and hands each change's composite cell key to a
  // labeller supplied by the caller. It never parses the key and never
  // resolves an identity: a component that resolved one is a component that
  // can resolve it wrongly, and the caller already holds the SKU and tier
  // names. Named here because the key it passes through encodes the canonical
  // attachment, and a file touching that identity should say so even when its
  // only role is transport.
  "src/components/pricing-surface/staging-bar.tsx",
  // CLASSIFIED — carries, does not resolve. CellAction stages a lift or a
  // direct price against a `CellRef` its CALLER resolved; it never derives one.
  // The identity appears here only in the type it receives and in the composite
  // key it builds to ask the staging model whether this cell is already staged.
  //
  // Named because the cost of getting it wrong is the highest on the surface: a
  // price change landing on a different commercial line. The resolution lives
  // at the composition point, where `canonicalQuoteLeafId` and the tier UUID
  // both exist, and fails closed to null — at which point this component
  // refuses to stage rather than addressing a guess.
  "src/components/pricing-surface/cell-action.tsx",
  // CLASSIFIED — display only, fails closed. The Phase 3 mount builds the
  // labeller the staging bar transports keys to, and that is the one place the
  // composite cell key is taken apart. It resolves canonical quote_leaf_id →
  // product name from `skuRollups`, which carries both, and nothing else: no
  // write, no commercial read, no mapping asserted between canonical and
  // legacy identity.
  //
  // Named here because the resolution is easy to get subtly wrong and was:
  // the classifier's `state.skus[].id` is the engine's SKU id, a SEPARATE
  // field from `canonicalQuoteLeafId` on the same rollup. Keyed on the former
  // this matches nothing and every chip degrades to two raw UUIDs. It fails
  // closed to exactly that raw key when either half is unresolved — an ugly
  // chip is recoverable, a chip naming the wrong SKU beside a price change is
  // not.
  "src/components/pricing-surface/pricing-surface-shell.tsx",
  "src/lib/freight-workbook.ts", "src/lib/leaf-spec-loader.ts",
  "src/lib/commercial-settings.ts",
  "src/lib/library-browse-loader.ts", "src/lib/nav/home-queries.ts", "src/lib/netsuite/item-resolver.ts",
  "src/lib/netsuite/mark-complete.ts", "src/lib/product-structure/canonical-attachment-identity.ts",
  "src/lib/product-structure/grouped-membership-compatibility.ts", "src/lib/quote-guards.ts",
  "src/lib/quote-cost-completeness-contract.ts", "src/lib/quote-cost-completeness.ts",
  "src/lib/scenario-copy-loader.ts", "src/lib/workspace-queries.ts",
  // CLASSIFIED — verification only. Rebuilds the drilldown's grid from
  // assembly_leaf_inputs to prove the per-line cutover moved exactly the
  // cells the pre-flight predicted and blanked none.
  "scripts/gate-1b/verify-packaging-cutover.ts",
  // CLASSIFIED — verification only. Scenario Copy acceptance. Reads legacy
  // `assembly_leaf_id` solely to COUNT the canonical-only rows (legacy key
  // NULL) that the clone's old legacy-keyed SELECT could not see; the clone
  // itself now selects on `quote_leaf_id`. Creates and deletes its own
  // `ZZ-VALIDATION-copy-*` quotes, which the S-7 basket excludes.
  "scripts/gate-1b/verify-scenario-copy.ts",
  "scripts/parity/so-field-parity.ts", "scripts/product-structure/slice1-compatibility-rehearsal.ts",
  "scripts/product-structure/slice1-contract-rehearsal.ts",
  "scripts/product-structure/slice1-cutover-rehearsal.ts", "scripts/product-structure/slice1-preflight.ts",
  // CLASSIFIED — fixture provisioner, canonical only. Writes `quote_leaves`
  // for both structures and `assembly_leaves` only for grouped members, which
  // is what makes the seeded quote a genuine mixed case rather than a
  // simulation of one. Resolves no identity and maps between no id spaces.
  "scripts/provision-mixed-certification-fixture.ts",
  "scripts/provision-cb-step10-fixture.ts", "scripts/provision-cb-step8b-fixture.ts",
  "scripts/provision-cb-step8c4-fixture.ts", "scripts/seed-sample-order.mjs",
  "scripts/validation/phase-1-identity-reachability.ts",
  "scripts/validation/fixtures.ts",
  "scripts/verify/canonical-repair-digest.mjs",
  "src/lib/packaging-materialization.ts",
  // CLASSIFIED — transitional, read-only. Gate 1B S-7 fixture selection
  // joins assembly_leaf_inputs.assembly_leaf_id purely to COUNT which node
  // kinds each quote's data can produce. It resolves no identity, writes
  // nothing, and asserts no mapping — the join is a census, not authority.
  // Retire with the S-7 baseline once the node graph lands.
  "scripts/gate-1b/select-fixtures.ts",
  // CLASSIFIED — evidence, read-only. Both count and compare identity columns
  // to settle OD-014 and to prove the C-2 population swap could not reorder or
  // revalue anything. They resolve no identity and write nothing. The ordering
  // check is retained rather than deleted because it is the precondition any
  // future change of population source must re-prove.
  "scripts/gate-1b/od-014-ordering-check.ts",
  "scripts/gate-1b/od-014-population-evidence.ts",
  // CLASSIFIED — write-then-rollback falsification, canonical identity only.
  // Inserts probe rows carrying a literal `quote_leaf_id` to prove the
  // immutability trigger and the (snapshot, leaf) uniqueness actually refuse.
  // Every statement runs inside a transaction that always rolls back; it
  // resolves nothing through the identity, never queries `assembly_leaves`, and
  // asserts residue 0 afterwards.
  "scripts/gate-1b/ordered-spec-freeze-falsification.ts",
  // CLASSIFIED — write-then-rollback atomicity proof, canonical identity only.
  // Inserts probe rows carrying literal `quote_leaf_id` values to prove the send
  // transaction commits snapshot, ordered specs and commercial state together or
  // not at all. Never queries `assembly_leaves`, resolves nothing through the
  // identity, and asserts zero residue for its probe ids before and after.
  "scripts/gate-1b/send-atomicity-falsification.ts",
  // CLASSIFIED — verification, read-only. Asserts that the engine's leaf
  // population equals the canonical attachment set by identity. It resolves
  // the canonical-to-legacy mapping only to predict the id the engine emits,
  // and writes nothing. Retire when cost inputs key on quote_leaf_id and the
  // coalesce it mirrors disappears.
  "scripts/gate-1b/verify-sku-population.ts",
  // CLASSIFIED — rehearsal, read-only, and the one place naming both identities
  // is the whole point. R2 exists to prove the canonical row and the legacy
  // membership denote the same attachment during the Slice 1 compatibility
  // window, so it must hold both ids side by side to compare them.
  //
  // It resolves nothing itself: the verdict is `lookupCanonicalAttachment` and
  // its reverse — the production resolvers a lift would call. The row columns
  // it reads directly serve only the failure-category breakdown, printed to say
  // why a resolver that has already refused did so. Retire with the
  // compatibility window.
  "scripts/rehearsal/r2-identity-parity.ts",
  // CLASSIFIED — canonical only, by construction. The Direct Product path
  // writes and reads `quote_leaves` and never touches the legacy junction:
  // `assembly_leaves` appears in the helper exactly once, in a guard that
  // REFUSES to detach a row carrying a junction, because such a row is a
  // grouped member in a corrupted state rather than a Direct Product.
  //
  // There is no compatibility window to retire here. A Direct Product has no
  // legacy identity to be compatible with — it is the first structure in the
  // system that exists only in the canonical space.
  "src/app/actions/quote-products.ts",
  "src/lib/product-structure/direct-attachment.ts",
  // CLASSIFIED — canonical only, render surface. Both hold `quoteLeafId` as an
  // opaque handle: a React key and the argument the detach action takes. Neither
  // resolves an identity, maps between the two spaces, or shows either id to the
  // operator, who sees product name and SKU.
  "src/components/assembly-tree/assembly-tree-body.tsx",
  "src/components/assembly-tree/direct-product-row.tsx",
  // CLASSIFIED — read-only evidence, canonical only. OW-2's isolation reads
  // `quote_leaf_id` from `quote_product_attach` audit rows and matches it
  // against `skuRollups[].skuId`, which OD-017 made the canonical quote-leaf id.
  // That correspondence IS the finding: it is what proves the two added rollups
  // are the operator's two attachments and not a third thing. No mapping between
  // identity spaces, no writes.
  "scripts/gate-1b/ow-2-isolate.ts",
  // CLASSIFIED — canonical only. B-3's quote-owned spec authority is keyed by
  // (quote_id, leaf_id); it reads leafId to template from the Library default
  // and never touches the legacy junction or maps between identity spaces.
  "src/lib/product-structure/quote-spec-authority.ts",
  // CLASSIFIED — canonical only, and deliberately quote-free. The Library
  // master surface names `leafId` because a Library product IS a leaf; it holds
  // no quote identity at all, which is the whole point of the route.
  "src/app/library/leaves/[leafId]/defaults/page.tsx",
  // CLASSIFIED — canonical only, and deliberately quote-free. The stacked
  // Library spec editor names `leafId` because a Library product IS a leaf; it
  // holds no quote identity, which is what makes it Library scope.
  "src/components/library/library-spec-modal.tsx",
  // CLASSIFIED — read-only evidence, canonical only. The B-3 falsification
  // harness builds fixtures keyed by (quote_id, leaf_id) and never touches the
  // legacy junction or maps between identity spaces.
  "scripts/verify/b3-spec-authority.ts",
  // CLASSIFIED — read-only evidence, canonical only. The Step 4 falsification
  // harness keys on (quote_id, leaf_id) and never touches the legacy junction.
  "scripts/verify/step-4-pinned-spec-schema.ts",
  // CLASSIFIED — canonical only. Step 8 builds fixtures keyed by
  // (quote_id, leaf_id) and sweeps source for the retired write paths.
  "scripts/verify/step-8-leaf-authority-retired.ts",
  // CLASSIFIED — canonical only. The structural-move primitive keys every
  // operation on quote_leaves.id and touches the legacy junction solely to keep
  // it consistent; the falsification asserts that identity survives.
  "scripts/verify/structural-move-identity.ts",
  "src/lib/product-structure/structural-move.ts",
  // CLASSIFIED — canonical only. Ordering falsification: asserts the position
  // the operator was promised is the position persisted. Reads back through the
  // loader's own `ORDER BY position, created_at` rather than checking the
  // written value, because a renumber that left ties would satisfy the latter
  // and still render wrongly. Keys on quote_leaves.id throughout.
  "scripts/verify/structural-move-ordering.ts",
  // CLASSIFIED — canonical only, and it RESOLVES NOTHING. The optimistic
  // structural projection moves whole nodes between homes and orders them via
  // the shared rule; it addresses them by quoteLeafId because that is the
  // identity a rendered row carries. It never reads or writes assembly_leaf_id
  // — the one place a junction id appears, it is synthesised as a React key for
  // a node that has no true junction id yet, and is explicitly not persisted.
  "src/lib/product-structure/optimistic-structure.ts",
  // CLASSIFIED — canonical only. Provisions the mutable drag/drop operator
  // fixture through the governed attach helpers, so every attachment it creates
  // carries canonical identity by construction rather than by insertion.
  "scripts/product-structure/provision-drag-drop-fixture.ts",
  // CLASSIFIED — read-only evidence, canonical only. The B-14 falsification
  // asserts attachment is read from `quote_leaves`, the canonical table, and
  // creates its own fixtures.
  "scripts/verify/b14-attachment-state.ts",
  // CLASSIFIED — read-only evidence, canonical only. The Step 9 post-drop
  // runtime probe executes every loader that once read the dropped columns; it
  // creates nothing and maps between no identity spaces.
  "scripts/verify/step-9-post-drop-runtime.ts",
  // CLASSIFIED — canonical only. The Step 4 backfill reads `leaf_specs` by
  // (quote_id, leaf_id) and writes only the pinned schema columns; it maps
  // between no identity spaces.
  "scripts/product-structure/backfill-pinned-spec-schema.ts",
  "scripts/smoke/mark-complete.ts", "scripts/verify/costing-adapter.ts",
  "scripts/verify/sample-order-margin.ts", "scripts/verify/slice-11-5-1-warnings-parity.ts",
  "tests/harness/fixtures/world.ts",
  // CLASSIFIED — canonical only, and it is the enumeration that RETIRES the
  // last customer-facing junction read (OD-023). The quote's product set comes
  // from `quote_leaves`; groups are LEFT JOINed for their identity only. That
  // join direction is the whole fix: enumerating through `assembly_leaves`
  // omitted every Direct Component silently, so the customer received a priced
  // product with no specification pages and nothing said so.
  //
  // No compatibility window. It never reads or writes `assembly_leaf_id`.
  "src/lib/quote-product-structure.ts",
  // CLASSIFIED — canonical only. The sent version's frozen representation
  // carries `quoteLeafId` and `leafId` as recorded EVIDENCE of what was sold,
  // not as handles it resolves. It maps between no identity spaces and reaches
  // no table; the structure it freezes is whatever the canonical enumeration
  // above produced.
  "src/lib/quote-snapshot-representation.ts",
  // CLASSIFIED — read-only evidence, and it names BOTH identities on purpose.
  // The OD-023 falsification asserts that the canonical enumeration sees a
  // Direct Component and that the retired `assembly_leaves` read sees strictly
  // fewer groups. Holding both is what makes that a comparison rather than an
  // assertion; the junction appears only inside a `count(*)` taken to be beaten.
  "scripts/verify/od-023-snapshot-completeness.ts",
  // CLASSIFIED — canonical identity only, read + display. The Direct Service
  // Production surface addresses its rows by `quote_leaf_id`, the governed
  // owner of a service-owned production row, and resolves no junction.
  "src/components/costs/direct-service-production.tsx",
  // CLASSIFIED — canonical identity only. The picker addresses its line by
  // assembly id or by `quoteLeafId`, the governed attachment, and resolves no
  // junction. Which of the two it sends is decided by the caller, not looked up.
  "src/components/costs/other-service-item-picker.tsx",
  // CLASSIFIED — type declaration only. `SkuRow.quoteLeafId` carries the
  // CANONICAL id alongside the junction `id`, so consumers that must key on
  // the canonical one (the production markup node) can. Declares, resolves
  // nothing, writes nothing.
  "src/lib/sku-tree.ts",
  // CLASSIFIED — canonical identity ONLY, and by construction. Stage 3 A's
  // Direct Service Production writer keys on `quote_leaf_id`, which is the
  // governed owner of a service-owned production row; it never resolves or
  // writes the legacy junction, and it cannot, because the column it targets
  // is derived from the leaf's service identity rather than supplied.
  "src/app/actions/direct-service-production.ts",
  // CLASSIFIED — canonical identity only. The per-line Other Service selection
  // is owned by an assembly XOR a `quote_leaf_id`, the governed attachment.
  // It resolves no legacy junction and cannot: the XOR is enforced by the DB.
  "src/app/actions/other-service-item.ts",
  // CLASSIFIED — canonical identity only, as recorded EVIDENCE. Both read
  // `quoteLeafId` off the frozen line to match a commercial line against the
  // live grouping structure. Neither resolves a legacy junction; the frozen
  // record cannot contain one, because the freeze writes only the canonical id.
  "src/lib/netsuite/frozen-order-assembly.ts",
  "src/lib/netsuite/frozen-sales-order.ts",
  // CLASSIFIED — read-only diagnostic, canonical identity only. It characterizes
  // what the V1 freight distribution policy moved across the S-7 basket before
  // any baseline is refreshed, so it reads `quote_leaf_id` as the shipment
  // membership key the policy distributes across. It writes nothing and
  // resolves no legacy junction.
  "scripts/gate-1b/pre-refresh-isolation.ts",
  // CLASSIFIED — canonical identity only, carried as EVIDENCE. The commercial
  // projection reads `canonicalQuoteLeafId` off the rollup and passes it
  // through onto the line; it resolves nothing with it and reaches no table.
  // It cannot touch the junction: its only structural input is the costing
  // bundle, which was already canonicalised upstream.
  "src/lib/commercial-projection.ts",
  // CLASSIFIED — canonical identity only, write-through. The freeze persists
  // the `quoteLeafId` the projection recorded, verbatim, as part of the
  // frozen line. It performs no lookup by it, and a frozen line is a record
  // of what was sold rather than a handle used to resolve anything later.
  "src/lib/commercial-freeze.ts",
  // CLASSIFIED — canonical identity only. Reads `quote_leaves` directly for the
  // ordered-item set and joins the spec authority on `leaf_id` + `quote_id`,
  // which is the authority's own key. It writes `quoteLeafId` verbatim onto the
  // frozen row as the ORDERED ITEM's identity and never resolves anything
  // through it afterwards. `assembly_leaves` is not queried at all — grouped and
  // direct items are both reached as `quote_leaves` rows, which is what makes a
  // Direct Component's specification present in the freeze rather than lost with
  // the legacy junction.
  // CLASSIFIED — read-only projection, canonical identity only. Reads
  // `quote_snapshot_lines.quote_leaf_id` as the ordered item's identity and
  // matches it against the frozen spec keyed on the same value. It resolves
  // nothing THROUGH the identity — no lookup into live structure — never
  // queries `assembly_leaves`, and writes nothing. Grouped and direct items are
  // both reached as frozen lines, which is what keeps a Direct Component's
  // specification in the packet.
  "src/lib/order-packet/reader.ts",
  "src/lib/ordered-spec-freeze.ts",
  // CLASSIFIED — read-only walk evidence, canonical identity only. All three
  // read `quote_leaf_id` as the governed owner of a service-owned production
  // row, or as the identity a frozen line records. None resolves the legacy
  // junction and none writes outside a transaction it then rolls back.
  // CLASSIFIED — read-only census, canonical identity only. Counts which
  // BV-011 destinations the population reaches, joining `quote_leaves` to the
  // library by `leaf_id` for the service identity. Writes nothing.
  "scripts/gate-1b/bv011-representation-census.ts",
  // CLASSIFIED — read-only Case 6 Mixed proof harness. Queries `assembly_leaves`
  // DELIBERATELY, and that is the point of the case: it must prove a top-level
  // Direct Product acquires NO junction while its Item Group siblings keep
  // theirs. It counts junctions per `quote_leaf_id` and asserts no packaging row
  // references a structure it does not belong to. Canonical `quote_leaves.id` is
  // the key throughout — an earlier version keyed per-SKU economics on the
  // display label, which is empty for grouped members, so two leaves collided
  // onto one entry and the check passed while covering half of what it claimed.
  // Writes nothing.
  "scripts/gate-1b/case6-mixed.ts",
  // CLASSIFIED — read-only #321 discrimination proof. Queries `assembly_leaves`
  // DELIBERATELY: it SIMULATES the removed legacy ownership gate so the old
  // implementation can be shown to FAIL the Direct-only case before the new one
  // is accepted. A regression that passes on both implementations certifies
  // nothing. Runs both shapes inside a transaction it then rolls back, so the
  // Case 1 witness is never mutated, and re-reads afterwards to prove it.
  "scripts/gate-1b/f1-gate-discrimination.ts",
  // CLASSIFIED — read-only CERT-303 walk evidence, canonical identity only.
  // Reads the frozen snapshot line set and its per-tier rows, and the live
  // per-line NetSuite selection keyed on `quote_leaf_id`. Resolves nothing
  // through the legacy junction — `assembly_leaves` is never queried — and
  // writes nothing.
  "scripts/gate-1b/cert303-frozen.ts",
  // CLASSIFIED — read-only lifecycle-guard proof, canonical identity only.
  // Loads the real quote rows and runs `assertDraft` against them, with a
  // draft quote as control; reads service-owned production rows by
  // `quote_leaf_id`. Writes nothing.
  "scripts/gate-1b/cert303-server-refusal.ts",
  "scripts/gate-1b/freeze-lifecycle-proof.ts",
  "scripts/gate-1b/freeze-walk-candidates.ts",
  "scripts/gate-1b/freeze-walk-inspect.ts",
  // CLASSIFIED — read-only survey. Counts a project's scenarios by shape,
  // reading `quote_leaf_id` as the canonical attachment key. Writes nothing.
  "scripts/gate-1b/freeze-walk-project-detail.ts",
  // CLASSIFIED — read-only UAT readiness survey, canonical identity only. Joins
  // `quote_leaves` to the library on `leaf_id` for each leaf's sku and name, and
  // reads `quote_leaves.assembly_id` directly to separate grouped from direct.
  // It resolves nothing through the legacy junction — `assembly_leaves` is not
  // queried at all — and writes nothing.
  "scripts/gate-1b/uat-readiness.ts",
  // CLASSIFIED — read-only walk pre-flight, canonical identity only. Joins
  // `quote_leaves` to the library on `leaf_id` to find service attachments, and
  // reports `quote_leaves.id` as the picker's owner key. Never queries
  // `assembly_leaves`, resolves nothing through the legacy junction, and writes
  // nothing.
  "scripts/gate-1b/testing-walk-preflight.ts",
  // CLASSIFIED — read-only Deal Organizer evidence probe. It reads BOTH
  // identities deliberately: it resolves each unresolved-cost row's true origin
  // by asking whether `assemblyLeafId` names a `freight_subcategories` row or an
  // `assembly_leaves` row, which is the falsification proving that the payload's
  // null-pattern is an INFERENCE and its declared `source` field is not. Queries
  // id sets only, resolves nothing through the legacy junction for any
  // commercial purpose, and writes nothing.
  "scripts/organizer/freight-discriminator-evidence.ts",
]);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(dir.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(relative));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

test("every source identity usage has an explicit Cutover classification", async () => {
  // OD-017 added `quoteLeaves.id` / `quote_leaves.id`. Without them the sweep
  // LOSES a file the moment it converts from the legacy junction to canonical
  // identity — the registry would quietly shrink exactly when a file starts
  // handling the governed identity, which is the opposite of what it is for.
  const identity = /assemblyLeafId|assembly_leaf_id|assemblyLeaves\.id|assembly_leaves\.id|quoteLeafId|quote_leaf_id|quoteLeaves\.id|quote_leaves\.id|leafId|leaf_id|junctionId/;
  const matches: string[] = [];
  for (const file of [
    ...await sourceFiles("src"),
    ...await sourceFiles("scripts"),
    ...await sourceFiles("tests/harness"),
  ]) {
    if (identity.test(await read(file))) matches.push(file);
  }
  assert.deepEqual(matches.sort(), [...classifiedIdentityFiles].sort());
});

test("canonical lookup is branded, direct-capable, and fail-closed", async () => {
  const identity = await read("src/lib/product-structure/canonical-attachment-identity.ts");
  assert.match(identity, /type CanonicalQuoteLeafId = string &/);
  assert.match(identity, /lookupCanonicalAttachment\([\s\S]*quoteLeafId: CanonicalQuoteLeafId/);
  assert.match(identity, /lookupCanonicalAttachmentByLegacyId\([\s\S]*assemblyLeafId: LegacyAssemblyLeafId/);
  assert.match(identity, /canonical\.assemblyId === null/);
  assert.match(identity, /did not resolve exactly once/);
  assert.match(identity, /did not resolve exactly one canonical attachment/);
  assert.doesNotMatch(identity, /lookupCanonicalAttachment\([\s\S]{0,80}leafId:/);
});

test("grouped action evidence is canonical with legacy context", async () => {
  const [assemblies, costing, inputs] = await Promise.all([
    read("src/app/actions/assemblies.ts"), read("src/app/actions/costing.ts"),
    read("src/app/actions/assembly-leaf-inputs.ts"),
  ]);
  assert.match(assemblies, /entityType: "quote_leaf"[\s\S]*entityId: attached\.quoteLeafId/);
  assert.match(assemblies, /entityType: "quote_leaf"[\s\S]*entityId: detached\.quoteLeafId/);
  assert.match(assemblies, /quoteLeafId: membership\.quoteLeafId[\s\S]*junctionId: membership\.assemblyLeafId/);
  // OD-017 · both halves now come from the resolved attachment. The legacy id
  // is context, and for a Direct Component it is legitimately null — reading it
  // from the resolver rather than from a local is what makes that expressible.
  assert.match(costing, /quote_leaf_id: attachment\.quoteLeafId[\s\S]*assembly_leaf_id: attachment\.assemblyLeafId/);
  assert.match(inputs, /quote_leaf_id: attachment\.quoteLeafId/);
});

test("Direct production writer stays unreachable and Migration 0049 stays inactive", async () => {
  const [journal, boundary, rehearsal] = await Promise.all([
    read("drizzle/meta/_journal.json"),
    read("src/lib/product-structure/grouped-membership-compatibility.ts"),
    read("scripts/product-structure/slice1-cutover-rehearsal.ts"),
  ]);
  assert.doesNotMatch(journal, /0049_product_structure_slice1_backfill/);
  assert.match(boundary, /assemblyId: args\.assemblyId/);
  assert.doesNotMatch(boundary, /assemblyId:\s*null/);
  assert.match(rehearsal, /assertRuntimeSafety\(\)/);
  assert.match(rehearsal, /assemblyId: null/);
});
