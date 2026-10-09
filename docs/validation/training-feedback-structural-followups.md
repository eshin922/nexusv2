# Training feedback: structural follow-ups

These items are confirmed gaps but are not part of PR #634. Each crosses persisted quote structure or the frozen Sales Order contract. Keep the sandbox NetSuite changes separate from production cutover.

## 1. Repair historical Item Group duplication — completed for Smart Press Alt 1

Smart Pressed Juice Alt 1 had eight library SKUs represented by two separate quote product rows each. The standalone rows owned the entered 5,000/10,000 tier quantities; the grouped rows owned the group membership. Three pairs had different unit costs. The user authorized discarding duplicate test-quote pricing. A guarded transaction transferred the eight tier quantities to the grouped rows and removed the standalone copies, retaining grouped costs. Database and live Setup/Costs read-back passed. The steps below remain the procedure for any future quote with this defect; do not rerun the one-off repair on an unrelated quote.

1. Capture a before snapshot of both quote-leaf IDs, tier quantities, unit costs, specification versions, dependent charge/service IDs, quote totals, and customer-visible rows.
2. For each paired SKU, retain the grouped quote-leaf ID and transfer the standalone tier quantities to it. Choose which existing unit cost to retain based on the operator's decision, not on row order.
3. Check for non-identical specs and dependent charges/services before deleting a standalone copy. Resolve these explicitly; a deletion that cascades either is not acceptable.
4. Remove the redundant quote row and recompute Costs, Pricing, PDF, and the NetSuite projection for every tier. Assert one economic owner and one customer-visible placement per SKU. Save before/after evidence and a reversible repair record.
5. Add a regression for the current Setup picker: moving an existing quote product into a group preserves its quote-leaf ID, tier quantities, costs, specs, and dependents; it must not attach the same library SKU a second time.

## 2. Repeatable Testing / Micros instances

The current checkbox is keyed by one service identity. `attachDirectProduct` refuses a second service/product pair, and `quote_leaves_product_service_unique_idx` enforces that in the database. This is why several tests cannot be represented by clicking the checkbox again.

1. Define each ordered test as its own service instance with a required, distinct label and optional test quantity. The label must distinguish, for example, micro screening from stability testing; the service SKU stays the governed Testing / Micros SKU unless Accounting chooses separate SKUs.
2. Replace the pair-level uniqueness rule with instance-level identity. Preserve one standalone service per quote if that remains the intended direct-service behavior; do not silently permit duplicate product lines.
3. Let Setup add and remove labeled test instances. Give every instance its own per-tier cost in Production, its own recovery choice and customer presentation, and a separate NetSuite service line linked by stable product and instance IDs.
4. Extend quote copy, revision, frozen snapshot, acceptance, retry, and NetSuite read-back tests. Include two tests on one product, the same test on two products, and an existing single-test quote.

## 3. Services owned by grouped products

The current composite foreign key requires an associated service's target product to be direct. The picker correctly blocks a grouped product under that rule. A UI-only unlock would fail at the database and could misattribute costs.

1. Change the target constraint to require a same-quote product without requiring `is_direct=true`; keep services as separate top-level commercial and NetSuite lines.
2. Update Setup's associated-service picker, owner labels, delete/reorder behavior, and group member counts. The service must follow its product when the product moves between Direct and a group.
3. Reconcile Costs, Pricing, customer quote, copy/freeze, Sales Order line mapping, and ordered-spec exclusion. Test group membership changes before and after a service is attached, with no duplicate charge or NetSuite line.

## 4. Useful specs for generic turnkey products

The live Smart Press Alt 2 SKU DPS-SPJ-1002 is classified in HubSpot as `Filling and Packout Services`. That category is explicitly mapped to `no_schema`, so Nexus correctly displays “Specifications not applicable.” A free-text box on the page alone would create values that are neither frozen nor exported.

1. Confirm the intended HubSpot Product Type for these SKUs. If they are products rather than service lines, correct classification at the source before changing the schema mapping.
2. Define a governed generic or turnkey specification schema with a free-form field, versioning, and a clear disposition for truly non-specifiable services.
3. Extend quote spec entry, freeze, customer addendum, Order Packet, and NetSuite ordered-spec record/read-back. Keep formula references withheld under the existing disclosure rule.
4. Validate a direct product and group member with multiline specs, then verify copy, revision, and sandbox Sales Order transfer.

## 5. Decisions and reproductions still needed

- Circadian one-time-charge margin: decide whether a charge at 20% markup may proceed when it lowers blended margin below the firm floor. The Pricing notice in PR #634 exposes undecided recovery; it does not change approval policy.
- Dr. Squatch freight: the current quote reads nonzero. Reproduce the exact edit/delete/refresh sequence on a disposable quote before changing the freight writer.
- Air/ocean customer alternatives: deferred by the training call. Keep separate from split shipments and existing internal freight scenarios.
