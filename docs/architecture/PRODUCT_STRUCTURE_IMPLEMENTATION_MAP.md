# Product Structure Implementation Map

## Status and purpose

This document maps the approved governing business contracts in BV-006, BV-007,
and BV-008 to the current Nexus repository.

It is an architecture mapping only. It does not authorize implementation,
define schema changes, specify migrations, estimate effort, or establish an
implementation sequence.

For each business concept, the map records:

- the governing Business Contract;
- its Current Repository representation;
- the Gap Analysis;
- Required Future Work at an outcome level; and
- What Can Remain Unchanged.

## Repository-wide finding

The repository already has a reusable LEAF library, quote-scoped ASYs,
ASY-to-LEAF membership, cost and pricing calculations, customer artifacts,
quote lifecycle controls, flat NetSuite line projection, audit infrastructure,
and an isolated validation harness.

The central divergence is identity and structure:

- `assembly_leaves.id` is the current cost-bearing attachment identity;
- `quote_leaves.id` is primarily a quote/specification-pinning identity;
- `quote_leaves.assembly_id` is required;
- Setup and Library attachment require an ASY; and
- downstream consumers assume every commercial Component is ASY-backed.

The repository therefore cannot currently represent a Direct Component as
defined by BV-006, nor can it derive downstream behavior from a structure that
contains Direct Components, Products, or both.

## 1. Quote

### Business Contract

BV-006 defines the Quote as the Nexus-owned commercial proposal and lifecycle
boundary. The PM builds Components and Products within it. BV-007 begins Product
Setup from an empty Quote without requiring an accounting classification.
BV-008 permits structural transitions only on the authoritative editable draft
and preserves non-draft history.

### Current Repository

- **Schema:** `quotes` owns project, scenario, version, lifecycle status,
  accepted tier, quote-wide price adjustment, margin target, notes, and lineage
  (`src/db/schema.ts`).
- **Runtime:** draft mutation is guarded by `assertDraft`/`requireDraft`;
  `sent` and `accepted` can return to draft through revision; `complete` is
  locked (`src/lib/quote-guards.ts`, `src/app/actions/quotes.ts`).
- **Consumers:** Setup, Costs, Pricing, customer view, PDF, acceptance,
  completion, cloning, and audit all use `quote.id` as their scope.

### Gap Analysis

- **Already matches:** Quote is the lifecycle, version, and ownership boundary.
- **Runtime/documentation divergence:** Product Structure is not yet modeled as
  Components and Products; current Quote consumers infer structure entirely
  through ASYs.
- **Testing divergence:** lifecycle tests exist, but no contract coverage exists
  for Direct or mixed Product Structure.

### Required Future Work

- Make every approved Product Structure form addressable within a Quote.
- Ensure all structural operations inherit the existing Quote lifecycle guards.
- Extend Quote-level completeness and transition validation to the frozen BV
  contracts.

### What Can Remain Unchanged

- Quote ownership, project association, scenario/version identity, lifecycle
  status, revision entry point, and completion lock.

## 2. LEAF

### Business Contract

BV-006 defines a LEAF as reusable Component master data, distinct from a
quote-specific commercial attachment. A LEAF may be used directly or within a
Product. BV-008 requires reusable identity and governed data to survive every
Structural Transition.

### Current Repository

- **Schema:** `leaves` is globally scoped, has no `quote_id`, supports archival,
  product classification, unit cost, specifications, ownership, URL, and stable
  HubSpot Product identity.
- **Runtime:** `createLeaf`, HubSpot pull, restore, library loading, and spec
  management operate on the reusable library entity.
- **Consumers:** Product Library, ASY membership, costing adapter, Setup tree,
  addendum loader, cloning, and NetSuite SKU resolution.

### Gap Analysis

- **Already matches:** reusable master identity, cross-Quote reuse, archival,
  HubSpot-first creation, and separation from Quote ownership.
- **Documentation/runtime divergence:** schema comments and browse projections
  describe LEAFs as nested under ASYs only.
- **Projection divergence:** all active consumers reach LEAFs through
  `assembly_leaves`; no direct Quote path exists.

### Required Future Work

- Extend LEAF consumption to approved Direct and Product-backed attachment
  contexts without changing reusable master ownership.
- Preserve HubSpot identity and specification behavior across both contexts.

### What Can Remain Unchanged

- The reusable `leaves` master, HubSpot identity, archive model, Product Library
  creation contract, and leaf specification master data.

## 3. Product (ASY)

### Business Contract

BV-006 defines one Product as one customer-visible commercial unit composed of
one or more LEAF Components. ASY is an internal/documentation term; it is not a
folder, manufacturing construct, Item Group, or NetSuite Assembly. BV-007 uses
Product in the PM workflow. BV-008 governs creation and transition authority.

### Current Repository

- **Schema:** `assemblies` is quote-scoped and carries identity, ordering,
  classification, notes, and commercial-looking fields including `unit_price`,
  `unit_cost`, `margin_pct`, and `markup_pct`.
- **Runtime:** `createAssembly`, `deleteAssembly`, notes, ordering, and
  ASY-targeted membership actions are draft-guarded.
- **Consumers:** Setup tree, Costing, Product Library destination picker,
  addendum, cloning, completion, and NetSuite projection.

### Gap Analysis

- **Already matches:** quote scope, one-to-many Component composition, ordering,
  and draft guards.
- **Business/runtime divergence:** ASYs can currently be empty and are treated as
  mandatory structural parents, not specifically as customer-visible Products.
- **Pricing divergence:** stored ASY commercial fields coexist with a costing
  engine that derives ASY sell values by summing child effective sells; no
  BV-008 Product-price authority is established.
- **Documentation divergence:** operator surfaces expose ASY terminology.

### Required Future Work

- Align internal ASY behavior with the approved Product meaning and
  completeness rules.
- Establish the authoritative Product commercial-price relationship without
  implicit price transformation.
- Align operator-facing terminology with Product while retaining internal
  traceability where appropriate.

### What Can Remain Unchanged

- Quote scoping, stable Product identity, membership ordering, notes,
  classification references, and draft authentication guards where they comply
  with the approved transition contract.

## 4. Quote attachment identity

### Business Contract

BV-006 separates reusable LEAF identity from quote-specific commercial
identity. BV-008 requires Structural Transitions to preserve quantities, costs,
specifications, notes, prices as history, and audit evidence without ambiguous
identity changes.

### Current Repository

- **`assembly_leaves.id`:** identifies one LEAF membership in one ASY. It carries
  quantity and order and is the foreign-key target for Component cost inputs,
  sell overrides, and customer targets.
- **`quote_leaves.id`:** identifies one Quote/ASY/LEAF spec-pinning row. It also
  carries quantity and order but is not the current costing identity.
- **Constraint:** `quote_leaves.assembly_id` is non-null.
- **Runtime:** attach creates `assembly_leaves`; send-time logic uses
  `quote_leaves` for specification pins.

### Gap Analysis

- **Schema divergence:** neither identity alone currently represents every
  approved commercial attachment. Direct Components cannot exist.
- **Runtime divergence:** quantity and order exist in two attachment paths with
  different responsibilities.
- **Migration divergence:** current foreign keys and historical rows depend on
  `assembly_leaves.id`.
- **Audit/projection divergence:** different consumers use different attachment
  keys.

### Required Future Work

- Establish one unambiguous quote-scoped commercial attachment identity that
  covers Direct and Product-member Components.
- Reconcile every current identity consumer and historical reference.
- Prove one-to-one historical reconciliation and preservation before any
  production migration.

### What Can Remain Unchanged

- Reusable `leaf_id`, Quote ownership, stable UUID identity practices, and
  referential protection against deleting referenced library LEAFs.

## 5. Product Structure

### Business Contract

BV-006 permits Components and Products; Direct Components require no Product;
one Product contains one or more Components. BV-007 makes Add Component the
primary workflow and uses context to determine destination. Mixed structure is
an approved architectural capability but not the initial operational workflow.
BV-008 governs transitions and Undo Grouping versus Dissolve Product.

### Current Repository

- **Schema/runtime:** only Product-backed structure exists:
  `quotes → assemblies → assembly_leaves → leaves`.
- **Loader:** `loadAssemblyTree` returns ASYs and their children.
- **Actions:** create/delete/reorder ASYs and attach/detach/reorder Component
  membership.
- **Consumers:** Setup, costing adapter, addendum, cloning, and completion all
  consume the ASY tree.

### Gap Analysis

- **Schema:** no direct Quote-to-Component commercial membership.
- **Runtime:** no group, regroup, undo-grouping, dissolve, or direct attach
  transition satisfying BV-008.
- **Documentation/UI:** current empty states require Products and expose ASY.
- **Testing:** no invariants for direct, mixed, or transition states.

### Required Future Work

- Represent Direct, Product-backed, and mixed Product Structure without future
  schema redesign.
- Enforce Product completeness and Structural Transition authority.
- Preserve structure and commercial state atomically across transitions.
- Keep the initial operator workflow optimized for common Component-only and
  Product-only work rather than exposing mixed complexity prematurely.

### What Can Remain Unchanged

- The reusable LEAF library, quote ownership, Product membership ordering, and
  current draft guard pattern.

## 6. Commercial Cost Model

### Business Contract

BV-006 separates Product Structure from the Commercial Cost Model. Component
costs and approved non-component costs participate in roll-up, pricing, and ERP
projection but are not LEAFs or Product children. BV-007 keeps costs out of
Product Setup. BV-008 preserves costs and provenance across transitions.

### Current Repository

- **Component costs:** `assembly_leaf_inputs` is keyed by
  `assembly_leaf_id × line_group_id × tier_id`.
- **Product-level policy/costs:** `assembly_production_inputs` is keyed by
  `assembly_id × tier_id` and holds production and service-fee inputs.
- **Quote-level costs:** freight groups, legs, tier rates, customs data, and
  related metadata are separate from Product membership.
- **Runtime:** the costing adapter combines these sources into
  `QuoteCostingInput`.

### Gap Analysis

- **Already matches:** non-component freight/customs data is structurally
  separate from LEAF membership; costing is a derived service.
- **Identity/schema divergence:** Component cost inputs require
  `assembly_leaf_id`, so Direct Components cannot participate.
- **Attribution divergence:** some cost policies are ASY-scoped; their meaning
  during grouping, moving, and dissolving is not governed by current runtime.
- **Migration divergence:** existing cost references must survive canonical
  identity reconciliation.

### Required Future Work

- Make governed cost inputs addressable for every approved commercial
  attachment and Product state.
- Define preservation/applicability behavior for costs affected by Structural
  Transitions.
- Keep non-component commercial costs outside Product Structure.

### What Can Remain Unchanged

- Cost categories, tier model, vendor provenance, freight/customs separation,
  numeric validation, and pure costing calculation primitives where their input
  identity remains valid.

## 7. Commercial Representation

### Business Contract

BV-006 makes Commercial Representation a Nexus-derived result of Product
Structure and the Commercial Cost Model. The PM never selects it. Direct-only
structure supports Detailed representation; Product-backed structure supports a
grouped representation; mixed structure is architecturally supported while its
operational workflow and downstream projection remain gated.

### Current Repository

- No canonical Commercial Representation datum or derivation service exists.
- `quotes.detail_level` and its snapshot are customer-PDF presentation axes
  (`itemized`/`turnkey_only`), not Product Structure.
- Deal type and project category are external CRM/project classifications.
- Runtime behavior often infers meaning from whether ASYs exist.

### Gap Analysis

- **Runtime/documentation divergence:** representation is implicit and
  conflated with ASY existence or PDF presentation.
- **Projection divergence:** downstream consumers do not receive a governed
  derived representation.
- **Testing divergence:** no derivation invariants exist.

### Required Future Work

- Establish the governed derivation boundary from approved structure and cost
  facts.
- Make downstream consumers use that result rather than ASY presence or PDF
  presentation settings.

### What Can Remain Unchanged

- PDF layout/detail controls can remain presentation-only.
- CRM classifications can remain contextual inputs without becoming structural
  authority.

## 8. ERP Projection

### Business Contract

BV-006 derives ERP Projection only after Commercial Representation and the
Commercial Cost Model are established. Direct Components map to detailed Item
lines. Item Group eligibility and membership remain separate readiness gates.
Finished Product and NetSuite Assembly behavior are deferred.

### Current Repository

- `markComplete` resolves NetSuite Items from LEAF SKUs.
- The active Sales Order payload emits one flat NetSuite line per ASY/LEAF
  membership.
- Item Group primitives and a local identity cache exist, but the active
  completion path deliberately does not invoke Item Group creation.
- Native NetSuite Assembly projection is not active.

### Gap Analysis

- **Runtime:** projection is selected by current technical limitation rather
  than governed Commercial Representation.
- **Schema/runtime:** Direct Components cannot reach projection.
- **Downstream projection:** Product membership and approved non-component
  projection lines are not governed through the BV model.
- **External readiness:** Item Group API behavior remains constrained and
  separately gated.

### Required Future Work

- Make the projection boundary consume approved Commercial Representation and
  Commercial Cost Model outcomes.
- Cover Direct, Product-backed, and mixed structure when its downstream
  operational contract is enabled.
- Retain separate readiness gates for Item Group and deferred Assembly behavior.

### What Can Remain Unchanged

- NetSuite customer lookup, Item SKU resolution, request composition framework,
  durable push record, idempotency key, response recovery, and field-parity
  handling.

## 9. Costing

### Business Contract

BV-006 requires deterministic roll-up without conflating reusable catalog cost
and quote-specific economics. BV-008 prohibits implicit pricing changes during
Structural Transitions and requires cost/provenance preservation.

### Current Repository

- `costing-adapter.ts` flattens ASYs and ASY memberships into a legacy-compatible
  math tree.
- `assembly_leaves.id` is the math LEAF identity.
- `costing.ts` computes Component sell from costs, markups, and adjustments, then
  rolls Product contribution and sell values up from children.
- Product production policy is assigned through an anchor-LEAF compatibility
  technique.

### Gap Analysis

- **Already matches:** calculations are centralized and deterministic.
- **Runtime/identity:** the adapter requires every Component to have a Product
  parent.
- **Business divergence:** current Product required sell is an automatic sum of
  member effective sells; BV-008 requires explicit authority when structural
  change alters commercial meaning.
- **Runtime debt:** anchor-LEAF attribution is coupled to current Product-only
  structure.

### Required Future Work

- Accept the canonical attachment model and approved Direct/Product structure.
- Separate cost roll-up from authoritative commercial-price transitions.
- Preserve existing formulas where their governed business meaning remains
  unchanged.

### What Can Remain Unchanged

- Pure numeric helpers, freight/customs math, component markup calculations,
  margin classification, tier arithmetic, and fail-closed numeric validation,
  subject to identity-independent verification.

## 10. Pricing

### Business Contract

BV-008 makes Product Structure and Commercial Pricing independent. Structural
transitions never implicitly change pricing. Grouping Components with
established independent commercial meaning requires explicit PM authorization
of the Product and its selling price.

### Current Repository

- Selling price is normally derived automatically from governed costs, markups,
  and quote/tier adjustments.
- Sparse `assembly_leaf_overrides` stores explicit PM overrides per membership
  and tier.
- `assembly_leaf_targets` stores independent customer benchmarks.
- Product-level effective sell is calculated by summing member effective sells.
- `assemblies.unit_price` exists but is not the authoritative path used by the
  costing roll-up and downstream flat-line projection.

### Gap Analysis

- **Runtime/business:** no authoritative Product-price decision satisfying
  BV-008 exists.
- **Identity/schema:** overrides and targets attach to `assembly_leaves.id`.
- **Transition:** no state preservation/authorization boundary distinguishes
  structural grouping from pricing transformation.
- **Documentation:** a numeric derived price does not prove established
  commercial meaning.

### Required Future Work

- Establish the authoritative pricing decision consumed after Structural
  Transitions.
- Reconcile Component overrides and targets with canonical attachment identity
  and post-transition applicability.
- Prevent derived calculations from silently authorizing a Product price.

### What Can Remain Unchanged

- Derived-price formulas, explicit override validation, target benchmarks,
  margin bands, and audit patterns where their identity and applicability remain
  valid.

## 11. Quote cloning

### Business Contract

BV-006 requires Product Structure and commercial meaning to follow Quote
cloning. BV-008 requires Components, Products, values, and history to remain
unambiguous; completed commercial correction uses the approved clone workflow.

### Current Repository

- `cloneQuoteGraph` clones Quotes, tiers, ASYs, memberships, Component cost
  inputs, sell overrides, targets, Product production inputs, and freight data.
- Reusable LEAF IDs are retained; quote-scoped ASY and membership IDs are
  remapped.
- The target is a new draft with lineage through `copied_from_quote_id`.

### Gap Analysis

- **Already matches:** transactional graph cloning, master LEAF reuse, new
  quote-scoped IDs, and draft reset.
- **Runtime:** clone inventory only understands ASY-backed Components.
- **Identity:** future canonical attachments and Direct Components are absent.
- **Audit/testing:** transition evidence and mixed structure are not covered.

### Required Future Work

- Extend the clone inventory and reconciliation to every approved Product
  Structure and canonical commercial reference.
- Preserve transition/pricing evidence according to BV-008.

### What Can Remain Unchanged

- Transactional cloning framework, lineage, reusable LEAF reuse, tier mapping,
  draft reset, and existing commercial-cost cloning that remains applicable.

## 12. Quote revision

### Business Contract

BV-006 makes revisions part of Product Structure lifecycle. BV-008 permits
Structural Transitions only on the authoritative editable draft; sent and
accepted evidence cannot be changed in place.

### Current Repository

- Sent and accepted Quotes are revisable through guarded lifecycle actions.
- Revision closes the current sent snapshot, increments the Quote version, and
  returns the Quote to draft.
- Existing Quote row identity is retained while immutable sent-version evidence
  remains in `quote_snapshots`.

### Gap Analysis

- **Already matches:** explicit return to editable draft and preservation of
  sent artifact history.
- **Snapshot/projection:** current snapshots do not provide a complete canonical
  Product Structure snapshot independent of ASY/spec pin assumptions.
- **Testing:** no revision coverage for Direct, Product, mixed, or Structural
  Transition history.

### Required Future Work

- Ensure revised drafts carry the correct approved Product Structure while prior
  customer evidence remains reconstructable.
- Extend revision invariants to canonical attachments and transition evidence.

### What Can Remain Unchanged

- Status transition framework, version increment, snapshot supersession,
  revision audit event, and draft-only edit guard.

## 13. Product Setup

### Business Contract

BV-007 makes **Add Component** the primary action. Quote context creates an
independent Component; Product context adds to that Product. Product creation is
secondary. Empty Products are immediately incomplete. Operator language is
Components and Products, not ASY or accounting concepts.

### Current Repository

- Setup renders only `AssemblyTreeView` from `loadAssemblyTree`.
- Empty state and counters use assembly terminology.
- Product Library attachment requires an ASY, defaults to the first ASY, and
  disables attachment when none exists.
- ASY create/delete/reorder and member detach/reorder actions exist.
- No direct Component section or contextual direct destination exists.

### Gap Analysis

- **Runtime/UI:** current flow requires the Product decision first and exposes
  internal ASY language.
- **Runtime:** destination is globally selected rather than primarily determined
  by Quote/Product context.
- **Validation:** empty Product incompleteness is not the governing Setup state.
- **Transition:** grouping, Undo Grouping, and Dissolve Product are absent.

### Required Future Work

- Align Setup behavior with the approved Component-first workflow and operator
  vocabulary.
- Render every finally approved structure without exposing ERP decisions.
- Surface Product completeness and enforce BV-008 authorization boundaries.

### What Can Remain Unchanged

- Existing visual system, page routing, draft read-only behavior, library modal
  foundation, ordering controls, pending/error patterns, and accessibility
  foundations that remain valid.

## 14. Product Library

### Business Contract

BV-006 keeps LEAF master data reusable and distinct from Quote attachment.
BV-007 uses Product Library selection to add a Component into the current Quote
or Product context. Product Library does not determine commercial or ERP
representation.

### Current Repository

- `library-browse-loader.ts` lists reusable LEAFs and calculates reference and
  attachment state through `assembly_leaves`.
- `LibraryBrowseModal` creates LEAFs, refreshes HubSpot catalog data, selects an
  ASY target, and invokes `attachAssemblyLeaf`.
- HubSpot-first Product creation, canonical zero catalog price, stable HubSpot
  ID, archival, and fake-provider coverage are established.

### Gap Analysis

- **Already matches:** reusable catalog boundary and external Product identity.
- **Runtime/projection:** membership and attached-state calculations are
  ASY-only.
- **Workflow:** no Quote-level Component destination; zero-Product state blocks
  attachment.
- **Terminology:** ASY appears in operator guidance.

### Required Future Work

- Make attachment and membership projections understand approved Quote and
  Product contexts.
- Preserve the proven HubSpot Product creation contract unchanged.

### What Can Remain Unchanged

- Catalog loading/filtering, HubSpot provider boundary, LEAF creation, archival,
  stable external identity, pending/error isolation, and outbound-call testing.

## 15. Customer Preview

### Business Contract

BV-006 requires Direct Component specifications under **Direct Components** in
the customer addendum and Product Components beneath their Product. Commercial
Representation is derived, not selected by the PM.

### Current Repository

- `customer-view-resolver.ts` consumes costing `skuRollups`, Quote presentation
  axes, and `loadQuoteAddendum`.
- Customer pricing rows are filtered from math LEAF rollups.
- Draft uses live data; non-draft uses snapshot-controlled commercial defaults
  and presentation axes.
- `loadQuoteAddendum` reads only ASYs and `assembly_leaves`.

### Gap Analysis

- **Projection:** Direct Components cannot appear in pricing or specifications.
- **Business:** customer representation is not driven by the BV-derived
  Commercial Representation.
- **Identity:** rows are keyed through current math/ASY membership identity.

### Required Future Work

- Project approved Direct and Product structure into customer pricing and
  specifications.
- Preserve sent-version reproducibility for the resulting structure.

### What Can Remain Unchanged

- Resolver boundary, draft-versus-snapshot selection, firm/customer metadata,
  tier shaping, and presentation-axis handling where still applicable.

## 16. Customer PDF

### Business Contract

BV-006 requires customer artifacts to preserve Direct Components separately and
Product Components beneath Products. BV-008 requires prior customer evidence to
survive transitions and forbids in-place mutation after freeze.

### Current Repository

- PDF rendering consumes the normalized Customer View.
- Pricing supports itemized and turnkey-only presentation modes.
- Specification addendum renders only `addendum.assemblies` and their LEAFs.
- Send renders/uploads the artifact before status changes and records versioned
  snapshot metadata.

### Gap Analysis

- **Projection:** no Direct Components addendum section.
- **Representation:** PDF presentation mode is not the BV Commercial
  Representation contract.
- **Historical snapshot:** reproducibility depends on current structure loaders
  plus spec pins and artifact retention rather than one complete structural
  snapshot contract.

### Required Future Work

- Extend normalized PDF input to approved Product Structure.
- Preserve the exact Direct/Product structure and commercial values for each
  sent artifact.
- Keep presentation settings independent from structural meaning.

### What Can Remain Unchanged

- React PDF containment, artifact generation/upload ordering, document chrome,
  party/terms rendering, pagination primitives, and immutable artifact pointers.

## 17. Completion

### Business Contract

BV-006 requires Detailed direct-component Quotes to complete without an ASY and
ERP projection to follow approved Commercial Representation. BV-008 forbids
structural mutation after lifecycle freeze.

### Current Repository

- `markComplete` requires an accepted Quote and accepted tier, resolves customer
  and Items, composes a Sales Order, records durable push state, and freezes the
  Quote after success.
- It explicitly fails when `loadAssemblyTree` returns no ASYs.
- It resolves LEAF SKUs only through ASY children.
- It emits flat LEAF lines and does not invoke Item Group creation.

### Gap Analysis

- **Runtime:** direct-only Quotes fail the “no assemblies” guard.
- **Projection:** completion cannot consume Direct or mixed structure.
- **Business:** projection is not selected from derived Commercial
  Representation.
- **Testing:** no completion invariants cover Direct Components.

### Required Future Work

- Make completion consume approved Product Structure and derived projection.
- Remove ASY existence as a universal eligibility condition.
- Preserve durable external-write and freeze guarantees across all projections.

### What Can Remain Unchanged

- Acceptance prerequisite, customer/Item resolution, durable push ledger,
  idempotency, response-loss recovery, failure recording, and successful
  completion lock.

## 18. NetSuite detailed projection

### Business Contract

BV-006 maps Detailed Direct Components to flat NetSuite Item lines. Commercial
cost values remain outside Product Structure but may participate under approved
projection contracts.

### Current Repository

- `sales-orders.ts` builds flat numeric Item lines.
- `markComplete.ts` creates one line per ASY/LEAF membership with quantity based
  on accepted tier quantity and membership quantity, and rate from the LEAF
  effective sell.
- SKU resolution and unit-cost custom-column projection are established.

### Gap Analysis

- **Already matches:** flat Item-line payload shape and numeric rate handling.
- **Identity/runtime:** source lines must currently be ASY members.
- **Business:** a Product-backed LEAF is flattened regardless of commercial
  meaning, while a Direct Component cannot be projected.
- **Projection:** approved non-component line participation is not derived from
  the BV model.

### Required Future Work

- Source detailed lines from canonical Direct Component attachments.
- Preserve quantity, rate, accepted total, SKU resolution, and audit linkage.
- Ensure Product-backed lines are flattened only when an approved projection
  requires it.

### What Can Remain Unchanged

- Sales Order line serializer, numeric rate shape, Item resolver, tax omission
  behavior, custom SKU/unit-cost fields, and payload validation.

## 19. NetSuite Item Group projection

### Business Contract

BV-006 states that Item Group is a possible grouped Product projection, not an
automatic consequence of ASY membership. Membership may include governed
Component structure plus approved projection-only commercial-cost lines. Final
applicability and mapping remain separate readiness gates. BV-008 defers Item
Group behavior.

### Current Repository

- `netsuite_item_groups`, composition hashing, provider methods, and sandbox
  smoke coverage exist.
- Active completion deliberately skips Item Group find/create because controlled
  REST and SOAP probes found Sales Order create incompatible with the required
  group-line behavior.
- Current production path emits flat LEAF lines and relies on a manual NetSuite
  wrap step for grouped invoicing.

### Gap Analysis

- **Downstream projection/external integration:** Item Group projection is not
  active and the transport behavior is not production-ready.
- **Business:** no approved applicability datum or membership derivation from
  Commercial Representation plus Commercial Cost Model.
- **Runtime:** dormant primitives are not connected to the BV Product meaning.

### Required Future Work

- Close the separate Item Group business and external-integration readiness
  gates.
- Map approved grouped representation and projection-only cost lines into the
  established downstream contract when authorized.
- Preserve correct behavior for non-Item-Group projections.

### What Can Remain Unchanged

- Composition-hash primitives, local recovery/cache concepts, provider
  isolation, and sandbox smoke assets may remain if revalidated against the
  finally approved integration path.

## 20. Audit

### Business Contract

BV-008 requires attributable authorization, preserved prior state, transition
facts, pricing decision evidence, and one complete audit event. Undo Grouping
preserves both grouping and reversal evidence.

### Current Repository

- Generic `audit_log` supports actor, entity type/ID, action, JSON diff,
  timestamp, labels, and causal links.
- Existing actions audit Product creation/deletion, membership attach/detach,
  ordering, costs, pricing overrides, sends, revisions, acceptance, completion,
  and cloning.
- No BV-008 Structural Transition event model exists.

### Gap Analysis

- **Already matches:** general append-oriented evidence facility and action-level
  audit conventions.
- **Runtime/documentation:** grouping authorization, preserved commercial state,
  Undo Grouping, Dissolve Product, and atomic transition evidence are absent.
- **Identity:** audit references reflect current ASY/membership identities.

### Required Future Work

- Define audit coverage for every approved Structural Transition and operator
  authorization.
- Preserve old/new canonical identities and commercial applicability without
  destroying prior evidence.

### What Can Remain Unchanged

- Generic audit table, authenticated actor linkage, JSON diff capacity, causal
  linkage, and existing unrelated audit events.

## 21. Historical snapshots

### Business Contract

BV-006 requires sent, accepted, completed, and historical commercial meaning to
remain unchanged. BV-008 preserves pre-transition Product Structure, selling
prices, specifications, notes, and authorization evidence.

### Current Repository

- `quote_snapshots` versions send-time commercial defaults, prepared-by data,
  PDF axes, artifact URL, and accepted-tier snapshot JSON.
- `quote_leaves.leaf_spec_version_id` pins LEAF specifications at send.
- The PDF artifact is generated before the Quote becomes sent.
- Revision supersedes the current snapshot but retains history.
- Durable NetSuite pushes retain payload snapshots.

### Gap Analysis

- **Already matches:** immutable sent artifact and version lifecycle.
- **Schema/projection:** Product Structure is not captured through one canonical
  historical attachment contract; spec pins require ASY.
- **Transition history:** no snapshot/evidence model covers BV-008 grouping and
  dissolution semantics.
- **Migration:** legacy ASYs cannot be assumed to mean customer-visible Products.

### Required Future Work

- Ensure exact Product Structure and commercial attachment identity are
  reconstructable for every protected lifecycle state.
- Reconcile legacy rows without inferring business meaning.
- Preserve existing accepted and NetSuite payload evidence.

### What Can Remain Unchanged

- Snapshot versioning, supersession timestamps, immutable PDF artifacts,
  accepted snapshot retention, and durable outbound payload evidence.

## 22. Validation harness

### Business Contract

BV-006 through BV-008 require proof of Direct/Product structure, transition
authorization, data preservation, lifecycle freeze, derived representation,
customer evidence, and downstream projection without accidental external calls.

### Current Repository

- The validation system includes isolated database fixtures, fake providers,
  network denial, unit contracts, Playwright browser tests, artifact capture,
  scenario registry, and an authoritative merge gate.
- Existing scenarios cover Product Library, ASY/LEAF Setup, costing, pricing,
  customer PDF, lifecycle, completion, and NetSuite adapters in varying states.
- Item Group and mark-complete smoke tools exist separately for controlled
  external validation.

### Gap Analysis

- **Already matches:** isolation architecture and layered validation approach.
- **Fixtures/testing:** current representative Product data assumes ASYs.
- **Coverage:** no Direct, mixed, single-Component Product, grouping,
  Undo Grouping, Dissolve Product, or transition-preservation scenarios.
- **Database invariants:** no canonical attachment reconciliation suite exists.

### Required Future Work

- Extend deterministic fixtures and the Scenario Registry to all approved
  Product Structure and transition states.
- Add database, unit, browser, artifact, lifecycle, and projection invariants.
- Retain strict outbound isolation and require controlled external evidence only
  for separately approved integration tests.

### What Can Remain Unchanged

- Validation environment isolation, fake-provider composition, network denial,
  artifact directories, merge-gate discipline, and formula-source testing
  principle.

## Cross-cutting divergence classification

| Divergence class | Current impact |
| --- | --- |
| Documentation | ASY-only comments and operator language conflict with Components/Products terminology and derived representation rules. |
| Runtime | Setup, attachment, costing, customer view, completion, and projection require ASY-backed Components. |
| Schema | Direct attachment is unavailable; costing and specification identities are split; current foreign keys depend on `assembly_leaves.id`. |
| Migration | Existing memberships, cost references, overrides, targets, spec pins, snapshots, audits, and historical Quotes require deterministic reconciliation without inferred business meaning. |
| Downstream projection | Active NetSuite projection is always flat ASY-member LEAF lines; Direct and governed grouped projection are unavailable. |
| Testing | Existing fixtures and scenarios do not cover the frozen BV structure and transition invariants. |

## Unresolved architectural questions

1. What existing or future identity is authoritative for every quote-specific
   commercial Component attachment across Direct and Product-backed contexts?
2. What is the exact relationship among commercial attachment identity,
   Product membership identity, and specification pin identity?
3. How is established independent commercial meaning represented or proven
   without treating an automatically derived numeric sell value as PM intent?
4. What is the authoritative Product selling-price decision consumed by
   Costing, Pricing, customer artifacts, and ERP projection?
5. Which Component targets and overrides remain active after grouping,
   regrouping, moving, Undo Grouping, or Dissolve Product?
6. For architecturally supported mixed Quotes, is structure alone sufficient to
   derive behavior per commercial unit, or is another durable architectural
   boundary required before operational enablement?
7. How are Product-level and Quote-level Commercial Cost Model values attributed
   after Structural Transitions without making them Product children?
8. What complete historical structure must be retained in addition to existing
   PDF artifacts, spec pins, accepted snapshots, and NetSuite payload snapshots?
9. What authoritative evidence can classify legacy ASYs as customer-visible
   Products, and which rows require operator review?
10. How should a single-Component Product and an independently commercialized
    instance of the same LEAF remain distinct through costing and projection?
11. What final Item Group authorization and external integration path will
    govern grouped projection?
12. What approved contract governs Product Structure correction after
    acceptance and before completion?

## Estimated implementation domains

This is a domain inventory, not an effort estimate or priority order.

- Business-contract traceability and repository documentation
- Database model and integrity constraints
- Historical data reconciliation and migration validation
- Quote-scoped identity and reference mapping
- Product Setup server actions and operator surface
- Product Library attachment and membership projection
- Costing adapters and cost-input ownership
- Commercial pricing authority, overrides, and targets
- Commercial Representation derivation
- Customer Preview normalization
- Customer PDF pricing and specification addendum
- Quote cloning and revision lifecycle
- Historical snapshots and artifact reproducibility
- Completion eligibility and durable external-write orchestration
- NetSuite detailed-line projection
- NetSuite Item Group readiness and projection
- Audit and operator authorization evidence
- Deterministic fixtures, database invariants, browser validation, and controlled
  integration evidence

## Dependency graph

```text
BV-006 ───────────────┐
                     │
BV-007 ───────────────┼──> Canonical Quote Attachment
                     │
BV-008 ───────────────┘
                               │
                               ├──> Product Structure
                               │         │
                               │         ├──> Product Setup
                               │         ├──> Product Library Membership
                               │         └──> Historical Structure
                               │
                               ├──> Commercial Cost Model
                               │         │
                               │         └──> Costing
                               │                  │
                               └──────────────────┴──> Pricing Authority
                                                        │
                                                        └──> Commercial Representation
                                                                  │
                                                                  ├──> Customer View
                                                                  │        │
                                                                  │        └──> Customer PDF
                                                                  │
                                                                  └──> Completion
                                                                           │
                                                                           └──> NetSuite Projection

Canonical Quote Attachment ───> Quote Cloning
Canonical Quote Attachment ───> Quote Revision
Canonical Quote Attachment ───> Audit
Canonical Quote Attachment ───> Validation Invariants

Historical Structure ─────────> Customer View
Historical Structure ─────────> Customer PDF
Historical Structure ─────────> Completion Evidence

Commercial Cost Model ────────> NetSuite Projection
Audit ────────────────────────> Structural Transition Evidence
Validation Invariants ────────> All mapped consumers
```
