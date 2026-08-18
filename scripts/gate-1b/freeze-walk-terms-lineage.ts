/** READ-ONLY. Which projects can pass the SEND terms gate, decided from the
 *  LOCAL cache only — the deal -> company -> NetSuite-customer lineage.
 *
 *  Deliberately stops before the NetSuite read. That read fails in this
 *  headless harness for an unrelated reason (a Clerk ESM import), and a failed
 *  read is not evidence of absence (OD-027). What IS decidable locally is
 *  whether the lineage exists at all — and `no_company` is returned before
 *  NetSuite is ever contacted. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
const rows = <T,>(r: unknown) => r as unknown as T[];
const p = rows<{ deal_name: string; hs: string | null; company: string | null; company_name: string | null; ns: string | null; drafts: number }>(
  await db.execute(sql`
    select p.deal_name, p.hubspot_deal_id as hs,
           c.associated_company_id as company,
           c.associated_company_name as company_name,
           comp.netsuite_customer_id as ns,
           (select count(*)::int from quotes q where q.project_id=p.id and q.status='draft') as drafts
      from projects p
      left join hubspot_deals_cache c on c.deal_id = p.hubspot_deal_id
      left join netsuite_customer_map comp on comp.hubspot_company_id = c.associated_company_id
     order by (comp.netsuite_customer_id is null), p.deal_name`));
console.log("\n  gate  drafts  project                                       company -> netsuite customer");
for (const r of p) {
  const gate = !r.hs ? "no-deal" : !r.company ? "NO-COMPANY" : !r.ns ? "no-nscust" : "lineage-ok";
  console.log(`  ${gate.padEnd(11)} ${String(r.drafts).padStart(3)}  ${r.deal_name.slice(0,44).padEnd(44)} ${r.company_name ?? "—"} -> ${r.ns ?? "—"}`);
}
process.exit(0);
