# Product quantities across Setup, Costs, Pricing, Quote, and NetSuite

Date: 2026-09-25
Status: Implementation in progress on `feature/product-tier-quantities`.
Runtime changes and quantity migrations 0138 and 0140 are local; no production migration or deployment has been performed for this work. The user requires an accessible preview before merging and selected the isolated local preview on 2026-09-25.

## Freight scope withdrawn after preview review

The user requested removal of the new freight work and restoration of the original Freight module. The split-shipment/cargo UI, actions, workbook loading, cloning, schema declaration, proposed migration 0139, and dedicated cargo tests have been removed. Existing Freight components and actions are restored to the branch base. Per-product quantities and their costing calculations remain. Earlier freight progress entries below are historical, not current capabilities.

The isolated review database still holds the experimental cargo table and demonstration records; no stored data was deleted during the code revert. Application code no longer reads or writes those experimental records. Future fresh validation databases must use the revised migration journal. Original shipment UI was browser-checked; type checks and 44 targeted Freight/quantity tests pass after removal.

## Implementation progress

- Added per-product/per-tier quantities, Setup inputs, guarded draft writer, and shared resolution of product, recipe-member, and associated-service quantities.
- Threaded quantities into costing, commercial line totals, customer documents, clone/revision handling, and NetSuite group order quantities. Reusable recipe definitions remain independent of the ordered run.
- Preserved legacy tier inheritance and corrected direct-product composition fields so they cannot multiply an order.
- Added regression coverage for five 5,000-unit variants, mixed jars, fixed-fee amortization, shared freight across unequal runs, and NetSuite recipe identity across different runs.
- Found and corrected customer-line freight multiplication for recipe usage greater than one. Freight dollar shares remain governed by the existing worksheet rather than inferred from product proportions.
- Added independent quote-wide shipments and explicit cargo quantities/units with optional product references, guarded writers, frozen workbook support, and clone remapping. Cargo quantities do not allocate freight costs or change ordered quantities.
- Isolated migrations, database action/clone proofs, quote deep links, and the browser quantity/shipment/cargo workflow pass. The browser proof found and fixed a shipment dialog whose Add button was outside the viewport.
- Still required before merging: remaining compatibility browser gates, customer document/accepted snapshot proof, user preview review, and controlled NetSuite posting/readback. Payload unit tests do not prove a real ERP transaction.
- Current quantity authoring supports positive whole count units. Exclusion/zero quantities and unit-of-measure conversions require separate explicit semantics before being added.

Local verification on 2026-09-25: 3,452 unit tests passed; dedicated costing assertions passed; TypeScript passed. The prebuild gates passed through NetSuite adapter and migration-index verification. A fresh isolated PostgreSQL database applied all 138 migrations; the real-action walk proved quantity persistence, costing hydration, optional cargo references, cross-quote/sent-quote refusals, and clone remapping/rollback. The operator browser workflow passed in 14.5 seconds. Durable evidence is at `C:\Code\nexus-validation-runs\quantities-a128444ebb71` and `C:\Code\nexusv2-product-quantities-{unit,costing,types,prebuild}.log`.

The legacy production persistence suite was interrupted before completion when the user selected local preview review. Do not count that suite as passed. Do not reset this run's fixtures or stop its owned server/database while the user is reviewing. Run remaining mutating verification in a separate isolated run. No Vercel protection or production authentication settings were changed.

## Objective and confirmed requirements

### Review correction — 2026-09-25

The user rejected the separate product-quantity matrix. Quantity authoring now opens from **Add sub-quantity**, beside **Add associated costs** on a standalone product row. Unequal runs are independent facts, not equal fractions of a tier: 200 + 100 + 100 + 50 + 50 within a 500-unit option is covered by a costing/projection regression. The separate matrix is removed.

The user also confirmed that a grouped product's override must affect that product only, leaving other members and the group quantity unchanged. This is a new requirement beyond the initial fixed-recipe model and is **not yet implemented end to end**: the initial writer/resolver still reject grouped-member overrides. Do not claim that path is complete or enable a writer that leaves costing or NetSuite inconsistent. Item groups are optional; the user is reconsidering their usefulness, not instructing deletion of historical grouping data. Independent standalone product lines support the variant example without groups.

The isolated review demo is a separate draft, `c5e4ba18-ee1f-48fa-9d44-4b46a1db20a4`, with five standalone gummy rows at 200/100/100/50/50. Its owned data IDs are recorded in the external validation root's `review-demo-ownership.json`; do not reset or delete it during user review.

Support an order scenario containing independently quantified products. A 25,000-unit scenario can contain five finished variants at 5,000 each, with 25,000 jars and cartons in total. Also support a finished jar containing multiple gummy SKUs, and combinations of these workflows.

Quantities must propagate through Setup, Costs, Pricing, customer documents, acceptance snapshots, and NetSuite. Associated services remain separately priced NetSuite service lines attributed to their owning product. Customer presentation may include service pricing within a product price; the NetSuite product amount must exclude the amount carried by the service lines.

Do not automatically create item groups, infer recipes, assume supplier volume discounts, or calculate an allocation that the operator already determines. Freight remains governed by the existing freight workflow; its quantity-dependent denominators and displayed totals require auditing.

## Freight — independent split-shipment workflow

User clarification, 2026-09-25: support split shipments, but shipments are not
necessarily tied to the product subquantity grouping. Freight is an independent
shipment structure, not a child automatically created for each item group.

- One shipment may combine several variants/groups; one variant/group may
  travel in several shipments. Inbound packaging and outbound finished goods
  can have distinct plans and units.
- Keep shipment, destination/leg, and cargo quantities explicit. Optional cargo
  references identify products/components where meaningful; there is no
  mandatory one-shipment-per-group or one-shipment-per-variant relationship.
- Capture the operator's freight costs and attribution, preserving existing
  worksheet authority. Do not infer cost allocation from variant proportions.
- Validate balance only within an explicitly defined movement scope. Cargo on
  consecutive legs is not duplicate order demand, and inbound jars must not be
  reconciled as outbound finished goods.
- Freight cost totals must count each governed charge once. A shipment's cargo
  quantity and the product quantity used to express a price contribution are
  distinct denominators.
- Freeze the quoted freight arrangement/costs with the commercial snapshot.
  Later operational splits, dates, or actual shipped quantities cannot reprice
  an accepted quote silently.
- Verify mixed cargo, partial shipments, independently split packaging,
  different destinations, sequential legs, and explicit shared-cost allocation
  through Costs, customer documents, and NetSuite's existing freight treatment.

## Shared foundation — implement before individual surfaces

### Item group role

Use an item group as the recipe/composition of one finished sellable product.
Its order quantity is a separate per-tier fact: 5,000 groups can each contain
one jar, one carton, and a recorded number of gummies. A mixed jar can contain
several gummy SKUs. Keep the overall variant allocation at the quote scenario
level. Do not create a synthetic 25,000-unit parent group with fractional
variant members; varying order splits must not change reusable NetSuite group
definitions. Standalone products remain independently quantified without
requiring a group.

### Quantity meanings

| Fact | Meaning | Authority |
|---|---|---|
| Tier/scenario | An alternative order configuration | Operator |
| Product quantity per tier | Finished units or standalone product units ordered | Operator |
| Component usage | Units of a component in one finished product | Operator's recorded composition |
| Component requirement | Product quantity multiplied by recorded component usage | Nexus arithmetic |
| Unit of measure and conversion | What each quantity measures and any explicit conversion | Recorded product/supplier information |
| Procurement quantity | Supplier order quantity, including any independently determined overage/MOQ | Operator; distinct from customer quantity |

A 20% share of an order is not a component usage factor. Preserve the existing meaning of `qtyPerParent`; do not use fractional composition to represent an order split.

Illustration: five variants at 5,000 jars each, one jar and one carton per finished unit, require 25,000 jars and 25,000 cartons. Separately, 25,000 mixed jars containing two of each of five gummy SKUs require 50,000 individual gummies of each SKU. These examples are explicit compositions, not assumptions about actual recipes.

### Proposed storage and calculation contract

- Add versioned quote quantity behavior: legacy tier inheritance and explicit product quantities. Do not reinterpret old records simply because a new reader is deployed.
- Store quantity against the quote-specific product or item-group occurrence and tier, not just the library SKU. The same SKU can participate in several distinct products.
- Make quantity state explicit: inherited, entered, not yet entered, or excluded. An excluded product is not a missing quantity and is not a free product.
- Record each product's unit of measure. Count-based units require whole quantities; measured units use appropriate decimal precision. Avoid implicit unit conversion.
- Use a single quantity resolver that returns product quantity, component quantity, units, owner identity, and source for each tier. Costing, commercial projection, documents, and NetSuite consume it.
- Resolve associated-service billing quantity from its basis: per finished unit, per component unit, fixed fee, or explicitly entered production quantity. Do not assign the tier quantity to every service.
- Derive the finished-unit scenario total only from the designated finished products with compatible units. Do not sum packaging, services, or unlike units into that total. Show the product breakdown when a meaningful single total does not exist.
- Extend copy, clone, revision, imports, audit history, and pricing fingerprints alongside the schema. Enforce ownership, quote/tier consistency, uniqueness, and nonnegative quantity constraints at write boundaries.

### Design decisions to record before production code

The user has confirmed both separate variants and mixed contents. Record that disposition against the existing tier-only contracts, including OD-026. Finalize the quantity table design, exclusion behavior, unit precision/conversions, whether a scenario target is advisory or mandatory, and the operator's shared-cost allocation workflow. Preserve inherited quantities as the compatibility default. These are outstanding design details, not claims that behavior is already approved or implemented.

## Stage 1 — Setup

### User workflow

1. Add standalone products or explicitly create finished-product item groups using existing controls.
2. Enter order quantities in a table with products as rows and tiers as columns. Show unit labels and whether each value is inherited or entered.
3. For a finished product, enter its component usage per finished unit. Shared library SKUs may be used in multiple products without merging the quote occurrences.
4. Show calculated component requirements as a read-only explanation of the entered quantities.
5. When tier size changes, identify which inherited quantities changed and which explicit quantities require review. Do not silently rebalance a 5,000/5,000/15,000 split.
6. Preserve existing rows and actions, including associated costs, library specifications, and removal. Quantity controls should use the established visual treatment.

### Implementation

Add occurrence-by-tier quantity storage and actions, integrate the common resolver with the costing adapter, and update all creation/copy/removal paths. Exclude service rows from finished-product totals. Define handling of group conversion and moving components so explicit quantities cannot be silently lost.

### Exit evidence

Five variants at 5,000 persist through reload and revision; common jars/cartons total 25,000. A mixed jar derives each gummy requirement correctly. An unequal split and an excluded product remain explicit across multiple tiers. Missing quantities block sending rather than becoming zero-priced lines.

## Stage 2 — Costs

### User workflow

Display the quantity and unit beside each cost input. A price must clearly be per gummy, per jar, per kg, per batch, or a total charge. Keep supplier pricing as entered; combined demand is information, not automatic price-break selection.

Associated costs follow their owners and cost bases:

- Product/unit costs extend over that product's resolved quantity.
- Component costs extend over component demand with explicit unit conversion where needed.
- Filling and similar per-unit services follow the relevant product quantity.
- Batch-based services use a recorded batch quantity or total; do not infer batch size.
- Product-specific fixed charges use that product's quantity when expressing a per-unit contribution.
- Shared charges record the operator's distribution across selected products; validate that allocated amounts reconcile to the source charge and do not count it twice.

### Implementation

Replace tier-only multiplication and division in rollups, associated-service handling, commercial recovery, and quantity-dependent freight displays. Calculate total cost before deriving per-product unit costs. Keep existing recovery choices: cost, recovery amount, and customer presentation are distinct facts. Do not force all fixed costs into customer unit price.

Audit inventory availability, vendor costing, MOQ references, and component demand displays for quantity assumptions. Procurement quantity must not silently change customer quantities or billed revenue.

### Exit evidence

A $1,000 product-specific cost over 5,000 units contributes $0.20/unit. If the operator allocates that same $1,000 as $200 to each of five products, the total remains $1,000. Changing a variant quantity updates affected costs and preserves entered supplier prices. Missing or excluded quantities cannot cause division by zero.

## Stage 3 — Pricing

### User workflow

Show each product's actual quantity, cost per unit, selling price per unit, extended amount, and margin in each scenario. Show overall revenue, cost, and margin from extended totals. A blended price per finished unit is a labeled summary only when its denominator is meaningful; it is not the price used to bill every product.

### Implementation

Feed resolved quantities into commercial projection, price adjustments, targets, overrides, recovery, approval checks, and pricing fingerprints. Preserve the existing pricing authority and override rules. A quantity or composition edit invalidates the relevant calculated pricing/review status without silently deleting negotiated inputs. Revalidate send readiness.

Compute overall margin as `(total revenue - total cost) / total revenue`, with explicit zero-revenue behavior. Never average product margins or multiply an average product price by the tier quantity as a substitute for line totals.

### Exit evidence

Use unequal quantities and unequal prices to prove totals and weighted margins. Editing one product's quantity updates its amount and overall totals; any shared allocation follows the recorded policy. Customer bundling of services leaves total revenue unchanged. No obsolete reviewed price remains eligible for send after a quantity change.

## Stage 4 — Quote and acceptance

### User workflow

Each scenario presents the relevant products, their quantities, units, prices, and totals. Five 5,000-unit variants must not appear as five 25,000-unit lines. Group contents may be presented using the existing profile choices while preserving quantities in the underlying commercial record.

### Implementation

Use the shared projection for screen, PDF, public/customer views, and acceptance. Snapshot the selected scenario, occurrence identities, product/component quantities, units/conversions, composition, service ownership, prices, and presentation choices together. Freeze inputs required to reproduce downstream amounts; do not recalculate accepted orders from a mutable library.

Clone and revision create editable copies using the correct quantity model. Previously sent/accepted snapshots retain their original quantities, prices, and rendering semantics. Excluded lines are omitted consistently; incomplete included lines block send with a specific explanation.

### Exit evidence

The interactive quote, PDF, accepted snapshot, and pricing totals agree. Library edits after acceptance cannot change the order. Revising a quote preserves the old version while allowing a new mix. Bundled and separately displayed service prices reconcile to the same agreed amount.

## Stage 5 — NetSuite

### Required behavior

- Use the accepted product quantity for each independent product or group occurrence.
- Keep group-definition usage per finished unit distinct from transaction quantities. A 5,000-unit group containing two units of a member expands to 10,000 member units exactly once.
- Keep the same SKU used under different products attributable to its original owner. Aggregated demand views do not authorize collapsing accounting lines.
- Send associated services as separate priced service lines identified by stable owner references and readable product/SKU descriptions.
- When a service price is included visually in a customer product line, exclude that amount from the NetSuite product line and retain it on its service line. Combined amounts must match the accepted quote.
- Preserve existing item classification and mapping rules. Validate supported units and conversions; never round unsupported fractional quantities into different obligations.

### Implementation

Update grouping-plan inputs, per-group quantities, frozen-order checks, mark-complete, export payload construction, retry behavior, and reconciliation. Audit integer coercions and assumptions that every group shares `tierQty`. Preserve composition hashes as per-unit definitions, independent of order size. Determine the supported ownership fields from the existing NetSuite integration rather than inventing custom field IDs.

### Exit evidence

Verify generated payloads and a controlled NetSuite test order for both separate variants and mixed contents, with repeated SKUs and associated services. Read back quantities, units, rates, extended amounts, and ownership. Reconcile against the accepted snapshot, with explicit rounding tolerances; retrying must not duplicate the order or service lines. Mock payload tests alone do not establish successful ERP posting.

## Compatibility and release sequence

1. Complete the quantity-consumer audit and record the business/design dispositions. Cover Setup, all Costs views, Pricing, PDFs, acceptance, imports, revisions, freight denominators, inventory displays, and NetSuite.
2. Add schema and a resolver with legacy behavior preserved. Validate migrations on representative historical data; deploy schema before readers depend on it.
3. Build all five stages behind one feature boundary. Do not enable mixed quantities for users until the entire quote-to-order path passes.
4. Rehearse both primary examples and regressions in the isolated validation environment. Compare old and new readers against legacy fixtures for unchanged amounts and quantities.
5. Release to a controlled set of new drafts, then expand after production verification. Existing drafts change model only through an explicit, reviewable conversion; historical accepted records are never reinterpreted.
6. Rollback must preserve already-created explicit-quantity quotes. If new authoring is disabled, keep compatible readers/export behavior or block affected operations clearly; never fall back to multiplying all products by the tier quantity.

## Permanent acceptance matrix

| Scenario | Required result |
|---|---|
| Legacy quote with no explicit quantities | Same quantities, totals, and ERP representation |
| Five variants at 5,000 | 25,000 finished units; each variant remains 5,000 |
| Unequal variant split | Correct per-line extensions and overall margin |
| Mixed jar with multiple gummy SKUs | Recorded contents expanded once using correct units |
| Separate variants plus mixed jar | Both models coexist in one scenario |
| Same packaging SKU across products | Combined demand visible; ownership retained |
| Multiple tiers with different product mix | Each scenario resolves independently |
| Missing / excluded / invalid quantity | Distinct behavior; no silent free line or divide-by-zero |
| Product-specific / shared fixed charges | Correct denominator and no duplicate cost |
| Associated service bundled on customer quote | Separate ERP service amount; no duplicated revenue |
| Clone / revision / accepted snapshot | Correct copy semantics and historical immutability |
| NetSuite group member multiplier | No double expansion or integer truncation |
| Failed export and retry | No duplicate transaction or line |

Completion means operator-visible quantity entry and verified calculations/documents/ERP output for both workflows. A deployed page, passing build, or new quantity column is not sufficient.

## Initial code trace for implementation

- `src/db/schema.ts`: quote tiers, quote leaves, assembly usage, and frozen line quantities.
- `src/lib/product-structure/direct-component-quantity.ts`: current OD-026 tier-only direct-product invariant; retain multiplicity meaning while introducing order quantity separately.
- `src/lib/costing-adapter.ts`, `src/lib/costing.ts`: structure adaptation, consumption, cost rollups, and allocation weights.
- `src/lib/commercial-recovery/construct.ts`: fixed-charge amortization currently takes tier quantity.
- `src/lib/commercial-projection.ts`: current line quantity starts from tier quantity times multiplicity.
- `src/lib/pricing-cost-base.ts`: pricing invalidation and cost fingerprint.
- `src/lib/customer-money.ts`, `src/lib/customer-view-resolver.ts`: per-line amounts and summary denominators.
- `src/lib/netsuite/grouping-plan.ts`, `grouping-plan-adapter.ts`, `frozen-order-assembly.ts`, `mark-complete.ts`: group expansion and accepted quantity reconciliation.

This list is an initial trace, not a claim that the quantity-consumer audit is complete. The implementation must also follow the repository's eight implementation gates and merge validation requirements.

## Replacement freight workflow: one percentage across all options

After withdrawing cargo-entry work, the user requested a Split shipment button beside Record shipment. The replacement selects an existing unsplit shipment and one percentage, applies it to every order option, rounds the first part, and assigns the exact remainder to the second. Whole-unit totals are conserved; percentages producing an empty part are refused. The original section and a new section each persist a split plan. Shipment details, product references, and destination identities are copied; monetary amounts and tracking are not duplicated. Enter new-section freight charges separately. Draft locking, audit, frozen worksheet inclusion, and clone tier remapping are included. Migration 0141 adds nullable split_plan; it was applied only to the owned isolated review database.

Browser proof created Percentage split example and reloaded 30/70 units for the 100-unit option and 150/350 units for the 500-unit option. Type checks and 29 targeted tests passed. No production deployment has occurred. Existing split sections cannot be split a second time by this first implementation.

## Operator review and release scope — September 26, 2026

The operator approved merging the local preview. Quantity entry lives on each product row, including grouped products; item groups remain optional. Shipment record/split actions align to the right edge of their header. Edit destination uses the destination's existing inset; shipment edit actions retain their location while the form expands. The service library confirms attached direct services and services do not create freight sections.

The persisted calculation walkthrough exercises five unequal gummy runs, an independently quantified packaging group/member, two direct services, product-associated testing, included samples, separately recovered print plates, a global pricing adjustment, and percentage-split domestic freight. Independent calculations reconcile to costs of $1,225 / $1,873 and customer totals of $2,084.25 / $3,309.25. Presentation folding preserves totals and the separate accounting service line. The browser reached Send and generated a draft PDF; it did not send, accept, or post a live NetSuite order.

Known limits disclosed before approval: customs/duty/tariff were not exercised in the operator walkthrough; an eight-product freight allocation exposed a two-cent unrounded Pricing versus published-line Quote discrepancy; the price-build selector can label priced direct services as not priced. The final packaging-only fixture reconciles exactly but does not resolve these other cases. Existing customs behavior is retained. Do not claim live NetSuite certification from projection or unit tests.

Apply migrations 0138, 0140, and 0141 before deploying their readers. They add the quantity table, permit grouped product overrides, and add nullable freight split metadata. Existing records keep tier inheritance and original freight behavior. The reviewed local fixture script and evidence remain outside the repository; permanent quantity/freight/NetSuite invariants are covered by the committed tests.
