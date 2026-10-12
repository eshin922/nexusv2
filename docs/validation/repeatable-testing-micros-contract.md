# Repeatable associated costs — implementation contract

Status: draft implementation on `fix/repeatable-testing-micros`. No migration or application code from this branch has been deployed.

## Verified problem

The Setup picker used a checkbox for each component charge and each product-associated service. A single visit could add only one of each type. Filling / Blending and Pack-out / Assembly were then disabled after the first attachment; Testing / Micros alone had a named second-instance path. This did not match the training request: any associated cost may occur multiple times, and each occurrence needs a note that distinguishes its costing line.

## Behavior

Every component charge type (Print plates, Tooling, Artwork & plate, Samples, Project setup, R&D, Other Service) and every associable production service (Filling / Blending, Pack-out / Assembly, Testing / Micros) now has an Add action. Operators can add multiple rows of any type in one picker visit. Each new row requires a short note, unique for that type and product. The note becomes the existing charge label or service instance label; these fields already flow to Costs and downstream descriptions. Each entry retains its own economic row and can be priced separately. This is a number of distinct costs or services, not a multiplier on ordered product quantity.

Component-charge storage already supports multiple labeled instances and its action writes a submission transactionally. Migration 0148 replaces the associated-service uniqueness index with `(product, service leaf, normalized instance note)`; legacy unlabeled services remain valid. The service action accepts notes for all three governed identities. Copy Quote preserves service notes. The picker rejects blank or duplicate notes before submission; the server and database remain the final duplicate guards.

The existing picker submits charge rows together, then service rows individually. A failed service attachment can leave earlier additions saved; the picker removes successful draft rows from its local selection, stays open, reports the failure and refreshes the quote, so retry submits only remaining entries. This existing cross-type transaction boundary is still a limitation to address before calling an end-to-end multi-type submission atomic.

The training report that an associated cost could not be removed without deleting its product was verified: the charge deletion action existed, but no Setup control called it. The sheet now lists the product's attached charges and services with a two-step Remove control. It warns that draft costs for that line will be removed, then uses the existing guarded deletion paths; the product and sibling costs stay in place. In the isolated quote, removing only the Back plate charge reduced the count from four to three and kept Front plate with both tier costs. Removing only Secondary blend reduced it to two and kept Primary blend and the grouped product. Database read-back confirmed the remaining charge and service identities. No production data was changed.

## Validation and remaining proof

An isolated local PostgreSQL container (`nexus-validation-db-repeatable`, port 55437) was migrated through 0148 and seeded with the validation fixture. In the current Setup view, one product accepted two Print plates charges (Front plate and Back plate) and two Filling / Blending services (Primary blend and Secondary blend). Database read-back confirmed four independent records and their notes. In the current Costs view, the charges were independently costed at 45/60 and 25/35 across the two tiers. Direct service amounts were edited inline at 130/300 and 240/600; the Price build production contribution changed when the first service changed. The current Costs grid now owns direct-service editing and no longer sends those rows to the legacy Production editor. The redundant charge pricing-state and cost-basis badges were removed; the cost-basis selector and actionable tooling-classification warning remain.

The isolated browser walk continued through copy, pricing, finalization, customer PDF, revision, and acceptance. A copied quote retained both Print plates instances and both Filling / Blending instances with independent notes and tier values. The copied quote finalized as VAL-1000 with $748.70 and $1,908.00 tier totals. Its frozen snapshot has four charge recovery instructions, one per instance and tier. A rollback-only deletion of the two draft charge instances left all four frozen instructions and both UUID identities intact.

That walk exposed a real freeze blocker: the old snapshot uniqueness constraint allowed only one same-type charge on one owner and tier. Migration 0149 gives modern instructions uniqueness by frozen charge instance and tier, keeps the old grain for historical instructions without an instance UUID, and removes the live-instance foreign key that would erase frozen provenance on draft deletion. The migration was applied to the isolated database only. The corrected quote finalized and revised successfully.

The downloaded v2 customer PDF was inspected as a two-page document. Both named service lines and both Print plates fees appear independently, with the same totals as the preview. The walk also found that send-time PDF rendering used a UTC issue date and omitted the expiry because the resolver still saw a draft. The send now supplies its local issue date and calculated expiry to the frozen document, matching the persisted quote. The downloaded v2 PDF shows October 11, 2026 and November 10, 2026. The Preview rail no longer guesses a page count from the addendum switch.

The quote was accepted in the isolated fixture. Sales Order review correctly refused to show a postable structure because the fixture has no NetSuite item mappings for these service/charge lines and the validation server has no NetSuite credentials. No NetSuite order was sent. Sandbox NetSuite read-back remains outstanding; do not treat this as full send-to-order certification. The isolated database and fake HubSpot provider are separate from shared services; no shared migration or production NetSuite change was made. Production NetSuite remains unchanged until cutover.

After these changes, type checking, all 3,530 unit tests, and `verify:ci` pass.

Migration order: #636 (0146) → #637 (0147) → this branch (0148, 0149).
