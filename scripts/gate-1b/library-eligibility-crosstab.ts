/**
 * ADJUDICATION · Product Library eligibility, measured on TWO INDEPENDENT AXES.
 *
 * `product-library-authority-census.ts` classifies with sequential `continue`:
 * a leaf with no HubSpot id is bucketed and never tested for NetSuite
 * resolution. Its four classes are therefore disjoint BY CONSTRUCTION, and the
 * overlap question cannot be asked of them at all — which is the question the
 * remediation plan actually depends on, because a leaf missing BOTH identities
 * needs different work from one missing either.
 *
 * This measures the axes separately and crosstabs them. It changes no
 * conclusion about the total; it makes the population addressable.
 *
 * READ-ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { suiteQL } from "@/lib/netsuite/client";

const leaves = (await db.execute(sql`
  SELECT id, sku, name, hubspot_product_id, commercial_kind::text ck
    FROM leaves
   WHERE archived = false AND service_identity IS NULL
`)) as unknown as Array<{ id: string; sku: string | null; hubspot_product_id: string | null; ck: string | null }>;

// Every active non-Group NetSuite item, keyed by lowercased itemid.
// COUNT DISTINCT ITEM IDS, not row occurrences. A first version counted rows
// and reported 100% of the library ineligible with ZERO unique resolutions --
// paging returns overlapping rows, so every itemid appeared twice and every
// leaf resolved "MULTIPLE". An implausible total is the tell; the fix is to
// key on the item's own id so a row seen twice is still one item.
const byItemid = new Map<string, Set<string>>();
let offset = 0;
let rowsSeen = 0;
for (;;) {
  // PAGING IS A REQUEST PARAM, NOT SQL. A first version wrote
  // `offset N rows fetch next 1000 rows only` into the query text; the helper
  // ignores it and pages via `?limit&offset`, so all 21 pages returned the
  // SAME first 1000 rows -- 21,000 rows fetched, 1,000 distinct. Loop on the
  // provider's own `hasMore`.
  const r = (await suiteQL(
    `select id, itemid from item where isinactive='F' and itemtype != 'Group' order by id`,
    { limit: 1000, offset },
  )) as { items: Array<{ id: string; itemid: string }>; hasMore: boolean };
  const items = r.items ?? [];
  rowsSeen += items.length;
  for (const i of items) {
    const k = String(i.itemid).toLowerCase();
    if (!byItemid.has(k)) byItemid.set(k, new Set());
    byItemid.get(k)!.add(String(i.id));
  }
  if (!r.hasMore || items.length === 0) break;
  offset += items.length;
  if (offset > 60000) break;
}
const distinctItems = [...byItemid.values()].reduce((a, s) => a + s.size, 0);
console.log(`item rows fetched ${rowsSeen} -> ${distinctItems} distinct items`);

console.log(`active commercial leaves            ${leaves.length}`);
console.log(`distinct active non-Group itemids   ${byItemid.size}\n`);

// ── AXIS 1 · HubSpot identity ── AXIS 2 · NetSuite resolution ───────────
const cell = new Map<string, string[]>();
const bump = (k: string, sku: string | null) => {
  if (!cell.has(k)) cell.set(k, []);
  cell.get(k)!.push(sku ?? "(no sku)");
};

for (const l of leaves) {
  const hs = l.hubspot_product_id ? "has HubSpot id" : "NO HubSpot id";
  const n = l.sku ? (byItemid.get(String(l.sku).toLowerCase())?.size ?? 0) : 0;
  const ns = !l.sku ? "no SKU to resolve" : n === 1 ? "unique NetSuite" : n === 0 ? "NO NetSuite item" : "MULTIPLE NetSuite";
  bump(`${hs} × ${ns}`, l.sku);
}

const axis1 = ["has HubSpot id", "NO HubSpot id"];
const axis2 = ["unique NetSuite", "NO NetSuite item", "MULTIPLE NetSuite", "no SKU to resolve"];

console.log("── CROSSTAB ────────────────────────────────────────────");
console.log("".padEnd(22) + axis2.map((a) => a.padStart(18)).join(""));
for (const a of axis1) {
  const row = axis2.map((b) => String((cell.get(`${a} × ${b}`) ?? []).length).padStart(18));
  console.log(a.padEnd(22) + row.join(""));
}

console.log("\n── the populations that need different work ────────────");
let ineligible = 0;
for (const a of axis1) {
  for (const b of axis2) {
    const k = `${a} × ${b}`;
    const v = cell.get(k) ?? [];
    if (v.length === 0) continue;
    const eligible = a === "has HubSpot id" && b === "unique NetSuite";
    if (!eligible) ineligible += v.length;
    console.log(`${eligible ? "ELIGIBLE  " : "ineligible"} ${String(v.length).padStart(5)}  ${k}`);
    if (!eligible) console.log(`                  e.g. ${v.slice(0, 4).join(", ")}`);
  }
}
console.log(`\nineligible total ${ineligible} of ${leaves.length}  (${((ineligible / leaves.length) * 100).toFixed(1)}%)`);
console.log(
  `\nOVERLAP: leaves missing BOTH identities = ` +
    `${(cell.get("NO HubSpot id × NO NetSuite item") ?? []).length}` +
    ` — invisible to the sequential census, which buckets them as HubSpot-only.`,
);
process.exit(0);
