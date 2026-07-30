# Accounting Sales Order field universe

## Purpose and evidence boundary

This document is the repository-derived business contract for Slice 13.1. It
enumerates every Sales Order field that Nexus writes and every additional
Sales Order field explicitly referenced by the repository's parity tooling.
It does not assert that a field exists, is configured, or behaves identically
in production and sandbox merely because a comment or probe references it.

Field classifications and evidence rules are defined in
[PARITY_EVIDENCE_GUIDE.md](PARITY_EVIDENCE_GUIDE.md). Audit results belong in
[SALES_ORDER_PARITY_MATRIX.md](SALES_ORDER_PARITY_MATRIX.md).

Primary evidence:

- `src/lib/netsuite/sales-orders.ts`
- `src/lib/netsuite/mark-complete.ts`
- `src/lib/hubspot-cache.ts`
- `src/lib/netsuite/item-groups.ts`
- `src/lib/netsuite/composition-hash.ts`
- `src/db/schema.ts`
- `scripts/parity/so-field-parity.ts`

For compact tables, mapping-location filenames refer to these exact paths:
`mark-complete.ts` = `src/lib/netsuite/mark-complete.ts`;
`sales-orders.ts` = `src/lib/netsuite/sales-orders.ts`;
`hubspot-cache.ts` = `src/lib/hubspot-cache.ts`;
`project-source-resolver.ts` =
`src/lib/netsuite/project-source-resolver.ts`;
`business-segment-resolver.ts` =
`src/lib/netsuite/business-segment-resolver.ts`; and `item-resolver.ts` =
`src/lib/netsuite/item-resolver.ts`.

“Required” below means required by the current Nexus builder/orchestrator, not
necessarily required by NetSuite configuration. NetSuite-required status is
**Requires sandbox discovery** unless repository guards prove it.

## Current outbound Sales Order header

| Business name | Nexus input / source system | Nexus mapping location | NetSuite destination | Required | Current implementation | Expected parity behavior | Evidence required |
|---|---|---|---|---|---|---|---|
| Customer | `netsuite_customer_map.netsuite_customer_id`; HubSpot company association → Nexus mapping | `mark-complete.ts`; `sales-orders.ts` | `entity.id` | Yes | Populated | Same commercial customer; internal IDs may be environment-specific | HubSpot company association, mapping row, production/sandbox customer evidence, payload/result |
| Subsidiary | `firm_settings.netsuite_subsidiary_id`; Nexus | `mark-complete.ts`; `sales-orders.ts` | `subsidiary.id` | Yes | Populated | Same legal entity; ID differences require `ENVIRONMENT_DIFFERENCE` evidence | Firm setting and both account subsidiary metadata |
| Order status | `firm_settings.netsuite_so_order_status_code`; Nexus | `mark-complete.ts`; `sales-orders.ts` | `orderStatus` | Yes | Populated | Same operational status behavior | Firm setting, NetSuite status dictionary, observed SO |
| Memo | HubSpot deal ID + cached deal name; derived | `sales-orders.ts` | `memo` | Yes by builder | Populated as `HubSpot Deal <id> · <name>` | Meaning must be approved; text need not equal legacy formatting | Source values, payload, legacy and sandbox display |
| HubSpot deal link | `projects.hubspot_deal_id`; HubSpot identity persisted by Nexus | `mark-complete.ts`; `sales-orders.ts` | `custbody_dps_deal_id` | Yes | Populated | Same source deal identity | Project row, HubSpot record, payload, SO |
| Payment terms text | `quotes.payment_terms_snapshot`; Nexus immutable send snapshot | `mark-complete.ts`; `sales-orders.ts` | `custbody_dps_payment_terms_text` | Optional | Trimmed and populated when nonblank | Commercial terms equivalent; legacy standard `terms` behavior requires discovery | Snapshot, payload, production/sandbox terms fields |
| Standard terms reference | Repository comments refer to `terms`; no active payload assignment | `sales-orders.ts` comments; historical briefs | `terms` | Unknown | Referenced but currently omitted; custom payment-terms text is sent instead | `UNKNOWN` until legacy terms sourcing/defaulting and NetSuite field type are discovered | Full payload, production/sandbox terms metadata and observed records |
| Accounting files URL | HubSpot `monday_link` → `hubspot_deals_cache.deal_folder_url` | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_accounting_files` | Optional | Copied when truthy | Same approved URL | HubSpot raw property, cache, payload, SO |
| SharePoint link | Same value as Accounting files URL; derived mirror | `sales-orders.ts` | `custbody_sharepoint_link` | Optional | Populated with identical URL when present | Same approved URL and downstream behavior | Both destination fields and workflow/use evidence |
| Project service | HubSpot `project_service_s_` → cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_project_service_s` | Optional | Copied when truthy | Same business label/value | HubSpot property metadata/raw value, cache, payload, SO |
| Project category | HubSpot `project_category` → cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_project_category` | Optional | Copied when truthy | Same business classification | Source option dictionary and destination evidence |
| Project source | HubSpot `project_source` label → cache `sourcing_location` → NetSuite list ID | `hubspot-cache.ts`; `project-source-resolver.ts`; `mark-complete.ts`; `sales-orders.ts` | `custbody_dps_project_source.id` | Optional, but resolver fails closed when source exists | Derived label-to-ID reference | Same business option; internal ID may differ by environment | HubSpot label, resolver SuiteQL result, both list dictionaries, payload/SO |
| Client PO | HubSpot `client_po__` → cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_client_po` | Optional | Copied when truthy | Exact business identifier | Source, cache, payload, SO |
| Estimated invoice date | HubSpot `invoice_date__est_` → ISO date cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_est_invoice_date` | Optional | Date truncated to `YYYY-MM-DD` | Same business date under agreed timezone/date semantics | Raw property, cache, payload, SO |
| Estimated production ship date | HubSpot `production_ship_date` → ISO date cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_pp_production_ship_date` | Optional | Populated when present | Same business date | Raw property, cache, payload, SO |
| Standard ship date | Same estimated production ship date; derived mirror | `sales-orders.ts` | `shipDate` | Optional | Populated with the same date | Same operational ship date/default behavior | Both date fields, workflow/default evidence |
| Priority | HubSpot `hs_priority` → cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_priority` | Optional | Copied when truthy | Same priority meaning | Source/destination option dictionaries and observed value |
| Deal type | HubSpot `dealtype` → cache | `hubspot-cache.ts`; `sales-orders.ts` | `custbody_dps_deal_type` | Optional | Copied when truthy | Same deal-type meaning | Source/destination option dictionaries and observed value |
| Business class | HubSpot `business_segment` raw enum ID → cache | `hubspot-cache.ts`; `business-segment-resolver.ts`; `sales-orders.ts` | `class.id` | Optional | Raw ID passed after label lookup succeeds | Same classification; ID equivalence is not assumed | HubSpot option ID/label, NetSuite class dictionary, payload/SO |
| DPS business segment | Same business-segment ID; derived mirror | `sales-orders.ts` | `cseg_dps_bus_seg.id` | Optional | Mirrors `class.id` | Same segment meaning and class/segment relationship | Production/sandbox class and custom-segment metadata |
| Project manager | Builder input `projectManagerNsId`; intended HubSpot owner/PM → NetSuite employee mapping | `sales-orders.ts` | `custbody_project_manager.id` | Optional | Builder supports it, but `mark-complete.ts` does not supply it; currently omitted | `UNKNOWN` until owner source and mapping contract are discovered | Legacy source, employee mapping, payload absence, production/sandbox observed field |
| Item sublist | Nexus calculated leaf lines | `mark-complete.ts`; `sales-orders.ts` | `item.items[]` | Yes; at least one line enforced | Populated with flat leaf lines | Commercially equivalent lines except approved completed Item Group change | Full ordered line evidence and total reconciliation |

## Current outbound Sales Order line fields

| Business name | Nexus input / source system | Nexus mapping location | NetSuite destination | Required | Current implementation | Expected parity behavior | Evidence required |
|---|---|---|---|---|---|---|---|
| Item | Leaf SKU → exact NetSuite item resolver | `mark-complete.ts`; `item-resolver.ts`; `sales-orders.ts` | `item.items[n].item.id` | Yes | Populated with resolved leaf internal ID | Same sellable item meaning; completed Item Groups are a future approved change | SKU, resolver query/result, item metadata, payload/SO |
| Quantity | Accepted tier quantity × rounded `qtyPerParent`; derived | `mark-complete.ts` | `item.items[n].quantity` | Yes | Populated | Exact commercially ordered component quantity under current flat-line model | Tier, assembly membership, calculation trace, payload/SO |
| Rate | Canonical `requiredSellPerUnit`; derived and rounded to four decimals | `mark-complete.ts`; `sales-orders.ts` | `item.items[n].rate` | Yes | Populated | Must preserve commercial sell amount; never substitute `$0.00` catalog price | Costing output, independent expected value, payload/SO/totals |
| Amount | Quantity × rate; NetSuite-derived | Builder comments and parity probe | `item.items[n].amount` | Not sent | Referenced but omitted from payload | Must reconcile to quantity × rate using approved rounding | Payload absence, returned value, total reconciliation |
| Description | Leaf name, else `<assembly name> — <SKU>`; derived | `mark-complete.ts`; `sales-orders.ts` | `item.items[n].description` | Yes | Populated | Same operationally useful item description; formatting difference needs disposition | Source leaf/assembly values, payload/SO |
| Tax code | `firm_settings.netsuite_default_tax_code_id`, else NetSuite defaulting | `mark-complete.ts`; `sales-orders.ts` | `item.items[n].taxCode.id` | Optional | Populated only for configured override | Equivalent tax result; IDs/defaulting may differ by environment | Firm setting, customer/ship-to/item tax setup, calculated tax |
| Nexus SKU | Leaf SKU; copied | `mark-complete.ts`; `sales-orders.ts` | `item.items[n].custcol_dps_sku` | Yes by builder | Populated | Exact round-trip SKU | Leaf record, payload, SO |
| DPS unit cost | Canonical `contributionCostPerUnit`; derived and rounded to four decimals | `mark-complete.ts`; `sales-orders.ts` | `item.items[n].custcol_dps_unit_cost` | Optional | Populated when non-null | Same internal cost basis and precision; not customer-facing | Costing trace, payload/SO, access controls |

## HubSpot property universe used by Sales Orders

| HubSpot property / association | Cached Nexus field | Sales Order use | Status |
|---|---|---|---|
| Deal object ID | `projects.hubspot_deal_id`, `hubspot_deals_cache.deal_id` | `custbody_dps_deal_id`; derived memo; Item Group provenance | Active |
| `dealname` | `hubspot_deals_cache.deal_name` | Derived memo; Item Group description provenance | Active |
| Associated company ID | `hubspot_deals_cache.associated_company_id` | Resolves `entity.id` through `netsuite_customer_map` | Active association lookup |
| Associated company name | `associated_company_name` | Preflight display only; not sent | Context only |
| `monday_link` | `deal_folder_url` | Two URL body fields | Active |
| `project_service_s_` | `project_service_s` | `custbody_dps_project_service_s` | Active |
| `project_category` | `project_category` | `custbody_dps_project_category` | Active |
| `project_source` | `sourcing_location` | Resolved to `custbody_dps_project_source.id` | Active derived mapping |
| `business_segment` | `business_segment_id`; label backfilled separately | `class.id` and `cseg_dps_bus_seg.id` | Active; cross-system ID assumption needs evidence |
| `client_po__` | `client_po` | `custbody_dps_client_po` | Active |
| `invoice_date__est_` | `invoice_date_est` | `custbody_dps_est_invoice_date` | Active date normalization |
| `production_ship_date` | `production_ship_date_est` | Custom production ship date and `shipDate` | Active derived mirror |
| `hs_priority` | `priority` | `custbody_dps_priority` | Active |
| `dealtype` | `deal_type` | `custbody_dps_deal_type` | Active |
| `hubspot_owner_id` | `sales_rep_id` | No current Sales Order payload field | Cached but not mapped |
| Configured `HUBSPOT_PM_PROPERTY` | `pm_id` | No current Sales Order payload field | Property name and employee mapping require manual discovery |
| `amount` | Cache `amount` | Not copied to SO; Nexus later writes calculated completion amount back to HubSpot | Not an SO source |
| `dealstage`, `closedate`, `createdate`, `hs_lastmodifieddate` | Corresponding cache metadata | No current Sales Order payload field | Not SO-mapped |

## Custom fields

### Custom body fields populated by Nexus

`custbody_dps_deal_id`, `custbody_dps_payment_terms_text`,
`custbody_dps_accounting_files`, `custbody_sharepoint_link`,
`custbody_dps_project_service_s`, `custbody_dps_project_category`,
`custbody_dps_project_source`, `custbody_dps_client_po`,
`custbody_dps_est_invoice_date`,
`custbody_dps_pp_production_ship_date`, `custbody_dps_priority`,
`custbody_dps_deal_type`, `custbody_project_manager` (builder-supported but
currently omitted), and `cseg_dps_bus_seg`.

### Custom line fields populated by Nexus

`custcol_dps_sku` and `custcol_dps_unit_cost`.

### Custom fields referenced by the parity probe but not populated by Nexus

| Field | Repository characterization | Contract status |
|---|---|---|
| `custbody_report_timestamp` | NetSuite-generated processing timestamp | Requires sandbox/production workflow discovery |
| `custbody_dps_related_opportunity` | Legacy workflow Opportunity linkage | Requires business and workflow discovery |
| `custbody_dps_auto_generate_project` | Referenced only in `docs/UX_BACKLOG.md` as historical NetSuite project-generation behavior | Requires production/sandbox field and workflow discovery |
| `custbody_nexus_quote_id` | Proposed in a historical Mark Accepted brief as an idempotency key; active code instead uses `netsuite_so_pushes` plus the NetSuite idempotency header | Historical proposal; verify whether the custom field exists or is populated by any external automation |
| `custbody_stc_amount_after_discount` | SuiteTax-derived | Validate derived result and configuration |
| `custbody_stc_tax_after_discount` | SuiteTax-derived | Validate derived result and configuration |
| `custbody_stc_total_after_discount` | SuiteTax-derived | Validate derived result and configuration |
| `custcol_2663_isperson` | Third-party bundle line field | Requires bundle/business discovery |
| `custcol_p2p_ln_allow_po` | Third-party bundle line field | Requires bundle/business discovery |
| `custcol_statistical_value_base_curr` | Third-party bundle line field | Requires bundle/business discovery |

## Item Group field universe and current behavior

The Item Group primitive creates `itemGroup` records, not Sales Orders.
`src/lib/netsuite/mark-complete.ts` explicitly bypasses this primitive and
currently sends flat leaf lines. Completed Item Groups therefore remain a
Slice 13 parity/cutover requirement, not current behavior.

| Business name | Technical field | Source / derivation | Current behavior | Evidence required |
|---|---|---|---|---|
| Display item name | `itemGroup.itemId` | Available `<baseSku>-G[N]`; derived after local and SuiteQL collision scan | Created by standalone primitive | Item namespace scan, created record, naming approval |
| Stable external identity | `itemGroup.externalId` | `nxs-ig-` identity from canonical composition hash | Created/idempotency key | Hash inputs, recomputation, NetSuite record |
| Description | `itemGroup.description` | Customer, deal, base SKU, deal ID, members; derived; write-once | Created only; never overwritten on reuse | Input evidence, generated text, reuse behavior |
| Member list | `itemGroup.member.items[]` | Resolved leaf members | Created by primitive | Ordered/canonical member evidence |
| Member item | `member.items[n].item.id` | Resolved NetSuite item | Created by primitive | SKU-to-item evidence |
| Member quantity | `member.items[n].quantity` | Positive integer per assembly unit | Created by primitive | Assembly composition and record |
| Composition hash | Nexus `netsuite_item_groups.composition_hash` | Customer ID + base SKU + sorted member IDs/quantities | Local identity; not a NetSuite SO field | Independent recomputation and cache record |
| Sales Order group line | Destination shape unresolved | Approved desired behavior | Not implemented; existing probe records REST/SOAP failure | Sandbox technical spike, line pricing behavior, Accounting approval |

The repository states that an upstream item catalog price of `$0.00` may
satisfy NetSuite validation. It is not an approved transaction price. The
future group-line implementation must preserve Nexus's approved commercial
rate and prove downstream invoice behavior.

## NetSuite-derived or generated fields referenced by the repository

These are read from parity responses but not populated by the Nexus payload:

- record identity/time: `id`, `tranId`, `transactionNumber`, `createdDate`,
  `lastModifiedDate`, `trandate`/`tranDate`, `prevDate`, `startDate`;
- financial rollups: `subtotal`, `total`, `estGrossProfit`,
  `estGrossProfitPercent`;
- origin/linkage: `createdFrom`, `job`, `opportunity`,
  `previousOpportunity`, `custbody_dps_related_opportunity`;
- shipping: `shipAddressList`;
- line result/default fields: `amount`, `class`, `costEstimate`,
  `costEstimateRate`, `costEstimateType`, `itemType`, `itemSubtype`,
  `line`, `lineUniqueKey`, `poRate`, `price`, `taxCode`, `commitmentFirm`,
  `createWo`, `fromJob`, `isClosed`, `isEstimate`, `isOpen`, `linked`,
  `printItems`, `quantityBilled`, `quantityFulfilled`, `quantityAvailable`,
  `quantityCommitted`, `commitInventory`;
- result metadata: `item.totalResults`;
- SuiteTax and third-party custom fields listed above.

Each requires observed production and sandbox evidence before it may be
classified. The parity probe's historical “intentional” labels are discovery
leads, not permanent approvals.

## Unknown field discovery

The following are mandatory manual actions:

1. Export the production and sandbox Sales Order field dictionaries, forms,
   custom body/line fields, custom segments, mandatory flags, defaulting, and
   sourcing rules.
2. Export active HubSpot workflow and Custom Code Action mappings.
3. Export NetSuite workflows, User Event/Scheduled scripts, SuiteTax/bundle
   configuration, and field-change evidence.
4. Compare complete structured responses for representative legacy production
   and Nexus sandbox orders; add any unlisted field to this universe before
   classification.
5. Have Accounting identify every field used for invoicing, fulfillment,
   purchasing, revenue, tax, reporting, approvals, or reconciliation.
