# NetSuite "Create PO(s)" from a Sales Order — read-only trace (sandbox)

Traced 2026-10-05 in `7924416_SB2`. **Read-only:** no PO, SO, script, form,
template or workflow was created, edited or saved. Verified against SO2228
(internal 176867) and its PO2541 (internal 182497).

## The chain

| step | component | IDs |
|---|---|---|
| 1 · when the button appears | saved search **[WF] Check Condition to Create PO** — Sales Order lines where Main/Tax/Shipping line = false, **Unit Cost (`custcol_dps_unit_cost`) not empty, PO Vendor (`custcol_dps_po_vendor`) assigned, Linked Order (`custcol_dps_linked_order`) none** | saved search id 1814, `customsearch_dps_wf_check_condition_to_c` |
| 2 · adds the button | workflow **Create PO From SO** — Transaction / Sales Order; on create and on view or update; execute as admin; Released | workflow id 429, `customworkflow_dps_create_po_from_so` |
| | State 1 (start): action **Add Button** "Create PO(s)", *Save record first*, Before Record Load, condition = saved search 1814; transition → State 2 **on button Create PO(s)** | state id 445, `workflowstate561` |
| | State 2: action **Set Field Value** `custbody_dps_create_pos` (Create POs) = T, on Entry | state id 446, `workflowstate562` |
| 3 · builds the PO | User Event **UE Create PO from Sales** — `beforeSubmit` sees `custbody_dps_create_pos = T` and creates one PO per vendor; then clears the flag | script id 2587, `customscript_dps_new_po_creation_ue`; file **29867** `SuiteScripts/DPS/NewPOCreation/dps_new_po_creation_ue.js` (folder 2857) |
| | deployments | **2161** `customdeploy_dps_new_po_creation_ue` (Sales Order, Released, executes as Administrator, all internal roles); `customdeploy_dps_new_po_creation_ue_po` (Purchase Order, Released) |
| 4 · client side | Client **CS New PO Creation Process** — only `lineInit` is active: disables PO Vendor on a line already linked to a PO. It does **not** add or handle the button | script id 2588, `customscript_dps_new_po_creation_cs`; file **33741** `dps_new_po_creation_cs.js`; deployment **2162** `customdeploy_dps_new_po_creation_cs` (Sales Order, Released) |
| 5 · PO form | the UE hard-codes `customform = 218` | form 218 **The DPS - Purchase Order**, `custform_dps_strs_purchase_order` |
| 6 · vendor PDF | rendered by the BFO Advanced PDF engine (PDF producer `bforeport`); content matches **DPS Purchase Order** | template id 400, `CUSTTMPL_TVN_PF_PURCHASE_ORDER` (other PO templates: 201 `CUSTTMPL_ATLAS_STRE_PO`, 3 `STDTMPLPURCHORD`) |

How the click works: the workflow button saves the SO, transitions to State 2,
which sets `custbody_dps_create_pos = T` and resubmits; the UE's `beforeSubmit`
does the PO work. The form-218 → template-400 binding was established from the
rendered PO2541 output (template-400-specific labels present); the form's own
template field was not visible in the UI we could read.

## What the UE copies

**Header (new PO only):** `subsidiary`, `location`, `cseg_dps_bus_seg`,
`custbody_project_manager`, `custbody_dps_project_source`,
`custbody_dps_project_service`, `custbody_dps_related_opportunity`, `shipdate`;
`otherrefnum` → `custbody_dps_client_po`; **plus the 63 fields in the company
parameter `custscript_dps_ue_sale_copy_field`** — every PP / SP / SGA / COP spec
field, `custbody_size`, `custbody_color`, `custbody_material`, … the production
ship dates, freight services, `custbody_dps_shipping_address`,
`custbody_dps_accounting_files` (and `custbody_dps_est_invoice_date`, which the
code then skips).

**Lines (only SO lines with vendor + unit cost and no linked order, grouped by
vendor):** `item`, `quantity`, `rate` ← `custcol_dps_unit_cost`, `description`,
`expectedreceiptdate` ← SO `shipdate`, `customer` ← SO `job`,
`custcol_dps_linked_order` ← SO id, `custcol_dps_order_line_key` ← SO
`lineuniquekey`. If a PO already exists for that vendor, lines are appended to
it.

**Back-link:** after save, each SO line gets `custcol_dps_linked_order` = PO id
and `custcol_dps_order_line_key` = **the PO line's** `uniquekey`. The key field
means "the other side's line" on both records.

**Ongoing sync (`afterSubmit`, SO status A/B/D/E):** SO line changes to item,
quantity, unit cost, description, closed are pushed to the linked PO line
(matched by key); SO lines removed → PO lines removed (PO deleted if empty). On
the PO, a vendor change is pushed back to `custcol_dps_po_vendor` on the SO lines.

## Verification: SO2228 ↔ PO2541 (repeated SKUs)

| SO line key | item | SO memo | ↔ PO line key | PO → SO key | status |
|---|---|---|---|---|---|
| 381502 | OTC-0016 Micro Testing | Greens | 454394 | **1255559** | **drift** — PO line now points at a later SO line |
| 381503 | SWW-Greens-Assembly | | 454395 | 381503 | ok |
| 381504 | SWW-Minerals-Assembly | | 454396 | 381504 | ok |
| 381505 | SWW-Greens-Blend&Fill | | 454397 | 381505 | ok |
| 381506 | SWW-Minerals-FFS | | 454398 | 381506 | ok |
| 381507 | OTC-0043 Pallets | Greens | 454399 | 381507 | ok |
| 381508 | OTC-0043 Pallets | Minerals | 454400 | 381508 | ok |
| 381509 | OTC-0014 Master Shipper | Minerals | 454401 | 381509 | ok |
| 381510 | OTC-0014 Master Shipper | Greens | 454402 | 381510 | ok |
| 381511 | OTC-0016 Micro Testing | Minerals | 454403 | **0** | **broken** |
| 1255559, 1349253 | OTC-0016 (later SO lines) | | claim 454394 / 454403 | — | duplicated link (copied lines kept the keys) |
| — | 4 PO lines added by hand | | 1255568, 1256106, 1255569, 1349252 | none | unlinked |

Repeated SKUs **are** told apart correctly when the link is intact — by line
key, not item. What distinguishes them for the vendor is only the line
**description** ("Greens" / "Minerals").

Defects observed (pre-existing, not ours):

1. A line **copied** on the SO keeps `custcol_dps_linked_order` and
   `custcol_dps_order_line_key`; `beforeSubmit` only clears them when the line
   has no `lineuniquekey`, which a saved copied line has. Two SO lines then
   claim one PO line, and the PO side can be repointed (454394) or zeroed
   (454403).
2. The **manual-link** path (`custbody_ali_manual_linked_po`) matches PO lines to
   SO lines by **item + quantity** — ambiguous for a repeated SKU with equal
   quantities, exactly the spec-variant case.

## What the vendor PDF shows today (PO2541, template 400)

- Header block **DESCRIPTION**: Product Ship Date, Shipping Address, then
  sections chosen by `custbody_dps_project_service` contains "Primary
  Packaging" → PP fields; "Copacking" → COP fields; "Secondary Packaging" → SP;
  "Soft Goods & Accesories" → SGA; "Formulations"; "Other". PO2541 printed the
  COP block: *Description: FFS, Packout · SKUS: 2 · Fill Size: Greens: 5.40z
  Minerals: 5.40z · Blending Required: No · Additional Details: Fill sticks, pack
  30 sticks per pouch*. Two products' specs in one header field.
- Line table: **SKU** (`custcol_dps_sku`), **ITEM** (name/display name),
  description, quantity, units, unit cost, total. Lines of class
  "Raw ingredients" get separate handling. **No per-line specification.**

## Consequence for the ordered-spec work

- **Correction:** the legacy PP/SP/SGA/COP header fields **are consumed** —
  copied to every new PO and printed on the vendor PDF. The earlier File
  Cabinet scan missed this because the field list lives in a script
  *parameter*, not in source. The OD-024 / §12.2 question is answered for the
  PO path: retiring those fields would blank the vendor document.
- Today's vendor PDF has nowhere per line for a spec, and the header carries one
  value per family per order.

## Where per-line specs could attach (options, not implemented)

| option | how | notes |
|---|---|---|
| A · link the same record on the PO line | extend `custcol_nx_ordered_spec` to **Purchase Item**; UE copies the SO line's value onto the PO line (it already copies item/qty/rate per line and knows the SO line via `lineUniqueKey`) | one source record per ordered line; reverse-lookup from PO line to spec without new data; needs a UE change |
| B · printable text on both lines | add a line Text Area `custcol_nx_spec_text`, **sourced** from `custcol_nx_ordered_spec` → `custrecord_nxos_readable` (Store Value), on Sale + Purchase items; template 400 prints `item.custcol_nx_spec_text` under each line | vendor sees each product's spec per line; Text Area caps at 4,000 chars (readable text today is far below); `fm_actives` is already absent from `readable` |
| C · header summary projection | Nexus writes the legacy header fields from frozen specs | keeps today's template working; cannot separate repeated SKUs or multiple products — not recommended as the spec carrier |

Prerequisites for A/B: fix defect 1 (copied-line keys) and avoid the manual-link
path for spec-bearing repeated SKUs, or a PO line can inherit the wrong
product's spec.

## Security note (separate)

The deployment page's script-preference payload exposes a company-level
parameter `custscript_api_key` holding what appears to be a HubSpot private-app
token, readable in page source by any role that loads a page carrying that
preference. Value intentionally not recorded here. Recommend rotating it and
moving it to a secret/credential store.
