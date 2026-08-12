# Legacy Sales Order — populated-field parity review

**Governing requirement:** every populated business field on representative
legacy Sales Orders receives an explicit V1 disposition. **This does not mean
Nexus must populate every field.**

**Evidence base — all read-only, NetSuite sandbox `7924416_SB2`:**

| SO | id | role |
|---|---|---|
| **SO2646** Epicuren | 359341 | Edward's visual reference · 72 populated header fields |
| **SO2617** Nemah | 347982 | third-party ship-to · PP-tab fields · 77 populated |
| **SO2591** Nemah | 339477 | second legacy sample |
| **SO2698** Epicuren | 360841 | **the only Nexus-created SO** · 53 populated |

Cross-references `so-field-parity-matrix.md` rather than restarting it.

**Carried forward, not re-litigated:** C.1 (quote terms and `SO.terms` have
separate authorities) · C.2 (final Ship-to is manual NetSuite responsibility for
V1) · OD-001 (closed; no new freight-presentation behaviour) · fields already
proven NetSuite-derived keep that classification.

---

## §1 · The structural finding

**Nexus-created SO2698 carries 53 populated fields; legacy SO2646 carries 72.**
The 19-field delta is the entire subject of this review.

Critically, **most of the delta is not a Nexus gap**. Sorting it by who
populates it is the work; the counts alone would mislead.

---

## §2 · Header fields — the 53 Nexus-created SO already receives

These need no Nexus work. They arrive by NetSuite default, form default, or
SuiteScript on a REST-created order, **proven** by their presence on SO2698,
which Nexus created without sending them.

| field | ID | SO2698 value | source authority |
|---|---|---|---|
| Customer | `entity` | `131860 "3471 Epicuren"` | **Nexus at CREATE** |
| Subsidiary | `subsidiary` | `2 "The DPS, Inc."` | **Nexus at CREATE** |
| Order Status | `orderStatus` | `B "Pending Fulfillment"` | **Nexus at CREATE** |
| Memo | `memo` | HubSpot deal + label | **Nexus at CREATE** |
| Deal ID | `custbody_dps_deal_id` | `63252890041` | **Nexus at CREATE** (HubSpot-derived) |
| Ship Date | `shipDate` | 2026-07-29 | **Nexus at CREATE** |
| Custom Form | `customForm` | `225 "The DPS - Sales Order"` | NetSuite form default |
| Location | `location` | `1 "The DPS"` | NetSuite default |
| Currency / rate | `currency`, `exchangeRate` | USD / 1 | NetSuite default |
| **Sales Rep** | `salesRep` | `180236 "Jackie King"` | **NetSuite customer-derived** — Nexus never sends it |
| Prev Rep / Prev Date | `prevRep`, `prevDate` | 180236 / 2026-07-29 | NetSuite workflow |
| Sales Effective Date | `salesEffectiveDate` | 2026-07-29 | NetSuite default |
| Source / Source System | `source`, `sourceSystem`, `originator` | REST Web Services | NetSuite, set by the integration channel |
| Bill Address | `billAddress`, `billAddressList`, `billingAddress_text` | Epicuren | NetSuite customer-derived |
| Ship Address | `shipAddress`, `shipAddressList` | `57936` customer default | NetSuite customer-derived — **C.2: not the final Ship-to** |
| Subsidiary address | `custbody_311_subsidiary_addr` | The DPS | SuiteScript |
| Atlas hidden flags ×4 | `custbody_atlas_*_hdn` | 1 / 2 | SuiteScript, internal |
| Auto-generate project | `custbody_dps_auto_generate_project` | true | SuiteScript |
| Pipeline | `custbody_dps_pipeline` | `8 "Sales"` | SuiteScript default |
| Report timestamp | `custbody_report_timestamp` | 29/07/2026 | SuiteScript |
| Update related trans | `custbody_ali_to_update_related_trans` | true | SuiteScript |
| Est. gross profit / % | `estGrossProfit`, `estGrossProfitPercent` | 150 / 50 | **NetSuite-computed** from line cost estimates |
| Totals | `subtotal`, `taxTotal`, `total`, `discountTotal` | computed | **NetSuite-computed** — Nexus must never send |
| Order # / Transaction # | `tranId`, `transactionNumber` | SO2698 | NetSuite-assigned |
| Status | `status` | Pending Fulfillment | NetSuite lifecycle |
| Handling / needsPick / canBeUnapproved | — | — | NetSuite internal |

**Disposition for all of §2: NO NEXUS WORK.** Proven by the Nexus-created SO
receiving them. This discharges "prove Nexus-created REST orders receive the
expected default/workflow behaviour rather than duplicating it in Nexus."

---

## §3 · The 19-field delta — legacy has it, SO2698 does not

| # | UI label | field ID | SO2646 value | purpose | source authority | when | Nexus responsibility | disposition |
|---|---|---|---|---|---|---|---|---|
| 1 | **PO #** | `otherRefNum` | `13969` | customer PO / reference | operator or Accounting | at/after CREATE | **none today** | **C.3 — see §5** |
| 2 | Check Number | `checkNumber` | `13969` | mirrors PO # | NetSuite/manual | post-CREATE | none | Accounting/manual |
| 3 | **Terms** | `terms` | `7 "50% Deposit/balance at shipment"` | AR terms | **NetSuite customer record** | at CREATE, NetSuite-defaulted | **none — C.1** | **CLOSED (C.1)** — NetSuite-owned; Nexus never writes |
| 4 | Business Segment | `cseg_dps_bus_seg` | `1 "TurnKey"` | segment reporting | operator/Accounting | at/post-CREATE | Nexus *does* send it | **already sent** — verify value authority |
| 5 | Project / Job | `job` | `388400 "174 Epicuren - Pro Masks"` | project linkage | SuiteScript auto-project | post-CREATE | none | **NetSuite workflow** — `auto_generate_project=true` on SO2698 |
| 6 | Opportunity | `opportunity`, `previousOpportunity` | `280230` | CRM linkage | NetSuite/HubSpot sync | post-CREATE | none | NetSuite-derived |
| 7 | Related Opportunity | `custbody_dps_related_opportunity` | `#OP3228` | same | NetSuite | post-CREATE | none | NetSuite-derived |
| 8 | Project Manager | `custbody_project_manager` | `194766 "Andrea McKibben"` | ownership | **HubSpot deal owner?** | manual today | **unresolved** | **GAP — ownership question §8** |
| 9 | Project Source | `custbody_dps_project_source` | `1 "Domestic"` | Domestic/International | operator | manual | none | **unresolved ownership §8** |
| 10 | Project Services | `custbody_dps_project_service_s` | `Product 360°` | service mix | operator | manual | none | **unresolved ownership §8** |
| 11 | Transaction Hold | `custbody_dps_transaction_hold` | `true` | blocks fulfilment | Accounting | manual post-CREATE | **none — correctly** | **Accounting/manual** |
| 12 | Est. Invoice Date | `custbody_dps_est_invoice_date` | `2026-09-07` | AR forecasting | Accounting | manual post-CREATE | none | **Accounting/manual** |
| 13 | Accounting Files | `custbody_dps_accounting_files` | SharePoint URL | document linkage | SharePoint integration | post-CREATE | none | **another governed integration** — SharePoint |
| 14 | SharePoint Link | `custbody_sharepoint_link` | SharePoint URL | same | SharePoint integration | post-CREATE | none | SharePoint integration |
| 15 | Shipping Address (text) | `custbody_dps_shipping_address` | `1130 E. Wilshire Ave…` / `Concept Labs` | **third-party ship-to** | Accounting | manual post-CREATE | **none — C.2** | **CLOSED (C.2)** manual |
| 16 | Ship Override | `shipOverride` | `true` | transaction-specific address | Accounting | manual post-CREATE | none | **CLOSED (C.2)** manual |
| 17 | STC after-discount ×3 | `custbody_stc_*` | 27040 / 0 / 27040 | tax-engine mirror | SuiteScript (STC) | post-CREATE | none | tax integration |
| 18 | Total Cost Estimate | `totalCostEstimate` | 20900 | margin reporting | **NetSuite-computed** from lines | at CREATE | none | NetSuite-computed |
| 19 | COP Description | `custbody_dps_cop_description` | `Mask I and Mask II powders` | COP tab | operator | manual | none | **unresolved ownership §8** |

**Conditional — SO2617 only (PP tab, packaging orders):**
`custbody_dps_pp_component_type`, `_deco`, `_description`, `_factory`,
`_freight_service`, `_material`, `_packout_details`, `_size`. Operator-entered
packaging specification, manual, **not Nexus-supplied in V1**. These are the
"conditional populated fields" the second sample was meant to expose, and they
are all one family.

---

## §4 · Item lines

| column | SO2646 | SO2698 | disposition |
|---|---|---|---|
| `item`, `quantity`, `rate`, `amount`, `description` | ✓ | ✓ | **Nexus at CREATE** |
| `custcol_dps_sku` | `EPICURENMSK1` | `10064-GNX-Box` | **Nexus at CREATE** |
| `custcol_dps_unit_cost` | 9.05 | 0.1 | **Nexus at CREATE** |
| `class` | `42 "Filling and Packout Services"` | `10 "Secondary"` | **Nexus at CREATE** |
| `costEstimate`, `costEstimateRate`, `costEstimateType` | 9050 / 9.05 / CUSTOM | 50 / 0.1 / CUSTOM | NetSuite-computed from unit cost |
| `poRate`, `price`, `taxCode`, `commitInventory`, `isOpen`, `quantity*` | ✓ | ✓ | NetSuite defaults |
| `custcol_statistical_value_base_curr` | 0 | 0 | NetSuite/tax |
| **`custcol_dps_hubspot_line`** | **`2`** | **absent** | **GAP candidate — §7** |

**Line-level parity is otherwise complete.** One column differs:
`custcol_dps_hubspot_line` carries the HubSpot line-item reference on legacy
orders and is absent from the Nexus-created SO.

---

## §5 · C.3 — the evidence, and what it does and does not settle

Measured across **all 699 Sales Orders** in the account:

| field | populated |
|---|---|
| **`otherRefNum`** (standard PO #) | **684 / 699 — 97.9%** |
| **`custbody_dps_client_po`** | **0 / 699 — never, in the entire history** |

Sample values leave no doubt what `otherRefNum` carries: `PO14441`, `PO14442`,
`PO-2063`, `PO1279`, `13969`.

**What this settles:** `custbody_dps_client_po` is dead in practice. No
downstream document can be reading a field that has never held a value, so the
"both" option is not a live possibility and the custom field should not be
populated by Nexus.

**What it does not settle, and why I am not closing C.3:** population is not
consumption. 684 rows prove operators put the customer PO in `otherRefNum`; they
do not prove which field invoice print, packing slips, fulfilment and AR *read*.
That is NetSuite configuration and is not visible from this side. The evidence
makes `otherRefNum` overwhelmingly likely — it just isn't the same claim, and
C.1 is the reason to keep the distinction: there, a field existed, was
populated, and was consulted by nobody.

**C.3 remains an Accounting decision**, now narrowed to a yes/no:

> Confirm `otherRefNum` is the field operationally consumed as the customer
> PO/reference. If yes, Nexus needs a governed customer-PO capture point — and
> its source authority (operator-entered? a HubSpot property?) is part of the
> same answer, because Nexus has no such input today.

---

## §6 · C.4 — evidence, with an explicit limit

| field | populated |
|---|---|
| `custbody_dps_custdep_pcnt` | 250 / 699 |
| `custbody_dps_custdep_type` | 252 / 699 |
| `custbody_dps_req_custdep` | 251 / 699 |

**Actively maintained, not vestigial** — by year: 2023 · 9, 2024 · 112,
2025 · 87, **2026 · 42**.

Shape is legible: `pcnt = 0.5` uniformly on recent orders, `type = 1` on 250 of
252, and `req_custdep` is a **computed dollar amount** (16257.5, 19300, 400,
6396, 5875) — i.e. a required deposit *value*, not a flag.

**Two things prevent me from closing it:**

1. **`CustDep` transaction count in this account: 0.** That is consistent with
   "the fields are informational", but this is the **sandbox**, and absent
   deposit transactions may be a data-refresh artifact rather than production
   reality. **I will not read production accounting behaviour out of a sandbox
   absence.**
2. SO2646 carries terms `50% Deposit/balance at shipment` and yet has **no**
   deposit fields populated, while SO2643 has them. So they do **not** track the
   customer's payment-term record one-for-one — which is exactly the inference
   Edward forbade, and the data independently refutes it.

**C.4 remains an Accounting decision, unchanged.**

---

## §7 · Genuine V1 gaps

| gap | evidence | note |
|---|---|---|
| **Customer PO capture** | 684/699 legacy vs 0 in Nexus | blocked on C.3 |
| **`custcol_dps_hubspot_line`** | legacy line carries it; Nexus does not | is the HubSpot line id available in `hubspot_deals_cache`? **needs check before classifying** |
| **Business Segment value authority** | Nexus sends `cseg_dps_bus_seg`; SO2698 shows it **absent** while SO2646 has `1 "TurnKey"` | Nexus sends it but it did not land — **needs investigation** |

The Business Segment row is the one genuine surprise: the payload builder sends
`class` and `cseg_dps_bus_seg`, and the field is populated on legacy orders, but
**SO2698 has no `cseg_dps_bus_seg` at all**. Either the send is conditional on
data Nexus lacked, or it was rejected silently. Not investigated here — recorded
as a gap needing its own pass.

## §8 · Unresolved ownership questions

Four operator-entered fields have no established owner in the Nexus model:
**Project Manager**, **Project Source** (Domestic/International), **Project
Services**, **COP Description**. Each is populated on legacy orders and absent
from Nexus. For each: is it operator-entered in NetSuite post-CREATE (→ manual
handoff), or should Nexus supply it from HubSpot? Project Manager in particular
looks HubSpot-derivable (`hubspot_owner_id`), but I have not verified that the
NetSuite employee ids map to HubSpot owners, so I am not asserting it.

## §9 · Manual post-CREATE responsibilities → operational handoff

| responsibility | owner |
|---|---|
| Verify/set final transaction Ship-to (`shipOverride` + `custbody_dps_shipping_address`) | **Accounting** — C.2 |
| Set Transaction Hold when required | **Accounting** |
| Set Estimated Invoice Date | **Accounting** |
| Enter customer PO | **pending C.3** |
| PP-tab packaging specification (packaging orders) | **operator** |

**Nexus has no operational handoff document.** Recorded as an
operational-readiness gap in `od-004-walk-runbook.md`; belongs in release/go-live
documentation.

## §10 · Accounting decisions required

1. **C.3** — confirm `otherRefNum` is operationally consumed; name the capture
   point and source authority for the customer PO.
2. **C.4** — are the deposit fields operative inputs to deposit invoicing? If
   yes: lifecycle point and source authority.

---

# §11 · P-1, P-2 and operator-field ownership (2026-08-11)

**Two corrections to §3–§10 above, both material.** That inventory was drawn
from what SO2698 *received*. Reading the frozen payload and the deal cache shows
the builder already supports most of the delta — SO2698 simply had no cache row.

## §11.1 · P-1 Business Segment — **NO PAYLOAD CHANGE REQUIRED**

| # | question | answer |
|---|---|---|
| 1 | in SO2698's frozen `payload_snapshot`? | **No.** 6 header keys only: `memo`, `entity`, `subsidiary`, `orderStatus`, `custbody_dps_deal_id`, `custbody_dps_payment_terms_text`. Neither `cseg_dps_bus_seg` nor `class` |
| 2 | which condition suppressed it? | `mark-complete.ts:606` passes `businessSegmentId: dealCache.businessSegmentId`; `sales-orders.ts:142` gates on `if (input.businessSegmentId)`. **Deal `63252890041` has no `hubspot_deals_cache` row at all**, so the value was null and the guard correctly suppressed both fields |
| 3 | did NetSuite accept / ignore / transform / reject? | **N/A — never transmitted.** NetSuite is exonerated |
| 4 | governed source value | `hubspot_deals_cache.business_segment_id` (HubSpot deal property) → `{id}` on both `class` and `cseg_dps_bus_seg` |
| 5 | fixture-specific or general? | **Fixture-specific.** 67 of 70 cached deals carry it — **Nemah = `3`.** SO2698's deal was the synthetic `SMOKE-CB-STEP10-DELETE-ME` fixture |

**The conditional guard behaved correctly on absent data.** The Case B push on
Nemah will emit `class` and `cseg_dps_bus_seg`. No repair.

Residual, small: 3 of 70 deals have no `business_segment_id`, so those orders
would carry no Business Segment. Arguably correct — do not invent a segment —
but it is a real conditional gap worth knowing.

## §11.2 · P-2 `custcol_dps_hubspot_line` — **NO PAYLOAD CHANGE REQUIRED**

Populated on **1,731 of 4,864** SO lines (35.6%), across 2023–2026.

**Decisive on purpose:** the values are `1, 2, 3, 4…` — 650 ones, 387 twos, 248
threes, 137 fours, decaying. That is a **line ordinal**, not an identifier. A
HubSpot line-item ID would be high-cardinality and unique (like the
`2015042158` this codebase stores as `hubspot_product_id`).

So it records the **position of a line within a HubSpot deal's line items** —
and **Nexus quote lines are not HubSpot deal line items.** They are produced
from the assembly tree. Populating it would fabricate a reference to a structure
that does not exist for these orders, and the real identity is already carried
by `custcol_dps_sku`, which Nexus does send.

**Classification: legacy-only metadata superseded by Nexus identifiers.**

**Stated limit:** I cannot enumerate SuiteScripts or saved searches from this
integration, so I cannot prove *nothing* reads it. If some report groups by it,
Nexus-created lines will be absent from that grouping. That is the residual
risk, and it is a reporting question rather than a payload one.

## §11.3 · Operator-field ownership — three of four are already HubSpot-derived

`hubspot_deals_cache` carries far more than §3 credited:

| field | cache column | populated | builder support | payload target |
|---|---|---|---|---|
| **Project Manager** | `pm_id` / `pm_name` / `pm_email` | **61 / 70** | `input.projectManagerNsId` → `sales-orders.ts:140` | `custbody_project_manager` |
| **Project Services** | `project_service_s` | **69 / 70** | `input.projectServiceS` → `:125` | `custbody_dps_project_service_s` |
| **Project Source** | `sourcing_location` | **69 / 70** | `input.projectSourceId` → `:129`, via `resolveProjectSource` label→id | `custbody_dps_project_source` |
| **COP Description** | — none — | 0 | none | — |

| field | authoritative source | required at CREATE? | derived? | Accounting maintains? | required for V1 downstream? |
|---|---|---|---|---|---|
| Project Manager | HubSpot deal (`pm_id`) | no | **HubSpot-derived, already wired** | no | not established |
| Project Services | HubSpot deal | no | **HubSpot-derived, already wired** | no | not established |
| Project Source | HubSpot deal `sourcing_location` | no | **HubSpot-derived, already wired** | no | not established |
| **COP Description** | **operator, in NetSuite** | no | **no** | post-CREATE | not established |

**Project Manager needs no invented mapping.** The concern does not arise:
`projectManagerNsId` is already a NetSuite id in the builder's contract. What is
*not* verified is how `pm_id` becomes that NetSuite id — that resolution step
should be confirmed before relying on it, but no new mapping needs designing.

**COP Description is the only true manual field** of the four → operational
handoff list.

## §11.4 · C.3 — correction to §5

**§5 said "Nexus currently has no governed customer-PO capture." That was
wrong.** Nexus has capture and writes it to the wrong field:

- `hubspot_deals_cache.client_po` exists and is populated on **3 of 70** deals —
  samples `13969`, `6321`, `PO1005`, which are exactly the values legacy orders
  carry in `otherRefNum`. **SO2646's `otherRefNum` is `13969`**, and `13969` is
  the cached `client_po` for Epicuren's deal.
- `sales-orders.ts:131` writes it to **`custbody_dps_client_po`** — the field
  populated on **0 of 699** Sales Orders.
- `otherRefNum` — populated on **684 of 699** — is **never written by Nexus**.

So the customer PO is captured, carried, and then written to a field nothing has
ever used.

**This does not change the C.3 hold.** Accounting still owns "which field is
operationally consumed". But the decision is now a one-line redirect of an
existing wired path rather than new capture — and the coverage question
(3 of 70 deals carry a PO) is part of what that answer must address.

## §11.5 · C.3 — CLOSED (2026-08-11), repair shipped

The NetSuite technician confirmed the redirect: **`otherRefNum` carries the
customer PO; `custbody_dps_client_po` is the custom field used to get the data
from HubSpot.**

`sales-orders.ts` now emits `hubspot_deals_cache.client_po` to **both** — the
standard field because Accounting named it, and the custom field preserved
because its integration ownership is not determinable from this side (§12's
enumeration limit applies identically here). No new capture mechanism was added.

Full disposition and evidence: `parity-decision-package.md` § C.3.
Test: `tests/unit/c3-customer-po-projection.test.ts`.

**C.4 also closed** the same day: the DPS customer-deposit fields are custom
metadata, not operative for deposit invoicing. No V1 implementation; not to be
derived from payment terms.

---

# §12 · Legacy specification projection (PP / SP / SGA / COP) — ONE disposition

**Treated as a single legacy capability requiring business disposition, not as
dozens of individual V1 defects.** These four families historically projected
product/production specification through the Sales Order and, in at least some
cases, into downstream invoice/document workflows.

## §12.1 · Measured usage — all 699 Sales Orders

| family | most-populated field | range across the family |
|---|---|---|
| **SP** Secondary Packaging | `sp_color` **341** | 81 – 341 · description 329, finishing 303, coating 286, size 222, material 221, packout 185, freight svc 104, factory 81 |
| **PP** Primary Packaging | `pp_description` **175** | 12 – 175 · size 144, component type 133, material 118, factory 114, deco 110, packout 95, freight svc 50, **production ship date 12** |
| **SGA** Soft Goods / Accessories | `sga_description` **112** | 35 – 112 · deco 102, material 75, packout 73, finishing 70, size 67, factory 42, freight svc 35 |
| **COP** Co-pack / Production | `cop_description` **104** | 18 – 104 · skus 89, fill size 78, packout 74, freight svc 18 |

**Still in active use, not historical residue.** PP by year: 2023 · 14,
2024 · 76, 2025 · 60, **2026 · 25**.

**Two COP fields named in the request do not exist as SO body fields in this
account:** `cop_blending_required` and `cop_claims_testing` returned *no such
field*. They may live on another record, be differently named, or have been
retired. Recorded rather than assumed — the disposition should not be written as
if they exist.

**~40 fields across four families.** SP is the largest by usage, not PP — worth
noting, because the V1 manual list currently names only PP.

## §12.2 · The disposition question — Accounting / Operations

> Are any PP/SP/SGA/COP fields still consumed today by customer invoices,
> packing/fulfilment documents, production operations, Accounting processes,
> saved searches, SuiteScripts, or other downstream workflows?

**This cannot be answered from Nexus.** Population proves operators fill them in;
it does not prove anything reads them. Saved searches and SuiteScripts are not
enumerable through this integration — the same limit that blocked P-2 and C.3.
That is precisely why it is a business question.

### If NONE are still consumed

- Classify the legacy PP/SP/SGA/COP projection **obsolete for V1**.
- **Do not reproduce these fields in Nexus.**
- **Remove PP specification entry from the V1 manual post-CREATE list** — see
  §12.3.
- Retain product specifications in their governed Nexus product/project
  structures, where they already live (`leaf_specs`, product types).

### If SOME are still consumed

Identify **per field**, not per family:

1. which field;
2. which downstream artifact/process consumes it;
3. whether it must exist **at SO CREATE** or may be populated later;
4. the authoritative source — Nexus, HubSpot, or NetSuite;
5. whether the requirement is customer-facing, operational, accounting or
   reporting.

**Do not recreate an entire family because one field remains useful.** With
~40 fields and four families, family-level reinstatement would be the expensive
wrong answer to a narrow need.

## §12.3 · Consequence for the V1 manual post-CREATE list

The list currently reads:

| item | owner | status |
|---|---|---|
| Final Ship-to verification/set | Accounting | firm (C.2) |
| Transaction Hold | Accounting | firm |
| Estimated Invoice Date | Accounting | firm |
| **PP packaging specification** | operator | **CONDITIONAL on §12.2** |
| COP Description | operator | **CONDITIONAL on §12.2** — it is a COP-family field |
| Customer PO | pending C.3 | conditional |

Two entries are conditional on this disposition. **COP Description was listed
separately in §11.3 before this family framing existed** — it belongs to COP and
should be dispositioned with it, not on its own.

If the answer is "none consumed", both drop out and the manual list reduces to
three firm Accounting items plus the C.3-dependent PO.

## §12.4 · Consolidated business dependencies — hold implementation

| # | question | owner |
|---|---|---|
| **C.3** | Does downstream workflow consume standard `otherRefNum`? If yes, Nexus already carries the source in `hubspot_deals_cache.client_po` — the fix is redirecting an existing wired path, not new capture | Accounting |
| **C.4** | Are the deposit percentage/type/required-deposit fields operative accounting inputs? If yes, when must they exist and from what authority? Do not derive from payment terms | Accounting |
| **§12** | Are any PP/SP/SGA/COP fields still consumed downstream? If some, name them individually | Accounting / Operations |

**Implementation held on all three.** None of them changes the grouping
mechanics being certified, so Case B preparation is not blocked by them.
