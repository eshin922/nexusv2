# Grouped products with associated services

Training issue: a product with Filling / Blending, Pack-out / Assembly, or Testing / Micros attached could not be moved into an Item Group. The Setup picker disabled the move, the server refused it, and the database foreign key required the owner to remain direct. Grouped products also hid the associated-service choices; Costs could not resolve a grouped owner.

The association remains tied to the product's canonical quote-leaf ID as the product moves between standalone and grouped positions. The service stays its own quote leaf, production cost row, commercial line, and NetSuite Sales Order line. The customer quote may include its price in that product row when the existing display option is enabled; the item-group subtotal then includes it once. Removing a grouped product or its group is refused while an associated service still points to it.

Migration 0147 replaces the direct-only composite foreign key with a same-quote, product-kind foreign key. It preserves the service-owner check, one-service-per-product uniqueness, and `ON DELETE NO ACTION`. It must follow migration 0146 from PR #636. Apply 0147 before deploying code that permits grouped associations.

Validation on the branch: targeted association, Setup, quantity, and customer-presentation checks pass (98 tests); all 3,522 unit tests and `verify:ci` passed before the final comment and deletion-guard test edits, then the 98 targeted tests passed again. A live database migration and browser-to-NetSuite walkthrough remain for a non-production validation environment; this branch has not altered the shared database or production NetSuite.
