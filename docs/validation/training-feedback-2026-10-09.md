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

## Read-only production checks, 2026-10-09

- **Smart Pressed Juice Alt 1:** confirmed eight SKUs with two separate `quote_leaves` each: one direct and one in the 1 Day Cleanse group. The user confirmed these are test quotes and the duplicate pricing data may be lost. On 2026-10-09, a guarded, atomic repair transferred all eight 5,000/10,000 tier-quantity overrides onto the grouped rows and deleted the eight standalone copies. The grouped costs were retained; the standalone costs were discarded. A second guarded transaction removed the zero-quantity standalone DPS-SPJ-1005 row, whose SKU duplicated the 1 Day Cleanse group header and had no attached dependencies. Post-commit database read-back found exactly one grouped row and the expected quantity for every member SKU, with zero standalone copies; live Setup, Costs and customer Quote pages rendered the group members once and the group header only once. Audit rows record both repairs. Alt 2 had no matching duplicate and was unchanged. The overall Tier 1 quantity remains unset, so this test quote is still a draft and its group header says “quote on request.”
- **Smart Pressed Juice Alt 2 service costing:** current Costs shows editable Production `Service amount` fields for standalone Testing / Micros and for associated Testing / Micros and Pack-out / Assembly. The spreadsheet intentionally says `unpriced — in module`. The training report of an absent cost field does not reproduce on this current quote; field persistence remains untested to avoid altering an active quote. Existing mounted tests confirm the route to that editor.
- **Dr. Squatch Soap Saver freight:** the current quote stores a priced shipment and displays $0.7470 freight per unit plus $0.1983 duty/tariff per unit on Tier 1. The reported zero after a prior edit is not present now. The existing freight-node and input-fidelity tests cover two known zero-read defects; the original delete/rebuild sequence cannot be replayed from its former state.
- **Cirqadian 2ml margin:** confirmed that product cells show 30.0% while the tier blended margin is -4.8%. Three costed associated charges ($1,450 setup, $5,000 Machine Set Up, $825 tooling) have no `quote_charge_recovery` election. The Quote screen explicitly requires a recovery choice for each. Their costs lower blended margin while no sell is placed for them. Pricing now explains this and links to the recovery choice before suggesting an approval request. The separate policy question of whether low-margin one-time charges may bypass the blended floor is still open.
- **Five-decimal costs:** PR #636 preserves $0.12405 end to end in Nexus and its NetSuite payload; migration 0146 must precede deployment. Sandbox NetSuite read-back is still required.
- **Library access:** PR #635 adds a read-only Product Library index outside a deal. Full CI passes.
- **Product order:** native drag is the only standalone-product reorder affordance and was unreliable in the observed browser gesture. The grouped-product menu already uses the governed `moveProductMembership` action. Standalone product rows now have explicit Move up/down controls using that action and the same `resolveDropIndex` rule as drag/drop. Persistence still needs a draft-quote browser check; no production quote was reordered during investigation.
- **Multiple Testing / Micros entries:** the current associated-cost picker is a checkbox keyed by one service identity. `attachQuoteProduct` delegates to `attachDirectProduct`, which treats an existing service/product pair as a conflict, and the database has a partial unique index on that pair. Therefore repeatable tests cannot be implemented by only adding another checkbox. It needs a line-instance model with a label and quantity for each test, then separate cost, quote, and NetSuite reconciliation. This remains open.
- **Grouped products with associated services:** the picker blocks this because `quote_leaves` requires the associated product to be direct. Lifting it needs a database change plus preservation of the separate NetSuite service line and its product link. This remains open; the current restriction is not a browser-only bug.
- **Generic/turnkey specs:** verified in the live Smart Press Alt 2 quote: a product classified “Filling and Packout Services” opens an empty spec page saying “Specifications not applicable.” This is the governed `no_schema` state, not a failed form render. Supporting operator-authored free-form specs requires a new governed schema/disposition and ordered-spec export mapping; it cannot be solved by merely exposing a text box.
