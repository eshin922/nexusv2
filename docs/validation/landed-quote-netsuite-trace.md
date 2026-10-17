# Landed quote to NetSuite trace

The quote can show freight, duty and tariff as one amount per SKU, either
included in product unit prices or as a separately itemized charge. The
separate choice moves cents out of each frozen product line into one frozen
`otc_freight_duties_tariffs` line for that quote leaf. It does not add to the
accepted total. Multiple quote leaves with the same SKU display as one row
on the customer document, but retain separate accounting lines so quantities
and costs stay attributable to their source leaves.

At send, `commercial-freeze.ts` records the line kind, quote leaf, SKU,
destination, quantity, rate and amount. At completion,
`buildFrozenSalesOrder` resolves the destination against
`netsuite_destination_item_map`, emits each charge at quantity one and rate
equal to its frozen total, and runs REG-4 reconciliation against the full
accepted order. The planned-order preview uses the same order builder.

The separate charge is a flat Sales Order line, even when its product belongs
to an Item Group. Its description and custom SKU field identify the product.
The product's cost estimate excludes the raw freight, duty and tariff cost;
the charge's custom cost estimate receives that raw total. In the amortized
choice, the existing product line and cost estimate remain unchanged. These
cost estimates are the live governed accounting basis; commercial rates and
amounts remain frozen.

Read-only checks on 2026-10-15 found the Nexus destination mapped to sandbox
NetSuite `OTC-0012` (internal ID 21447), resolved 2026-09-29. SuiteQL in
account `7924416_SB2` confirmed that item is active and is a non-inventory
item. This sandbox internal ID must not be presumed valid in production.

Validation: unequal 30,000 / 30,000 / 5,000 SKU quantities preserve the
commercial total, yield one combined charge per leaf, and move the raw cost
to the corresponding charge. A Sales Order payload test checks the item,
custom SKU, quantity, rate, and custom cost fields. The full unit suite and
`verify:ci` pass. No disposable Sales Order was posted for this change; a
sandbox create/read-back is still the final external integration check.

Migration `0154_quote_landed_presentation` must precede app deployment. The
production Nexus database did not have this column during the read-only check.
Production NetSuite remains outside this change and awaits the cutover signal.
