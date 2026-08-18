/** READ-ONLY. Scenario shapes inside one project, for picking a walk target. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
const rows = <T,>(r: unknown) => r as unknown as T[];
const projectId = process.argv[2];
const q = rows<{ id: string; label: string; status: string; v: number; tiers: number;
  asy: number; members: number; direct: number; svc: number; prod: number; off: number; pkg: number }>(
  await db.execute(sql`
    select q.id::text, coalesce(q.scenario_label,'—') as label, q.status::text as status,
           q.version_number as v,
           (select count(*)::int from quote_tiers t where t.quote_id=q.id) as tiers,
           (select count(*)::int from assemblies a where a.quote_id=q.id) as asy,
           (select count(*)::int from quote_leaves ql join assembly_leaves al on al.quote_leaf_id=ql.id
             where ql.quote_id=q.id) as members,
           (select count(*)::int from quote_leaves ql left join assembly_leaves al on al.quote_leaf_id=ql.id
             where ql.quote_id=q.id and al.id is null and ql.commercial_kind='product') as direct,
           (select count(*)::int from quote_leaves ql
             where ql.quote_id=q.id and ql.commercial_kind='service') as svc,
           (select count(*)::int from assembly_production_inputs api join quote_tiers t on t.id=api.tier_id
             where t.quote_id=q.id) as prod,
           (select count(*)::int from assembly_production_inputs api join quote_tiers t on t.id=api.tier_id
             where t.quote_id=q.id and api.allocate_service_fees_to_cost=false) as off,
           (select count(*)::int from assembly_leaf_inputs ali join quote_tiers t on t.id=ali.tier_id
             where t.quote_id=q.id) as pkg
      from quotes q where q.project_id=${projectId}::uuid order by q.scenario_label`));
console.log("\nquote                                  status  v  tiers ASY memb dirP svc prod off  pkg  label");
for (const r of q)
  console.log(`${r.id}  ${r.status.padEnd(6)} ${r.v}  ${String(r.tiers).padStart(5)} ${String(r.asy).padStart(3)} ${String(r.members).padStart(4)} ${String(r.direct).padStart(4)} ${String(r.svc).padStart(3)} ${String(r.prod).padStart(4)} ${String(r.off).padStart(3)} ${String(r.pkg).padStart(4)}  ${r.label}`);
process.exit(0);
