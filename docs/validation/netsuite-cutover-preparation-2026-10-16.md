# NetSuite production cutover preparation — 16 October 2026

This is the current NetSuite change manifest for the [full HubSpot/Nexus/NetSuite cutover plan](production-hubspot-netsuite-cutover-plan.md). Preparation is authorized; production NetSuite changes, production ordered-spec export, and production order creation remain on hold until Edward signals the cutover. The files under `netsuite/` are preserved sandbox sources and a candidate, **not** instructions to deploy them automatically.

## Measured sandbox baseline

The Nexus integration token reached account `7924416_SB2` on 16 October. The read-only `scripts/gate-1b/netsuite-spec-customization-compare.ts` check found:

| Object | Measured state |
| --- | --- |
| `customrecord_nx_ordered_spec` | Active, sandbox internal ID 1612; record name on; inline editing/deleting off; permission-list access on. All 13 expected `custrecord_nxos_*` field IDs are present. |
| Ordered-spec records | 34 readable through the sandbox integration role. This supersedes older counts in the rollout documents. |
| `custcol_nx_ordered_spec` | Present in the Sales Order line metadata. Prior sandbox UI/probe evidence also confirms the Purchase Item application. |
| `custcol_nx_spec_text` | Present in the Sales Order metadata returned by the token; prior sandbox UI evidence identifies it as the printable Purchase Item Text Area field. Verify its production applicability in the UI; the metadata response alone does not prove that. |
| Integration role name | Not exposed by this token: the SuiteQL role query returned 400. Confirm the sandbox and production token roles in the NetSuite UI. |
| Script-ID collisions | The read-only check found the Nexus record and an unrelated bundle record; it did not identify another ordered-spec record. This says nothing about the unmeasured production account. |

The sandbox workflow chain previously traced and exercised is saved search `customsearch_dps_wf_check_condition_to_c` (sandbox 1814) → workflow `customworkflow_dps_create_po_from_so` (429) → User Event `customscript_dps_new_po_creation_ue` (2587, file 29867) → PO form `custform_dps_strs_purchase_order` (218) → original PDF template `CUSTTMPL_TVN_PF_PURCHASE_ORDER` (400). These numbers are **sandbox-only**. Resolve every target by script ID and account-specific read-back in production.

The preferred sandbox template 400 remains the original DPS PO design (version 159 with spec-text HTML escaping). The quote-aligned candidate is nonpreferred template 607, version 6, attached to sandbox form 341. Its live PO3676 print check showed four item lines, three line-specific specs and an unchanged $2,000 total. The original PO form 218 was restored after that check. [Template notes](../../netsuite/templates/README.md) record the layout and prior tests.

## Sources preserved for release and rollback

The files in `netsuite/suitescript/po-creation/` and `netsuite/templates/` were copied byte-for-byte from the sandbox development worktree. SHA-256 pins the critical variants:

| Source | SHA-256 | Purpose |
| --- | --- | --- |
| `dps_new_po_creation_ue.sandbox-original.js` | `0fe587d0b725797a5343986d5b8de8256aacac4a4793b2b448b8692a3569e5e9` | Pre-prototype rollback baseline. |
| `dps_new_po_creation_ue.sandbox-deployed-2026-10-06.js` | `003de2c7b5604c4e3be585f5310fea66d9440607e4ee5e7f84469149fb4bdbd9` | Last captured sandbox-deployed version; re-read live file 29867 before relying on this label. |
| `dps_new_po_creation_ue.js` | `af11f5fedb68193e2c726b7ccb24a08bf3c5c9674e3c9fc4df77990c0cdb6e5b` | Newer candidate. It validates spec-record transaction and SO line key before copying the link/text; **not yet proven deployed in sandbox**. |
| `dps-purchase-order.sandbox-original.xml` | `d682a6e8ec48732f34fe304213c853197e19637a16ce86c575c63cf0a6173a46` | Original preferred PDF source. |
| `dps-purchase-order.sandbox-candidate.xml` | `1d788fa4e1193bc86dad72df2065d01877b3fdf296ca3b023d049b6d97e1cb85` | Preferred layout with escaped spec text. |
| `dps-purchase-order.quote-theme-v2.xml` | `aaeebf21cda335c1c2028e11d65a3143e51c12119527066c125c6741001bbf44` | Approved quote-family alternative for production review. |

The newer User Event candidate differs from the captured deployed file. Its local harness passes 7/7 cases, including repeated SKU variants split between vendors, copied-line links, manual line-key pairing and unreadable spec records. That is **not** a live sandbox or vendor-PDF pass for this latest file.

## Sandbox work before copying a change to production

1. Read back live sandbox file 29867, template 607, form 341, both line fields and the integration/PO-script roles. Compare their contents/settings to the pinned files. Do not infer deployment from a local filename.
2. Deploy the newer User Event candidate to the **sandbox only**, then rerun the disposable two-vendor/repeated-SKU PO scenario. Verify create, append and subsequent SO→PO sync by reciprocal line keys, including a spec link that arrives after the PO. Confirm an inherited spec on a copied SO line is not carried to the new PO line.
3. Capture the actual PO line field values and PDF bytes. Verify distinct readable specs under the right repeated-SKU lines, line breaks, escaping, logo, addresses, totals and terms. Search PO fields, template output, PDF text and script logs for the withheld `fm_actives` test marker; it must be absent. Test ordinary PO creation with no spec as well.
4. Check the Nexus integration path from frozen quote → sandbox SO → linked spec → vendor PO, including Item Group members, direct products, services/charges, long text and special characters. Existing SO evidence does not prove the newest PO script or every schema on a live vendor PDF.
5. Keep the original template preferred until the alternative passes the above checks. Record a screenshot/PDF and the exact deployed file/template versions for the release evidence.

## Production change set, still gated

1. With read-only production access, run the same customization comparator; inventory current workflow/search/script/form/template/roles/items and capture exact rollback copies. The machine's known production `.env` file contains placeholders rather than usable NetSuite credentials, so the production comparison remains unmeasured. No request was sent to production during this preparation.
2. Resolve or create the ordered-spec record with the 13 field IDs/types in the [full plan](production-hubspot-netsuite-cutover-plan.md#gate-2--production-netsuite-object-and-accounting-preparation), the SO/PO line link and printable-text field, then grant the actual Nexus production role. Verify via that role. Never copy sandbox internal IDs into production mappings.
3. Re-resolve customer, product, service, Item Group and destination maps against the production account. In particular, the landed freight/duty/tariff line introduced by PR #650 uses `otc_freight_duties_tariffs`; sandbox item `OTC-0012` / internal ID 21447 is **not** a production item ID. PR #650 and migration 0154 are open dependencies, as are their accounting totals and separate SO line behavior.
4. Coordinate the Nexus production account/credential switch, ordered-spec export switch, line-accounting-note switch, HubSpot one-SO-creator workflow decision and blank-slate Nexus reset in one change window. Keep both NetSuite export switches off until their specific readiness checks pass. The reset clears test quote/order data while preserving Library, settings and valid reference data.
5. Release the proven PO User Event and quote-family PDF as versioned production changes, initially retaining the original form/template for rollback. Pilot one controlled SO and vendor PO only after Edward signals the cutover. Compare frozen quote, SO, spec record, PO and PDF line by line; verify totals, identity and redaction before widening use.

The invoice design remains a separate candidate (PR #625) and needs its own live example and accounting approval. The customer PDF `fm_actives` disclosure decision is also separate. Neither should be inferred from vendor-PO redaction.
