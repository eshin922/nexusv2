/** READ-ONLY survey for the #300 lifecycle walk. Finds draft quotes with the
 *  shape the walk needs: an Item Group member, a Direct Service, and (ideally)
 *  tier-varying OTC. */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = <T,>(r: unknown) => r as unknown as T[];

const q = rows<{
  quote_id: string; project: string; label: string; tiers: number;
  ig_members: number; services: number; otc_rows: number; otc_off: number;
}>(await db.execute(sql`
  select q.id::text as quote_id, p.deal_name as project,
         coalesce(q.scenario_label,'—') as label,
         (select count(*)::int from quote_tiers t where t.quote_id = q.id) as tiers,
         (select count(*)::int from quote_leaves ql
           join assembly_leaves al on al.quote_leaf_id = ql.id
          where ql.quote_id = q.id) as ig_members,
         (select count(*)::int from quote_leaves ql
          where ql.quote_id = q.id and ql.commercial_kind = 'service') as services,
         (select count(*)::int from assemblies a
           join assembly_production_inputs api on api.assembly_id = a.id
          where a.quote_id = q.id) as otc_rows,
         (select count(*)::int from assemblies a
           join assembly_production_inputs api on api.assembly_id = a.id
          where a.quote_id = q.id and api.allocate_service_fees_to_cost = false) as otc_off
    from quotes q join projects p on p.id = q.project_id
   where q.status = 'draft'
   order by services desc, ig_members desc, tiers desc
   limit 12`));

console.log("\nquote_id                              tiers  IG  svc  prodRows  allocOFF  project / label");
for (const r of q) {
  console.log(
    `${r.quote_id}  ${String(r.tiers).padStart(5)} ${String(r.ig_members).padStart(3)} ${String(r.services).padStart(4)} ${String(r.otc_rows).padStart(9)} ${String(r.otc_off).padStart(9)}  ${r.project} / ${r.label}`,
  );
}
process.exit(0);
