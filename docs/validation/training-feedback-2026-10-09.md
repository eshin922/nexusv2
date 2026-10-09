# Training feedback worklist — 2026-10-09

Source: user-provided training transcript. The transcript records observations and proposed behavior; it is not proof that a bug still reproduces on current code. Verify on a fresh quote and on the cited existing quote before closing an item.

## Launch blockers

| Area | Observed behavior | Completion evidence |
| --- | --- | --- |
| Item groups | Smart Press Juice products appeared both standalone and inside the finished-good group, including on the customer quote. | Moving an existing quote product into a group yields one product cost and one customer-facing product placement, preserves product-level quantity and specs, and handles an attached service without dropping its separate NetSuite line. Test new and existing quotes. |
| Associated costs | Users could add an "Other" or production service but could not find a way to remove it without deleting the product. They need several differently labeled one-time charges and multiple tests. | Add, name, cost, remove, re-add, and quote two same-type charges plus multiple tests on one product; no unrelated product or cost is changed. |
| Associated cost pricing | Testing / Micros and some services reportedly had no cost input when added as associated costs or direct services. | Each supported placement has a per-tier cost input, appears once in Costs, Pricing, quote, and its separate NetSuite line. |
| Freight | An entered freight amount sometimes displayed as zero until the quote was rebuilt. | Reproduce from the affected quote if possible; enter freight, navigate away/back, refresh, revise, and verify the same amount in the cost stack and price build. |
| Margin policy | Circadian 2 mL was blocked because 20% markup one-time charges reduced the blended margin even when product pricing met its target. | Accounting approves a one-time-charge floor/approval rule; implement it consistently at Pricing, send, acceptance, and Sales Order push, with visible product and one-time economics. |

## Follow-up enhancements

| Area | Need |
| --- | --- |
| Product order | Drag/reorder on standalone and grouped products must visibly persist. |
| Group presentation | Show finished-good cost and make included members unmistakable in Costs and customer quote. |
| Cost precision | Preserve five-decimal vendor unit cost such as $0.12405 through calculations and NetSuite transfer; distinguish input precision from printed rate. |
| Freight options | Separate customer-selectable air/ocean alternatives from split shipments and internal scenario comparison. This was explicitly deferred in the call. |
| Generic specs | Permit useful free-form specifications for turnkey products whose type has no specialized fields, and verify all enabled users can edit draft specs. |
| Library access | Give users a searchable product-library index outside a HubSpot deal. |
| Discoverability | Replace hidden or ambiguous controls where testers had to guess what was clickable. |

## Workflow decisions to retain

- Formal orders use what is known now. Packaging ordered now and later finished-good work may be separate deals/orders; do not invent future structure for a current order.
- For large hypothetical scenario sets, use an estimate workbook until the customer narrows the choices; use Nexus to build a formal quote or a small number of meaningful alternatives.
- A one-time total is independent of tier quantity, but a formal quote still requires an order quantity. Distinguish those concepts in the UI.
- The go-live date discussed in the call is conditional on verified fixes, not an automatic release instruction.

## First code audit

- The current Item Group picker calls `moveProductMembership`, whose writer keeps the same `quote_leaves.id` and moves its membership atomically. It does not create a second product attachment. This is evidence against a new-write duplication, but the reported Smart Press quote still needs a row-level and customer-preview check; old physical duplicates are not removed by changing the picker.
- The Costs page builds production-cost input rows for both standalone and product-associated services from quote service leaves. That establishes an intended input path, not that the reported Micro Testing row is reachable and editable in the affected quote.
- Freight has unit coverage for a priced shipment reading nonzero, but the reported zero-after-navigation sequence has not been reproduced. Keep this open.
- The source of the fifth-decimal limit is concrete: `parseUnitMoney` accepts scale 4, `assembly_leaf_inputs.unit_cost` stores scale 4, the Packaging input steps by 0.0001, and the Sales Order adapter serializes four decimals. This needs a coordinated precision change, not a cosmetic input edit.
- The associated-cost sheet now offers multiple labeled Other Service charges in one submission and explicit removal for existing charge or service rows. Deleting a charge also deletes its entered per-tier economics; the confirmation names that consequence. The governed action and audit already existed. This change is in PR #634.
