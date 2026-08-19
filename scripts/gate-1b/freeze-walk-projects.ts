/** READ-ONLY. Which projects are synthetic/validation vs real client work —
 *  so the #300 lifecycle send lands somewhere isolated. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
const rows = <T,>(r: unknown) => r as unknown as T[];
const p = rows<{ id: string; deal: string; client: string | null; hs: string | null; quotes: number; drafts: number }>(
  await db.execute(sql`
    select p.id::text, p.deal_name as deal, p.client_name as client,
           p.hubspot_deal_id as hs,
           (select count(*)::int from quotes q where q.project_id=p.id) as quotes,
           (select count(*)::int from quotes q where q.project_id=p.id and q.status='draft') as drafts
      from projects p order by p.deal_name`));
console.log("\nproject                                           hubspot_deal   quotes drafts  client");
for (const r of p)
  console.log(`${r.deal.slice(0,48).padEnd(48)}  ${(r.hs ?? "— none —").padEnd(13)} ${String(r.quotes).padStart(5)} ${String(r.drafts).padStart(6)}  ${r.client ?? "—"}`);
console.log("\nproject ids:");
for (const r of p) console.log(`  ${r.id}  ${r.deal}`);
process.exit(0);
