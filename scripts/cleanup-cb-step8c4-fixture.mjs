// Slice 12 Step 8c-4 — CB fixture cleanup.
// Usage: node scripts/cleanup-cb-step8c4-fixture.mjs '<handoff-json>'
//
// Per CA / #152 lesson: cleanup scans NetSuite DIRECTLY via SuiteQL
// on custbody_dps_deal_id, NOT via netsuite_so_pushes. If FAIL-A-style
// reset code ever deletes push rows before cleanup fires, the SO would
// orphan; scanning NS by the immutable deal-id field on the SO catches
// every push regardless of local state.
//
// Cleanup order (reverse of provisioning to avoid dangling FKs):
//   1. NetSuite Sales Orders (via SuiteQL scan on custbody_dps_deal_id)
//   2. Nexus quote row (cascades to assemblies + assembly_leaves +
//      assembly_leaf_inputs + quote_tiers + quote_snapshots +
//      quote_review_events + netsuite_so_pushes + audit_log entries
//      via FKs where set)
//   3. Nexus project row
//   4. hubspot_deals_cache row for the throwaway deal (fabricated
//      local-only row pointing at Epicuren's HS company id)
//   5. HubSpot deal (archive via API)
//
// Fixture uses Epicuren's real HubSpot company id + the seeded
// netsuite_customer_map row — neither belongs to us and neither gets
// touched by cleanup.
//
// Idempotent — safe to re-run. Reports what did NOT clean and why.

import postgres from "postgres";
import { createHmac, randomBytes } from "node:crypto";

const argJson = process.argv[2];
if (!argJson) {
  console.error("Usage: node scripts/cleanup-cb-step8c4-fixture.mjs '<handoff-json>'");
  console.error("The handoff json is printed by the provisioner. Wrap in single quotes.");
  process.exit(1);
}
let handoff;
try {
  handoff = JSON.parse(argJson);
} catch (e) {
  console.error("Failed to parse handoff JSON:", e.message);
  process.exit(1);
}
const {
  hubspotDealId,
  projectId,
  quoteId,
  quoteNumber,
  smokeTag,
} = handoff;
console.log(`Cleanup for ${smokeTag} · quote ${quoteNumber} · project ${projectId} · deal ${hubspotDealId}`);

const DB = process.env.DATABASE_URL;
const HS_WRITE = process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
const NS_ACCOUNT = process.env.NETSUITE_ACCOUNT_ID;
if (!DB) throw new Error("DATABASE_URL required");
if (!HS_WRITE) throw new Error("HUBSPOT_WRITE_ACCESS_TOKEN required");
if (!NS_ACCOUNT) throw new Error("NETSUITE_ACCOUNT_ID required");

const sql = postgres(DB, { prepare: false, max: 1, connect_timeout: 10 });

// ---- NetSuite REST via TBA (mirrored from probes) ----
const NS_BASE = `https://${NS_ACCOUNT.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com/services/rest`;
function pctE(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function signNs(m, urlStr) {
  const url = new URL(urlStr);
  const params = {
    oauth_consumer_key: process.env.NETSUITE_CONSUMER_KEY,
    oauth_token: process.env.NETSUITE_TOKEN_ID,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };
  const q = {};
  url.searchParams.forEach((v, k) => { q[k] = v; });
  const all = { ...params, ...q };
  const ps = Object.keys(all).sort().map((k) => `${pctE(k)}=${pctE(all[k])}`).join("&");
  const bs = [m, pctE(url.origin + url.pathname), pctE(ps)].join("&");
  const sk = `${pctE(process.env.NETSUITE_CONSUMER_SECRET)}&${pctE(process.env.NETSUITE_TOKEN_SECRET)}`;
  params.oauth_signature = createHmac("sha256", sk).update(bs).digest("base64");
  return 'OAuth realm="' + NS_ACCOUNT + '", ' +
    Object.keys(params).sort().map((k) => `${pctE(k)}="${pctE(params[k])}"`).join(", ");
}
async function nsSuiteQL(q) {
  const url = NS_BASE + "/query/v1/suiteql";
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: signNs("POST", url), "Content-Type": "application/json", Prefer: "transient" },
    body: JSON.stringify({ q }),
  });
  return await r.json();
}
async function nsDelete(path) {
  const url = NS_BASE + "/record/v1" + path;
  const r = await fetch(url, { method: "DELETE", headers: { Authorization: signNs("DELETE", url) } });
  const text = await r.text();
  return { status: r.status, body: text };
}

async function hubspotArchive(path) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${HS_WRITE}` },
  });
  return { status: r.status, body: r.status < 300 ? "ok" : await r.text() };
}

const summary = { nsSoDeleted: [], nsSoFailed: [], nexusRowsDeleted: [], warnings: [] };

try {
  // ═════ 1. NetSuite SO scan by custbody_dps_deal_id ═════
  console.log(`\n[1/7] Scanning NetSuite for SOs with custbody_dps_deal_id='${hubspotDealId}'…`);
  const qEsc = String(hubspotDealId).replace(/'/g, "''");
  const scan = await nsSuiteQL(
    `SELECT id, tranid FROM transaction WHERE type='SalesOrd' AND custbody_dps_deal_id='${qEsc}'`,
  );
  const soRows = scan?.items ?? [];
  if (scan?.["o:errorDetails"]) {
    console.error(`      SuiteQL error:`, scan["o:errorDetails"]);
    summary.warnings.push("NetSuite SuiteQL scan errored — check manually");
  } else {
    console.log(`      → found ${soRows.length} SO(s)`);
    for (const so of soRows) {
      const del = await nsDelete(`/salesOrder/${so.id}`);
      if (del.status === 204) {
        console.log(`      ✓ deleted SO id=${so.id} tranid=${so.tranid}`);
        summary.nsSoDeleted.push({ id: so.id, tranid: so.tranid });
      } else {
        console.log(`      ✗ failed to delete SO id=${so.id}: ${del.status} ${del.body.slice(0, 200)}`);
        summary.nsSoFailed.push({ id: so.id, tranid: so.tranid, status: del.status });
      }
    }
  }

  // ═════ 2. Nexus quote row (cascade via FKs) ═════
  console.log(`\n[2/7] Deleting Nexus quote row (cascades to tree)…`);
  const qDel = await sql`DELETE FROM quotes WHERE id = ${quoteId} RETURNING id`;
  if (qDel.length) {
    console.log(`      ✓ quote ${quoteId} deleted (cascaded assemblies, tiers, snapshots, events, pushes)`);
    summary.nexusRowsDeleted.push(`quote:${quoteId}`);
  } else {
    console.log(`      quote row not present (already cleaned?)`);
  }

  // ═════ 3. Nexus project row ═════
  console.log(`\n[3/7] Deleting Nexus project row…`);
  const pDel = await sql`DELETE FROM projects WHERE id = ${projectId} RETURNING id`;
  if (pDel.length) {
    console.log(`      ✓ project ${projectId} deleted`);
    summary.nexusRowsDeleted.push(`project:${projectId}`);
  } else {
    console.log(`      project row not present`);
  }

  // ═════ 4. hubspot_deals_cache row (fabricated for throwaway deal only) ═════
  console.log(`\n[4/5] Deleting hubspot_deals_cache row for throwaway deal…`);
  const cDel = await sql`DELETE FROM hubspot_deals_cache WHERE deal_id = ${hubspotDealId} RETURNING deal_id`;
  if (cDel.length) {
    console.log(`      ✓ cache row for deal ${hubspotDealId} deleted`);
    summary.nexusRowsDeleted.push(`hubspot_deals_cache:${hubspotDealId}`);
  } else {
    console.log(`      cache row not present`);
  }

  // ═════ 5. HubSpot deal ═════
  console.log(`\n[5/5] Archiving HubSpot deal ${hubspotDealId}…`);
  const dArch = await hubspotArchive(`/crm/v3/objects/deals/${hubspotDealId}`);
  if (dArch.status === 204) {
    console.log(`      ✓ deal archived`);
  } else {
    console.log(`      ✗ deal archive failed: ${dArch.status} ${dArch.body.slice(0, 200)}`);
    summary.warnings.push(`HubSpot deal ${hubspotDealId} not archived — check manually`);
  }
} finally {
  await sql.end();
}

console.log(`\n════ Cleanup summary ════`);
console.log(`NetSuite SOs deleted: ${summary.nsSoDeleted.length}`);
for (const so of summary.nsSoDeleted) console.log(`  • id=${so.id} tranid=${so.tranid}`);
if (summary.nsSoFailed.length) {
  console.log(`NetSuite SOs FAILED to delete: ${summary.nsSoFailed.length}`);
  for (const so of summary.nsSoFailed) console.log(`  • id=${so.id} tranid=${so.tranid} status=${so.status}`);
}
console.log(`Nexus rows deleted: ${summary.nexusRowsDeleted.length}`);
for (const row of summary.nexusRowsDeleted) console.log(`  • ${row}`);
if (summary.warnings.length) {
  console.log(`Warnings:`);
  for (const w of summary.warnings) console.log(`  ⚠  ${w}`);
}
