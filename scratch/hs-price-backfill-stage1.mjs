// HubSpot price backfill · Stage 1 · READ-ONLY assessment.
// No writes to HubSpot. Uses HUBSPOT_ACCESS_TOKEN (read-only token).
//
// Reports:
//   A. Total products; populated 'price' vs empty
//   B. Field-name/type confirmation + shape of one populated product
//   C. Unpriced products Nexus references (join leaves.hubspot_product_id)
//   D. Batch-update endpoint shape + rate-limit posture (from docs)
//   E. Cross-system priced-count comparison (HubSpot vs NetSuite 89/1350)
//   F. Origin split — Nexus-authored vs external, from leaves.audit_log
//      + HubSpot hs_created_by_user_id
import postgres from "postgres";

const HS = process.env.HUBSPOT_ACCESS_TOKEN;
const DB = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!HS) throw new Error("HUBSPOT_ACCESS_TOKEN missing");
if (!DB) throw new Error("DATABASE_URL / DIRECT_URL missing");

const sql = postgres(DB, { max: 3, prepare: false });

const PROPS = [
  "name",
  "hs_sku",
  "price",
  "hs_cost_of_goods_sold",
  "hs_product_type",
  "hs_status",
  "hubspot_owner_id",
  "hs_created_by_user_id",
  "createdate",
  "hs_lastmodifieddate",
];

async function hsGet(path, params) {
  const q = params ? "?" + new URLSearchParams(params).toString() : "";
  const r = await fetch(`https://api.hubapi.com${path}${q}`, {
    headers: { Authorization: `Bearer ${HS}` },
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`HS ${path} → ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function fetchAllProducts() {
  const all = [];
  let after = undefined;
  let pageNum = 0;
  while (true) {
    pageNum++;
    const params = {
      limit: "100",
      properties: PROPS.join(","),
      archived: "false",
    };
    if (after) params.after = after;
    const page = await hsGet("/crm/v3/objects/products", params);
    all.push(...(page.results ?? []));
    process.stdout.write(`  page ${pageNum}  running total ${all.length}\r`);
    after = page.paging?.next?.after;
    if (!after) break;
    if (pageNum > 200) throw new Error("cutoff at 200 pages — too many products");
  }
  process.stdout.write("\n");
  return all;
}

function isPriced(p) {
  const v = p.properties?.price;
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function isPriceEmpty(p) {
  const v = p.properties?.price;
  return v === null || v === undefined || v === "";
}

function isPriceZero(p) {
  const v = p.properties?.price;
  if (v === null || v === undefined || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n === 0;
}

try {
  console.log("═══ Stage 1A · Total products + price distribution ═══");
  const products = await fetchAllProducts();
  console.log(`  Total active HubSpot products: ${products.length}`);
  const priced = products.filter(isPriced);
  const zero = products.filter(isPriceZero);
  const empty = products.filter(isPriceEmpty);
  const other = products.length - priced.length - zero.length - empty.length;
  console.log(`    price > 0  (populated real value):  ${priced.length}`);
  console.log(`    price = 0  (structural zero):       ${zero.length}`);
  console.log(`    price empty (null/undefined/""):    ${empty.length}`);
  console.log(`    price other (non-numeric):          ${other}`);

  // ═════ 1B · Field shape ═════
  console.log("\n═══ Stage 1B · Field-name/type confirmation ═══");
  console.log("  Property name: `price` (NOT `hs_price` — that's not a HubSpot Product property).");
  console.log("  Type: STRING per HubSpot API (numeric stored as text; parse on read).");
  console.log("  Sample of one populated product:");
  const samplePriced = priced[0];
  if (samplePriced) {
    console.log(`    id: ${samplePriced.id}`);
    console.log(`    hs_object_id: ${samplePriced.properties?.hs_object_id ?? "-"}`);
    for (const k of PROPS) {
      const v = samplePriced.properties?.[k];
      if (v !== null && v !== undefined && v !== "") {
        console.log(`    ${k}: ${JSON.stringify(v).slice(0, 100)}`);
      }
    }
  } else {
    console.log("    (no priced product found)");
  }
  console.log("\n  Sample of one EMPTY-price product:");
  const sampleEmpty = empty[0];
  if (sampleEmpty) {
    console.log(`    id: ${sampleEmpty.id}`);
    console.log(`    price field: ${JSON.stringify(sampleEmpty.properties?.price)}`);
    console.log(`    name: ${sampleEmpty.properties?.name ?? "-"}`);
    console.log(`    hs_sku: ${sampleEmpty.properties?.hs_sku ?? "-"}`);
  }

  // ═════ 1C · Cross-reference with Nexus ═════
  console.log("\n═══ Stage 1C · Which unpriced HubSpot products does Nexus reference? ═══");
  const leaves = await sql`
    SELECT id, name, sku, hubspot_product_id, archived
    FROM leaves
    WHERE hubspot_product_id IS NOT NULL
  `;
  console.log(`  Nexus leaves with hubspot_product_id: ${leaves.length}`);
  const leafByHs = new Map(leaves.map((l) => [l.hubspot_product_id, l]));

  const nexusRefsUnpriced = empty.filter((p) => leafByHs.has(p.id));
  const nexusRefsPriced = priced.filter((p) => leafByHs.has(p.id));
  const nexusRefsZero = zero.filter((p) => leafByHs.has(p.id));
  console.log(`  Of Nexus-referenced products:`);
  console.log(`    priced > 0: ${nexusRefsPriced.length}`);
  console.log(`    price = 0:  ${nexusRefsZero.length}`);
  console.log(`    empty:      ${nexusRefsUnpriced.length}`);
  console.log(`    total in HubSpot: ${nexusRefsPriced.length + nexusRefsZero.length + nexusRefsUnpriced.length}`);
  console.log(`    Nexus leaves with hubspot_product_id not found in HS (archived or missing): ${leaves.length - (nexusRefsPriced.length + nexusRefsZero.length + nexusRefsUnpriced.length)}`);

  // ═════ 1D · Batch-update endpoint + rate limits ═════
  console.log("\n═══ Stage 1D · Batch update endpoint + rate limits ═══");
  console.log(`  Endpoint:  POST /crm/v3/objects/products/batch/update`);
  console.log(`  Body shape:`);
  console.log(`    { "inputs": [ { "id": "<hubspot_product_id>", "properties": { "price": "0" } }, ... ] }`);
  console.log(`  Batch size: max 100 inputs per request (HubSpot v3 batch API standard)`);
  console.log(`  Response:   200 with per-input results; 207 partial-success with per-input errors`);
  console.log(`  Rate limits (public app / Sales Hub Pro DPS tier):`);
  console.log(`    - 100 requests / 10 seconds per token (burst)`);
  console.log(`    - 250,000 requests / day`);
  console.log(`    - Batch calls count as ONE request regardless of input size (100 products = 1 unit)`);
  console.log(`  Backfill scale estimate:`);
  console.log(`    ${empty.length} empty-price products / 100 per batch = ${Math.ceil(empty.length / 100)} batches`);
  console.log(`    At 10 batches / sec burst budget: <${Math.ceil(empty.length / 100 / 10)}s wall clock ignoring overhead`);
  console.log(`    Well under daily quota.`);

  // ═════ 1E · Cross-system priced-count comparison ═════
  console.log("\n═══ Stage 1E · Cross-system priced-count comparison ═══");
  const hsPricedTotal = priced.length + zero.length;
  console.log(`  HubSpot: ${products.length} total · ${hsPricedTotal} with any price value (${priced.length} > 0, ${zero.length} = 0) · ${empty.length} empty`);
  console.log(`  NetSuite (per Probe 8b, 2026-07-28): 1350 total · 89 priced · 1261 unpriced`);
  const hsPricedPct = ((hsPricedTotal / products.length) * 100).toFixed(1);
  const nsPricedPct = ((89 / 1350) * 100).toFixed(1);
  console.log(`  Priced fraction:  HubSpot ${hsPricedPct}% · NetSuite ${nsPricedPct}%`);
  console.log("");
  console.log("  Interpretation:");
  const hsSurplus = hsPricedTotal - 89;
  if (hsSurplus > 200) {
    console.log(`  ⚠  HubSpot has ${hsSurplus} MORE priced products than NetSuite.`);
    console.log(`     If Vu's account of the sync is correct ("prices propagate"), the`);
    console.log(`     surplus should not exist. This CONTRADICTS the sync story and`);
    console.log(`     needs explicit review before Stage 3.`);
  } else if (hsSurplus > 50) {
    console.log(`  ⚠  HubSpot has ${hsSurplus} more priced products than NetSuite.`);
    console.log(`     Some divergence is expected (NetSuite carries items that never`);
    console.log(`     came from HubSpot; the reverse gap is what's suspicious). This is`);
    console.log(`     modest and could be sync lag or one-off exceptions, but flag for CA.`);
  } else if (hsSurplus >= 0) {
    console.log(`  HubSpot has ${hsSurplus} more priced than NetSuite — consistent with`);
    console.log(`  a working sync (small delta absorbable by sync lag / edge cases).`);
  } else {
    console.log(`  NetSuite has ${-hsSurplus} MORE priced than HubSpot.`);
    console.log(`  This is EXPECTED per CA — NetSuite carries items that never came`);
    console.log(`  from HubSpot (Aisha's manual creates + legacy migrations). The gap`);
    console.log(`  our push-mapping fix won't close is the count of NS items without`);
    console.log(`  a HubSpot origin.`);
  }

  // ═════ 1F · Origin split — Nexus-authored vs external ═════
  console.log("\n═══ Stage 1F · Origin split (Nexus-authored vs external) ═══");
  // From audit_log: leaf_create rows with diff_json.source='nexus_authored'
  // give us the leaves Nexus created. Anything else with a
  // hubspot_product_id came in via pullFromHubSpot (source='hubspot_pull')
  // OR pre-slice-hubspot-bidirectional (no audit row).
  const auditOrigins = await sql`
    SELECT
      COUNT(*) FILTER (WHERE diff_json->>'source' = 'nexus_authored') AS nexus_authored,
      COUNT(*) FILTER (WHERE diff_json->>'source' = 'hubspot_pull')  AS hubspot_pull,
      COUNT(*) FILTER (WHERE diff_json->>'source' IS NULL AND action = 'leaf_create') AS pre_bidirectional_or_unsourced,
      COUNT(*) FILTER (WHERE action = 'leaf_create') AS total_leaf_create_rows
    FROM audit_log
    WHERE action = 'leaf_create'
  `;
  const a = auditOrigins[0];
  console.log(`  audit_log leaf_create rows:`);
  console.log(`    source='nexus_authored': ${a.nexus_authored}  (Nexus AddProductModal LEAF mode)`);
  console.log(`    source='hubspot_pull':   ${a.hubspot_pull}  (pullFromHubSpot batch imports)`);
  console.log(`    source absent:           ${a.pre_bidirectional_or_unsourced}  (pre-slice-hubspot-bidirectional creates)`);
  console.log(`    total:                   ${a.total_leaf_create_rows}`);
  console.log("");
  console.log("  What Nexus's HubSpot-side backfill can + can't fix:");
  console.log("    ✓ Nexus-authored leaves — 1-line mapper fix stops the trickle going forward");
  console.log("    ✓ Products already in HubSpot with empty price — Stage 4 batch update sets them to 0");
  console.log("    ✗ NetSuite-only items (Aisha's direct NS creates, legacy migrations) — no HubSpot record");
  console.log("      to backfill. Those need Vu's NetSuite-side update, not a HubSpot backfill.");
  console.log("");
  console.log("  From leaves table:");
  const withHs = leaves.length;
  const totalLeaves = await sql`SELECT COUNT(*)::int AS n FROM leaves`;
  console.log(`    Total leaves in Nexus:              ${totalLeaves[0].n}`);
  console.log(`    Leaves with hubspot_product_id:     ${withHs}`);
  console.log(`    Leaves without hubspot_product_id:  ${totalLeaves[0].n - withHs}  (Nexus-only, not sync-eligible)`);

  // ═════ Stage 1 summary ═════
  console.log("\n═══ Stage 1 summary ═══");
  console.log(`  • ${products.length} active HubSpot products; ${empty.length} have empty 'price' — the backfill target`);
  console.log(`  • ${nexusRefsUnpriced.length} of those are referenced by Nexus leaves (they matter today for the flat-lines pivot's per-line rate flow when grouped-SO reopens)`);
  console.log(`  • ${nexusRefsPriced.length + nexusRefsZero.length} Nexus-referenced products already have any price value — no backfill needed`);
  console.log(`  • Cross-system comparison: see Stage 1E above; disposition depends on the sync-direction confirmation Vu will provide`);
  console.log(`  • Batch update: max 100/batch; ${Math.ceil(empty.length / 100)} batches for a full backfill; well within rate limits`);
  console.log("");
  console.log("  STOP after Stage 2 per CA directive. Awaiting explicit go for Stages 3-4.");
} finally {
  await sql.end();
}
