# Five-decimal vendor unit costs

Vendor prices quoted per thousand can require five decimals per unit: $124.05/M is $0.12405 each. Costs now accept and retain that precision for product unit costs and per-unit associated charges. One-time charge totals remain currency amounts with two decimals. Customer sell prices and order amounts keep their existing rules.

## Deployment order

Apply migration `0146_five_decimal_unit_cost` before deploying code that accepts five-decimal costs. It widens `assembly_leaf_inputs.unit_cost` and `quote_charge_instance_tiers.cost_amount` without reducing their whole-dollar range. If code deploys first, the database can round away the fifth decimal. Do not use a five-decimal value until the migration is confirmed on the target database.

For NetSuite sandbox certification, enter a five-decimal cost, push a disposable order, and read back both `custcol_dps_unit_cost` and `costEstimateRate`. The payload preserves the fifth decimal, but the sandbox field configuration has not yet been probed for read-back precision. This does not authorize production NetSuite changes; its cutover remains separate.

## Evidence

- Unit input accepts 0.12405 and rejects a sixth decimal.
- Per-unit component charges retain 0.12405 through cost extension; one-time charges still reject fractional cents.
- The Sales Order adapter emits 0.12405 in both unit-cost fields.
- 3,518 unit tests and `verify:ci` pass locally.
