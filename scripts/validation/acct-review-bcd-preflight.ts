/**
 * Accounting Review Orders B/C/D — product-resolution preflight. READ-ONLY.
 *
 * Applies the OD-027 eligibility contract to every commercial leaf B, C and D
 * propose, BEFORE any authoring:
 *
 *   1 · governed HubSpot Product identity exists
 *   2 · Nexus identity agrees with that authority
 *   3 · exactly one eligible NetSuite Item resolves
 *
 * An active Nexus leaf is NOT sufficient. Failure stops that order individually
 * — it never substitutes another SKU.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getProduct } from "@/lib/hubspot";
import { resolveNetsuiteItem } from "@/lib/netsuite/item-resolver";

// B, C and D all draw on the same two commercial leaves.
const REQUIRED = [
  { role: "Bottle", sku: "DPS-BOTTLE-0001", orders: "B, C, D" },
  { role: "Box   ", sku: "10064-GNX-Box", orders: "B, C, D" },
];

let allEligible = true;
for (const r of REQUIRED) {
  console.log(`\n── ${r.role} · ${r.sku}   (orders ${r.orders})`);
  const [leaf] = (await db.execute(sql`
    SELECT id, sku, name, hubspot_product_id, archived FROM leaves WHERE sku = ${r.sku}`)) as any[];
  if (!leaf) { console.log(`  1 · Nexus leaf : NOT FOUND`); allEligible = false; continue; }
  console.log(`  0 · Nexus leaf : ${String(leaf.id).slice(0, 8)} active=${!leaf.archived}`);

  // 1 · governed HubSpot authority exists
  let hs: any = null;
  try { hs = leaf.hubspot_product_id ? await getProduct(String(leaf.hubspot_product_id)) : null; } catch { /* null */ }
  const authorityOk = !!hs;
  console.log(`  1 · HubSpot ${leaf.hubspot_product_id ?? "(none)"} : ${authorityOk ? "EXISTS" : "MISSING"}`);

  // 2 · Nexus identity agrees with that authority
  const agrees = authorityOk && String(hs.sku ?? "").trim() === String(leaf.sku).trim();
  console.log(`  2 · identity agrees : ${agrees ? `YES ("${hs.sku}")` : `NO (hubspot="${hs?.sku ?? "-"}" vs nexus="${leaf.sku}")`}`);

  // 3 · exactly one eligible NetSuite Item
  const res: any = await resolveNetsuiteItem(r.sku);
  const unique = res.status === "found";
  console.log(`  3 · NetSuite resolve: ${res.status}${unique ? ` id=${res.netsuiteItemId} type=${res.itemtype}` : ""}`);

  const eligible = authorityOk && agrees && unique;
  if (!eligible) allEligible = false;
  console.log(`  ELIGIBLE: ${eligible ? "YES ✓" : "NO ✗"}`);
}

console.log(`\n══ VERDICT ══`);
console.log(allEligible
  ? `  All B/C/D commercial leaves are downstream-eligible. B may proceed.`
  : `  At least one leaf is INELIGIBLE. Stop that order. Do NOT substitute.`);
process.exit(allEligible ? 0 : 1);
