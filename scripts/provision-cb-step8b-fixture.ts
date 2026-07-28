// Slice 12 Step 8b — CB browser walk fixture provisioning (v2).
//
// v2 correction (2026-07-28) per CA P0 disposition:
//   - Amount is now DERIVED via computeQuoteCosting (real math layer),
//     not hardcoded. The audit_log.diff_json.hubspot.amount matches
//     what production markAccepted would push — receipt subtotal +
//     ledger HubSpot amount agree by construction.
//   - PM-authored note text corrected to match the seeded tier qty
//     (Tier 2 = 5,000 units, not "10k units" fixture bait).
//
// Provisions a throwaway HubSpot deal + Nexus quote in ACCEPTED
// state so CB can walk sub-tab 5 (Sales Order receipt). All three
// visual states reachable via dev-switcher URL params; production
// state never reaches 'complete' (no writer + prebuild verifier).
//
// Fixture guarantees per CA discipline:
//   - HubSpot deal: bare — zero line items, zero company
//     associations. Cannot enroll in the auto-SO workflow.
//   - Nexus quote: status='accepted', v1, with 8a's tier + channel +
//     note written via a mirrored 8a-tx (HubSpot side skipped).
//   - Real cost data: clones DPS-1007's structure so the receipt
//     renders with live turnkey math.
//   - Review feed: 3 entries (system 'sent', system
//     'mark_accepted_auto_log', PM-authored 'responded' with note).

import postgres from "postgres";
import { computeQuoteCosting } from "../src/lib/costing";
import { buildQuoteCostingInputFromNewModel } from "../src/lib/costing-adapter";

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE) { console.error("HUBSPOT_WRITE_ACCESS_TOKEN required"); process.exit(1); }

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const TEMPLATE_QUOTE_ID = "54c38f67-3aa3-44e1-8be2-b85f85882ac1"; // DPS-1007
const DPS_SALES_PIPELINE_ID = "108896657";
const ACCEPT_STAGE_ID = "195607084"; // Won - In production
const FROM_STAGE_ID = "195274339";   // Development & Quoting (pre-accept)

const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-CB-8B-DELETE-ME-${NOW_ISO}`;

async function hubspotPost(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HS_WRITE}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot POST ${path} failed ${res.status}: ${await res.text()}`);
  return res.json();
}

let orphanDealId: string | null = null;

async function main() {
  console.log("=== Step 8b CB fixture provisioning (v2 — real math) ===");
  console.log(`Tag: ${SMOKE_TAG}`);

  // ---- 1. HubSpot deal (bare, no assocs, no line items) ----
  console.log("\n[1/7] Creating throwaway HubSpot deal…");
  const deal = await hubspotPost("/crm/v3/objects/deals", {
    properties: {
      dealname: SMOKE_TAG,
      pipeline: DPS_SALES_PIPELINE_ID,
      dealstage: ACCEPT_STAGE_ID, // Won stage — matches post-accept state
    },
  });
  const dealId = deal.id;
  orphanDealId = dealId;
  console.log(`      → deal id ${dealId} at 'Won - In production'`);

  // ---- 2-6. Seed the Nexus fixture (project + quote + tiers + assembly + leaf + inputs + snapshot) ----
  const seeded = await sql.begin(async (tx) => {
    console.log("\n[2/7] Loading DPS-1007 cost template…");
    const [tplQuote] = await tx`SELECT * FROM quotes WHERE id = ${TEMPLATE_QUOTE_ID}`;
    const tplTiers = await tx`SELECT * FROM quote_tiers WHERE quote_id = ${TEMPLATE_QUOTE_ID} ORDER BY sort_order`;
    const tplAsms = await tx`SELECT * FROM assemblies WHERE quote_id = ${TEMPLATE_QUOTE_ID} ORDER BY position`;
    const tplLeaves = tplAsms.length > 0
      ? await tx`SELECT * FROM assembly_leaves WHERE assembly_id IN ${sql(tplAsms.map((a: any) => a.id))} ORDER BY position`
      : [];
    const tplInputs = tplLeaves.length > 0
      ? await tx`SELECT * FROM assembly_leaf_inputs WHERE assembly_leaf_id IN ${sql(tplLeaves.map((l: any) => l.id))}`
      : [];
    console.log(`      → template: ${tplTiers.length} tiers · ${tplAsms.length} assemblies · ${tplLeaves.length} leaves · ${tplInputs.length} inputs`);

    console.log("\n[3/7] Inserting throwaway project + quote (accepted, v1)…");
    const [proj] = await tx`
      INSERT INTO projects (
        hubspot_deal_id, deal_name, client_name,
        sales_rep_user_id, pm_user_id, project_category, status,
        deal_stage, imported_by_user_id, imported_at
      ) VALUES (
        ${dealId}, ${SMOKE_TAG}, ${SMOKE_TAG},
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
        global_price_adj_pct,
        created_by_user_id
      ) VALUES (
        ${proj.id}, 'SMOKE-CB-8B', 1, 'accepted',
        ${sentAt}, ${acceptedAt}, ${EDWARD_USER_ID}, 'manual_button',
        ${quoteNumber}, NULL,
        'tier_table', 'itemized', false,
        '50% deposit on PO · balance Net 30 from ship date',
        'FOB Long Beach', '(standard terms — see attached)',
        '90-120 days', 30,
        'Edward Shin', 'edward@thedps.co', NULL,
        'email',
        ${tplQuote.global_price_adj_pct},
        ${EDWARD_USER_ID}
      ) RETURNING id
    `;
    console.log(`      → project=${proj.id.slice(0,8)} quote=${q.id.slice(0,8)} (${quoteNumber})`);

    console.log("\n[4/7] Cloning tiers + assemblies + leaves + inputs…");
    const tierIdMap = new Map<string, string>();
    const newTiers: Array<{ id: string; label: string; qty: number }> = [];
    for (const t of tplTiers) {
      const [row] = await tx`
        INSERT INTO quote_tiers (quote_id, label, qty, sort_order, tier_price_adj_pct)
        VALUES (${q.id}, ${t.label}, ${t.qty}, ${t.sort_order}, ${t.tier_price_adj_pct})
        RETURNING id, label, qty
      `;
      tierIdMap.set(t.id, row.id);
      newTiers.push({ id: row.id, label: row.label, qty: Number(row.qty) });
    }
    const capturedTier = newTiers.find(t => t.label === "Tier 2") ?? newTiers[newTiers.length - 1];

    const asmIdMap = new Map<string, string>();
    for (const a of tplAsms) {
      const [row] = await tx`
        INSERT INTO assemblies (
          quote_id, sku, name, unit_cost, unit_price, markup_pct, owner_id, position
        ) VALUES (
          ${q.id},
          ${"CB-8B-" + a.sku},
          ${"CB fixture · " + a.name},
          ${a.unit_cost}, ${a.unit_price}, ${a.markup_pct},
          ${EDWARD_USER_ID}, ${a.position}
        ) RETURNING id
      `;
      asmIdMap.set(a.id, row.id);
    }

    const leafIdMap = new Map<string, string>();
    for (const l of tplLeaves) {
      const [row] = await tx`
        INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity, position)
        VALUES (${asmIdMap.get(l.assembly_id)}, ${l.leaf_id}, ${l.quantity}, ${l.position})
        RETURNING id
      `;
      leafIdMap.set(l.id, row.id);
    }

    for (const i of tplInputs) {
      await tx`
        INSERT INTO assembly_leaf_inputs (
          assembly_leaf_id, tier_id, line_group_id, sort_order,
          supplier, qty_per_sellable_unit, category, markup_pct, markup_pct_source,
          inventory_eligible, notes, unit_cost, purchase_qty
        ) VALUES (
          ${leafIdMap.get(i.assembly_leaf_id)}, ${tierIdMap.get(i.tier_id)},
          ${i.line_group_id}, ${i.sort_order},
          ${i.supplier}, ${i.qty_per_sellable_unit}, ${i.category},
          ${i.markup_pct}, ${i.markup_pct_source},
          ${i.inventory_eligible}, ${i.notes}, ${i.unit_cost}, ${i.purchase_qty}
        )
      `;
    }

    await tx`
      UPDATE quotes SET customer_accepted_tier_id = ${capturedTier.id} WHERE id = ${q.id}
    `;
    console.log(`      → captured tier: ${capturedTier.label} (${capturedTier.qty.toLocaleString()} units)`);

    console.log("\n[5/7] Inserting snapshot + review events (audit deferred to real-math compute)…");
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
    // v2 correction — note text matches the seeded qty (5,000 units,
    // not the previous "10k units" bait CB flagged).
    const pmNote = `Beth (email, this morning): "We're set to go on Tier 2 — 5,000 units, please. Send the PO paperwork when you can."`;
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
    };
  });

  // ---- 6. Real-math compute via computeQuoteCosting ----
  console.log("\n[6/7] Computing REAL tier turnkey via computeQuoteCosting (no more hardcoded approximation)…");
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
  const capturedRollup = result.quoteRollup.find(r => r.tierId === seeded.capturedTier.id);
  if (!capturedRollup) throw new Error("Failed to find captured tier in rollup");
  const tierTurnkeyAmount = capturedRollup.totalRevenue;
  console.log(`      → captured tier real totalRevenue: $${tierTurnkeyAmount.toFixed(4)}`);
  console.log(`         (reconciliation invariant: this value flows to BOTH the audit_log`);
  console.log(`          and the receipt's ledger — they cannot diverge)`);

  // ---- 7. Insert audit_log entries with REAL amount + audit_log for review events ----
  console.log("\n[7/7] Inserting audit_log entries (real amount + review events)…");
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
          customer_response_channel: 'email',
          hubspot: {
            deal_id: orphanDealId,
            from_stage_id: FROM_STAGE_ID,
            from_stage_label: 'Development & Quoting',
            to_stage_id: ACCEPT_STAGE_ID,
            to_stage_label: 'Won - In production',
            amount: tierTurnkeyAmount,   // ← REAL math, not hardcoded
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

  console.log("\n=============================================");
  console.log("=== FIXTURE PROVISIONED (v2 — real math) ===");
  console.log("=============================================");
  console.log(JSON.stringify({
    hubspotDealId: orphanDealId,
    projectId: seeded.projectId,
    quoteId: seeded.quoteId,
    quoteNumber: seeded.quoteNumber,
    capturedTierId: seeded.capturedTier.id,
    capturedTierLabel: seeded.capturedTier.label,
    capturedTierQty: seeded.capturedTier.qty,
    tierTurnkeyAmount,   // ← Real, not $6731 hardcode
    smokeTag: SMOKE_TAG,
  }, null, 2));

  const previewBase =
    "https://nexusv2-git-feat-slice-12-step-8b-sal-680695-eshin922s-projects.vercel.app";
  const base = `${previewBase}/projects/${seeded.projectId}/quotes/${seeded.quoteId}/quote`;
  console.log("\n=== CB HANDOFF ===");
  console.log(`Fixture tag: ${SMOKE_TAG}`);
  console.log(`Quote number: ${seeded.quoteNumber} · captured tier: ${seeded.capturedTier.label} (${seeded.capturedTier.qty.toLocaleString()} units)`);
  console.log(`HubSpot deal id: ${orphanDealId} (at 'Won - In production', bare — no companies, no line items)`);
  console.log(`HubSpot amount pushed at acceptance: $${tierTurnkeyAmount.toFixed(2)}`);
  console.log(`  ↳ same value as the receipt's Order Total by construction`);
  console.log("");
  console.log("URLs to walk (Vercel preview URL for PR #148):");
  console.log("");
  console.log("Sub-tab 5 · Sales Order:");
  console.log(`  Pending (default):     ${base}?tab=tier`);
  console.log(`  Pending + below_floor: ${base}?tab=tier&dev=1&so-flags=below_floor`);
  console.log(`  Pending + unmatched:   ${base}?tab=tier&dev=1&so-flags=unmatched`);
  console.log(`  Pending + both flags:  ${base}?tab=tier&dev=1&so-flags=both`);
  console.log(`  Failed (so_create):    ${base}?tab=tier&dev=1&so-state=failed`);
  console.log(`  Failed (item_group):   ${base}?tab=tier&dev=1&so-state=failed&so-failed-at=item_group`);
  console.log(`  Record:                ${base}?tab=tier&dev=1&so-state=record`);
  console.log("");
  console.log("Sibling tabs:");
  console.log(`  Preview:    ${base}?tab=preview`);
  console.log(`  Send:       ${base}?tab=send`);
  console.log(`  Review:     ${base}?tab=review`);
  console.log(`  Acceptance: ${base}?tab=accepted`);
}

main()
  .catch(async (e) => {
    console.error("PROVISIONING ERROR:", e);
    if (orphanDealId) {
      console.error(`\nOrphan HubSpot deal ${orphanDealId} — archive manually:`);
      console.error(`  curl -X DELETE -H "Authorization: Bearer $HUBSPOT_WRITE_ACCESS_TOKEN" https://api.hubapi.com/crm/v3/objects/deals/${orphanDealId}`);
    }
    process.exitCode = 1;
  })
  .finally(async () => { await sql.end(); });
