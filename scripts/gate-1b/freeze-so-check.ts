/** READ-ONLY. Confirms this slice emitted no Sales Order, and shows the audit
 *  trail the certification send actually wrote. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
const rows = <T,>(r: unknown) => r as unknown as T[];
const id = process.argv[2];

const [q] = rows<Record<string, unknown>>(await db.execute(sql`
  select quote_number, status::text as st, netsuite_so_id as so,
         netsuite_so_tranid as tranid, netsuite_so_push_status::text as push,
         sent_at::text as sent_at
    from quotes where id = ${id}::uuid`));
console.log("\nQUOTE");
for (const [k, v] of Object.entries(q)) console.log(`  ${k.padEnd(10)} ${v ?? "—"}`);

const a = rows<{ action: string; n: number }>(await db.execute(sql`
  select action, count(*)::int as n from audit_log
   where entity_id = ${id} group by action order by action`));
console.log("\nAUDIT for this quote");
for (const r of a) console.log(`  ${r.action.padEnd(30)} ${r.n}`);

const [so] = rows<{ n: number }>(await db.execute(sql`
  select count(*)::int as n from quotes where netsuite_so_id is not null`));
console.log(`\nquotes carrying a NetSuite SO id, whole population: ${so[0 as never] ?? so.n}`);
console.log(q.so === null
  ? "NO SALES ORDER — this slice emitted none, as required.\n"
  : "A SALES ORDER EXISTS ON THIS QUOTE — investigate.\n");
process.exit(0);
