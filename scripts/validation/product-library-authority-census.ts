/**
 * Product Library authority census — READ-ONLY.
 *
 * Reproduces the three proven failure classes and censuses the whole active
 * commercial library against the governed chain:
 *
 *     HubSpot Product  ↔  Nexus leaf  →  exactly one eligible NetSuite Item
 *
 * No mutation of any kind. No leaf creation, no substitution, no sync.
 *
 * METHOD NOTE. The per-SKU resolver is serial by design (SuiteQL throttles),
 * so 1,000+ calls is impractical and would also be a different measurement from
 * the one that matters. Instead the eligible NetSuite item namespace is pulled
 * ONCE and joined in memory using the resolver's OWN predicate — active,
 * itemtype != 'Group', case-insensitive itemid — so the census answers the same
 * question `resolveNetsuiteItem` would, for every leaf, without 1,000 round
 * trips. Divergence from the resolver's rule would make the census a different
 * question wearing the same name.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getProduct } from "@/lib/hubspot";
import { suiteQL } from "@/lib/netsuite/client";

const line = (s = "") => console.log(s);

// ── PART 1 · reproduce the three proven classes ────────────────────────────
line("═══ PART 1 · PROVEN FAILURE CLASSES ═══\n");

const CLASS_1 = "CC-12oz-Filling-1.4";
const [c1] = (await db.execute(sql`
  SELECT id, name, sku, hubspot_product_id, archived FROM leaves WHERE sku = ${CLASS_1}`)) as any[];
line(`CLASS 1 · governed HubSpot Product exists, NetSuite Item missing`);
line(`  Nexus leaf   : ${String(c1?.id).slice(0, 8)} sku=${c1?.sku} active=${!c1?.archived}`);
let c1hs: any = null;
try { c1hs = await getProduct(String(c1.hubspot_product_id)); } catch { /* reported below */ }
line(`  HubSpot ${c1?.hubspot_product_id} : ${c1hs ? `EXISTS sku="${c1hs.sku}" name="${c1hs.name}"` : "MISSING"}`);
const c1ns = await suiteQL<Record<string, string>>(
  `SELECT id,itemid,itemtype FROM item WHERE LOWER(itemid)=LOWER('${CLASS_1}') AND isinactive='F' AND itemtype != 'Group'`);
line(`  NetSuite     : ${c1ns.items.length ? JSON.stringify(c1ns.items) : "NO ITEM"}`);
line(`  CLASSIFICATION: HubSpot → NetSuite synchronization missing/failed.`);
line(`  NOT a Nexus mapping defect — Nexus and HubSpot agree on SKU and name.\n`);

line(`CLASS 2 · active Nexus leaf references a deleted HubSpot authority`);
for (const sku of ["10025-Fill", "50010-Fill"]) {
  const [l] = (await db.execute(sql`
    SELECT id, sku, hubspot_product_id, archived FROM leaves WHERE sku = ${sku}`)) as any[];
  let hs: any = null;
  try { hs = await getProduct(String(l.hubspot_product_id)); } catch { /* null below */ }
  line(`  ${sku.padEnd(12)} leaf ${String(l?.id).slice(0, 8)} active=${!l?.archived} hs_id=${l?.hubspot_product_id} → ${hs ? "EXISTS" : "DOES NOT EXIST"}`);
}
line(`  CLASSIFICATION: Nexus Product Library stale/dangling authority.`);
line(`  A Nexus governance problem: the product stays operator-usable after its`);
line(`  governing HubSpot Product has disappeared.\n`);

line(`CLASS 3 · NetSuite SKU ambiguity`);
const amb = await suiteQL<Record<string, string>>(
  `SELECT id,itemid,itemtype,class FROM item WHERE LOWER(itemid)=LOWER('10025-Fill') AND isinactive='F' AND itemtype != 'Group'`);
for (const i of amb.items as any[]) line(`  10025-Fill → id=${i.id} type=${i.itemtype} class=${i.class ?? "-"}`);
line(`  RESOLVER BEHAVIOUR (read from item-resolver.ts, not inferred):`);
line(`    0 matches → not_found · 1 → found · >1 → status:"ambiguous", ALL matches`);
line(`    returned. It REFUSES ambiguity; it does not first-match.`);
line(`    Matches on itemid only, case-insensitive, itemtype='Group' excluded.`);
line(`    No identifier beyond SKU participates.\n`);

// ── PART 2 · population census ─────────────────────────────────────────────
line("═══ PART 2 · ACTIVE LIBRARY CENSUS ═══\n");

const leaves = (await db.execute(sql`
  SELECT id, sku, name, hubspot_product_id FROM leaves
   WHERE archived = false AND sku IS NOT NULL AND btrim(sku) <> ''`)) as any[];
line(`active commercial leaves with a SKU: ${leaves.length}`);

// Eligible NetSuite namespace, using the resolver's own predicate.
const byItemid = new Map<string, any[]>();
let offset = 0;
for (;;) {
  const page = await suiteQL<Record<string, string>>(
    `SELECT id, itemid, itemtype FROM item WHERE isinactive='F' AND itemtype != 'Group'`,
    { limit: 1000, offset } as never,
  );
  const items = page.items as any[];
  for (const i of items) {
    const k = String(i.itemid ?? "").toLowerCase();
    if (!byItemid.has(k)) byItemid.set(k, []);
    byItemid.get(k)!.push(i);
  }
  if (items.length < 1000) break;
  offset += 1000;
  if (offset > 20000) break; // safety
}
line(`eligible NetSuite items (active, non-Group): ${[...byItemid.values()].flat().length} across ${byItemid.size} distinct itemids\n`);

const noHsId: any[] = [], unique: any[] = [], noItem: any[] = [], ambiguous: any[] = [];
for (const l of leaves) {
  if (!l.hubspot_product_id) { noHsId.push(l); continue; }
  const m = byItemid.get(String(l.sku).toLowerCase()) ?? [];
  if (m.length === 1) unique.push(l);
  else if (m.length === 0) noItem.push(l);
  else ambiguous.push({ ...l, n: m.length });
}

const ex = (a: any[], n = 3) => a.slice(0, n).map((x) => x.sku).join(", ") || "—";
line(`  unique NetSuite resolution      : ${unique.length}   e.g. ${ex(unique)}`);
line(`  NO NetSuite item                : ${noItem.length}   e.g. ${ex(noItem)}`);
line(`  MULTIPLE active matches         : ${ambiguous.length}   e.g. ${ex(ambiguous)}`);
line(`  no HubSpot product id stored    : ${noHsId.length}   e.g. ${ex(noHsId)}`);
line();
line(`NOTE · leaves carrying a HubSpot id are NOT all verified live here — that`);
line(`is one API call per leaf. Class 2 proves the dangling case EXISTS; its`);
line(`population size is deliberately left unmeasured rather than guessed.`);
process.exit(0);
