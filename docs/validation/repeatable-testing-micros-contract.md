# Repeatable Testing / Micros — verified gap and implementation contract

Status: draft implementation on `fix/repeatable-testing-micros`. The working choice is individually priced, named test instances; the user has been asked whether they instead want one counted line. No migration or application code has been deployed.

## Reproduction from current code

The associated-cost picker renders Testing / Micros as one checkbox keyed by service identity and disables it once present (`add-component-charges-sheet.tsx`). `attachDirectProduct` rejects a second row with the same product and library leaf. The database's `quote_leaves_product_service_unique_idx` independently enforces that one-row limit. Therefore the reported need for two or three tests cannot be solved by changing only the picker.

## If tests are individually priced

Model each named test as its own top-level service quote leaf, linked to the owning product quote leaf. The implemented picker requires a nonblank distinct label for every new test; historical unlabeled test lines remain valid. Migration 0148 replaces the `(product, service leaf)` unique index with an index that also keys the normalized label. Each instance retains its own cost row, customer line or included-service contribution, and NetSuite service line. The label is carried through Setup, Costs, commercial projection, quote freeze, Copy Quote, customer display, and NetSuite description. The number of attached instances is the test count; product ordered units remain a separate fact.

The code-level proof covers two differently named tests with independent costs, customer subtotal conservation, and two distinct NetSuite-shaped lines. A draft-quote browser walk, copy/revise/freeze read-back, and sandbox NetSuite write/read-back remain before production deployment. They require a database with migration 0148 applied; the shared database has not been modified by this branch.

## If tests share one counted service line

Keep one service quote leaf and add an explicit test count plus notes. Determine whether vendor cost is per test or a one-time combined total before changing calculations. Verify that the customer and NetSuite quantity/rate/amount convention remains consistent with the existing one-time Testing / Micros accounting treatment. This is not equivalent to duplicating the service row.

## Existing evidence

The current Costs page has an editable Testing / Micros service amount in both standalone and product-associated placements on the checked Smart Press Alt 2 quote. The earlier missing-input report does not reproduce there. The repeatability limit above is separately confirmed by code and database constraints. Production NetSuite stays unchanged until cutover.

Validation: 3,529 unit tests and `verify:ci` pass on the draft branch. Migration order is #636 (0146) → #637 (0147) → this branch (0148).
