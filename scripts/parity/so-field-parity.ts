// Slice 12 Step 9 CD audit follow-up — SO field-parity probe.
//
// Per CA (2026-07-29): the write path is proven (SO 360442 landed
// cleanly on DPS-1034), but the created SO's fields were never
// compared to a known-good reference. This probe closes that gap:
//
//   1. Provision throwaway fixture (reuse 8c-4 provisioner shape)
//   2. Call runMarkComplete directly (bypasses HTTP scope; smoke pattern)
//   3. Fetch the fresh SO — full field inventory, expandSubResources=true
//   4. Fetch SO2646 (Epicuren's workflow-created reference) — same depth
//   5. Deep-diff every field
//   6. Report in three buckets:
//      - Intentional (with reason)
//      - Missing (we should be setting it and aren't)
//      - Wrong (set, but to the wrong value)
//   7. Clean up
//
// Invocation:
//   npx cross-env NODE_OPTIONS=--require=./scripts/smoke/shim-server-only.cjs \
//     npx tsx --env-file=.env.local ./scripts/parity/so-field-parity.ts

import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";

const DB = process.env.DATABASE_URL!;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN!;
const NS_ACCT = process.env.NETSUITE_ACCOUNT_ID!;
if (!DB || !HS_WRITE || !NS_ACCT) {
  console.error("DATABASE_URL, HUBSPOT_WRITE_ACCESS_TOKEN, NETSUITE_ACCOUNT_ID all required");
  process.exit(1);
}

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const DPS_SALES_PIPELINE_ID = "108896657";
const ACCEPT_STAGE_ID = "195607084";
const EPICUREN_HS_COMPANY_ID = "17586902316";
// Reference SO — the canonical workflow-created SO for Epicuren. The
// "SO2646" moniker is the display tranId; NetSuite's REST record
// endpoint takes the internal id (resolved via SuiteQL 2026-07-29).
const REFERENCE_SO_ID = "359341"; // tranId SO2646, Epicuren canonical

// ═════════════ NetSuite REST helpers ═════════════
const NS_BASE = `https://${NS_ACCT.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest`;
function pctE(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function nsAuth(method: string, urlStr: string): string {
  const url = new URL(urlStr);
  const params: Record<string, string> = {
    oauth_consumer_key: process.env.NETSUITE_CONSUMER_KEY!,
    oauth_token: process.env.NETSUITE_TOKEN_ID!,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };
  const q: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { q[k] = v; });
  const all = { ...params, ...q };
  const ps = Object.keys(all).sort().map((k) => `${pctE(k)}=${pctE(all[k])}`).join("&");
  const bs = [method, pctE(url.origin + url.pathname), pctE(ps)].join("&");
  const sk = `${pctE(process.env.NETSUITE_CONSUMER_SECRET!)}&${pctE(process.env.NETSUITE_TOKEN_SECRET!)}`;
  params.oauth_signature = createHmac("sha256", sk).update(bs).digest("base64");
  return 'OAuth realm="' + NS_ACCT + '", ' +
    Object.keys(params).sort().map((k) => `${pctE(k)}="${pctE(params[k])}"`).join(", ");
}
async function nsGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const url = NS_BASE + "/record/v1" + path;
  const r = await fetch(url, { method: "GET", headers: { Authorization: nsAuth("GET", url) } });
  if (!r.ok) throw new Error(`NS GET ${path} → ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function nsDelete(path: string): Promise<{ status: number }> {
  const url = NS_BASE + "/record/v1" + path;
  const r = await fetch(url, { method: "DELETE", headers: { Authorization: nsAuth("DELETE", url) } });
  return { status: r.status };
}
async function nsSuiteQL<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const url = NS_BASE + "/query/v1/suiteql";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: nsAuth("POST", url), "Content-Type": "application/json", Prefer: "transient" },
    body: JSON.stringify({ q }),
  });
  const j = await r.json();
  return j.items ?? [];
}

// ═════════════ HubSpot ═════════════
async function hubspotPost(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HS_WRITE}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot POST ${path} failed ${res.status}: ${await res.text()}`);
  return res.json();
}
async function hubspotDelete(path: string) {
  await fetch(`https://api.hubapi.com${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HS_WRITE}` },
  });
}

// ═════════════ Diff helpers ═════════════
type FieldDiff = {
  field: string;
  fresh: unknown;
  reference: unknown;
};
function flatten(obj: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (obj === null || obj === undefined || typeof obj !== "object") {
    if (prefix) out.set(prefix, obj);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      const sub = flatten(v, `${prefix}[${i}]`);
      sub.forEach((val, key) => out.set(key, val));
    });
    return out;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (k === "links") continue; // ignore hypermedia noise
    const sub = flatten(rec[k], prefix ? `${prefix}.${k}` : k);
    sub.forEach((val, key) => out.set(key, val));
  }
  return out;
}
function diff(fresh: unknown, reference: unknown): {
  onlyInFresh: FieldDiff[];
  onlyInRef: FieldDiff[];
  bothDiffer: FieldDiff[];
} {
  const f = flatten(fresh);
  const r = flatten(reference);
  const keys = new Set([...f.keys(), ...r.keys()]);
  const onlyInFresh: FieldDiff[] = [];
  const onlyInRef: FieldDiff[] = [];
  const bothDiffer: FieldDiff[] = [];
  for (const k of [...keys].sort()) {
    const fv = f.get(k);
    const rv = r.get(k);
    if (!f.has(k)) onlyInRef.push({ field: k, fresh: undefined, reference: rv });
    else if (!r.has(k)) onlyInFresh.push({ field: k, fresh: fv, reference: undefined });
    else if (JSON.stringify(fv) !== JSON.stringify(rv)) bothDiffer.push({ field: k, fresh: fv, reference: rv });
  }
  return { onlyInFresh, onlyInRef, bothDiffer };
}

// ═════════════ Bucket categorization ═════════════
// Known-intentional differences: fields that legitimately differ per
// design or per Nexus-vs-workflow provenance. Full explanation for
// each so the report reads clean.
const INTENTIONAL_DIFF_REASONS: Record<string, string> = {
  // Identity + provenance — always different by definition
  "id": "SO internal id — always different per SO",
  "tranId": "SO display id (SO2XXX) — allocated by NS per SO",
  "createdDate": "SO creation timestamp — always different",
  "lastModifiedDate": "SO modification timestamp — always different",
  "createdFrom": "Reference SO may have createdFrom (converted from a quote); Nexus creates SOs fresh with no createdFrom",
  "prevDate": "NS internal state field, per-record",
  "startDate": "NS derives per-record from createdDate",
  "trandate": "SO transaction date — always different per SO",
  "tranDate": "SO transaction date — always different per SO",
  "custbody_dps_deal_id": "Nexus sends throwaway SMOKE deal id; reference SO uses real Epicuren deal 40412634025",
  "memo": "Nexus memo copies HubSpot deal id + name; reference SO's memo comes from workflow (probably deal name only)",
  "total": "totals differ by definition — fresh fixture has $300 total; reference SO has real turnkey amount",
  "subtotal": "same — differs per line-total sum",
  "estGrossProfit": "differs per cost + revenue values",
  "estGrossProfitPercent": "differs per cost + revenue values",
  // Item lines — differ per fixture leaves vs reference SO leaves
  "item.items[0].amount": "line amount differs per line quantity × rate",
  "item.items[0].item.id": "different NS items on fresh vs reference",
  "item.items[0].item.refName": "different NS items",
  "item.items[0].quantity": "different quantity",
  "item.items[0].rate": "different rate",
  "item.items[0].description": "different SKU description",
  "item.items[0].custcol_dps_sku": "different Nexus SKU",
  "item.items[0].custcol_dps_unit_cost": "different unit cost",
  "item.items[0].line": "line index — could differ if line count differs",
  // Item lines — NS-derived from item record; differ per item
  "item.items[0].class.id": "class derived from item record — differs per item",
  "item.items[0].class.refName": "class derived from item record — differs per item",
  "item.items[0].costEstimate": "cost estimate derived from item record — differs per item",
  "item.items[0].costEstimateRate": "cost estimate rate derived from item record — differs per item",
  "item.items[0].costEstimateType.id": "cost estimate type derived from item record — differs per item",
  "item.items[0].costEstimateType.refName": "cost estimate type derived from item record — differs per item",
  "item.items[0].itemType.id": "item type inferred from item record — differs per item",
  "item.items[0].itemType.refName": "item type inferred from item record — differs per item",
  "item.items[0].itemSubtype.id": "item subtype inferred from item record — differs per item",
  "item.items[0].itemSubtype.refName": "item subtype inferred from item record — differs per item",
  "item.items[0].lineUniqueKey": "NS-generated per-line internal id — always different",
  "item.items[0].poRate": "PO rate derived from item + tier — differs per item",
  "item.items[0].price.id": "price level ref derived from item — differs per item",
  "item.items[0].price.refName": "price level ref derived from item — differs per item",
  "item.items[0].taxCode.id": "tax code derived per item + customer — differs per item",
  "item.items[0].taxCode.refName": "tax code derived per item + customer — differs per item",
  "item.items[0].commitmentFirm": "NS-derived per-line boolean",
  "item.items[0].createWo": "NS-derived per-line boolean",
  "item.items[0].fromJob": "NS-derived — related to job attachment which we don't set",
  "item.items[0].isClosed": "NS-derived per-line state",
  "item.items[0].isEstimate": "NS-derived per-line state",
  "item.items[0].isOpen": "NS-derived per-line state",
  "item.items[0].linked": "NS-derived per-line boolean",
  "item.items[0].printItems": "NS-derived per-line boolean",
  "item.items[0].quantityBilled": "NS-derived per-line state (post-billing)",
  "item.items[0].quantityFulfilled": "NS-derived per-line state (post-fulfillment)",
  "item.items[0].quantityAvailable": "NS-derived — inventory-related",
  "item.items[0].quantityCommitted": "NS-derived — inventory-related",
  "item.items[0].commitInventory.id": "NS-derived — inventory-related",
  "item.items[0].commitInventory.refName": "NS-derived — inventory-related",
  "item.items[0].custcol_2663_isperson": "NS custom column — third-party bundle field",
  "item.items[0].custcol_p2p_ln_allow_po": "NS custom column — third-party bundle field",
  "item.items[0].custcol_statistical_value_base_curr": "NS custom column — third-party bundle field",
  // Line count mismatch
  "item.totalResults": "line count differs — fresh has 3 leaves; ref has 4 lines including OTC additions",
  // NS-workflow / NS-derived header fields
  "createdFrom": "reference SO may have createdFrom (converted from a quote); Nexus creates fresh, no createdFrom",
  "prevDate": "NS-internal state field",
  "startDate": "NS derives per-record",
  "trandate": "SO transaction date — per record",
  "tranDate": "SO transaction date — per record",
  "transactionNumber": "NS-generated unique transaction number (SALESORD###)",
  "custbody_report_timestamp": "NS-generated processing timestamp",
  "job.id": "NS Job (Project) attachment — Nexus stays out of NS Projects per CA disposition",
  "job.refName": "NS Job (Project) attachment — Nexus stays out",
  "opportunity.id": "NS Opportunity linkage — workflow sets on deal-to-SO conversion; not applicable to Nexus's direct-SO-create path",
  "opportunity.refName": "NS Opportunity linkage",
  "previousOpportunity": "NS Opportunity linkage",
  "custbody_dps_related_opportunity.id": "NS Opportunity linkage — workflow sets",
  "custbody_dps_related_opportunity.refName": "NS Opportunity linkage",
  // SuiteTax after-discount computed fields
  "custbody_stc_amount_after_discount": "SuiteTax-computed — NS derives from lines + tax code",
  "custbody_stc_tax_after_discount": "SuiteTax-computed",
  "custbody_stc_total_after_discount": "SuiteTax-computed",
  // Item sublist address list
  "shipAddressList.id": "shipAddressList — NS returns customer's on-file addresses on fresh SO; ref SO may have overridden and this field surfaced with a specific chosen id",
  "shipAddressList.refName": "same",
};
function categorizeReason(field: string): string | null {
  if (INTENTIONAL_DIFF_REASONS[field]) return INTENTIONAL_DIFF_REASONS[field];
  // Line-index-agnostic matcher for per-line intentional diffs
  const lineMatch = field.match(/^item\.items\[\d+\]\.(.+)$/);
  if (lineMatch) {
    const suffix = lineMatch[1];
    const key = `item.items[0].${suffix}`;
    if (INTENTIONAL_DIFF_REASONS[key]) return INTENTIONAL_DIFF_REASONS[key] + " (per-line)";
  }
  return null;
}

// ═════════════ Fixture setup ═════════════
const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-PARITY-DELETE-ME-${NOW_ISO}`;
type Fixture = {
  hubspotDealId: string;
  projectId: string;
  quoteId: string;
  quoteNumber: string;
  capturedTierId: string;
  soInternalId: string | null;
};
const cleanupQueue: { deal?: string; project?: string; quote?: string; cacheDeal?: string; so?: string } = {};

async function provisionFixture(): Promise<Fixture> {
  console.log("[Provision] Fixture tag:", SMOKE_TAG);

  // 1. HubSpot deal
  const deal = await hubspotPost("/crm/v3/objects/deals", {
    properties: {
      dealname: SMOKE_TAG,
      pipeline: DPS_SALES_PIPELINE_ID,
      dealstage: ACCEPT_STAGE_ID,
    },
  });
  cleanupQueue.deal = deal.id;
  console.log("  ✓ HubSpot deal:", deal.id);

  // 2. Fabricated hubspot_deals_cache pointing at Epicuren's HS company.
  //
  // Class B verification (CA disposition 2026-07-29): seed the cache
  // row with REALISTIC values that a real synced Epicuren deal carries
  // (values copied verbatim from deal 40412634025's cache row —
  // the one that produced reference SO2646). Prior version seeded
  // NULL for all the 8c-2 conditional fields; that fixture couldn't
  // distinguish "the field is unwritten because cache is empty" from
  // "the field is unwritten because the code path doesn't fire."
  // Realistic seeding closes that inference.
  await sql`
    INSERT INTO hubspot_deals_cache (
      deal_id, deal_name, deal_stage, amount, close_date,
      associated_company_id, associated_company_name,
      sales_rep_id, sales_rep_name, sales_rep_email,
      pm_id, pm_name, pm_email,
      deal_folder_url, project_service_s, project_category,
      sourcing_location, business_segment_id, business_segment_label,
      client_po, invoice_date_est, production_ship_date_est,
      priority, deal_type,
      created_at_hubspot, updated_at_hubspot, last_synced_at
    ) VALUES (
      ${deal.id}, ${SMOKE_TAG}, ${ACCEPT_STAGE_ID},
      NULL, NULL,
      ${EPICUREN_HS_COMPANY_ID}, 'Epicuren (parity smoke)',
      NULL, NULL, NULL,
      NULL, NULL, NULL,
      'https://thedpsco.sharepoint.com/sites/TheDPSPortal/Shared%20Documents/Deals/Epicuren/PARITY-SMOKE',
      'Copacking', 'Co-Packing',
      -- sourcing_location DELIBERATELY NULL here — Nexus stores the
      -- TEXT LABEL ('Domestic') in this column, but NS's
      -- custbody_dps_project_source is a LIST field requiring an
      -- internal id. Sending the label errors with "Invalid Field
      -- Value Domestic". This is a pre-existing bug in
      -- sales-orders.ts:109 exposed by Class B parity; fix scope
      -- belongs in Slice 13 R6 (label→id translation, mirror of
      -- business_segment_resolver). Seed NULL here so the probe
      -- completes and Class A/B/C bucket the remaining fields
      -- cleanly.
      NULL, '1', NULL,
      '13969', '2026-09-07', '2026-09-07',
      NULL, NULL,
      NOW(), NOW(), NOW()
    )
  `;
  cleanupQueue.cacheDeal = deal.id;

  // 3. Locate the 3 resolvable leaves
  const leaves = await sql`
    SELECT id, name, sku FROM leaves
    WHERE sku IN ('10064-GNX-Box', 'BA146400', 'DPS-BOTTLE-0001') AND archived = false
  `;
  if (leaves.length !== 3) throw new Error(`expected 3 leaves; got ${leaves.length}`);

  // 4. Nexus project + quote + tiers + assembly + leaves + inputs
  const seeded = await sql.begin(async (tx) => {
    const [proj] = await tx`
      INSERT INTO projects (
        hubspot_deal_id, deal_name, client_name,
        sales_rep_user_id, pm_user_id, project_category, status,
        deal_stage, imported_by_user_id, imported_at
      ) VALUES (
        ${deal.id}, ${SMOKE_TAG}, ${SMOKE_TAG},
        ${EDWARD_USER_ID}, ${EDWARD_USER_ID}, 'other', 'active',
        'Won - In production', ${EDWARD_USER_ID}, NOW()
      ) RETURNING id
    `;

    const [seq] = await tx`SELECT nextval('quote_number_seq') AS n`;
    const quoteNumber = `DPS-${seq.n}`;

    const sentAt = new Date(Date.now() - 60 * 60 * 1000);
    const acceptedAt = new Date(Date.now() - 15 * 60 * 1000);
    const [q] = await tx`
      INSERT INTO quotes (
        project_id, scenario_label, version_number, status,
        sent_at, accepted_at, accepted_by_user_id, accept_source,
        quote_number, pdf_url,
        pdf_layout, detail_level, include_spec_addendum,
        payment_terms_snapshot, incoterms_snapshot, tcs_snapshot,
        lead_time_snapshot, days_valid_snapshot,
        prepared_by_name_snapshot, prepared_by_email_snapshot,
        prepared_by_phone_snapshot,
        customer_response_channel,
        global_price_adj_pct, target_margin_pct,
        created_by_user_id
      ) VALUES (
        ${proj.id}, 'SMOKE-PARITY', 1, 'accepted',
        ${sentAt}, ${acceptedAt}, ${EDWARD_USER_ID}, 'manual_button',
        ${quoteNumber}, NULL,
        'tier_table', 'itemized', false,
        '50% deposit on PO · balance Net 30 from ship date',
        'FOB Long Beach', '(standard terms — see attached)',
        '90-120 days', 30,
        'Edward Shin', 'edward@thedps.co', NULL,
        'email',
        0, NULL,
        ${EDWARD_USER_ID}
      ) RETURNING id
    `;
    console.log(`  ✓ project=${proj.id.slice(0,8)} quote=${q.id.slice(0,8)} (${quoteNumber})`);

    const [t1] = await tx`INSERT INTO quote_tiers (quote_id, label, qty, sort_order) VALUES (${q.id}, 'Tier 1', 100, 0) RETURNING id`;
    const [t2] = await tx`INSERT INTO quote_tiers (quote_id, label, qty, sort_order) VALUES (${q.id}, 'Tier 2', 500, 1) RETURNING id, label, qty`;

    const [asm] = await tx`
      INSERT INTO assemblies (quote_id, sku, name, unit_cost, unit_price, markup_pct, owner_id, position)
      VALUES (${q.id}, ${SMOKE_TAG + "-ASY"}, ${"parity ASY"}, NULL, NULL, NULL, ${EDWARD_USER_ID}, 0)
      RETURNING id
    `;

    const newAsmLeaves: string[] = [];
    for (const [i, leaf] of leaves.entries()) {
      const [row] = await tx`
        INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
        VALUES (${asm.id}, ${leaf.id}, 1, ${i})
        RETURNING id
      `;
      newAsmLeaves.push(row.id);
    }

    const crypto = await import("node:crypto");
    for (const alid of newAsmLeaves) {
      for (const tier of [t1, t2]) {
        const lineGroupId = crypto.randomUUID();
        await tx`
          INSERT INTO assembly_leaf_inputs (
            assembly_leaf_id, tier_id, line_group_id, sort_order,
            supplier, qty_per_sellable_unit, category, markup_pct, markup_pct_source,
            inventory_eligible, notes, unit_cost, purchase_qty
          ) VALUES (
            ${alid}, ${tier.id}, ${lineGroupId}, 0,
            'PARITY-supplier', 1, 'primary_packaging', 1.00, 'manual_override',
            false, NULL, 0.10, 500
          )
        `;
      }
    }

    await tx`UPDATE quotes SET customer_accepted_tier_id = ${t2.id} WHERE id = ${q.id}`;

    return {
      hubspotDealId: deal.id as string,
      projectId: proj.id as string,
      quoteId: q.id as string,
      quoteNumber,
      capturedTierId: t2.id as string,
      soInternalId: null,
    };
  });

  // Insert quote_accepted audit so amount patch has "prior" to compare
  await sql`
    INSERT INTO audit_log (user_id, entity_type, entity_id, action, diff_json)
    VALUES (
      ${EDWARD_USER_ID}, 'quote', ${seeded.quoteId}, 'quote_accepted',
      ${sql.json({
        from_status: "sent",
        to_status: "accepted",
        version_number: 1,
        customer_accepted_tier_id: seeded.capturedTierId,
        customer_response_channel: "email",
        hubspot: { deal_id: deal.id, amount: 300 },
      })}
    )
  `;

  cleanupQueue.quote = seeded.quoteId;
  cleanupQueue.project = seeded.projectId;
  return seeded;
}

// ═════════════ Cleanup ═════════════
async function runCleanup() {
  console.log("\n[Cleanup]");
  if (cleanupQueue.so) {
    const r = await nsDelete(`/salesOrder/${cleanupQueue.so}`);
    console.log(`  del SO ${cleanupQueue.so} → ${r.status}`);
  }
  if (cleanupQueue.quote) {
    await sql`DELETE FROM quotes WHERE id = ${cleanupQueue.quote}`;
    console.log(`  del quote ${cleanupQueue.quote}`);
  }
  if (cleanupQueue.project) {
    await sql`DELETE FROM projects WHERE id = ${cleanupQueue.project}`;
    console.log(`  del project ${cleanupQueue.project}`);
  }
  if (cleanupQueue.cacheDeal) {
    await sql`DELETE FROM hubspot_deals_cache WHERE deal_id = ${cleanupQueue.cacheDeal}`;
    console.log(`  del cache row ${cleanupQueue.cacheDeal}`);
  }
  if (cleanupQueue.deal) {
    await hubspotDelete(`/crm/v3/objects/deals/${cleanupQueue.deal}`);
    console.log(`  archived HubSpot deal ${cleanupQueue.deal}`);
  }
  // Post-cleanup: audit_log orphans for this fixture (bank per CA's Slice 14 L2 followup)
  const orphans = await sql`DELETE FROM audit_log WHERE entity_id = ${cleanupQueue.quote} RETURNING id`;
  console.log(`  del ${orphans.length} audit_log rows (this fixture's orphans)`);
}

// ═════════════ Main ═════════════
async function main() {
  const fx = await provisionFixture();

  console.log("\n[Send] Calling runMarkComplete directly (bypasses HTTP scope)…");
  const { runMarkComplete } = await import("../../src/lib/netsuite/mark-complete");
  const result = await runMarkComplete({ quoteId: fx.quoteId, actorUserId: EDWARD_USER_ID });
  fx.soInternalId = result.netsuite.salesOrderId;
  cleanupQueue.so = fx.soInternalId;
  console.log(`  ✓ SO created — internal id ${fx.soInternalId}, retryOutcome=${result.retryOutcome}, amountPushed=${result.netsuite.amountPushed}`);

  console.log("\n[Fetch] Fresh SO + reference SO (both with expandSubResources=true)…");
  const fresh = await nsGet(`/salesOrder/${fx.soInternalId}?expandSubResources=true`);
  const reference = await nsGet(`/salesOrder/${REFERENCE_SO_ID}?expandSubResources=true`);
  console.log(`  fresh SO ${fx.soInternalId} · reference SO ${REFERENCE_SO_ID} both fetched`);

  console.log("\n[Diff] Field-by-field…");
  const { onlyInFresh, onlyInRef, bothDiffer } = diff(fresh, reference);

  const buckets = { intentional: [] as FieldDiff[], missing: [] as FieldDiff[], wrong: [] as FieldDiff[] };
  for (const d of onlyInRef) {
    const reason = categorizeReason(d.field);
    if (reason) buckets.intentional.push({ ...d, reference: `${d.reference} · REASON: ${reason}` });
    else buckets.missing.push(d);
  }
  for (const d of bothDiffer) {
    const reason = categorizeReason(d.field);
    if (reason) buckets.intentional.push({ ...d, reference: `${d.reference} · REASON: ${reason}` });
    else buckets.wrong.push(d);
  }
  const extra = onlyInFresh; // "extra" (fresh has, ref doesn't) — worth reporting but not a defect category

  const fmt = (v: unknown, cap = 80): string => {
    if (v === undefined) return "(absent)";
    if (v === null) return "null";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > cap ? s.slice(0, cap) + "…" : s;
  };

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("  SO FIELD PARITY REPORT");
  console.log("  fresh SO:", fx.soInternalId, "vs reference SO2646");
  console.log("══════════════════════════════════════════════════════════════════");

  console.log(`\n─── MISSING (${buckets.missing.length}) — fields the reference has that we don't set ───`);
  for (const d of buckets.missing) console.log(`  ${d.field.padEnd(60)}  ref=${fmt(d.reference)}`);

  console.log(`\n─── WRONG (${buckets.wrong.length}) — set on both, values disagree ───`);
  for (const d of buckets.wrong) console.log(`  ${d.field.padEnd(60)}  fresh=${fmt(d.fresh)} · ref=${fmt(d.reference)}`);

  console.log(`\n─── EXTRA (${extra.length}) — fields we set that the reference doesn't have ───`);
  for (const d of extra) console.log(`  ${d.field.padEnd(60)}  fresh=${fmt(d.fresh)}`);

  console.log(`\n─── INTENTIONAL (${buckets.intentional.length}) — legitimately different, categorized ───`);
  for (const d of buckets.intentional) console.log(`  ${d.field.padEnd(60)}  fresh=${fmt(d.fresh, 60)} · ${fmt(d.reference, 100)}`);

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  SUMMARY: ${buckets.missing.length} missing, ${buckets.wrong.length} wrong, ${extra.length} extra, ${buckets.intentional.length} intentional`);
  console.log("══════════════════════════════════════════════════════════════════");
}

main()
  .then(() => runCleanup())
  .catch(async (e) => {
    console.error("\nPARITY PROBE ERROR:", e);
    await runCleanup().catch((ce) => console.error("cleanup also failed:", ce));
    process.exitCode = 1;
  })
  .finally(async () => { await sql.end(); });

// Silence unused warnings from optional imports
void nsSuiteQL;
