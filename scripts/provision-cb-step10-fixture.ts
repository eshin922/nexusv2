// Slice 12 Step 10 close — CB browser walk fixture provisioning.
//
// Adapts 8c-4's fixture for a FULL-LIFECYCLE walk. Quote starts at
// status='sent' so CB walks:
//   Client Review → Mark Accepted → Sales Order → Complete
//
// Step 10 close verifies:
//   - reconciled 0046 migration applied cleanly (no-op on prod state
//     but the auto-tracker now records what was oral-knowledge only)
//   - assertNotFrozen helper + Pattern 52 doc guide land + doc grep-able
//   - netsuite_so_pushes.accepted_tier_id FK constraint present
//   - full sent → accepted → complete lifecycle works end-to-end
//   - freeze-tx writes acceptedTierId + netsuite_so_* mirror columns
//     correctly (P0 fix from Step 8c-4 stays fixed)
//
// Reconciliation with CA's Step 10 requirements verbatim:
//   * "quote in sent state at the start, not accepted" — status='sent',
//     accepted_at NULL, accepted_by_user_id NULL, accept_source NULL,
//     customer_accepted_tier_id NULL, customer_response_channel NULL.
//     markAccepted (invoked by CB clicking the Mark Accepted Advance)
//     will populate all six columns + push HubSpot stage from
//     'Development & Quoting' to 'Won - In production'.
//   * "throwaway HubSpot deal (zero line items, zero company
//     associations)" — HubSpot deal created bare, at
//     FROM_STAGE_ID='195274339' (Development & Quoting, the pre-accept
//     stage). No line items, no company associations. Nexus's local
//     hubspot_deals_cache row is fabricated to point at Epicuren's
//     real HubSpot company id so customer resolver succeeds; the
//     HubSpot deal itself carries zero associations.
//   * "netsuite_customer_map row so the send resolves" — seeded row
//     for Epicuren HS company id 17586902316 → NS customer 131860
//     already in DB (initial_seed_8c3_post_merge). No new map row.
//   * "leaves that resolve to NetSuite items" — same 3 leaves as 8c-4
//     (10064-GNX-Box, BA146400, DPS-BOTTLE-0001) which unique-match
//     NS InvtParts per Probe 8c.
//   * "tier above the floor" — ~50% blended margin via unit_cost=$0.10
//     + 100% markup, well above 25% floor.
//   * "≥1 review-feed entry" — one 'sent' system event ("Sent to
//     customer.") mirroring the row sendQuote inserts on a real send.
//     Additional entries (Mark Accepted, PM response) NOT pre-seeded
//     because CB creates them by exercising the transitions.
//
// The send creates a REAL sandbox Sales Order under the seeded NS
// customer 131860 (Epicuren). CB reports the SO tranId; cleanup script
// scans NetSuite directly by custbody_dps_deal_id='<throwaway_deal_id>'
// per CA's #152 directive.

import postgres from "postgres";
import crypto from "node:crypto";
import { computeQuoteCosting } from "../src/lib/costing.ts";
import { buildQuoteCostingInputFromNewModel } from "../src/lib/costing-adapter.ts";

// Slice 12 Step 10 walk banks (2026-07-29) — provisioner discipline:
// fixtures READ from source (firm_settings, hubspot_deals_cache),
// NEVER invent values. Fifth-instance-this-slice rule (following
// #148 hardcoded amount, #154 pre-set accepted_tier_id, #156 null
// sourcing_location, #Q1 fabricated snapshot terms, #Q12 collapsed
// client_name to smoke tag). CLAUDE.md pattern-promotion pending.

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE) { console.error("HUBSPOT_WRITE_ACCESS_TOKEN required"); process.exit(1); }

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const DPS_SALES_PIPELINE_ID = "108896657";
// PRE-accept stage — markAccepted pushes FROM this stage TO the accept
// stage. Fixture leaves the deal here so CB triggers the actual push
// during the walk.
const FROM_STAGE_ID = "195274339";   // Development & Quoting
const FROM_STAGE_LABEL = "Development & Quoting";
// ACCEPT_STAGE_ID (195607084 · 'Won - In production') is the STAGE
// markAccepted moves the deal to. Fixture DOES NOT pre-set this;
// CB's Mark Accepted click triggers the push.

const EPICUREN_HS_COMPANY_ID = "17586902316";
const TARGET_NS_CUSTOMER_ID = "131860";
const TARGET_NS_CUSTOMER_DISPLAY = "Epicuren";

const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-CB-STEP10-DELETE-ME-${NOW_ISO}`;

// Preview URL — patched post-#159-push once the Vercel deploy landed.
// Deploy 5660785982 (commit d356f7e) resolves to this hash-based URL.
// Env override for re-runs against future deploys of the same branch
// (each commit gets a fresh hash-based preview URL).
const PREVIEW_URL_BASE = process.env.PREVIEW_URL_BASE
  ?? "https://nexusv2-ch9uie74c-eshin922s-projects.vercel.app";

async function hubspotPost(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HS_WRITE}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot POST ${path} failed ${res.status}: ${await res.text()}`);
  return res.json();
}

let orphan: {
  dealId?: string;
  cacheDealId?: string;
  projectId?: string;
  quoteId?: string;
} = {};

async function main() {
  console.log("=== Step 10 close CB fixture provisioning ===");
  console.log(`Tag: ${SMOKE_TAG}`);
  console.log(`Target NS customer: ${TARGET_NS_CUSTOMER_ID} (${TARGET_NS_CUSTOMER_DISPLAY}) via seeded map row keyed on HubSpot company ${EPICUREN_HS_COMPANY_ID}`);
  console.log(`Deal starts at: ${FROM_STAGE_ID} (${FROM_STAGE_LABEL}) — markAccepted will push to Won - In production during CB walk\n`);

  // ---- 1. HubSpot deal (bare — zero HubSpot company associations, at PRE-accept stage) ----
  console.log("[1/6] Creating throwaway HubSpot deal (bare, at Development & Quoting stage)…");
  const deal = await hubspotPost("/crm/v3/objects/deals", {
    properties: {
      dealname: SMOKE_TAG,
      pipeline: DPS_SALES_PIPELINE_ID,
      dealstage: FROM_STAGE_ID,
    },
  });
  orphan.dealId = deal.id;
  console.log(`      → deal id ${deal.id} at '${FROM_STAGE_LABEL}'`);

  // ---- 2. Fabricate hubspot_deals_cache row pointing at Epicuren's HS company id ----
  console.log("\n[2/6] Fabricating hubspot_deals_cache row (local only, points at Epicuren HS company)…");
  await sql`
    INSERT INTO hubspot_deals_cache (
      deal_id, deal_name, deal_stage, amount, close_date,
      associated_company_id, associated_company_name,
      sales_rep_id, sales_rep_name, sales_rep_email,
      pm_id, pm_name, pm_email,
      created_at_hubspot, updated_at_hubspot, last_synced_at
    ) VALUES (
      ${deal.id}, ${SMOKE_TAG}, ${FROM_STAGE_ID},
      NULL, NULL,
      ${EPICUREN_HS_COMPANY_ID}, ${TARGET_NS_CUSTOMER_DISPLAY + " (SMOKE via cache fabrication)"},
      NULL, NULL, NULL,
      NULL, NULL, NULL,
      NOW(), NOW(), NOW()
    )
  `;
  orphan.cacheDealId = deal.id;
  console.log(`      → cache row inserted for deal ${deal.id} → HS company ${EPICUREN_HS_COMPANY_ID}`);
  console.log(`      → customer resolver will use the seeded map row for Epicuren`);

  // ---- 3. Locate the 3 resolvable leaves ----
  console.log("\n[3/6] Locating library leaves with resolvable NetSuite SKUs…");
  const resolvable = await sql`
    SELECT id, name, sku
    FROM leaves
    WHERE sku IN ('10064-GNX-Box', 'BA146400', 'DPS-BOTTLE-0001')
      AND archived = false
    ORDER BY sku
  `;
  if (resolvable.length !== 3) {
    throw new Error(
      `Expected 3 resolvable leaves; found ${resolvable.length}. Nexus DB may have diverged from Probe 8c snapshot.`,
    );
  }
  for (const l of resolvable) {
    console.log(`      → leaf ${l.id.slice(0, 8)}  sku=${l.sku}  name=${l.name}`);
  }

  // ---- 3.5. Read firm_settings — provisioner rule bank #5 ----
  // Real sendQuote reads firm defaults into snapshot columns at
  // send time. Fixture MUST match production behavior: pull
  // payment_terms / lead_time / incoterms / tcs / days_valid from
  // firm_settings, never invent literals. Q1 walk finding — CB saw
  // v1 snapshot columns ('50% deposit on PO · balance Net 30…')
  // NOT match live firm ('50% deposit, 50% on shipment') because
  // the prior fixture hardcoded strings unrelated to firm state.
  console.log("\n[3.5/6] Reading firm_settings for snapshot columns…");
  const [firm] = await sql`
    SELECT payment_terms_default, lead_time_default, incoterms_default,
           tcs_default, days_valid_default,
           vendor_name, vendor_tagline, vendor_address
    FROM firm_settings WHERE effective_until IS NULL
  `;
  if (!firm) throw new Error("firm_settings active row missing — cannot provision");
  console.log(`      → firm payment_terms: ${(firm.payment_terms_default ?? "").slice(0, 60)}…`);
  console.log(`      → firm lead_time: ${firm.lead_time_default ?? "(null)"}`);

  // ---- 4. Insert project + quote (sent state) + tree ----
  const seeded = await sql.begin(async (tx) => {
    console.log("\n[4/6] Inserting throwaway project + quote (SENT, v1) + tree…");
    // Q12 walk finding — project.client_name must be distinct from
    // deal_name to reflect real production (project-import reads
    // client_name from hubspot_deals_cache.associated_company_name;
    // deal_name is the HubSpot deal title). Prior fixture collapsed
    // both to SMOKE_TAG, making CB see 'same string for Customer +
    // Deal' in the send-quote-flow confirmation. Set client_name to
    // the seeded Epicuren display so the walk exercises the two
    // distinct fields correctly.
    const clientNameForFixture = TARGET_NS_CUSTOMER_DISPLAY;
    const [proj] = await tx`
      INSERT INTO projects (
        hubspot_deal_id, deal_name, client_name,
        sales_rep_user_id, pm_user_id, project_category, status,
        deal_stage, imported_by_user_id, imported_at
      ) VALUES (
        ${deal.id}, ${SMOKE_TAG}, ${clientNameForFixture},
        ${EDWARD_USER_ID}, ${EDWARD_USER_ID}, 'other', 'active',
        ${FROM_STAGE_LABEL}, ${EDWARD_USER_ID}, NOW()
      ) RETURNING id
    `;
    orphan.projectId = proj.id;

    const [seq] = await tx`SELECT nextval('quote_number_seq') AS n`;
    const quoteNumber = `DPS-${seq.n}`;

    const sentAt = new Date(Date.now() - 60 * 60 * 1000);

    // Sent state — snapshot columns populated (sendQuote wrote them);
    // accept-family columns all NULL until markAccepted fires.
    //
    // Column-naming note: quotes.pdf_layout / detail_level /
    // include_spec_addendum are the ACTUAL DB columns. The Drizzle
    // TypeScript fields carry a `_snapshot` suffix
    // (pdfLayoutSnapshot etc.) because sendQuote's tx populates them
    // at send time and they're then read-only — but the underlying
    // DB column names don't carry the suffix. Direct SQL uses the
    // real column names.
    // Q1 walk finding — snapshot columns pulled from firm_settings,
    // not hardcoded literals. Matches what real sendQuote writes.
    const [q] = await tx`
      INSERT INTO quotes (
        project_id, scenario_label, version_number, status,
        sent_at, quote_number, pdf_url,
        pdf_layout, detail_level, include_spec_addendum,
        payment_terms_snapshot, incoterms_snapshot, tcs_snapshot,
        lead_time_snapshot, days_valid_snapshot,
        prepared_by_name_snapshot, prepared_by_email_snapshot,
        prepared_by_phone_snapshot,
        valid_until,
        global_price_adj_pct, target_margin_pct,
        created_by_user_id
      ) VALUES (
        ${proj.id}, 'SMOKE-CB-STEP10', 1, 'sent',
        ${sentAt}, ${quoteNumber}, NULL,
        'tier_table', 'itemized', false,
        ${firm.payment_terms_default},
        ${firm.incoterms_default},
        ${firm.tcs_default},
        ${firm.lead_time_default},
        ${firm.days_valid_default ?? 30},
        'Edward Shin', 'edward@thedps.co', NULL,
        ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)},
        0, NULL,
        ${EDWARD_USER_ID}
      ) RETURNING id
    `;
    orphan.quoteId = q.id;
    console.log(`      → project=${proj.id.slice(0,8)} quote=${q.id.slice(0,8)} (${quoteNumber}) status='sent'`);

    // Two tiers. Small qty. CB picks tier 2 during Mark Accepted walk.
    console.log("\n      Inserting 2 tiers (100 / 500 units)…");
    const [t1] = await tx`
      INSERT INTO quote_tiers (quote_id, label, qty, sort_order)
      VALUES (${q.id}, 'Tier 1', 100, 0)
      RETURNING id, label, qty
    `;
    const [t2] = await tx`
      INSERT INTO quote_tiers (quote_id, label, qty, sort_order)
      VALUES (${q.id}, 'Tier 2', 500, 1)
      RETURNING id, label, qty
    `;
    const targetTier = { id: t2.id, label: t2.label, qty: Number(t2.qty) };

    console.log("      Inserting 1 assembly + 3 assembly_leaves (resolvable SKUs)…");
    const [asm] = await tx`
      INSERT INTO assemblies (
        quote_id, sku, name, unit_cost, unit_price, markup_pct, owner_id, position
      ) VALUES (
        ${q.id}, ${SMOKE_TAG + "-ASY"}, ${"CB Step 10 fixture assembly"},
        NULL, NULL, NULL, ${EDWARD_USER_ID}, 0
      ) RETURNING id
    `;
    const newAsmLeaves: Array<{ id: string; leafId: string; sku: string; name: string }> = [];
    for (const [i, leaf] of resolvable.entries()) {
      const [row] = await tx`
        INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
        VALUES (${asm.id}, ${leaf.id}, 1, ${i})
        RETURNING id
      `;
      newAsmLeaves.push({ id: row.id, leafId: leaf.id, sku: leaf.sku, name: leaf.name });
    }

    // Per-(leaf, tier) cost inputs. Low unit_cost + 100% markup gives
    // ~50% blended margin — well above the firm's 25% floor.
    console.log("      Inserting assembly_leaf_inputs (unit_cost=$0.10, markup=100% → ~50% margin)…");
    for (const asmLeaf of newAsmLeaves) {
      for (const tier of [t1, t2]) {
        const lineGroupId = crypto.randomUUID();
        await tx`
          INSERT INTO assembly_leaf_inputs (
            assembly_leaf_id, tier_id, line_group_id, sort_order,
            supplier, qty_per_sellable_unit, category, markup_pct, markup_pct_source,
            inventory_eligible, notes, unit_cost, purchase_qty
          ) VALUES (
            ${asmLeaf.id}, ${tier.id}, ${lineGroupId}, 0,
            'SMOKE-supplier', 1, 'primary_packaging', 1.00, 'manual_override',
            false, NULL, 0.10, ${tier.qty}
          )
        `;
      }
    }

    // Snapshot table row (mirror of what sendQuote inserts).
    const [snap] = await tx`
      INSERT INTO quote_snapshots (
        quote_id, version_number, effective_from, superseded_at,
        sent_at, quote_number, valid_until,
        pdf_layout, detail_level, include_spec_addendum,
        payment_terms, incoterms, tcs, lead_time, days_valid,
        prepared_by_name, prepared_by_email, prepared_by_phone,
        pdf_url, created_by_user_id
      ) VALUES (
        ${q.id}, 1, ${sentAt}, NULL,
        ${sentAt}, ${quoteNumber},
        ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)},
        'tier_table', 'itemized', false,
        ${firm.payment_terms_default},
        ${firm.incoterms_default},
        ${firm.tcs_default},
        ${firm.lead_time_default},
        ${firm.days_valid_default ?? 30},
        'Edward Shin', 'edward@thedps.co', NULL,
        NULL, ${EDWARD_USER_ID}
      ) RETURNING id
    `;

    // Single review-feed entry (per CA: "≥1 review-feed entry"). This
    // is the 'sent' system event that sendQuote inserts. CB clicking
    // Mark Accepted will insert its own 'responded' event.
    const [sysSent] = await tx`
      INSERT INTO quote_review_events (quote_id, version_number, event_type, note, author_user_id, system)
      VALUES (${q.id}, 1, 'sent', 'Sent to customer.', NULL, true)
      RETURNING id
    `;

    // Slice 12 Step 10 Q4b — quote_sent audit row with
    // diff_json.pdf.storagePath so Q4b's re-sign path exercises
    // the happy path against the fixture (not just the
    // PDF_UNRECOVERABLE fallback). Fabricated storagePath — the
    // fixture doesn't actually upload a PDF to Storage, so Q4b's
    // Supabase.createSignedUrl call at runtime returns whatever
    // the SDK returns for a nonexistent object (still a URL string
    // per Supabase behavior; opening it 404s at the browser layer).
    // Good enough for structural verification: the action layer
    // executes end-to-end + shows "loading → new tab opens →
    // customer PDF preview loads" ordering matches production
    // even when the file itself isn't there.
    const fakeSendUuid = crypto.randomUUID();
    const fakeStoragePath = `${q.id}/${fakeSendUuid}.pdf`;
    await tx`
      INSERT INTO audit_log (user_id, entity_type, entity_id, action, diff_json)
      VALUES (
        ${EDWARD_USER_ID}, 'quote', ${q.id}, 'quote_sent',
        ${sql.json({
          quoteNumber,
          versionNumber: 1,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          snapshots: {
            tcs: firm.tcs_default,
            paymentTerms: firm.payment_terms_default,
            leadTime: firm.lead_time_default,
            incoterms: firm.incoterms_default,
            daysValid: firm.days_valid_default ?? 30,
            pdfLayout: 'tier_table',
            detailLevel: 'itemized',
            includeSpecAddendum: false,
          },
          pdf: {
            bucket: 'quote-pdfs',
            storagePath: fakeStoragePath,
            sendUuid: fakeSendUuid,
          },
          audit_source: 'smoke_fixture',
        })}
      )
    `;

    return {
      projectId: proj.id,
      quoteId: q.id,
      quoteNumber,
      targetTier,
      snapshotId: snap.id,
      sysSentId: sysSent.id,
      assemblyId: asm.id,
      resolvableLeaves: newAsmLeaves,
    };
  });

  // ---- 5. Real math to verify tier clears floor ----
  console.log("\n[5/6] Computing turnkey via computeQuoteCosting to verify tier margin above floor…");
  const [quote] = await sql`SELECT * FROM quotes WHERE id = ${seeded.quoteId}`;
  // firm already read in [3.5/6] for snapshot columns — reuse to
  // avoid a second identical query. computeQuoteCosting reads the
  // margin thresholds (target_margin_pct, floor_margin_pct) which
  // aren't in our narrow SELECT, so re-fetch just those.
  const [firmMargins] = await sql`SELECT target_margin_pct, floor_margin_pct FROM firm_settings WHERE effective_until IS NULL`;
  const tiersRows = await sql`SELECT * FROM quote_tiers WHERE quote_id = ${seeded.quoteId} ORDER BY sort_order`;
  const asmsRows = await sql`SELECT * FROM assemblies WHERE quote_id = ${seeded.quoteId}`;
  const aleavesRows = await sql`SELECT * FROM assembly_leaves WHERE assembly_id IN ${sql(asmsRows.map((a: any) => a.id))}`;
  const linputsRows = await sql`SELECT * FROM assembly_leaf_inputs WHERE assembly_leaf_id IN ${sql(aleavesRows.map((l: any) => l.id))}`;
  const mdefs = await sql`SELECT category, default_markup_pct FROM markup_defaults`;
  const markupDefaults: Record<string, number> = {};
  for (const m of mdefs) markupDefaults[m.category] = parseFloat(m.default_markup_pct);

  const input = buildQuoteCostingInputFromNewModel({
    quote: {
      id: quote.id,
      globalPriceAdjPct: parseFloat(quote.global_price_adj_pct),
      targetMarginPct: quote.target_margin_pct !== null ? parseFloat(quote.target_margin_pct) : null,
    },
    firmSettings: {
      targetMarginPct: parseFloat(firmMargins.target_margin_pct),
      floorMarginPct: parseFloat(firmMargins.floor_margin_pct),
    },
    markupDefaults,
    tiers: tiersRows.map((t: any) => ({
      id: t.id, label: t.label,
      qty: t.qty !== null ? Number(t.qty) : null,
      tierPriceAdjPct: t.tier_price_adj_pct !== null ? parseFloat(t.tier_price_adj_pct) : null,
    })),
    assemblies: asmsRows.map((a: any) => ({
      id: a.id, sku: a.sku, name: a.name,
      unitCost: a.unit_cost !== null ? parseFloat(a.unit_cost) : null,
      unitPrice: a.unit_price !== null ? parseFloat(a.unit_price) : null,
      markupPct: a.markup_pct !== null ? parseFloat(a.markup_pct) : null,
      position: a.position,
    })),
    assemblyLeaves: aleavesRows.map((l: any) => ({
      id: l.id, assemblyId: l.assembly_id, leafId: l.leaf_id,
      quantity: parseFloat(l.quantity), position: l.position,
    })),
    assemblyLeafInputs: linputsRows.map((i: any) => ({
      id: i.id, assemblyLeafId: i.assembly_leaf_id, tierId: i.tier_id,
      lineGroupId: i.line_group_id, sortOrder: i.sort_order,
      supplier: i.supplier,
      qtyPerSellableUnit: i.qty_per_sellable_unit !== null ? parseFloat(i.qty_per_sellable_unit) : null,
      category: i.category,
      markupPct: i.markup_pct !== null ? parseFloat(i.markup_pct) : null,
      markupPctSource: i.markup_pct_source,
      inventoryEligible: i.inventory_eligible,
      notes: i.notes,
      unitCost: i.unit_cost !== null ? parseFloat(i.unit_cost) : null,
      purchaseQty: i.purchase_qty !== null ? parseFloat(i.purchase_qty) : null,
    })),
    assemblyProductionInputs: [],
    assemblyLeafOverrides: [],
    assemblyLeafTargets: [],
    lifts: [],
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
  } as any);

  const result = computeQuoteCosting(input);
  const targetRollup = result.quoteRollup.find((r) => r.tierId === seeded.targetTier.id);
  if (!targetRollup) throw new Error("target tier missing from rollup");
  const tierTurnkeyAmount = targetRollup.totalRevenue;
  const blendedMarginPct = targetRollup.blendedMarginPct;
  const blendedMarginStatus = targetRollup.blendedMarginStatus;
  console.log(`      → target tier: totalRevenue=$${tierTurnkeyAmount.toFixed(2)}  margin=${(blendedMarginPct * 100).toFixed(1)}%  status=${blendedMarginStatus}`);
  if (blendedMarginStatus === "BELOW_FLOOR") {
    throw new Error("BLENDED MARGIN BELOW FLOOR — fixture would trigger the below-floor block. Adjust unit_cost or markup_pct.");
  }

  // ---- 6. Handoff ----
  console.log("\n[6/6] Handoff payload…");
  // Deep-link opens on Preview Quote (sub-tab 1) — the start of the
  // umbrella. Step 10 walk is the FULL lifecycle: Preview → Send →
  // Review → Acceptance → Sales Order, plus Revise-from-sent BEFORE
  // acceptance work. Opening on the frontier (?tab=accepted) would
  // skip Walks A + B. Preview + Send render read-only on a sent
  // quote (subTabStatus → 'done'; reversibility model, subtabs.ts:102).
  const url = `${PREVIEW_URL_BASE}/projects/${seeded.projectId}/quotes/${seeded.quoteId}/quote?tab=preview`;
  const handoff = {
    hubspotDealId: deal.id,
    hubspotDealFromStageId: FROM_STAGE_ID,
    hubspotDealFromStageLabel: FROM_STAGE_LABEL,
    netsuiteCustomerId: TARGET_NS_CUSTOMER_ID,
    netsuiteCustomerDisplay: TARGET_NS_CUSTOMER_DISPLAY,
    projectId: seeded.projectId,
    quoteId: seeded.quoteId,
    quoteNumber: seeded.quoteNumber,
    targetTierId: seeded.targetTier.id,
    targetTierLabel: seeded.targetTier.label,
    targetTierQty: seeded.targetTier.qty,
    tierTurnkeyAmount,
    blendedMarginPct,
    blendedMarginStatus,
    resolvableLeaves: seeded.resolvableLeaves.map((l) => ({ sku: l.sku, name: l.name })),
    smokeTag: SMOKE_TAG,
    previewTabUrl: url,
  };
  console.log("\n\n================ FIXTURE PROVISIONED ================");
  console.log(JSON.stringify(handoff, null, 2));

  console.log("\n\n============= CB HANDOFF =============\n");
  console.log(`Preview Quote tab deep link (quote at status='sent'; walk starts here):`);
  console.log(`  ${url}`);
  console.log(`\nFull-lifecycle walk sequence:`);
  console.log(`  Walk A: Preview → Send → Client Review (read-only sub-tabs on sent quote)`);
  console.log(`  Walk B: Revise from sent — bumps v1→v2, supersedes snapshot, back to draft`);
  console.log(`          (test with quote_snapshots.superseded_at populated after)`);
  console.log(`          Then send again (v2) to get back to sent for Walks C-E.`);
  console.log(`  Walk C: Acceptance — Mark Accepted push (HubSpot stage → Won - In production)`);
  console.log(`  Walk D: Sales Order — send SO to NetSuite (creates real sandbox SO)`);
  console.log(`  Walk E: Complete — freeze-tx writes accepted_tier_id + netsuite_so_* mirrors`);
  console.log(`\nQuote number:  ${seeded.quoteNumber}`);
  console.log(`HubSpot deal:  ${deal.id}  (dealname "${SMOKE_TAG}", stage ${FROM_STAGE_LABEL})`);
  console.log(`  → markAccepted (Walk C Advance click) pushes to 'Won - In production'`);
  console.log(`Target tier for CB to pick during accept: ${seeded.targetTier.label} (${seeded.targetTier.qty.toLocaleString()} units)  ·  $${tierTurnkeyAmount.toFixed(2)} turnkey`);
  console.log(`Blended margin: ${(blendedMarginPct * 100).toFixed(1)}% (${blendedMarginStatus})  ·  clears floor`);
  console.log(`\nResolvable leaves (all 3 uniquely match NetSuite items):`);
  for (const l of seeded.resolvableLeaves) console.log(`  • ${l.sku}  ${l.name}`);
  console.log(`\nNetSuite customer resolves to: ${TARGET_NS_CUSTOMER_ID} (${TARGET_NS_CUSTOMER_DISPLAY})`);
  console.log(`  via seeded netsuite_customer_map row keyed on HubSpot company ${EPICUREN_HS_COMPANY_ID}`);
  console.log(`  (throwaway deal's hubspot_deals_cache row points at that company id — fabrication is local-only)`);
  console.log("\n⚠  Mark Accepted push is LIVE (HubSpot deal stage change). Sales Order Send is LIVE (creates real sandbox SO).");
  console.log(`\nAfter CB reports the SO tranId, run:`);
  console.log(`  node scripts/cleanup-cb-step10-fixture.mjs '${JSON.stringify(handoff)}'`);
}

main()
  .catch(async (e) => {
    console.error("\nPROVISIONING ERROR:", e);
    console.error("\nOrphaned resources — clean up manually:");
    if (orphan.dealId) console.error(`  HubSpot deal ${orphan.dealId} (archive: curl -X DELETE -H "Authorization: Bearer $HUBSPOT_WRITE_ACCESS_TOKEN" https://api.hubapi.com/crm/v3/objects/deals/${orphan.dealId})`);
    if (orphan.cacheDealId) console.error(`  DELETE FROM hubspot_deals_cache WHERE deal_id='${orphan.cacheDealId}';`);
    if (orphan.quoteId) console.error(`  Nexus quote ${orphan.quoteId}  (DELETE FROM quotes WHERE id='${orphan.quoteId}';)`);
    if (orphan.projectId) console.error(`  Nexus project ${orphan.projectId}  (DELETE FROM projects WHERE id='${orphan.projectId}';)`);
    process.exitCode = 1;
  })
  .finally(async () => { await sql.end(); });
