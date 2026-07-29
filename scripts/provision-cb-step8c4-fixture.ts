// Slice 12 Step 8c-4 — CB browser walk fixture provisioning.
//
// Adapts 8b's fixture for a LIVE-send walk. Extends with:
//   - Throwaway HubSpot COMPANY + deal↔company association
//   - Cache sync so hubspot_deals_cache.associated_company_id populates
//   - netsuite_customer_map row so the customer resolver returns 'found'
//   - Assembly leaves whose SKUs resolve UNIQUELY in NetSuite (from
//     Probe 8c: 10064-GNX-Box, BA146400, DPS-BOTTLE-0001 — 3 InvtParts
//     resolvable via SKU-match)
//   - Known-good margin (blended > firm floor) so the normal path
//     walks without hitting the below-floor block
//
// Reconciliation with CA's requirements:
//   CA said "throwaway HubSpot deal (zero line items, zero company
//   associations), a netsuite_customer_map row so the send resolves."
//   Preserved AS WRITTEN — the HubSpot deal itself HAS zero company
//   associations in HubSpot proper. Nexus's local hubspot_deals_cache
//   row is fabricated to point at Epicuren's real HubSpot company id
//   (17586902316), which already maps to NS 131860 via the seeded
//   customer_map row. Send resolves; no HubSpot company writes needed
//   (which the current write token isn't scoped for anyway).
//
//   Ledger implication: nothing in HubSpot ever ties the throwaway
//   deal to any company. Only Nexus's local cache carries the
//   association, and only until cleanup drops that cache row.
//   Trade-off: any Nexus surface that reads project → cache would
//   describe the throwaway deal as being "for Epicuren"; the Quote
//   umbrella tab reads `project.client_name` (set to the fixture
//   tag) instead, so the visual identity stays SMOKE throughout.
//
// The send will create a REAL sandbox Sales Order under a REAL NetSuite
// customer (131860 Epicuren, mapped via seed). CB reports the SO tranId;
// the cleanup script scans NetSuite directly by
// custbody_dps_deal_id='<throwaway_deal_id>' (per CA's #152 directive)
// and deletes the SO. Cache row + Nexus rows + HubSpot deal all cleaned.

import postgres from "postgres";
import crypto from "node:crypto";
import { computeQuoteCosting } from "../src/lib/costing";
import { buildQuoteCostingInputFromNewModel } from "../src/lib/costing-adapter";

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE) { console.error("HUBSPOT_WRITE_ACCESS_TOKEN required"); process.exit(1); }

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const DPS_SALES_PIPELINE_ID = "108896657";
const ACCEPT_STAGE_ID = "195607084"; // Won - In production
const FROM_STAGE_ID = "195274339";   // Development & Quoting (pre-accept)

// Real Epicuren HubSpot company id + its NS customer mapping — already
// seeded via initial_seed_8c3_post_merge. The fabricated
// hubspot_deals_cache row for our throwaway deal points at this
// company id so the customer resolver returns 'found' with NS 131860.
// Nothing in HubSpot proper knows about the association; the cache is
// local and gets dropped in cleanup.
const EPICUREN_HS_COMPANY_ID = "17586902316";
const TARGET_NS_CUSTOMER_ID = "131860";
const TARGET_NS_CUSTOMER_DISPLAY = "Epicuren";

const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-CB-8C4-DELETE-ME-${NOW_ISO}`;

const PREVIEW_URL_BASE =
  "https://nexusv2-git-feat-slice-12-step-8c-4-s-5746e1-eshin922s-projects.vercel.app";

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
  console.log("=== Step 8c-4 CB fixture provisioning ===");
  console.log(`Tag: ${SMOKE_TAG}`);
  console.log(`Target NS customer: ${TARGET_NS_CUSTOMER_ID} (${TARGET_NS_CUSTOMER_DISPLAY}) via seeded map row keyed on HubSpot company ${EPICUREN_HS_COMPANY_ID}\n`);

  // ---- 1. HubSpot deal (bare — zero HubSpot company associations) ----
  console.log("[1/7] Creating throwaway HubSpot deal (bare, zero company assocs in HubSpot)…");
  const deal = await hubspotPost("/crm/v3/objects/deals", {
    properties: {
      dealname: SMOKE_TAG,
      pipeline: DPS_SALES_PIPELINE_ID,
      dealstage: ACCEPT_STAGE_ID,
    },
  });
  orphan.dealId = deal.id;
  console.log(`      → deal id ${deal.id} at 'Won - In production'`);

  // ---- 2. Fabricate hubspot_deals_cache row pointing at Epicuren's HS company id ----
  console.log("\n[2/7] Fabricating hubspot_deals_cache row (local only, points at Epicuren HS company)…");
  await sql`
    INSERT INTO hubspot_deals_cache (
      deal_id, deal_name, deal_stage, amount, close_date,
      associated_company_id, associated_company_name,
      sales_rep_id, sales_rep_name, sales_rep_email,
      pm_id, pm_name, pm_email,
      created_at_hubspot, updated_at_hubspot, last_synced_at
    ) VALUES (
      ${deal.id}, ${SMOKE_TAG}, ${ACCEPT_STAGE_ID},
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

  // ---- 5. Locate the 3 resolvable leaves ----
  console.log("\n[3/7] Locating library leaves with resolvable NetSuite SKUs…");
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

  // ---- 4. Insert project + quote + tiers + assembly + assembly_leaves + inputs ----
  const seeded = await sql.begin(async (tx) => {
    console.log("\n[4/7] Inserting throwaway project + quote (accepted, v1) + tree…");
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
    orphan.projectId = proj.id;

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
        ${proj.id}, 'SMOKE-CB-8C4', 1, 'accepted',
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
    orphan.quoteId = q.id;
    console.log(`      → project=${proj.id.slice(0,8)} quote=${q.id.slice(0,8)} (${quoteNumber})`);

    // Two tiers. Small qty. Customer accepts the larger tier.
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
    const capturedTier = { id: t2.id, label: t2.label, qty: Number(t2.qty) };

    console.log("      Inserting 1 assembly + 3 assembly_leaves (resolvable SKUs)…");
    const [asm] = await tx`
      INSERT INTO assemblies (
        quote_id, sku, name, unit_cost, unit_price, markup_pct, owner_id, position
      ) VALUES (
        ${q.id}, ${SMOKE_TAG + "-ASY"}, ${"CB 8c-4 fixture assembly"},
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
    // ~50% blended margin — well above the firm's 25% floor. Same numbers
    // for both tiers to keep math simple.
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

    // CB round 1 P0 catch — fixture must mirror the real pre-send
    // state: customer_accepted_tier_id populated (markAccepted set it),
    // accepted_tier_id STAYS NULL until markComplete's freeze-tx
    // writes it. The prior fixture pre-set both which masked the
    // production defect that #148/round-1 walks never caught.
    await tx`
      UPDATE quotes SET
        customer_accepted_tier_id = ${capturedTier.id}
      WHERE id = ${q.id}
    `;
    console.log(`      → captured tier: ${capturedTier.label} (${capturedTier.qty.toLocaleString()} units)`);
    console.log(`      → accepted_tier_id INTENTIONALLY LEFT NULL — freeze-tx writes it on send (P0 fix)`);

    // Snapshot for Preview + review events for Client Review
    const [snap] = await tx`
      INSERT INTO quote_snapshots (
        quote_id, version_number, effective_from, superseded_at,
        sent_at, quote_number,
        pdf_layout, detail_level, include_spec_addendum,
        payment_terms, incoterms, tcs, lead_time, days_valid,
        prepared_by_name, prepared_by_email, prepared_by_phone,
        pdf_url, created_by_user_id
      ) VALUES (
        ${q.id}, 1, ${sentAt}, NULL,
        ${sentAt}, ${quoteNumber},
        'tier_table', 'itemized', false,
        '50% deposit on PO · balance Net 30 from ship date',
        'FOB Long Beach', '(standard terms — see attached)',
        '90-120 days', 30,
        'Edward Shin', 'edward@thedps.co', NULL,
        NULL, ${EDWARD_USER_ID}
      ) RETURNING id
    `;

    const [sysSent] = await tx`
      INSERT INTO quote_review_events (quote_id, version_number, event_type, note, author_user_id, system)
      VALUES (${q.id}, 1, 'sent', 'Sent to customer.', NULL, true)
      RETURNING id
    `;
    const [sysMark] = await tx`
      INSERT INTO quote_review_events (quote_id, version_number, event_type, note, author_user_id, system)
      VALUES (${q.id}, 1, 'responded', 'Marked accepted at v1 (PM proxy).', NULL, true)
      RETURNING id
    `;
    const pmNote = `[SMOKE FIXTURE] Beth (email): "Send us the Sales Order for Tier 2 — 500 units please."`;
    const [pmResp] = await tx`
      INSERT INTO quote_review_events (quote_id, version_number, event_type, note, author_user_id, system)
      VALUES (${q.id}, 1, 'responded', ${pmNote}, ${EDWARD_USER_ID}, false)
      RETURNING id
    `;

    return {
      projectId: proj.id,
      quoteId: q.id,
      quoteNumber,
      capturedTier,
      snapshotId: snap.id,
      reviewEventIds: { sysSent: sysSent.id, sysMark: sysMark.id, pmResp: pmResp.id },
      pmNote,
      assemblyId: asm.id,
      resolvableLeaves: newAsmLeaves,
    };
  });

  // ---- 5. Real math + audit log ----
  console.log("\n[5/7] Computing real turnkey via computeQuoteCosting…");
  const [quote] = await sql`SELECT * FROM quotes WHERE id = ${seeded.quoteId}`;
  const [firm] = await sql`SELECT * FROM firm_settings WHERE effective_until IS NULL ORDER BY effective_from DESC LIMIT 1`;
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
      targetMarginPct: parseFloat(firm.target_margin_pct),
      floorMarginPct: parseFloat(firm.floor_margin_pct),
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
    freightLegGroups: [],
    freightLegs: [],
    freightLegTiers: [],
  } as any);

  const result = computeQuoteCosting(input);
  const capturedRollup = result.quoteRollup.find((r) => r.tierId === seeded.capturedTier.id);
  if (!capturedRollup) throw new Error("captured tier missing from rollup");
  const tierTurnkeyAmount = capturedRollup.totalRevenue;
  const blendedMarginPct = capturedRollup.blendedMarginPct;
  const blendedMarginStatus = capturedRollup.blendedMarginStatus;
  console.log(`      → captured tier: totalRevenue=$${tierTurnkeyAmount.toFixed(2)}  margin=${(blendedMarginPct * 100).toFixed(1)}%  status=${blendedMarginStatus}`);
  if (blendedMarginStatus === "BELOW_FLOOR") {
    throw new Error("BLENDED MARGIN BELOW FLOOR — fixture would trigger the below-floor block. Adjust unit_cost or markup_pct.");
  }

  // Insert audit trail
  console.log("\n[6/7] Inserting audit_log entries…");
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO audit_log (user_id, entity_type, entity_id, action, diff_json)
      VALUES (
        ${EDWARD_USER_ID}, 'quote', ${seeded.quoteId}, 'quote_accepted',
        ${sql.json({
          from_status: 'sent',
          to_status: 'accepted',
          version_number: 1,
          accepted_by_user_id: EDWARD_USER_ID,
          accept_source: 'manual_button',
          customer_accepted_tier_id: seeded.capturedTier.id,
          // accepted_tier_id INTENTIONALLY absent — mirrors real
          // markAccepted's audit shape (captures customer choice; the
          // commitment column stays NULL until markComplete lands).
          customer_response_channel: 'email',
          hubspot: {
            deal_id: deal.id,
            from_stage_id: FROM_STAGE_ID,
            from_stage_label: 'Development & Quoting',
            to_stage_id: ACCEPT_STAGE_ID,
            to_stage_label: 'Won - In production',
            amount: tierTurnkeyAmount,
          },
        })}
      )
    `;
    for (const [evId, source, note, system] of [
      [seeded.reviewEventIds.sysSent, undefined, 'Sent to customer.', true],
      [seeded.reviewEventIds.sysMark, 'mark_accepted_auto_log', 'Marked accepted at v1 (PM proxy).', true],
      [seeded.reviewEventIds.pmResp, 'acceptance_capture', seeded.pmNote, false],
    ] as const) {
      await tx`
        INSERT INTO audit_log (user_id, entity_type, entity_id, action, diff_json)
        VALUES (
          ${EDWARD_USER_ID}, 'quote_review_event', ${evId as string}, 'quote_review_event_added',
          ${sql.json({
            quoteId: seeded.quoteId,
            versionNumber: 1,
            eventType: 'responded',
            system,
            note,
            ...(source ? { source } : {}),
          })}
        )
      `;
    }
  });

  // ---- Handoff ----
  console.log("\n[7/7] Handoff payload…");
  const url = `${PREVIEW_URL_BASE}/projects/${seeded.projectId}/quotes/${seeded.quoteId}/quote?tab=tier`;
  const handoff = {
    hubspotDealId: deal.id,
    netsuiteCustomerId: TARGET_NS_CUSTOMER_ID,
    netsuiteCustomerDisplay: TARGET_NS_CUSTOMER_DISPLAY,
    projectId: seeded.projectId,
    quoteId: seeded.quoteId,
    quoteNumber: seeded.quoteNumber,
    capturedTierId: seeded.capturedTier.id,
    capturedTierLabel: seeded.capturedTier.label,
    capturedTierQty: seeded.capturedTier.qty,
    tierTurnkeyAmount,
    blendedMarginPct,
    blendedMarginStatus,
    resolvableLeaves: seeded.resolvableLeaves.map((l) => ({ sku: l.sku, name: l.name })),
    smokeTag: SMOKE_TAG,
    salesOrderTabUrl: url,
  };
  console.log("\n\n================ FIXTURE PROVISIONED ================");
  console.log(JSON.stringify(handoff, null, 2));

  console.log("\n\n============= CB HANDOFF =============\n");
  console.log(`Sales Order tab deep link (opens on sub-tab 5):`);
  console.log(`  ${url}`);
  console.log(`\nQuote number:  ${seeded.quoteNumber}`);
  console.log(`HubSpot deal:  ${deal.id}  (dealname "${SMOKE_TAG}", stage Won - In production)`);
  console.log(`Captured tier: ${seeded.capturedTier.label} (${seeded.capturedTier.qty.toLocaleString()} units)  ·  $${tierTurnkeyAmount.toFixed(2)} turnkey`);
  console.log(`Blended margin: ${(blendedMarginPct * 100).toFixed(1)}% (${blendedMarginStatus})  ·  clears floor`);
  console.log(`\nResolvable leaves (all 3 uniquely match NetSuite items):`);
  for (const l of seeded.resolvableLeaves) console.log(`  • ${l.sku}  ${l.name}`);
  console.log(`\nNetSuite customer resolves to: ${TARGET_NS_CUSTOMER_ID} (${TARGET_NS_CUSTOMER_DISPLAY})`);
  console.log(`  via seeded netsuite_customer_map row keyed on HubSpot company ${EPICUREN_HS_COMPANY_ID}`);
  console.log(`  (throwaway deal's hubspot_deals_cache row points at that company id — fabrication is local-only)`);
  console.log("\n⚠  Send is LIVE. Per Edward's directive: per-send confirmation required, throwaway quote + deal only.");
  console.log(`\nAfter CB reports the SO tranId, run:`);
  console.log(`  node scripts/cleanup-cb-step8c4-fixture.mjs '${JSON.stringify(handoff)}'`);
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
