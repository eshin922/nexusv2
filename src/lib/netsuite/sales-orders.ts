import "server-only";
import { createHash } from "node:crypto";
import { POSTED_RATE_SCALE } from "@/lib/commercial-rate";
import { createRecord, getRecord, type NetsuiteConfig } from "./client";
import { NON_TAXABLE_TAX_CODE_ID } from "./tax-policy";
import { CUSTOM_PRICE_LEVEL_ID } from "./price-policy";

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
//   • class            — NOT SENT. See the note by `cseg_dps_bus_seg` below;
//                        observed orders carry class = null.
//   • item[]           — SO line items (physical + OTC in one list)
//
// Per-line shape (verified via SO2646/item/1):
//   • item             — { id: <ns_item_internal_id> } (an Item Group
//                        or a physical/OTC item)
//   • quantity, rate, amount, description
//   • taxCode          — ALWAYS { id: "-8" } (-Not Taxable-), governed rule
//   • price            — ALWAYS { id: "-1" } (Custom), governed rule
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
  // Tax is NOT an input.
  //
  // It was `taxCodeId: string | null`, sourced from
  // firm_settings.netsuite_default_tax_code_id, where null meant "let NetSuite
  // derive per-line tax from customer + ship-to" (Q4 REVISED, CA 2026-07-28).
  // It was null in practice, which is why SO2716 came back carrying $1,030.50
  // of tax derived from a customer flagged taxable.
  //
  // Every Nexus-created Sales Order is non-taxable by governed business rule,
  // so tax is no longer a parameter a caller can get wrong or an admin can
  // silently flip. See tax-policy.ts for the measured cause and the lever.
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
  // RAW HubSpot `business_segment` enum id — NOT a NetSuite class id, and not
  // resolved to one. The prior comment here claimed "NetSuite class id
  // (resolved via BS resolver → NS class)"; that was false and is what the
  // Case B walk halted on. `business-segment-resolver.ts` resolves this enum
  // id to a LABEL for display backfill. Nothing maps it to a class.
  //
  // No longer feeds `class` (V1 Class contract, 2026-08-12 — see below).
  // Still feeds `cseg_dps_bus_seg`, whose own authority is under review.
  businessSegmentId?: string | null;
  businessSegmentLabel?: string | null;  // fallback for readability
  clientPo?: string | null;
  invoiceDateEst?: string | null;        // YYYY-MM-DD
  productionShipDateEst?: string | null; // YYYY-MM-DD
  priority?: string | null;
  dealType?: string | null;
  projectManagerNsId?: string | null;    // if HubSpot owner id maps to NS employee
  // Lines — FLAT (itemized). Mutually exclusive with `groupLines`.
  lines: SalesOrderLine[];
  /**
   * Item Group lines (turnkey_only). MUTUALLY EXCLUSIVE with `lines`.
   *
   * NetSuite expands each group into its member lines itself. Sending a group
   * AND explicit member lines duplicates the members and doubles the total
   * (Probe 7a) — a 204 that ships a wrong order. The builder therefore refuses
   * to emit both rather than trusting callers to pass only one.
   *
   * Deliberately BARE: item + quantity only. Probe 7a also established that a
   * rate on the group header is ignored, so putting the negotiated rate here
   * would look like pricing and do nothing. Member pricing arrives by
   * per-line PATCH in Step 3, after `awaiting_rates`.
   */
  groupLines?: SalesOrderGroupLine[];
  /**
   * Item ids the emitted Item Groups will expand into member lines.
   *
   * Required whenever `groupLines` and `lines` are both non-empty: it is what
   * lets the builder refuse a flat line for an item the group already expands
   * (Probe 7a doubling) while permitting one for an item in no group (P1).
   * Membership is the rule; co-occurrence is not.
   *
   * Source it from the VERIFIED master data read back from NetSuite, not from
   * the plan's intent — what the group will actually expand is what matters.
   */
  groupMemberItemIds?: string[];
}

export interface SalesOrderGroupLine {
  /** The Item Group RECORD's internal id (not a member item). */
  netsuiteItemId: string;
  /** Group display sku — diagnostic only; not transmitted. */
  sku: string;
  /** Tier quantity. Members expand at `quantity × member-quantity-per-group`. */
  quantity: number;
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
  //   2. cseg_dps_bus_seg, from businessSegmentId.
  //
  //      This used to read "cseg_dps_bus_seg MIRRORS class … ref carries the
  //      same segment id in both". `class` was never assigned — a grep for
  //      `body.class` returns nothing — and on SO2701 / SO2704 / SO2707 /
  //      SO2709 `class` is null while `cseg_dps_bus_seg` is 3. The comment
  //      described a parity mapping that was not implemented, which is a
  //      worse state than an unimplemented one: it reads as done.
  //
  //      Corrected rather than implemented (Edward, 2026-08-19). Whether
  //      `class` should also be written is an Accounting question; the
  //      reference order carrying both is evidence, not a decision.
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
  // C.3 (2026-08-11) — NetSuite technician disposition: "Customer PO should be
  // otherRefNum. custbody_dps_client_po is the custom field used to get the
  // data from HubSpot."
  //
  // Estate evidence agrees: otherRefNum 684/699, custbody_dps_client_po 0/699,
  // and Epicuren's cached client_po `13969` is exactly SO2646's otherRefNum.
  // So this is a redirect of an already-wired path, not new capture.
  //
  // The custom-field write is PRESERVED rather than replaced. Whether it is
  // still required as a staging field for the HubSpot synchronization path
  // cannot be determined from this side — SuiteScripts, workflows and saved
  // searches are not enumerable through the REST integration (the same limit
  // recorded against P-2 and §12). Unresolved ownership is authority to ADD
  // the field Accounting named, not to remove one an upstream integration may
  // depend on. 0/699 population proves no operator filled it; it does not
  // prove nothing writes to or reads it.
  //
  // Emitted verbatim to both. No formatting, no transformation, no inference.
  if (input.clientPo) {
    body.otherRefNum = input.clientPo;
    body.custbody_dps_client_po = input.clientPo;
  }
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
  // V1 CLASS CONTRACT (2026-08-12, Edward):
  //
  //   NetSuite owns Sales Order line Class through the Item record.
  //   Nexus must not send `class`.
  //
  // Class remains required business/accounting data. What was removed is an
  // invalid COMPETING authority, not the requirement. Nexus was sending the
  // raw HubSpot `business_segment` enum id as `class` — two unrelated
  // taxonomies. Segment 3 (`DPS Packaging`) is not a class at all and NetSuite
  // rejected it; segment 1 (`Product 360°`) collides numerically with class 1
  // (`Primary`) and was silently misattributing every order it touched.
  //
  // NetSuite already derives line Class from the Item record, correctly, with
  // no help from us. Proven by SO2698 — created by Nexus transmitting NO class
  // — whose lines came back 10064-GNX-Box → 10 Secondary, BA146400 → 58 Soft
  // Goods and Accessories, DPS-BOTTLE-0001 → 1 Primary, each matching its
  // Item-record class. 1,296 of 1,358 Items carry Class; 2,523 of 2,731
  // historical classified lines match their Item's. The systematic exceptions
  // are Accounting's own line-level refinements — a further reason not to
  // overwrite this authority.
  //
  // Do NOT substitute Nexus cost category, markup category, HubSpot Business
  // Segment, or any other mapping. Do not add a fallback for the 62 Items that
  // carry no Class — that is an Accounting Item-master matter, and Group /
  // Assembly items being unclassed already matches legacy behaviour.
  //
  // Evidence: tests/unit/netsuite-class-item-authority.test.ts
  // Review:   docs/validation/netsuite-class-mapping-review.md
  //
  // `cseg_dps_bus_seg` is a DIFFERENT dimension (Business Segment, not Class)
  // and is deliberately left as-is here. It is fed the same raw enum id and was
  // rejected in the same CREATE; its authority is under separate review and
  // must not be assumed valid because Class was settled.
  if (input.businessSegmentId) {
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
  // taxCode is sent on EVERY line, always -8 (-Not Taxable-). This reverses
  // Q4 REVISED, which delegated tax to NetSuite and produced $1,030.50 of tax
  // on SO2716 from a customer flagged taxable.
  //
  // rate + amount sent as NUMBERS not strings — sandbox probe
  // 2026-07-28 confirmed NetSuite REST rejects strings with
  // INVALID_VALUE.
  // WHAT DUPLICATES, PRECISELY. Probe 7a sent a group's OWN MEMBERS alongside
  // the group: NetSuite expanded the group and also honoured the explicit
  // members, doubling the order at 204. P1 (2026-08-13, SO2713) sent a group
  // plus a flat line for an item in NO group and measured five lines — header,
  // both members expanded once each, EndGroup, and the flat line once.
  //
  // So the rule is membership, not co-occurrence. The guard used to refuse both
  // together because membership was the thing it could not see; now the caller
  // supplies the member set, so the guard can express what actually breaks.
  //
  // Refusing co-occurrence outright was not merely conservative — it forced the
  // caller to send `lines: []` whenever a group was present, which SILENTLY
  // DROPPED any Direct Product on a turnkey quote. A blunt guard produced a
  // worse failure than the one it prevented.
  const groupLines = input.groupLines ?? [];
  const memberItemIds = new Set(input.groupMemberItemIds ?? []);
  if (groupLines.length > 0) {
    const offenders = input.lines.filter((l) =>
      memberItemIds.has(l.netsuiteItemId),
    );
    if (offenders.length > 0) {
      throw new Error(
        "[sales-orders] refusing to emit a flat line for an item the Item Group already expands — " +
          "NetSuite honours both and doubles the quantity (Probe 7a). " +
          `Offending item id(s): ${offenders.map((o) => o.netsuiteItemId).join(", ")}.`,
      );
    }
    // A caller that emits groups without declaring their members cannot have
    // its flat lines checked at all. Fail rather than assume none collide.
    if (input.lines.length > 0 && memberItemIds.size === 0) {
      throw new Error(
        "[sales-orders] flat lines were supplied alongside Item Group lines without " +
          "`groupMemberItemIds`, so membership cannot be checked. Refusing rather than " +
          "assuming no flat line collides with an expanded member.",
      );
    }
  }

  // BARE group lines: item + quantity only. No rate (ignored on the group
  // header), no amount, no per-line custom columns — the members NetSuite
  // expands carry their own, and Step 3 patches their rates.
  // `taxCode` IS sent on the group header even though NetSuite already defaults
  // it to -8. Relying on that default would make compliance with a governed
  // rule depend on a NetSuite behaviour nobody here controls; stating it costs
  // one field.
  //
  // It cannot be sent on EndGroup — NetSuite creates that line itself and Nexus
  // never emits it. Observed as -8 on SO2716; the post-create pass corrects it
  // if it is ever anything else.
  const groupItems = groupLines.map((g) => ({
    item: { id: g.netsuiteItemId },
    quantity: g.quantity,
    taxCode: { id: NON_TAXABLE_TAX_CODE_ID },
  }));

  const flatItems = input.lines.map((line) => ({
      item: { id: line.netsuiteItemId },
      quantity: line.quantity,
      // POSTED_RATE_SCALE, not 4. The rate is derived from the frozen amount
      // at this scale precisely so NetSuite's own `quantity × rate` reproduces
      // it; rendering it shorter here would undo that on the wire.
      rate: parseFloat(line.rate.toFixed(POSTED_RATE_SCALE)),
      description: line.description,
      // Unconditional, not conditional on a setting. See tax-policy.ts.
      taxCode: { id: NON_TAXABLE_TAX_CODE_ID },
      // Nexus supplies the rate, so the line is CUSTOM-priced rather than
      // sourced from the item master's base price. Sent WITH `rate` above —
      // never without it. See price-policy.ts.
      price: { id: CUSTOM_PRICE_LEVEL_ID },
      custcol_dps_sku: line.sku,
      // GOVERNED PRODUCT COST → two destinations, one source.
      //
      // `custcol_dps_unit_cost` is RETAINED: it has carried this value since
      // Slice 12 and may feed reporting not visible from this side. The native
      // pair is ADDED alongside, not substituted for it.
      //
      // The defect this closes was never missing data — Nexus always sent the
      // governed cost. It sent it only to a custom column, while NetSuite's
      // standard Unit Cost display and margin basis read `costEstimateRate`.
      // With that field unset the line falls back to the item master's costing
      // method, which on the certified set was AVGCOST against an empty basis
      // (hence "blank"), and on other items resolves to LASTPURCHPRICE figures
      // unrelated to the quote.
      //
      // `costEstimate` is NOT sent — NetSuite derives it as quantity × rate.
      //
      // The null guard is load-bearing in both directions: absent governed cost
      // must leave NetSuite's own default intact rather than assert a zero. A
      // zero is a claim that the product is free; silence is not.
      ...(line.unitCost !== null
        ? {
            custcol_dps_unit_cost: parseFloat(line.unitCost.toFixed(4)),
            costEstimateType: { id: "CUSTOM" },
            costEstimateRate: parseFloat(line.unitCost.toFixed(4)),
          }
        : {}),
  }));

  // Groups first, then Direct lines — the order the operator built them in and
  // the order the read-back is asserted against. A mixed order carries both;
  // a single-structure order carries one and an empty other.
  body.item = { items: [...groupItems, ...flatItems] };

  return body;
}

/**
 * Deterministic idempotency key for the accepted sent snapshot of a Quote.
 * Payload movement cannot mint a second identity; retries replay the first
 * payload durably associated with this snapshot.
 */
export function computeIdempotencyKey(
  quoteId: string,
  quoteSnapshotId: string,
): string {
  const hash = createHash("sha256")
    .update(`${quoteId}|${quoteSnapshotId}`)
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
