/** READ-ONLY. Which BV-011 destinations does V1 actually REACH today?
 *
 *  The mapping surface should be scoped to inputs the population produces, not
 *  to all sixteen destinations — an admin asked to map destinations no quote
 *  can currently generate is being asked to guess. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
const rows = <T,>(r: unknown) => r as unknown as T[];

console.log("\n── service identities attached to quotes ──");
const svc = rows<{ id: string; quotes: number; nondraft: number }>(await db.execute(sql`
  select l.service_identity::text as id,
         count(distinct ql.quote_id)::int as quotes,
         count(distinct ql.quote_id) filter (where q.status <> 'draft')::int as nondraft
    from quote_leaves ql
    join leaves l on l.id = ql.leaf_id
    join quotes q on q.id = ql.quote_id
   where ql.commercial_kind = 'service'
   group by 1 order by 1`));
if (svc.length === 0) console.log("  none");
for (const r of svc) console.log(`  ${r.id.padEnd(20)} ${String(r.quotes).padStart(3)} quote(s), ${r.nondraft} non-draft`);

console.log("\n── OTC fee columns carrying a value (any allocation) ──");
const cols = [
  ["setup_fee_total", "Setup"],
  ["tooling_artwork_total", "Tooling / Artwork"],
  ["rd_total", "R&D / Formulation"],
  ["other_service_total", "Other Service"],
  ["testing_micros_total", "Testing / Micros"],
  ["filling_blending_cost", "Filling / Blending"],
  ["cm_assembly_total", "CM Assembly / Pack-out"],
  ["bulk_raw_cost", "Bulk Raw"],
] as const;
for (const [col, label] of cols) {
  const [r] = rows<{ any: number; billed: number }>(await db.execute(sql`
    select count(*) filter (where ${sql.raw(col)} is not null and ${sql.raw(col)} > 0)::int as any,
           count(*) filter (where ${sql.raw(col)} is not null and ${sql.raw(col)} > 0
                              and allocate_service_fees_to_cost = false)::int as billed
      from assembly_production_inputs`));
  console.log(`  ${label.padEnd(24)} ${String(r.any).padStart(4)} row(s) with a value · ${String(r.billed).padStart(4)} separately billed`);
}

console.log("\n── the existing service-identity map ──");
const m = rows<{ id: string; code: string | null; ns: string | null }>(await db.execute(sql`
  select service_identity::text as id, netsuite_item_code as code, netsuite_internal_id as ns
    from netsuite_service_item_map order by 1`));
for (const r of m) console.log(`  ${r.id.padEnd(20)} ${(r.code ?? "—").padEnd(16)} ns=${r.ns ?? "—"}`);
process.exit(0);
