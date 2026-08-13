# Sales Order field-parity — legacy vs Nexus

**READ-ONLY probe. No NetSuite record was created or modified.**

Sample: legacy Nemah SOs **SO2617** (`347982`), **SO2615** (`346430`), **SO2591**
(`339477`) — entity `72173`, 7 legacy SOs available — against Nexus-created
**SO2698** (`360841`). Header fields via `getRecord(salesOrder, id)` (**102
fields**); line fields via `transactionLine`. Nemah SOs span $300 – $38,743 over
2025-08 → 2026-05, so invariant fields are distinguishable from scenario-specific.

---

## A · Parity — populated and consistent on both

| field | scope | legacy | Nexus SO2698 | source | class |
|---|---|---|---|---|---|
| `entity` | header | `72173` Nemah | `131860` Epicuren | Nexus sends | **parity** |
| `subsidiary` | header | `2` The DPS, Inc. | `2` | Nexus sends | **parity** |
| `customForm` | header | `225` The DPS - Sales Order | `225` | NetSuite default | **NetSuite-owned** |
| `currency` / `exchangeRate` | header | USD / 1 | USD / 1 | NetSuite from customer | **NetSuite-owned** |
| `location` | header + line | `1` The DPS | `1` | NetSuite default | **NetSuite-owned** |
| `orderStatus` / `status` | header | `B` Pending Fulfillment | `B` | Nexus sends | **parity** |
| `custbody_dps_deal_id` | header | deal id | `63252890041` | Nexus sends | **parity** |
| `memo` | header | bare deal id | `HubSpot Deal … · <name>` | Nexus sends | **parity** (richer) |
| `tranDate` | header | create date | `2026-07-29` | NetSuite default | **NetSuite-owned** |
| `shipDate` | header | populated | `2026-07-29` | Nexus sends when known | **parity** |
| `class` | **line** | `60`, `1` | `10`, `58`, `1` | NetSuite from item defaults | **NetSuite-owned** |
| `costestimate` / `costestimatetype` | **line** | populated, `CUSTOM` | populated, `CUSTOM` | NetSuite-derived | **NetSuite-owned** |
| `quantity` / `rate` / `netamount` | line | populated | populated | Nexus sends | **parity** |
| `subtotal` / `total` / `taxTotal` / `discountTotal` | header | consistent | consistent | NetSuite-computed | **parity** |
| `salesRep` | header | `210084` Jing Santos | `180236` Jackie King | NetSuite from customer | **NetSuite-owned** |
| `billAddress` / `billAddressList` | header | customer address | customer address | NetSuite from customer | **NetSuite-owned** |
| `shipComplete` / `toBePrinted` / `toBeEmailed` / `shipIsResidential` | header | false | false | NetSuite default | **NetSuite-owned** |

## B · Conditional — the builder sends these; SO2698's smoke deal had no cached source

Not gaps. `buildSalesOrderPayload` emits each only when its cache column is
populated, and the smoke deal carried none. **Nemah's cache row must be checked
before Case B** to establish which will actually populate.

`custbody_dps_accounting_files` · `custbody_sharepoint_link` ·
`custbody_dps_project_service_s` · `custbody_dps_project_category` ·
`custbody_dps_project_source` · `custbody_dps_client_po` ·
`custbody_dps_est_invoice_date` · `custbody_dps_pp_production_ship_date` ·
`custbody_dps_priority` · `custbody_dps_deal_type` · `custbody_project_manager` ·
`class` + `cseg_dps_bus_seg` (header)

## C · V1 gaps and business dispositions

| # | field | legacy value | Nexus | classification |
|---|---|---|---|---|
| **1** | `terms` | `2` Net 30 · `10` 30% Deposit / 70% Shipment | **NetSuite derived `7` from the customer default.** Nexus sends only free text into `custbody_dps_payment_terms_text` | **V1 gap — highest stakes.** The quote's negotiated send-time terms do not drive the NetSuite `terms` record; where they differ from the customer default the SO carries the wrong terms into invoicing |
| **2** | `shipAddress` / `shipAddressList` | **`Concept Labs`, Pleasant Prairie WI** — a third-party fulfilment site | defaults to the **customer's own address** (`26081 Merit Circle`) | **V1 gap / business disposition.** Legacy ships to a co-packer; Nexus would ship to the customer |
| **3** | `otherRefNum` (+ `checkNumber`) | `NM1082`, `NM1071`, `NM1065` | absent — Nexus uses `custbody_dps_client_po` | **business disposition.** `otherRefNum` is NetSuite's standard PO# field, surfaced on invoices and packing slips |
| **4** | `opportunity` · `previousOpportunity` · `custbody_dps_related_opportunity` | linked NS Opportunity (`#OP3276 …`) | absent | **business disposition.** Is the Opportunity part of the workflow Nexus replaces, or must the SO still link to it? |
| **5** | `custbody_dps_pp_*` — component_type, factory, size, packout_details, freight_service, gasket/pipette | heavily used (`Airless`, `Goldrain`, `150mL`, `Carton Pack`) | absent | **business disposition.** PM-maintained post-CREATE, or required at CREATE? |
| **6** | `custbody_dps_custdep_pcnt` / `custdep_type` / `req_custdep` | `30` / `Percent` / `9090.61` | absent | **business disposition.** Customer-deposit tracking; drives billing |
| **7** | `custbody_dps_internal_note` | operational notes | absent | **business disposition** — likely post-CREATE |
| **8** | `shipMethod` · `shippingCost` · `shippingTaxCode` · `actualShipDate` | on 1 of 3 (`Ocean Freight`) | absent | **scenario-specific**, likely post-CREATE at fulfilment |
| **9** | `custbody_stc_amount_after_discount` / `_tax_` / `_total_` | mirrors totals on all 3 | absent on SO2698 | **probably bundle/NetSuite-owned** — confirm the populating script also fires for REST-created SOs |
| **10** | line `memo` (description) | `150ml Bottle + 30% PCR` | `" Genexa - Box…"` — **leading space** | **cosmetic defect** in description generation |

## D · Blocking assessment for Nemah Case B

**Not blocking.** Every item in C concerns *what the SO carries*, not whether a
correct SO can be created. Case B exercises grouping, membership and
reconciliation; none of C affects those. Items **1** and **2** must be
dispositioned before Nexus replaces the legacy workflow in production.

---

## Mandatory Track B preflight (new)

> **Before Sales Order CREATE, verify in the target NetSuite account that no
> existing Sales Order carries the HubSpot deal ID.**

```sql
SELECT id, tranid, trandate, status FROM transaction
 WHERE type = 'SalesOrd' AND custbody_dps_deal_id = '<dealId>';
```

Non-empty ⇒ CREATE is refused by
`/SuiteScripts/DPS/Sales/_dps_ue_prevent_dupplicated_so.js` with
`DUPLICATED DEAL`. Status is **not** a filter — SO2624 is `Closed` and still blocks.

## Incidental defect — OAuth signature omits query parameters

`buildAuthHeader` signs `url.split("?")[0]` and includes only its `extra`
argument in the base string; `nsRequest` never passes `extra`. Any request
carrying a query string is signed without those parameters and rejected
`401 INVALID_LOGIN`.

Control — identical SuiteQL, one variable:

```
no query param      -> OK (1 rows)
with { limit: 6 }   -> [netsuite:auth] Invalid login attempt
```

`suiteQL`'s `limit`/`offset` are unusable, so **SuiteQL pagination is broken**, as
is any REST GET needing `?expandSubResources=true` — the projection an Item Group
read-back would most naturally use. No current production caller passes either,
so this is latent, not live.

---

## C.1 · CLOSED — governed customer payment terms (`0c2c523`, 2026-08-11)

### The V1 authority contract

```
NetSuite Customer Terms → Nexus customer-facing quote terms → frozen Send snapshot
```

and, independently:

```
NetSuite accounting configuration → SO.terms
```

**Nexus does not force equality between the two after Send.** They answer
different questions for different audiences: the quote snapshot preserves what
was *promised to the customer*; `SO.terms` is what *Accounting operates on*.
A difference between them is auditable commercial/accounting state, not drift
to be reconciled. Nexus never writes `SO.terms`.

### Why the previous value was not authority

`firm_settings.payment_terms_default` is one firm-wide free-text string with no
customer dimension. Against the 9 customers with verified NetSuite lineage:

| | |
|---|---|
| had a populated governed Terms record | **9 of 9** |
| disagreed with what Nexus would print | **9 of 9** |
| disagreed **materially** (governed `Net 30` vs printed 50%-deposit) | **5 of 9** |
| agreed only by coincidence of drafting | 4 of 9 |

Coincidental free-text equivalence is not parity. That is why C.1 could not
close as parity and had to close as a repair.

### Operational consequence — intentional, not a defect

> **A quote cannot be sent until its customer has verified NetSuite lineage and
> a resolvable NetSuite Customer Terms value.**

Fail-closed is the point: the alternative is printing an unauthorised
commercial commitment. All 9 currently-mapped customers satisfy the gate, so no
existing customer is blocked. A newly-imported deal will be blocked until its
lineage is verified — expected behaviour, and worth knowing before a PM meets
it.

Drafts still render, marked `provisional` via `paymentTermsSource`, so quote
authoring is never blocked — only the commitment is.

### Quote-level Terms override — `DEFERRED, NOT DECLINED`

Two prerequisites, both established, neither an engineering question:

1. **Business authority** — who may override, and under what conditions.
2. **An approved, enumerable governed Terms vocabulary.** Not available today:
   `term` is not a SuiteQL record and `GET /record/v1/term/{id}` returns
   `Permission Violation`. Reading *one* customer's term works (it arrives on
   the customer record as `terms.refName`); listing the vocabulary does not.
   Those are different permissions — which is why the starting value was
   reachable now and a picker was not.

Pinned by `governed-payment-terms.test.ts` test 11 so it cannot arrive by
accident.

### Explicitly out of V1 scope

**No caching or freshness architecture.** Drafts resolve live; sent quotes read
their frozen snapshot and never re-resolve. That is the whole model.

### DPS-1045 — invalidated for Case B in its current sent state

| | |
|---|---|
| frozen terms | `50% deposit, 50% on shipment` |
| Nemah governed terms | `Net 30` |
| verdict | **snapshot is not valid certification evidence** |

**Do not Accept.** **Do not Revise/re-Send yet** — held until the remaining
quote-side parity work is dispositioned, so external transitions are not spent
unnecessarily. Nemah has verified lineage and a populated Terms record, so the
governed Revise → Send path will succeed when it is time.
