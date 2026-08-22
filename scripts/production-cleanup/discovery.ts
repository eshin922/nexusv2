import { db } from "@/db";
import { sql } from "drizzle-orm";
const q = async (l: string, s: string) => {
  try { console.log(l + " " + JSON.stringify(await db.execute(sql.raw(s)))); }
  catch (e) { console.log(l + " ERROR " + (e as Error).message.slice(0, 90)); }
};
// 1 · live enablement of customer_ships_raws
await q("CSR_LIVE", "SELECT customer_ships_raws, count(*)::int n FROM assembly_production_inputs GROUP BY 1");
await q("CSR_QUOTES", `SELECT count(DISTINCT a.quote_id)::int quotes FROM assembly_production_inputs api
   JOIN assemblies a ON a.id = api.assembly_id WHERE api.customer_ships_raws`);
// 2 · has it EVER been true? audit history
await q("CSR_AUDIT", `SELECT count(*)::int n FROM audit_log
   WHERE diff_json::text LIKE '%customer_ships_raws%'`);
// 3 · frozen snapshots — does a sent/accepted quote carry it?
await q("SNAPSHOT_TABLES", `SELECT table_name FROM information_schema.columns
   WHERE column_name = 'customer_ships_raws' ORDER BY table_name`);
// 4 · allocate_service_fees_to_cost live distribution
await q("ALLOC_LIVE", "SELECT allocate_service_fees_to_cost, count(*)::int n FROM assembly_production_inputs GROUP BY 1");
await q("ALLOC_QUOTES", `SELECT count(DISTINCT a.quote_id)::int quotes FROM assembly_production_inputs api
   JOIN assemblies a ON a.id = api.assembly_id WHERE NOT api.allocate_service_fees_to_cost`);
// 5 · does bulk_raw_cost carry values that the flag would have hidden?
await q("BULK_RAW", `SELECT count(*) FILTER (WHERE bulk_raw_cost IS NOT NULL AND bulk_raw_cost <> 0)::int nonzero,
   count(*)::int total FROM assembly_production_inputs`);
process.exit(0);
