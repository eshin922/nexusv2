import "server-only";
import { createHash } from "node:crypto";
import { createRecord, getRecord, type NetsuiteConfig } from "./client";

// Slice 12 Step 8c-3 — Sales Order payload builder + REST create.
//
// Field surface mirrors SO2646 (sandbox probe 2026-07-28):
//   • entity           — customer NS internal id (resolved via customer-map)
//   • subsidiary       — firm_settings.netsuite_subsidiary_id (default '2')
//   • orderStatus      — firm_settings.netsuite_so_order_status_code
//                        (default 'B' = Pending Fulfillment; NetSuite
//                        uses single-letter codes for SO status)
//   • terms            — free text from quote.paymentTermsSnapshot
//                        (verbatim; NetSuite accepts free-text terms)
//   • memo             — mirror of custbody_dps_deal_id + dealName
//                        (workflow parity per CA Q5 disposition)
//   • custbody_dps_deal_id — HubSpot deal id (main linkage field)
//   • custbody_dps_accounting_files — SharePoint URL (from
//                        hubspot_deals_cache.deal_folder_url)
//   • custbody_dps_project_source, project_service_s, ...
//                      — field-fill from 8c-2's expanded cache columns
//   • class            — NetSuite class ref (business segment id;
//                        NetSuite resolves)
//   • item[]           — SO line items (physical + OTC in one list)
//
// Per-line shape (verified via SO2646/item/1):
//   • item             — { id: <ns_item_internal_id> } (an Item Group
//                        or a physical/OTC item)
//   • quantity, rate, amount, description
//   • taxCode          — { id: firm_settings.netsuite_default_tax_code_id }
//   • custcol_dps_sku  — leaf's Nexus SKU (round-trip breadcrumb)
//   • custcol_dps_unit_cost — leaf's per-unit cost from ASY/LEAF adapter

export interface SalesOrderLine {
  netsuiteItemId: string;          // resolved Item Group OR physical/OTC item
  sku: string;                     // Nexus SKU (round-trip)
  description: string;             // per-line description
  quantity: number;
  rate: number;                    // per-unit sell price
  unitCost: number | null;         // per-unit cost (for custcol_dps_unit_cost)
}

export interface SalesOrderPayloadInput {
  // Header — customer + firm defaults
  netsuiteCustomerId: string;
  subsidiaryId: string;
  orderStatusCode: string;         // e.g. 'B' Pending Fulfillment
  // Q4 REVISED (CA 2026-07-28): null means "let NetSuite's tax engine
  // derive per-line tax from customer + ship-to". Only populate when
  // firm_settings.netsuite_default_tax_code_id is set as an admin
  // override. Hardcoding a value overrides correct behavior on lines
  // most likely to need it (OTC/tooling for out-of-state customers).
  taxCodeId: string | null;
  // Free-text terms from send-time snapshot
  paymentTermsText: string | null;
  // Provenance / audit fields
  hubspotDealId: string;
  hubspotDealName: string;
  // 8c-2 cache field-fill (all optional; write only if populated)
  dealFolderUrl?: string | null;
  projectServiceS?: string | null;
  projectCategory?: string | null;
  // NetSuite internal id for the project_source custom list — NOT the
  // label. Cache stores the label; markComplete's STEP 4 resolves via
  // project-source-resolver's SuiteQL lookup before payload build.
  // Sending the label directly errors USER_ERROR "Invalid Field Value
  // <label> for the following field: custbody_dps_project_source"
  // (Class B parity finding, 2026-07-29).
  projectSourceId?: string | null;
  businessSegmentId?: string | null;     // NetSuite class id (resolved via BS resolver → NS class)
  businessSegmentLabel?: string | null;  // fallback for readability
  clientPo?: string | null;
  invoiceDateEst?: string | null;        // YYYY-MM-DD
  productionShipDateEst?: string | null; // YYYY-MM-DD
  priority?: string | null;
  dealType?: string | null;
  projectManagerNsId?: string | null;    // if HubSpot owner id maps to NS employee
  // Lines
  lines: SalesOrderLine[];
}

/**
 * Build the SO payload for REST POST /record/v1/salesOrder.
 * Additive by design — omit properties that aren't populated so
 * NetSuite doesn't reject on unknown-null-write. Number and date
 * formatting normalized here (rate/amount as strings for NS's
 * numeric-as-string convention on inputs).
 */
export function buildSalesOrderPayload(
  input: SalesOrderPayloadInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    entity: { id: input.netsuiteCustomerId },
    subsidiary: { id: input.subsidiaryId },
    orderStatus: input.orderStatusCode,
    memo: `HubSpot Deal ${input.hubspotDealId} · ${input.hubspotDealName}`,
    // custom body fields
    custbody_dps_deal_id: input.hubspotDealId,
  };

  if (input.paymentTermsText && input.paymentTermsText.trim()) {
    // NS `terms` accepts a text/ref; passing as text is safe for
    // free-text terms that don't match a named term record.
    body.custbody_dps_payment_terms_text = input.paymentTermsText.trim();
  }

  // 8c-2 field-fill (conditional — write only when populated).
  //
  // Slice 12 Step 9 CD audit follow-up — three parity mappings added
  // per SO field-parity probe vs reference SO2646 (2026-07-29):
  //   1. custbody_sharepoint_link mirrors custbody_dps_accounting_files.
  //      Both hold the SharePoint URL; ref SO carries both simultaneously.
  //   2. cseg_dps_bus_seg mirrors class from businessSegmentId. class is
  //      the NS classification taxonomy; cseg is the parallel custom
  //      segment taxonomy — ref carries the same segment id in both.
  //   3. shipDate mirrors custbody_dps_pp_production_ship_date. NS uses
  //      the standard shipDate field; the custom body field is retained
  //      as a Nexus round-trip breadcrumb, but the standard field must
  //      also carry the value or NS defaults to today (a real operational
  //      error on every SO — CA's highest-stakes item in the parity set).
  if (input.dealFolderUrl) {
    body.custbody_dps_accounting_files = input.dealFolderUrl;
    body.custbody_sharepoint_link = input.dealFolderUrl;
  }
  if (input.projectServiceS)
    body.custbody_dps_project_service_s = input.projectServiceS;
  if (input.projectCategory)
    body.custbody_dps_project_category = input.projectCategory;
  if (input.projectSourceId)
    body.custbody_dps_project_source = { id: input.projectSourceId };
  if (input.clientPo) body.custbody_dps_client_po = input.clientPo;
  if (input.invoiceDateEst)
    body.custbody_dps_est_invoice_date = input.invoiceDateEst;
  if (input.productionShipDateEst) {
    body.custbody_dps_pp_production_ship_date = input.productionShipDateEst;
    body.shipDate = input.productionShipDateEst;
  }
  if (input.priority) body.custbody_dps_priority = input.priority;
  if (input.dealType) body.custbody_dps_deal_type = input.dealType;
  if (input.projectManagerNsId)
    body.custbody_project_manager = { id: input.projectManagerNsId };
  if (input.businessSegmentId) {
    body.class = { id: input.businessSegmentId };
    body.cseg_dps_bus_seg = { id: input.businessSegmentId };
  }

  // Lines — flat one-per-leaf (per CA disposition 2026-07-28).
  //
  // Each line references a bare NetSuite item (InvtPart / NonInvtPart /
  // OthCharge) resolved from the leaf's SKU. Item Group wrap is
  // intentionally skipped — see mark-complete.ts STEP 5 block for the
  // full context on why. This ships correct pricing (Aisha stops
  // retyping) while leaving her invoice-side wrap step in place.
  //
  // taxCode omitted per Q4 REVISED — NetSuite derives per-line tax
  // from customer + ship-to. Only sent when firm_settings admin
  // override is set (currently NULL by default).
  //
  // rate + amount sent as NUMBERS not strings — sandbox probe
  // 2026-07-28 confirmed NetSuite REST rejects strings with
  // INVALID_VALUE.
  body.item = {
    items: input.lines.map((line) => ({
      item: { id: line.netsuiteItemId },
      quantity: line.quantity,
      rate: parseFloat(line.rate.toFixed(4)),
      description: line.description,
      ...(input.taxCodeId ? { taxCode: { id: input.taxCodeId } } : {}),
      custcol_dps_sku: line.sku,
      ...(line.unitCost !== null
        ? { custcol_dps_unit_cost: parseFloat(line.unitCost.toFixed(4)) }
        : {}),
    })),
  };

  return body;
}

/**
 * Deterministic idempotency key for a (quote, tier, payload) triple.
 * Same triple → same key. Different payloads (same quote+tier) →
 * different key: caller should treat that as an anomaly (payload
 * drift on retry) but the netsuite_so_pushes CHECK-then-write is
 * the primary defense; this header is belt-and-suspenders.
 */
export function computeIdempotencyKey(
  quoteId: string,
  acceptedTierId: string,
  payload: Record<string, unknown>,
): string {
  const canonical = JSON.stringify(payload);
  const hash = createHash("sha256")
    .update(`${quoteId}|${acceptedTierId}|${canonical}`)
    .digest("hex");
  // Prefix identifies Nexus-authored keys unambiguously in NetSuite
  // logs; the hash is deterministic in inputs.
  return `nxs-so-${hash.slice(0, 40)}`;
}

/**
 * Create a Sales Order via REST /record/v1/salesOrder. Wraps
 * createRecord() with the idempotency-key header. Returns the new
 * SO's internal id (NetSuite's Location header) — caller must then
 * fetch tranId separately if wanted.
 *
 * IMPORTANT: this is layer 2 of dual idempotency. Layer 1 is the
 * netsuite_so_pushes CHECK-then-write in the orchestrator. The
 * header here catches only the "post succeeded, persist failed"
 * retry window where the orchestrator can't see the previous push.
 */
export async function createSalesOrder(
  payload: Record<string, unknown>,
  args: {
    idempotencyKey: string;
    config?: NetsuiteConfig;
  },
): Promise<{ internalId: string }> {
  return createRecord({
    recordType: "salesOrder",
    body: payload,
    config: args.config,
    idempotencyKey: args.idempotencyKey,
  });
}

/**
 * Fetch a Sales Order's display tranId (e.g. "SO2697") given its
 * internal id. NetSuite's REST POST returns only the internal id
 * via the Location header; the human-readable tranId requires a
 * follow-up GET.
 *
 * Slice 12 Step 10 Q15 (2026-07-29) — closes a "TODO written as
 * statement of intent" gap:
 *   mark-complete.ts:543 previously read
 *     `salesOrderTranid = null; // caller can fetch tranId separately`
 *   with no caller ever picking it up. Every completed quote shipped
 *   with null tranid — the human-readable order reference PMs actually
 *   use to find the SO in NetSuite.
 *
 * Returns the tranId as a string if the fetch + parse succeed,
 * null on any failure (network, parse, missing field). Callers MUST
 * treat null as diagnostic missing data — NOT as a reason to block
 * the freeze-tx. Same rule as the amount-patch step: fetch is
 * best-effort; complete never blocks on it.
 */
export async function fetchSalesOrderTranid(
  internalId: string,
  opts?: { config?: NetsuiteConfig },
): Promise<string | null> {
  try {
    const rec = await getRecord<{ tranId?: unknown }>(
      "salesOrder",
      internalId,
      opts,
    );
    if (rec && typeof rec.tranId === "string" && rec.tranId.trim() !== "") {
      return rec.tranId.trim();
    }
    return null;
  } catch {
    return null;
  }
}
