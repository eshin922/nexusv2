# HubSpot Sales Order routing, production cutover

On 17 October 2026, Edward chose Nexus as the sole Sales Order creator for deals accepted through Nexus. The existing HubSpot workflow remains the creator for other deals.

HubSpot portal `21497798` now has the deal dropdown `nexus_sales_order_source` ("Nexus Sales Order source") with the internal option value `nexus`. Workflow `380248643`, "NETSUITE: Auto create NetSuite sales order from won deal," retains its Won-stage and associated-line-item-SKU conditions and adds this deal condition: **Nexus Sales Order source has never been any of Nexus**, with empty values included. The workflow was saved without re-enrolling existing deals. HubSpot's workflow tester showed an empty marker passing this criterion and certification deal `65764633271` with marker `nexus` failing it. The workflow remained ON.

Nexus records acceptance by updating the HubSpot stage, accepted amount, and `nexus_sales_order_source=nexus` in one deal PATCH. If that PATCH fails, acceptance remains unrecorded. Certification mode suppresses the entire PATCH. A subsequent acceptance rollback changes the stage but deliberately leaves the source marker: an operator must explicitly resolve order ownership before a previously Nexus-managed deal can return to HubSpot's SO workflow.

This routing change does not enable Nexus production NetSuite writes by itself. Production NetSuite customization, a verified production integration token, item/customer maps, and an end-to-end pilot remain separate cutover gates. Existing Nexus quotes and orders were test data and were removed in the reset; none was sent to production NetSuite.
