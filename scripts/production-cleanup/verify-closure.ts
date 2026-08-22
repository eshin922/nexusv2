/**
 * Production cleanup — closure proofs. READ ONLY.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
const q = async (l: string, s: string) =>
  console.log(l + " " + JSON.stringify(await db.execute(sql.raw(s))));

// Stored values must be untouched by a UI-only change.
await q("ALLOC_DISTRIBUTION", "SELECT allocate_service_fees_to_cost, count(*)::int n FROM assembly_production_inputs GROUP BY 1 ORDER BY 1");
await q("ALLOC_QUOTES_OFF", `SELECT q.status, count(DISTINCT q.id)::int n
  FROM quotes q JOIN assemblies a ON a.quote_id=q.id
  JOIN assembly_production_inputs api ON api.assembly_id=a.id
  WHERE NOT api.allocate_service_fees_to_cost GROUP BY 1 ORDER BY 1`);
// The dormant column: still present, still uniformly false.
await q("CSR_COLUMN", "SELECT customer_ships_raws, count(*)::int n FROM assembly_production_inputs GROUP BY 1");
await q("BULK_RAW_UNCHANGED", `SELECT count(*) FILTER (WHERE bulk_raw_cost IS NOT NULL AND bulk_raw_cost <> 0)::int nonzero,
  count(*)::int total FROM assembly_production_inputs`);
// raws_mode untouched, per scope.
await q("RAWS_MODE", "SELECT raws_mode, count(*)::int n FROM bulk_raw_section_meta GROUP BY 1");
process.exit(0);
