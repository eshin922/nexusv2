// Reconcile leaves.hubspot_product_type against the HubSpot inventory.
// Disposable — deleted at the end of the walk.
import { db } from "@/db";
import { sql } from "drizzle-orm";

const label = process.argv[2] ?? "";
console.log(`===== ${label} =====`);

const [t] = (await db.execute(sql`
  SELECT count(*)::int AS all_leaves,
         count(hubspot_product_id)::int AS linked,
         count(hubspot_product_type)::int AS typed,
         count(product_type_id)::int AS nexus_typed,
         count(DISTINCT hubspot_product_type)::int AS distinct_types
  FROM leaves
`)) as unknown as Array<Record<string, number>>;
console.log("totals:", t);

const rows = (await db.execute(sql`
  SELECT COALESCE(hubspot_product_type, '<<NULL>>') AS v, count(*)::int AS n
  FROM leaves GROUP BY 1 ORDER BY n DESC
`)) as unknown as Array<{ v: string; n: number }>;
console.log("\nby source type:");
for (const r of rows) console.log(String(r.n).padStart(5), `«${r.v}»`);

// A display label persisted in the value column is the failure this slice
// exists to prevent. Zero is the only passing answer.
const labels = (await db.execute(sql`
  SELECT hubspot_product_type AS v, count(*)::int AS n FROM leaves
  WHERE hubspot_product_type IN ('Primary Packaging','Secondary Packaging','Logistics')
  GROUP BY 1
`)) as unknown as Array<{ v: string; n: number }>;
console.log("\nLABELS PERSISTED AS VALUES (must be empty):", labels.length ? labels : "none");

// Controls, traced by HubSpot id — chosen from the divergent options so this
// proves internal-value handling rather than label matching.
const controls = (await db.execute(sql`
  SELECT hubspot_product_id AS id, sku, hubspot_product_type AS hs, product_type_id AS nexus
  FROM leaves
  WHERE hubspot_product_id IN ('2008191375','1833843360','2008191385','2023909451','45055026846','44365128085','2556946721')
  ORDER BY hubspot_product_id
`)) as unknown as Array<Record<string, string | null>>;
console.log("\ncontrols:");
for (const c of controls)
  console.log(`  ${c.id}  ${String(c.sku ?? "-").padEnd(16)} hs=«${c.hs ?? "NULL"}»  nexus=${c.nexus ?? "null"}`);

process.exit(0);
