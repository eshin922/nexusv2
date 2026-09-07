/**
 * What the Sales Order preview loader actually says about a quote, right now.
 *
 * READ-ONLY, and specifically NOT a push: `loadSalesOrderPreview` performs
 * NetSuite READS (SKU resolution, customer map) and never calls
 * `findOrCreateItemGroup`. Opening a preview must not write to NetSuite.
 *
 * Prints the mapping state alongside, because a blocker that says "no governed
 * destination" and a blocker that says "no NetSuite item mapped" are different
 * problems and reading one for the other sends a person to the wrong screen.
 *
 * Usage:  o3-preview-trace.ts <quoteNumber>
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

import { loadSalesOrderPreview } from "@/lib/netsuite/planned-sales-order-preview";

const quoteNumber = process.argv[2] ?? "DPS-1074";

const [quote] = (await db.execute(sql`
  SELECT id, quote_number, status FROM quotes WHERE quote_number = ${quoteNumber}
`)) as unknown as Array<{ id: string; quote_number: string; status: string }>;

if (!quote) {
  console.log(`UNRESOLVED · no quote numbered ${quoteNumber}`);
  process.exit(2);
}

const maps = (await db.execute(sql`
  SELECT destination::text AS destination,
         netsuite_item_code     AS code,
         netsuite_internal_id::text AS internal_id
    FROM netsuite_destination_item_map
   WHERE destination::text IN ('otc_mould', 'otc_print_plates', 'otc_tooling', 'otc_dies', 'otc_samples')
   ORDER BY destination::text
`)) as unknown as Array<Record<string, string>>;

console.log(`QUOTE ${quote.quote_number} · ${quote.status}`);
console.log("");
console.log("DESTINATION MAPPINGS");
for (const d of ["otc_mould", "otc_print_plates", "otc_tooling", "otc_dies", "otc_samples"]) {
  const m = maps.find((r) => r.destination === d);
  console.log(`  ${d.padEnd(18)} ${m ? `${String(m.code).padEnd(10)} internal ${m.internal_id}` : "UNMAPPED"}`);
}
console.log("");

const preview = await loadSalesOrderPreview(quote.id);
console.log(`PREVIEW · status=${preview.status}`);

if (preview.status !== "ok") {
  console.log(`  reason: ${JSON.stringify(preview.reason, null, 2).split("\n").join("\n  ")}`);
  process.exit(0);
}

console.log("");
console.log("PLANNED ROWS");
for (const r of preview.planned.rows) {
  if (r.role === "group") {
    console.log(`  GROUP      ${r.sku.padEnd(34)} qty ${String(r.quantity).padStart(7)}  ext ${r.externalId ?? "(none: " + (r.notDerivableReason ?? "?") + ")"}`);
  } else if (r.role === "member") {
    console.log(`    member   ${r.sku.padEnd(34)} qty ${String(r.quantity).padStart(7)}  = tier x ${r.qtyPerParent}  @ ${r.rate}`);
  } else if (r.role === "end_group") {
    console.log(`  ENDGROUP   ${r.assemblyId}`);
  } else {
    const l = r.line;
    console.log(`  ${r.role.toUpperCase().padEnd(10)} ${String(l.description).slice(0, 34).padEnd(34)} qty ${String(l.quantity).padStart(7)}  @ ${l.rate}  item ${l.netsuiteItemId}`);
  }
}
process.exit(0);
