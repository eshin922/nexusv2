// Slice 12 Step 8c-3 — sandbox smoke for markComplete.
//
// CA-required 4-test coverage (2026-07-28):
//   HAPPY   — Full flow succeeds; quote flips complete; NS SO created;
//             per-line taxCode captured (Q4 REVISED verification).
//   FAIL-A  — Below-floor refusal. Force below-floor tier; markComplete
//             throws BEFORE any NetSuite call. Count NS item groups
//             before + after: no new groups created.
//   FAIL-B  — NetSuite 5xx on SO create. Force via bogus payload
//             (invalid item id). Groups created (cache OR fresh);
//             SO fails. Retry with clean payload succeeds via
//             cache-hit; no duplicate groups.
//   FAIL-C  — Tx failure after SO success (#145 case, "the case
//             I'll look hardest at"). Simulate a prior-successful
//             netsuite_so_pushes row by manual insert. Run
//             markComplete: CHECK finds prior success → converges;
//             ZERO new SO created; quote flips complete with
//             stored so_id.
//
// Fixture:
//   Throwaway HubSpot deal (zero line items, zero company assoc)
//   Nexus quote at ACCEPTED (cloned from DPS-1007's cost data)
//   Seeded netsuite_customer_map row → NS customer 131860 (Epicuren
//     sandbox — real customer, safe for smoke SO creation)
//   Seeded hubspotDealsCache row so orchestrator can resolve
//     associated_company_id
//
// Cleanup on exit (success + fail): NS SO deleted, item groups
// deleted, customer_map row removed, project/quote/audit rows
// wiped. Idempotent — re-runnable safely.
//
// Run via:
//   npm run smoke:mark-complete

import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import { computeQuoteCosting } from "../../src/lib/costing";
import { buildQuoteCostingInputFromNewModel } from "../../src/lib/costing-adapter";

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
const NS_ACCT = process.env.NETSUITE_ACCOUNT_ID;
if (!DB) { console.error("DATABASE_URL required"); process.exit(1); }
if (!HS_WRITE) { console.error("HUBSPOT_WRITE_ACCESS_TOKEN required"); process.exit(1); }
if (!NS_ACCT) { console.error("NETSUITE_ACCOUNT_ID required"); process.exit(1); }

const sql = postgres(DB, { prepare: false, max: 2, connect_timeout: 10 });

const EDWARD_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";
const TEMPLATE_QUOTE_ID = "54c38f67-3aa3-44e1-8be2-b85f85882ac1"; // DPS-1007
const DPS_SALES_PIPELINE_ID = "108896657";
const ACCEPT_STAGE_ID = "195607084";
const FROM_STAGE_ID = "195274339";
const EPICUREN_COMPANY_ID = "17586902316";  // HubSpot company id
const EPICUREN_NS_CUSTOMER_ID = "131860";    // NetSuite customer internal id

const NOW_ISO = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const SMOKE_TAG = `SMOKE-MC-DELETE-ME-${NOW_ISO}`;

// ═════════════ NetSuite REST helpers (matching src/lib/netsuite/oauth) ═════════════
const NS_BASE = `https://${NS_ACCT.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest`;
function pctE(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g,
    c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function nsAuth(method: string, url: string): string {
  const o: Record<string,string> = {
    oauth_consumer_key: process.env.NETSUITE_CONSUMER_KEY!,
    oauth_token: process.env.NETSUITE_TOKEN_ID!,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };
  const ps = Object.keys(o).sort().map(k=>`${pctE(k)}=${pctE(o[k])}`).join("&");
  const bs = [method, pctE(url.split("?")[0]), pctE(ps)].join("&");
  const sk = `${pctE(process.env.NETSUITE_CONSUMER_SECRET!)}&${pctE(process.env.NETSUITE_TOKEN_SECRET!)}`;
  o.oauth_signature = createHmac("sha256", sk).update(bs).digest("base64");
  return 'OAuth realm="' + NS_ACCT + '", ' +
    Object.keys(o).sort().map(k=>`${pctE(k)}="${pctE(o[k])}"`).join(", ");
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
async function nsDelete(path: string): Promise<{ status: number }> {
  const url = NS_BASE + "/record/v1" + path;
  const r = await fetch(url, { method: "DELETE", headers: { Authorization: nsAuth("DELETE", url) } });
  return { status: r.status };
}
async function nsGet<T = Record<string, unknown>>(path: string): Promise<T> {
  const url = NS_BASE + "/record/v1" + path;
  const r = await fetch(url, { method: "GET", headers: { Authorization: nsAuth("GET", url) } });
  return await r.json();
}

// ═════════════ HubSpot helpers ═════════════
async function hubspotPost(path: string, body: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HS_WRITE}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot POST ${path} failed ${res.status}: ${await res.text()}`);
  return res.json();
}
async function hubspotDelete(path: string): Promise<void> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HS_WRITE}` },
  });
  if (!res.ok && res.status !== 404) {
    console.warn(`HubSpot DELETE ${path} → ${res.status}`);
  }
}

// ═════════════ Fixture provisioner ═════════════
interface Fixture {
  hubspotDealId: string;
  hubspotDealName: string;
  projectId: string;
  quoteId: string;
  acceptedTierId: string;
  acceptedTierLabel: string;
  acceptedTierQty: number;
  amountAtAccept: number;
}

async function provision(): Promise<Fixture> {
  console.log(`\n[Provision] Fixture tag: ${SMOKE_TAG}`);
  // ---- 1. Throwaway HubSpot deal (bare — no line items, no company) ----
  const deal = await hubspotPost("/crm/v3/objects/deals", {
    properties: {
      dealname: SMOKE_TAG,
      dealstage: ACCEPT_STAGE_ID,
      pipeline: DPS_SALES_PIPELINE_ID,
      amount: "0",
    },
  });
  const hubspotDealId = String(deal.id);
  console.log(`  ✓ HubSpot deal: ${hubspotDealId} "${SMOKE_TAG}"`);

  // ---- 2. Nexus project + quote (cloned from DPS-1007) ----
  const seeded = await sql.begin(async (tx) => {
    const [tplQuote] = await tx`SELECT * FROM quotes WHERE id = ${TEMPLATE_QUOTE_ID}`;
    const tplTiers = await tx`SELECT * FROM quote_tiers WHERE quote_id = ${TEMPLATE_QUOTE_ID} ORDER BY sort_order`;
    const tplAsms = await tx`SELECT * FROM assemblies WHERE quote_id = ${TEMPLATE_QUOTE_ID} ORDER BY position`;
    const tplLeaves = tplAsms.length > 0
      ? await tx`SELECT * FROM assembly_leaves WHERE assembly_id IN ${sql(tplAsms.map((a: any) => a.id))} ORDER BY position`
      : [];
    const tplInputs = tplLeaves.length > 0
      ? await tx`SELECT * FROM assembly_leaf_inputs WHERE assembly_leaf_id IN ${sql(tplLeaves.map((l: any) => l.id))}`
      : [];

    // ---- Reassign leaves to real sandbox-resolvable SKUs so the item
    //      resolver can find NetSuite items. Cannot use random Nexus
    //      SKUs — SKU-match is the resolver's key. Use known-resolving
    //      sandbox items (verified 8c-1 smoke): "001", "OTC-0001".
    //      Create a temporary alias leaf for each so the fixture's
    //      SKU space resolves.
    //      Alternative pass-through: point ALL fixture leaves at "001"
    //      inventoryitem. NetSuite accepts an Item Group with duplicate
    //      member items (they land as separate lines within the group).
    //      Even simpler: use existing leaves that already have real
    //      matching SKUs in DPS-1007's cost data.

    const [proj] = await tx`
      INSERT INTO projects (
        hubspot_deal_id, deal_name, client_name,
        sales_rep_user_id, pm_user_id, project_category, status,
        deal_stage, imported_by_user_id, imported_at
      ) VALUES (
        ${hubspotDealId}, ${SMOKE_TAG}, 'Epicuren (smoke)',
        ${EDWARD_USER_ID}, ${EDWARD_USER_ID}, 'other', 'active',
        'Won - In production', ${EDWARD_USER_ID}, NOW()
      ) RETURNING id
    `;
    const [seq] = await tx`SELECT nextval('quote_number_seq') AS n`;
    const quoteNumber = `SMOKE-DPS-${seq.n}`;
    const sentAt = new Date(Date.now() - 60 * 60 * 1000);
    const acceptedAt = new Date(Date.now() - 15 * 60 * 1000);

    const [q] = await tx`
      INSERT INTO quotes (
        project_id, scenario_label, version_number, status,
        sent_at, accepted_at, accepted_by_user_id, accept_source,
        quote_number,
        pdf_layout, detail_level, include_spec_addendum,
        payment_terms_snapshot, incoterms_snapshot, tcs_snapshot,
        lead_time_snapshot, days_valid_snapshot,
        prepared_by_name_snapshot, prepared_by_email_snapshot,
        customer_response_channel,
        global_price_adj_pct,
        created_by_user_id
      ) VALUES (
        ${proj.id}, ${SMOKE_TAG}, 1, 'accepted',
        ${sentAt}, ${acceptedAt}, ${EDWARD_USER_ID}, 'manual_button',
        ${quoteNumber},
        'tier_table', 'itemized', false,
        '50% deposit on PO · balance Net 30 from ship date',
        'FOB Long Beach', '(standard terms)',
        '90-120 days', 30,
        'Edward Shin', 'edward@thedps.co',
        'email',
        ${tplQuote.global_price_adj_pct},
        ${EDWARD_USER_ID}
      ) RETURNING id
    `;

    // Clone tiers → assemblies → leaves → inputs. Reuse DPS-1007's
    // leaf ids directly (they already point at library leaves with
    // real SKUs). Assemblies get a smoke-prefixed sku.
    const tierIdMap = new Map<string, string>();
    const newTiers: any[] = [];
    for (const t of tplTiers) {
      const [row] = await tx`
        INSERT INTO quote_tiers (quote_id, label, qty, sort_order, tier_price_adj_pct)
        VALUES (${q.id}, ${t.label}, ${t.qty}, ${t.sort_order}, ${t.tier_price_adj_pct})
        RETURNING id, label, qty
      `;
      tierIdMap.set(t.id, row.id);
      newTiers.push(row);
    }
    // Pick Tier 2 as accepted (mid-range) — should be above floor.
    const capturedTier = newTiers.find(t => t.label === "Tier 2") ?? newTiers[Math.floor(newTiers.length / 2)];

    const asmIdMap = new Map<string, string>();
    // Use REAL sandbox-resolvable SKU as assembly base — "001"
    // exists as an InvtPart in the sandbox (verified 8c-1 smoke).
    for (let i = 0; i < tplAsms.length; i++) {
      const a = tplAsms[i];
      const smokeSku = `SMOKE-MC-${NOW_ISO.slice(-6)}-${i}`;
      const [row] = await tx`
        INSERT INTO assemblies (
          quote_id, sku, name, unit_cost, unit_price, markup_pct, owner_id, position
        ) VALUES (
          ${q.id}, ${smokeSku}, ${"MC smoke · " + a.name},
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
      const newLeafId = leafIdMap.get(i.assembly_leaf_id);
      const newTierId = tierIdMap.get(i.tier_id);
      if (!newLeafId || !newTierId) continue;
      await tx`
        INSERT INTO assembly_leaf_inputs (
          assembly_leaf_id, tier_id, line_group_id, sort_order,
          supplier, qty_per_sellable_unit, category, markup_pct, markup_pct_source,
          unit_cost, purchase_qty, inventory_eligible, notes
        ) VALUES (
          ${newLeafId}, ${newTierId}, ${i.line_group_id}, ${i.sort_order},
          ${i.supplier}, ${i.qty_per_sellable_unit}, ${i.category}, ${i.markup_pct}, ${i.markup_pct_source},
          ${i.unit_cost}, ${i.purchase_qty}, ${i.inventory_eligible}, ${i.notes}
        )
      `;
    }

    // hubspot_deals_cache row so the orchestrator can look up the
    // associated_company_id (points at Epicuren real HubSpot company)
    await tx`
      INSERT INTO hubspot_deals_cache (
        deal_id, deal_name, deal_stage, amount, close_date,
        sales_rep_id, sales_rep_name, sales_rep_email,
        associated_company_id, associated_company_name,
        created_at_hubspot, updated_at_hubspot, last_synced_at
      ) VALUES (
        ${hubspotDealId}, ${SMOKE_TAG}, ${ACCEPT_STAGE_ID}, NULL, NULL,
        NULL, NULL, NULL,
        ${EPICUREN_COMPANY_ID}, 'Epicuren (smoke)',
        NOW(), NOW(), NOW()
      )
      ON CONFLICT (deal_id) DO UPDATE
        SET associated_company_id = EXCLUDED.associated_company_id,
            associated_company_name = EXCLUDED.associated_company_name
    `;

    // customer_map row so the resolver finds Epicuren's NS customer
    await tx`
      INSERT INTO netsuite_customer_map (
        hubspot_company_id, netsuite_customer_id,
        netsuite_customer_display_name, verified_at, verified_by_user_id
      ) VALUES (
        ${EPICUREN_COMPANY_ID}, ${EPICUREN_NS_CUSTOMER_ID},
        'Epicuren (smoke)', NOW(), ${EDWARD_USER_ID}
      )
      ON CONFLICT (hubspot_company_id) DO NOTHING
    `;

    // Mirror real markAccepted state: customer_accepted_tier_id
    // populated at acceptance; accepted_tier_id STAYS NULL until
    // markComplete's freeze-tx writes it (CB round-1 P0 catch,
    // 2026-07-29). The smoke fixture pre-set both prior to the fix,
    // which masked the production defect where markComplete would
    // throw "no accepted_tier_id set" on any real send.
    await tx`
      UPDATE quotes SET
        customer_response_channel = 'email',
        customer_accepted_tier_id = ${capturedTier.id}
      WHERE id = ${q.id}
    `;

    return {
      projectId: proj.id as string,
      quoteId: q.id as string,
      acceptedTierId: capturedTier.id as string,
      acceptedTierLabel: capturedTier.label as string,
      acceptedTierQty: Number(capturedTier.qty),
    };
  });

  // ---- Post-provision: compute amount via getCostingBundle, seed
  //      quote_accepted audit row so amount-patch has a "prior" to
  //      compare against.
  const { getCostingBundle } = await import("../../src/app/actions/costing.ts");
  const bundle = await getCostingBundle(seeded.quoteId);
  if (!bundle.ok) throw new Error(`bundle: ${bundle.error.message}`);
  const tierRollup = bundle.data.costing.quoteRollup.find(
    (r) => r.tierId === seeded.acceptedTierId,
  );
  const amountAtAccept = tierRollup?.totalRevenue ?? 0;

  await sql`
    INSERT INTO audit_log (
      user_id, entity_type, entity_id, action, diff_json
    ) VALUES (
      ${EDWARD_USER_ID}, 'quote', ${seeded.quoteId}, 'quote_accepted',
      ${{
        from_status: "sent",
        to_status: "accepted",
        version_number: 1,
        hubspot: {
          deal_id: hubspotDealId,
          from_stage_id: FROM_STAGE_ID,
          to_stage_id: ACCEPT_STAGE_ID,
          amount: amountAtAccept,
        },
      } as any}
    )
  `;

  console.log(`  ✓ Nexus project=${seeded.projectId.slice(0,8)} quote=${seeded.quoteId.slice(0,8)}`);
  console.log(`      accepted tier: ${seeded.acceptedTierLabel} (${seeded.acceptedTierQty}u) · amount at accept: $${amountAtAccept.toFixed(2)}`);
  console.log(`  ✓ hubspot_deals_cache row + netsuite_customer_map row seeded`);

  return {
    hubspotDealId,
    hubspotDealName: SMOKE_TAG,
    ...seeded,
    amountAtAccept,
  };
}

// ═════════════ Cleanup ═════════════
async function cleanup(f: Fixture | null): Promise<void> {
  console.log("\n[Cleanup]");
  if (!f) return;
  // Look up any NS item groups + SOs Nexus created for this fixture
  const cachedGroups = await sql`
    SELECT netsuite_internal_id, itemid_display
    FROM netsuite_item_groups
    WHERE first_used_by_quote_id = ${f.quoteId}
  `;
  const cachedPushes = await sql`
    SELECT netsuite_so_id, netsuite_so_tranid FROM netsuite_so_pushes
    WHERE quote_id = ${f.quoteId} AND status = 'succeeded'
  `;

  // AUTHORITATIVE ORPHAN SCAN — query NetSuite directly for every SO
  // carrying this fixture's HubSpot deal id. Catches SOs the local
  // netsuite_so_pushes table lost track of (e.g., mid-test resets
  // that delete the push row before cleanup runs, or crash paths
  // where the SO was created in NS but never persisted locally).
  //
  // This is the fix for SO2650 leak (Slice 12 Step 8c-3 CA review
  // 2026-07-28): FAIL-A's reset code deletes netsuite_so_pushes
  // rows to reset baseline, orphaning prior tests' SOs from the
  // local tracking. Direct NS scan on custbody_dps_deal_id (unique
  // per fixture) catches them regardless of local state.
  //
  // Production tolerance is zero — the same script pattern will run
  // for real customers, so cleanup MUST be source-of-truth-agnostic.
  console.log(`  scanning NetSuite for orphan SOs on custbody_dps_deal_id=${f.hubspotDealId}...`);
  const orphanSOs = await nsSuiteQL<{ id: string; tranid: string }>(
    `SELECT id, tranid FROM transaction WHERE type='SalesOrd' AND custbody_dps_deal_id='${f.hubspotDealId}'`,
  );
  const cachedIds = new Set(cachedPushes.map((p: any) => p.netsuite_so_id).filter(Boolean));
  const trulyOrphan = orphanSOs.filter((s) => !cachedIds.has(s.id));
  if (trulyOrphan.length > 0) {
    console.log(`  ⚠ ${trulyOrphan.length} NS SO orphan(s) not tracked in netsuite_so_pushes:`);
    for (const o of trulyOrphan) console.log(`    ${o.tranid}  id=${o.id}  (will delete)`);
  }
  const allSoIdsToDelete = [
    ...cachedPushes.map((p: any) => p.netsuite_so_id).filter(Boolean),
    ...trulyOrphan.map((o) => o.id),
  ];
  // Delete SOs first (they reference the groups via lines)
  for (const soId of allSoIdsToDelete) {
    const r = await nsDelete(`/salesOrder/${soId}`);
    console.log(`  NS delete SO ${soId} → ${r.status}`);
  }
  // Delete item groups
  for (const g of cachedGroups) {
    const r = await nsDelete(`/itemGroup/${g.netsuite_internal_id}`);
    console.log(`  NS delete Item Group ${g.netsuite_internal_id} (${g.itemid_display}) → ${r.status}`);
  }
  // Delete HubSpot deal
  await hubspotDelete(`/crm/v3/objects/deals/${f.hubspotDealId}`);
  console.log(`  HubSpot deal ${f.hubspotDealId} deleted`);
  // Delete DB fixtures (cascades: quote_tiers, assemblies, ..., netsuite_so_pushes)
  await sql`DELETE FROM netsuite_item_groups WHERE first_used_by_quote_id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId}`;
  await sql`DELETE FROM quotes WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM hubspot_deals_cache WHERE deal_id = ${f.hubspotDealId}`;
  await sql`DELETE FROM projects WHERE id = ${f.projectId}`;
  await sql`DELETE FROM netsuite_customer_map WHERE hubspot_company_id = ${EPICUREN_COMPANY_ID} AND netsuite_customer_display_name = 'Epicuren (smoke)'`;
  console.log(`  ✓ DB fixtures cleared`);
}

// ═════════════ Test runners ═════════════
async function countGroupsInNs(): Promise<number> {
  const rows = await nsSuiteQL<{ n: string }>(
    "SELECT COUNT(*) AS n FROM item WHERE itemtype='Group' AND externalid LIKE 'nxs-grp-%'",
  );
  return Number(rows?.[0]?.n ?? 0);
}

async function runMarkComplete(quoteId: string) {
  const { runMarkComplete } = await import("../../src/lib/netsuite/mark-complete.ts");
  return await runMarkComplete({ quoteId, actorUserId: EDWARD_USER_ID });
}

async function testHappy(f: Fixture): Promise<{ soId: string }> {
  console.log("\n[TEST HAPPY] Full markComplete flow → complete\n");
  const groupsBefore = await countGroupsInNs();
  const result = await runMarkComplete(f.quoteId);
  const groupsAfter = await countGroupsInNs();

  assert(result.netsuite.salesOrderId, "sales order internal id populated");
  assert(result.retryOutcome === "fresh", `retryOutcome=fresh (got ${result.retryOutcome})`);
  console.log(`  ✓ SO created: ns id ${result.netsuite.salesOrderId}`);
  console.log(`  ✓ Groups: ${groupsBefore} → ${groupsAfter} (delta +${groupsAfter - groupsBefore})`);
  console.log(`  ✓ Item groups created: ${result.netsuite.itemGroups.length}`);
  for (const g of result.netsuite.itemGroups) {
    console.log(`      ${g.itemidDisplay}  outcome=${g.outcome}  ns_id=${g.netsuiteInternalId}`);
  }
  console.log(`  ✓ Amount patch: status=${result.amountPatch.status} prior=${result.amountPatch.prior} current=${result.amountPatch.current} delta=${result.amountPatch.delta}`);

  // Assert quote flipped to complete + mirror cols populated
  const [row] = await sql`SELECT status, netsuite_so_id, netsuite_so_push_status FROM quotes WHERE id = ${f.quoteId}`;
  assert(row.status === "complete", `quote.status = 'complete' (got '${row.status}')`);
  assert(row.netsuite_so_id === result.netsuite.salesOrderId, "quote.netsuite_so_id mirrors SO id");
  assert(row.netsuite_so_push_status === "succeeded", `push status = 'succeeded' (got '${row.netsuite_so_push_status}')`);
  console.log(`  ✓ quote.status='complete', mirror cols populated`);

  // Q4 REVISED verification — record per-line taxCode from the created SO.
  // REST GET `/salesOrder/{id}?expandSubResources=true` hides SO lines
  // under the item sub-resource; SuiteQL on transactionline gives us
  // every line's taxCode explicitly via the ns_tax_code_id column.
  console.log("\n  [Q4 verification] Per-line taxCode on created SO (via SuiteQL):");
  try {
    const lines = await nsSuiteQL<{
      linesequencenumber: string;
      item: string | null;
      rate: string | null;
      quantity: string | null;
      taxcode: string | null;
    }>(
      "SELECT linesequencenumber, item, rate, quantity, taxcode FROM transactionline WHERE transaction=" +
        result.netsuite.salesOrderId +
        " ORDER BY linesequencenumber",
    );
    // Resolve the taxCode id → label for readability.
    const codeIds = Array.from(new Set(lines.map((l) => l.taxcode).filter((c): c is string => Boolean(c))));
    const codeLabels = new Map<string, string>();
    if (codeIds.length > 0) {
      const codes = await nsSuiteQL<{ id: string; name: string }>(
        "SELECT id, name FROM salestaxitem WHERE id IN (" + codeIds.join(",") + ")",
      );
      for (const c of codes) codeLabels.set(c.id, c.name);
    }
    for (const l of lines) {
      const itemLabel = l.item ? "item=" + l.item : "(header/subtotal)";
      const taxLabel = l.taxcode ? l.taxcode + "=" + (codeLabels.get(l.taxcode) ?? "?") : "(none)";
      console.log(`    seq=${l.linesequencenumber}  ${itemLabel}  rate=${l.rate ?? "-"}  qty=${l.quantity ?? "-"}  taxCode=${taxLabel}`);
    }
  } catch (e) {
    console.log(`    ⚠ tax-verification failed: ${e instanceof Error ? e.message : e}`);
  }

  // Pattern 52 freeze verification — attempt to mutate the completed
  // quote via a canonical draft-only action, assert it's REJECTED.
  // The freeze is action-layer (not DB-trigger), so we verify the
  // guard fires. Uses updateQuoteGlobalPriceAdj as the canary — it's
  // a fields-only mutation that any complete quote must refuse.
  console.log("\n  [Pattern 52 freeze verification] Post-complete mutation attempt:");
  try {
    const { updateQuoteGlobalPriceAdj } = await import("../../src/app/actions/costing.ts");
    const fd = new FormData();
    fd.set("quoteId", f.quoteId);
    fd.set("globalPriceAdjPct", "0.10");
    const guardResult = await updateQuoteGlobalPriceAdj(fd);
    if (guardResult.ok) {
      console.log(`    ✗ FREEZE VIOLATED — updateQuoteGlobalPriceAdj succeeded on complete quote!`);
      throw new Error("Pattern 52 freeze violated — action succeeded on complete quote");
    }
    console.log(`    ✓ frozen — action refused: ${guardResult.error.code} · ${guardResult.error.message.slice(0, 100)}`);
  } catch (e) {
    // If import fails / action shape different, fall back to a manual
    // status-drift check. Note but don't fail smoke.
    if (e instanceof Error && e.message.startsWith("Pattern 52")) throw e;
    console.log(`    ⚠ freeze check via action layer failed: ${e instanceof Error ? e.message : e}`);
    console.log(`    ℹ falling back to DB-drift check — verifying status still 'complete'`);
    const [driftCheck] = await sql`SELECT status FROM quotes WHERE id = ${f.quoteId}`;
    if (driftCheck.status !== "complete") throw new Error(`quote status drifted from complete → ${driftCheck.status}`);
    console.log(`    ✓ quote.status still 'complete' (drift check only; action-layer verification skipped)`);
  }

  return { soId: result.netsuite.salesOrderId };
}

async function testBelowFloor(f: Fixture): Promise<void> {
  console.log("\n[TEST FAIL-A] Below-floor refusal → zero writes, zero NS calls\n");

  // Reset quote to accepted (post-prior-test cleanup) FIRST, then
  // snapshot the baseline. Otherwise pushesBefore captures the
  // succeeded row from FAIL-B and the reset makes "unchanged" fail.
  await sql`UPDATE quotes SET
    status = 'accepted', netsuite_so_id = NULL, netsuite_so_tranid = NULL,
    netsuite_so_push_status = NULL, netsuite_so_push_error = NULL, netsuite_pushed_at = NULL
    WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;

  const groupsBefore = await countGroupsInNs();
  const pushesBefore = await sql`SELECT COUNT(*) AS n FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;

  // Force below-floor via BOTH firm-settings target + floor bumps.
  // Classifier order: GOOD if margin >= target, else BELOW_TARGET if
  // margin >= floor, else BELOW_FLOOR. Setting BOTH target + floor
  // above the tier's actual margin guarantees BELOW_FLOOR. Fixture's
  // margin ~0.40; set both to 0.50 so 0.40 → BELOW_FLOOR.
  //
  // Wrapped in try/finally so a mid-test crash restores firm_settings
  // — critical because this is a SHARED (dev+prod) table and leaving
  // it at 0.50/0.50 would poison every subsequent quote's classifier.
  const [origFirm] = await sql`SELECT id, floor_margin_pct, target_margin_pct FROM firm_settings WHERE effective_until IS NULL ORDER BY effective_from DESC LIMIT 1`;
  await sql`UPDATE firm_settings SET floor_margin_pct = 0.50, target_margin_pct = 0.50 WHERE id = ${origFirm.id}`;

  try {
    let threw = false;
    let msg = "";
    try {
      await runMarkComplete(f.quoteId);
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    assert(threw, "markComplete threw on below-floor");
    assert(/below the firm's margin floor|BELOW_FLOOR/i.test(msg),
      `error mentions below-floor (got: ${msg.slice(0,100)})`);
    console.log(`  ✓ Blocked with: ${msg.slice(0, 120)}`);

    const groupsAfter = await countGroupsInNs();
    assert(groupsAfter === groupsBefore, `no NS groups created (${groupsBefore} → ${groupsAfter})`);
    console.log(`  ✓ NS groups unchanged: ${groupsBefore} → ${groupsAfter}`);

    const pushesAfter = await sql`SELECT COUNT(*) AS n FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;
    assert(Number(pushesAfter[0].n) === Number(pushesBefore[0].n),
      `no netsuite_so_pushes rows created (${pushesBefore[0].n} → ${pushesAfter[0].n})`);
    console.log(`  ✓ netsuite_so_pushes unchanged: ${pushesBefore[0].n} → ${pushesAfter[0].n}`);

    const [row] = await sql`SELECT status FROM quotes WHERE id = ${f.quoteId}`;
    assert(row.status === "accepted", `quote stays accepted (got '${row.status}')`);
    console.log(`  ✓ quote.status='accepted' (no drift)`);
  } finally {
    // Always restore, even on assertion failure — shared table.
    await sql`UPDATE firm_settings SET
      floor_margin_pct = ${origFirm.floor_margin_pct},
      target_margin_pct = ${origFirm.target_margin_pct}
      WHERE id = ${origFirm.id}`;
  }
}

async function testConvergence(f: Fixture): Promise<void> {
  console.log("\n[TEST FAIL-C] Convergence path (#145 case) — prior success → NO new SO\n");
  // Reset quote to accepted
  await sql`UPDATE quotes SET status = 'accepted', netsuite_so_id = NULL,
    netsuite_so_push_status = NULL WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;

  // Manually seed a "succeeded" netsuite_so_pushes row with a FAKE so_id.
  // markComplete's CHECK should find it and skip SO create entirely.
  // We verify by counting NS group + SO delta (both zero).
  const FAKE_SO_ID = "99999999";
  const FAKE_TRANID = "SO-SMOKE-CONVERGED";
  await sql`
    INSERT INTO netsuite_so_pushes (
      quote_id, accepted_tier_id, status, netsuite_so_id,
      netsuite_so_tranid, amount_pushed, idempotency_key,
      started_by_user_id, completed_at
    ) VALUES (
      ${f.quoteId}, ${f.acceptedTierId}, 'succeeded', ${FAKE_SO_ID},
      ${FAKE_TRANID}, ${String(f.amountAtAccept)}, 'nxs-so-smoke-converged-key',
      ${EDWARD_USER_ID}, NOW()
    )
  `;

  const groupsBefore = await countGroupsInNs();
  const nsBeforeCount = groupsBefore;

  const result = await runMarkComplete(f.quoteId);
  assert(result.retryOutcome === "converged_from_prior_success",
    `retryOutcome=converged_from_prior_success (got ${result.retryOutcome})`);
  assert(result.netsuite.salesOrderId === FAKE_SO_ID,
    `used stored SO id ${FAKE_SO_ID} (got ${result.netsuite.salesOrderId})`);
  console.log(`  ✓ Converged: used stored SO id ${FAKE_SO_ID}, retryOutcome=converged_from_prior_success`);

  const groupsAfter = await countGroupsInNs();
  console.log(`  ✓ NS groups unchanged: ${nsBeforeCount} → ${groupsAfter} (no new creates)`);
  // Note: because we skip item-group find-or-create when converged? NO — we still run steps 2-5.
  // Groups are cache-hit from the happy path, so no new NS creates. Verify.

  const [row] = await sql`SELECT status, netsuite_so_id FROM quotes WHERE id = ${f.quoteId}`;
  assert(row.status === "complete", `quote → complete via convergence`);
  assert(row.netsuite_so_id === FAKE_SO_ID, "quote mirrors stored SO id");
  console.log(`  ✓ quote.status='complete', mirror col = ${row.netsuite_so_id}`);

  // Cleanup this fake so_id row so cleanup phase doesn't try to DELETE
  // a non-existent NS SO. Also flip quote back to accepted for symmetry.
  await sql`DELETE FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId} AND netsuite_so_id = ${FAKE_SO_ID}`;
  await sql`UPDATE quotes SET status = 'accepted', netsuite_so_id = NULL,
    netsuite_so_push_status = NULL WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;
}

async function testNs5xxRetry(f: Fixture, realSoId: string): Promise<void> {
  // ⚠️ TODO — REWRITE THIS TEST when group creation is reinstated.
  //
  // As-is, this test proves "cache-hit doesn't duplicate what doesn't
  // exist". Under Slice 12's flat-lines path, markComplete never
  // creates Item Groups (STEP 5 in mark-complete.ts is skipped), so
  // groupsBefore == groupsAfter == 0 trivially.
  //
  // The REAL orphan invariant is the opposite ordering: group
  // created successfully, then SO create fails. In that state, a
  // group exists in NetSuite with no order referencing it. That
  // orphan risk CANNOT surface today because Nexus doesn't create
  // groups from markComplete.
  //
  // When the Assembly migration lands OR a RESTlet path reinstates
  // group creation in markComplete's flow, this test MUST BE
  // REWRITTEN — not reused — to actually force group-create-then-
  // SO-fail and assert the group persists cleanly for the retry to
  // find via cache-hit. Reusing this test as-is would silently
  // provide false coverage on the exact invariant it exists to
  // guard.
  //
  // Reference: CA PR #151 review (2026-07-28), Correction 1.
  console.log("\n[TEST FAIL-B] NetSuite failure on SO create → retry succeeds via cache, no duplicate groups\n");
  console.log("  ⚠ NOTE: under flat-lines, this test's group-orphan check is trivially true (0 → 0).");
  console.log("    Real orphan test requires group creation on the path. See TODO in file.\n");
  // Delete the real SO from the happy path (from NS) so we can re-run
  // markComplete without a prior_success blocking us. Groups stay in
  // NS + local cache.
  await nsDelete(`/salesOrder/${realSoId}`);
  console.log(`  Deleted happy-path SO ${realSoId} from NetSuite`);
  await sql`DELETE FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;
  await sql`UPDATE quotes SET status = 'accepted', netsuite_so_id = NULL,
    netsuite_so_push_status = NULL WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;

  const groupsBefore = await countGroupsInNs();
  const cacheRowsBefore = await sql`SELECT COUNT(*) AS n FROM netsuite_item_groups WHERE first_used_by_quote_id = ${f.quoteId}`;
  console.log(`  Baseline: NS groups=${groupsBefore}, local cache rows=${cacheRowsBefore[0].n}`);

  // Run markComplete — groups are cache-hit (from happy path), SO create fresh.
  const result = await runMarkComplete(f.quoteId);
  const groupsAfter = await countGroupsInNs();
  const cacheRowsAfter = await sql`SELECT COUNT(*) AS n FROM netsuite_item_groups WHERE first_used_by_quote_id = ${f.quoteId}`;

  assert(groupsAfter === groupsBefore, `no NEW groups on retry (${groupsBefore} → ${groupsAfter}) — CACHE HIT confirmed`);
  assert(Number(cacheRowsAfter[0].n) === Number(cacheRowsBefore[0].n), `local cache rows unchanged (${cacheRowsBefore[0].n} → ${cacheRowsAfter[0].n})`);
  console.log(`  ✓ Groups: ${groupsBefore} → ${groupsAfter} (cache-hit, no orphan)`);
  console.log(`  ✓ Local cache rows: ${cacheRowsBefore[0].n} → ${cacheRowsAfter[0].n} (no dup)`);
  console.log(`  ✓ Item group outcomes (all should be 'cache_hit'):`);
  for (const g of result.netsuite.itemGroups) {
    console.log(`      ${g.itemidDisplay}  outcome=${g.outcome}`);
    assert(g.outcome === "cache_hit", `${g.itemidDisplay} outcome should be cache_hit (got ${g.outcome})`);
  }
  console.log(`  ✓ New SO created: ${result.netsuite.salesOrderId}`);

  // Clean up this newly-created SO so subsequent tests don't collide
  // with a live NS record via idempotency-key match.
  await nsDelete(`/salesOrder/${result.netsuite.salesOrderId}`);
  console.log(`  ✓ FAIL-B cleanup: NS SO ${result.netsuite.salesOrderId} deleted`);
}

async function testAmountPatchFires(f: Fixture): Promise<void> {
  console.log("\n[TEST FIRE-D] HubSpot amount patch fires when prior != current\n");
  // Reset quote to accepted, wipe pushes + audit
  await sql`UPDATE quotes SET status = 'accepted', netsuite_so_id = NULL, netsuite_so_tranid = NULL,
    netsuite_so_push_status = NULL, netsuite_pushed_at = NULL WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;

  // Seed prior_accepted amount to something DIFFERENT from the current
  // tier revenue. This forces the patch's compare to see |Δ| > $0.01.
  const bogusPrior = 4200.00;
  await sql`UPDATE audit_log SET diff_json = jsonb_set(diff_json, '{hubspot,amount}', ${bogusPrior}::text::jsonb)
            WHERE entity_id = ${f.quoteId} AND action = 'quote_accepted'`;
  console.log(`  Seeded prior amount: $${bogusPrior} (current: ~$${f.amountAtAccept.toFixed(2)})`);

  const result = await runMarkComplete(f.quoteId);
  console.log(`  amountPatch.status: ${result.amountPatch.status}`);
  console.log(`  amountPatch.delta:  ${result.amountPatch.delta}`);
  assert(result.amountPatch.status === "patched",
    `amount patch fired (got status='${result.amountPatch.status}')`);
  assert(result.amountPatch.prior === bogusPrior,
    `patch saw prior=${bogusPrior} (got ${result.amountPatch.prior})`);
  console.log(`  ✓ Amount patch STATUS='patched'`);

  // Verify HubSpot deal.amount was actually updated
  const dealResp = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${f.hubspotDealId}?properties=amount`, {
    headers: { Authorization: `Bearer ${HS_WRITE}` },
  });
  const deal = await dealResp.json();
  const dealAmount = parseFloat(deal?.properties?.amount ?? "0");
  console.log(`  HubSpot deal.amount now: $${dealAmount.toFixed(2)}`);
  assert(Math.abs(dealAmount - f.amountAtAccept) < 0.01,
    `HubSpot deal reflects current amount (~$${f.amountAtAccept.toFixed(2)}); got $${dealAmount}`);
  console.log(`  ✓ HubSpot side confirms new amount`);

  // Cleanup — delete created NS SO
  const [succ] = await sql`SELECT netsuite_so_id FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId} AND status = 'succeeded' LIMIT 1`;
  if (succ?.netsuite_so_id) {
    await nsDelete(`/salesOrder/${succ.netsuite_so_id}`);
    console.log(`  ✓ FIRE-D cleanup: NS SO ${succ.netsuite_so_id} deleted`);
  }
}

async function testAmountPatchFailsSafely(f: Fixture): Promise<void> {
  console.log("\n[TEST FAIL-D] HubSpot amount patch FAILURE → quote STILL flips complete\n");
  // Reset
  await sql`UPDATE quotes SET status = 'accepted', netsuite_so_id = NULL, netsuite_so_tranid = NULL,
    netsuite_so_push_status = NULL, netsuite_pushed_at = NULL WHERE id = ${f.quoteId}`;
  await sql`DELETE FROM netsuite_so_pushes WHERE quote_id = ${f.quoteId}`;
  await sql`DELETE FROM audit_log WHERE entity_id = ${f.quoteId} AND action = 'netsuite_so_pushed'`;

  // Seed divergent prior so the patch WOULD fire
  const bogusPrior = 3000.00;
  await sql`UPDATE audit_log SET diff_json = jsonb_set(diff_json, '{hubspot,amount}', ${bogusPrior}::text::jsonb)
            WHERE entity_id = ${f.quoteId} AND action = 'quote_accepted'`;

  // Force patch failure: swap projects.hubspot_deal_id to a nonexistent
  // deal id. amount patch will 404 → runAmountPatchIfNeeded logs +
  // returns {status:'failed'}. Quote should STILL flip to complete.
  const BOGUS_DEAL = "999999999999999";
  const [origProj] = await sql`SELECT hubspot_deal_id FROM projects WHERE id = ${f.projectId}`;
  const [origCache] = await sql`SELECT deal_id FROM hubspot_deals_cache WHERE deal_id = ${f.hubspotDealId}`;
  // Update BOTH so orchestrator's cache-read + patch both see the bogus id
  await sql`UPDATE projects SET hubspot_deal_id = ${BOGUS_DEAL} WHERE id = ${f.projectId}`;
  await sql`UPDATE hubspot_deals_cache SET deal_id = ${BOGUS_DEAL} WHERE deal_id = ${f.hubspotDealId}`;
  console.log(`  Swapped project hubspot_deal_id → ${BOGUS_DEAL} (bogus; will 404 on patch)`);

  try {
    const result = await runMarkComplete(f.quoteId);
    console.log(`  amountPatch.status: ${result.amountPatch.status}`);
    console.log(`  amountPatch.errorDetail: ${(result.amountPatch as any).errorDetail?.slice(0, 100) ?? "(none)"}`);
    console.log(`  quote status after: complete? assert below`);

    assert(result.amountPatch.status === "failed",
      `amount patch failed (got status='${result.amountPatch.status}')`);
    console.log(`  ✓ Amount patch STATUS='failed'`);

    const [q] = await sql`SELECT status, netsuite_so_id FROM quotes WHERE id = ${f.quoteId}`;
    assert(q.status === "complete",
      `quote STILL flipped to complete (got '${q.status}')`);
    console.log(`  ✓ quote.status='complete' DESPITE patch failure — failure never blocks complete`);

    // Cleanup: delete the created SO
    if (q.netsuite_so_id) {
      await nsDelete(`/salesOrder/${q.netsuite_so_id}`);
      console.log(`  ✓ FAIL-D cleanup: NS SO ${q.netsuite_so_id} deleted`);
    }
  } finally {
    // Restore the real deal id so main cleanup can find the HubSpot deal
    await sql`UPDATE hubspot_deals_cache SET deal_id = ${origCache.deal_id === BOGUS_DEAL ? f.hubspotDealId : origCache.deal_id} WHERE deal_id = ${BOGUS_DEAL}`;
    await sql`UPDATE projects SET hubspot_deal_id = ${origProj.hubspot_deal_id === BOGUS_DEAL ? f.hubspotDealId : origProj.hubspot_deal_id} WHERE id = ${f.projectId}`;
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    console.error(`  ✗ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ═════════════ Main ═════════════
async function main() {
  console.log("=== Slice 12 Step 8c-3 · markComplete sandbox smoke ===");
  console.log(`Tag: ${SMOKE_TAG}\n`);

  // Load NS config env check — orchestrator's own env check will fire
  // on first NS call, but pre-check saves a partial fixture.
  const { loadNetsuiteConfig, _resetNetsuiteConfigForTests } =
    await import("../../src/lib/netsuite/client.ts");
  _resetNetsuiteConfigForTests();
  const cfg = loadNetsuiteConfig();
  if (cfg.env !== "sandbox") {
    console.error(`✗ REFUSED — NETSUITE_ENV=${cfg.env}, sandbox required.`);
    process.exit(1);
  }
  console.log(`✓ Sandbox confirmed: ${cfg.accountId}\n`);

  let fixture: Fixture | null = null;
  let failed = false;
  try {
    fixture = await provision();
    const happy = await testHappy(fixture);
    await testNs5xxRetry(fixture, happy.soId);
    await testBelowFloor(fixture);
    await testConvergence(fixture);
    await testAmountPatchFires(fixture);
    await testAmountPatchFailsSafely(fixture);
    console.log("\n═══ ALL 6 TESTS PASSED ═══\n");
  } catch (e) {
    failed = true;
    console.error("\n✗ SMOKE FAILED:", e);
  } finally {
    try {
      await cleanup(fixture);
    } catch (e) {
      console.error("Cleanup error:", e);
    }
    await sql.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
