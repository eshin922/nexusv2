# Repeatable associated costs — implementation contract

Status: draft implementation on `fix/repeatable-testing-micros`. No migration or application code from this branch has been deployed.

## Verified problem

The Setup picker used a checkbox for each component charge and each product-associated service. A single visit could add only one of each type. Filling / Blending and Pack-out / Assembly were then disabled after the first attachment; Testing / Micros alone had a named second-instance path. This did not match the training request: any associated cost may occur multiple times, and each occurrence needs a note that distinguishes its costing line.

## Behavior

Every component charge type (Print plates, Tooling, Artwork & plate, Samples, Project setup, R&D, Other Service) and every associable production service (Filling / Blending, Pack-out / Assembly, Testing / Micros) now has an Add action. Operators can add multiple rows of any type in one picker visit. Each new row requires a short note, unique for that type and product. The note becomes the existing charge label or service instance label; these fields already flow to Costs and downstream descriptions. Each entry retains its own economic row and can be priced separately. This is a number of distinct costs or services, not a multiplier on ordered product quantity.

Component-charge storage already supports multiple labeled instances and its action writes a submission transactionally. Migration 0148 replaces the associated-service uniqueness index with `(product, service leaf, normalized instance note)`; legacy unlabeled services remain valid. The service action accepts notes for all three governed identities. Copy Quote preserves service notes. The picker rejects blank or duplicate notes before submission; the server and database remain the final duplicate guards.

The existing picker submits charge rows together, then service rows individually. A failed service attachment can leave earlier additions saved; the picker removes successful draft rows from its local selection, stays open, reports the failure and refreshes the quote, so retry submits only remaining entries. This existing cross-type transaction boundary is still a limitation to address before calling an end-to-end multi-type submission atomic.

## Validation and remaining proof

Type checking and focused tests pass. Full unit and CI checks are being rerun. Before production use, run a draft-quote browser walk with two of the same charge and two of the same production service, independently cost each row, copy and freeze the quote, and verify distinct customer and sandbox NetSuite lines. That browser walk requires a database with migration 0148 applied; this branch has not modified the shared database. Production NetSuite remains unchanged until cutover.

Migration order: #636 (0146) → #637 (0147) → this branch (0148).
