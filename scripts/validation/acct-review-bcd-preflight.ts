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
let indeterminate = false;
for (const r of REQUIRED) {
  console.log(`\n── ${r.role} · ${r.sku}   (orders ${r.orders})`);
  const [leaf] = (await db.execute(sql`
    SELECT id, sku, name, hubspot_product_id, archived FROM leaves WHERE sku = ${r.sku}`)) as any[];
  if (!leaf) { console.log(`  1 · Nexus leaf : NOT FOUND`); allEligible = false; continue; }
  console.log(`  0 · Nexus leaf : ${String(leaf.id).slice(0, 8)} active=${!leaf.archived}`);

  // 1 · governed HubSpot authority.
  //
  // THREE outcomes, not two. A wrapper that catches errors and returns
  // "missing" CANNOT establish nonexistence — it reports the same value for
  // "deleted" and "the API call failed". Conflating them is how a transient
  // failure becomes a false ineligibility verdict, so a read failure is
  // INDETERMINATE and aborts rather than counting as absence.
  let hs: any = null;
  let authority: "exists" | "not_found" | "read_failed" = "not_found";
  if (!leaf.hubspot_product_id) {
    authority = "not_found";
  } else {
    try {
      hs = await getProduct(String(leaf.hubspot_product_id));
      authority = hs ? "exists" : "not_found"; // authoritative null
    } catch (e) {
      authority = "read_failed";
      console.log(`  1 · HubSpot read THREW: ${(e as Error).message.slice(0, 140)}`);
    }
  }
  if (authority === "read_failed") {
    console.log(`  1 · HubSpot ${leaf.hubspot_product_id} : INDETERMINATE — not a verdict.`);
    console.log(`  ELIGIBLE: UNKNOWN — re-run. Absence was NOT concluded from a failed read.`);
    allEligible = false;
    indeterminate = true;
    continue;
  }
  const authorityOk = authority === "exists";
  console.log(`  1 · HubSpot ${leaf.hubspot_product_id ?? "(none)"} : ${authorityOk ? "EXISTS" : "NOT_FOUND (authoritative null)"}`);

  // 2 · Nexus identity agrees with that authority
  const agrees = authorityOk && String(hs.sku ?? "").trim() === String(leaf.sku).trim();
  console.log(`  2 · identity agrees : ${agrees ? `YES ("${hs.sku}")` : `NO (hubspot="${hs?.sku ?? "-"}" vs nexus="${leaf.sku}")`}`);

  // 3 · exactly one eligible NetSuite Item
  const res: any = await resolveNetsuiteItem(r.sku);
  const unique = res.status === "found";
  console.log(`  3 · NetSuite resolve: ${res.status}${unique ? ` id=${res.netsuiteItemId} type=${res.itemtype}` : ""}`);

  // OD-027 disposition (2026-08-12). HubSpot deletion alone is NOT product
  // retirement — Nexus cannot distinguish retirement from CRM cleanup, and
  // blocking on it would stop core products for an upstream filing decision.
  //
  //   HEALTHY  authority exists + identity agrees + unique resolution
  //   STATE B  authority gone BUT historical provenance retained
  //            + unique active resolution  → usable, VISIBLY DEGRADED
  //   BLOCKED  no unique resolution (State C / D), or no provenance at all
  //
  // Unique downstream resolution is the load-bearing condition; the HubSpot
  // record's current existence is not.
  const provenanceRetained = !!leaf.hubspot_product_id;
  let state: "HEALTHY" | "STATE_B_DEGRADED" | "BLOCKED";
  if (unique && authorityOk && agrees) state = "HEALTHY";
  else if (unique && provenanceRetained) state = "STATE_B_DEGRADED";
  else state = "BLOCKED";

  const eligible = state !== "BLOCKED";
  if (!eligible) allEligible = false;
  console.log(`  STATE   : ${state}`);
  console.log(`  ELIGIBLE: ${eligible ? (state === "HEALTHY" ? "YES ✓" : "YES — but DEGRADED, must not display as healthy ⚠") : "NO ✗"}`);
}

console.log(`\n══ VERDICT ══`);
console.log(
  indeterminate
    ? `  INDETERMINATE — a HubSpot read failed. No eligibility verdict issued.`
    : allEligible
      ? `  All B/C/D commercial leaves are downstream-eligible.`
      : `  At least one leaf is INELIGIBLE. Stop that order. Do NOT substitute.`,
);
process.exit(indeterminate ? 3 : allEligible ? 0 : 1);
