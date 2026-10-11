# Repeatable associated costs — implementation contract

Status: draft implementation on `fix/repeatable-testing-micros`. No migration or application code from this branch has been deployed.

## Verified problem

The Setup picker used a checkbox for each component charge and each product-associated service. A single visit could add only one of each type. Filling / Blending and Pack-out / Assembly were then disabled after the first attachment; Testing / Micros alone had a named second-instance path. This did not match the training request: any associated cost may occur multiple times, and each occurrence needs a note that distinguishes its costing line.

## Behavior

Every component charge type (Print plates, Tooling, Artwork & plate, Samples, Project setup, R&D, Other Service) and every associable production service (Filling / Blending, Pack-out / Assembly, Testing / Micros) now has an Add action. Operators can add multiple rows of any type in one picker visit. Each new row requires a short note, unique for that type and product. The note becomes the existing charge label or service instance label; these fields already flow to Costs and downstream descriptions. Each entry retains its own economic row and can be priced separately. This is a number of distinct costs or services, not a multiplier on ordered product quantity.

Component-charge storage already supports multiple labeled instances and its action writes a submission transactionally. Migration 0148 replaces the associated-service uniqueness index with `(product, service leaf, normalized instance note)`; legacy unlabeled services remain valid. The service action accepts notes for all three governed identities. Copy Quote preserves service notes. The picker rejects blank or duplicate notes before submission; the server and database remain the final duplicate guards.

The existing picker submits charge rows together, then service rows individually. A failed service attachment can leave earlier additions saved; the picker removes successful draft rows from its local selection, stays open, reports the failure and refreshes the quote, so retry submits only remaining entries. This existing cross-type transaction boundary is still a limitation to address before calling an end-to-end multi-type submission atomic.

## Validation and remaining proof

An isolated local PostgreSQL container (`nexus-validation-db-repeatable`, port 55437) was migrated through 0148 and seeded with the validation fixture. In the current Setup view, one product accepted two Print plates charges (Front plate and Back plate) and two Filling / Blending services (Primary blend and Secondary blend). Database read-back confirmed four independent records and their notes. In the current Costs view, the charges were independently costed at 45/60 and 25/35 across the two tiers. Direct service amounts were edited inline at 130/300 and 240/600; the Price build production contribution changed when the first service changed. The current Costs grid now owns direct-service editing and no longer sends those rows to the legacy Production editor. The redundant charge pricing-state and cost-basis badges were removed; the cost-basis selector and actionable tooling-classification warning remain.

Type checking and 3,529 unit tests pass. Copy/freeze, customer quote output, and sandbox NetSuite read-back have not been exercised in this local browser walk; do not treat it as full send-to-order certification. The isolated database is separate from the shared database; no shared migration or production NetSuite change was made. Production NetSuite remains unchanged until cutover.

Migration order: #636 (0146) → #637 (0147) → this branch (0148).
