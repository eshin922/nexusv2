/**
 * OD-014 evidence — read-only. Counts the candidate SKU populations in
 * production so the identity decision rests on what the data actually is.
 *
 * Reads nothing but counts. No writes, no fixtures, no mutation.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = (await db.execute(sql`
  select
    (select count(*) from quote_leaves)                                as quote_leaves_total,
    (select count(*) from quote_leaves where assembly_id is null)      as quote_leaves_direct,
    (select count(*) from quote_leaves where assembly_id is not null)  as quote_leaves_grouped,
    (select count(*) from assembly_leaves)                             as assembly_leaves_total,
    (select count(*) from assemblies)                                  as assemblies_total,
    (select count(*) from leaves)                                      as library_leaves_total
`)) as unknown as Record<string, string>[];
console.log("\n=== population counts ===");
for (const [k, v] of Object.entries(rows[0])) console.log(`  ${k.padEnd(24)} ${v}`);

// Is the library leaf reusable within a single quote? If so, leaf_id cannot be
// the commercial identity — the same library component attached twice is two
// commercial lines.
const dupes = (await db.execute(sql`
  select quote_id, leaf_id, count(*)::text as n
    from quote_leaves
   group by quote_id, leaf_id
  having count(*) > 1
   order by count(*) desc
   limit 10
`)) as unknown as { quote_id: string; leaf_id: string; n: string }[];
console.log(`\n=== same library leaf attached more than once in one quote ===`);
console.log(`  ${dupes.length === 0 ? "none" : `${dupes.length} case(s)`}`);
for (const d of dupes) console.log(`  quote ${d.quote_id.slice(0, 8)} leaf ${d.leaf_id.slice(0, 8)} x${d.n}`);

// Quantity spread. If every attachment carries the same quantity, a weighted
// and an unweighted mean agree and no fixture built on production shape can
// tell them apart.
const qty = (await db.execute(sql`
  select quantity::text as q, count(*)::text as n
    from quote_leaves
   group by quantity
   order by count(*) desc
   limit 10
`)) as unknown as { q: string; n: string }[];
console.log("\n=== attachment quantity distribution ===");
for (const r of qty) console.log(`  quantity ${r.q.padEnd(10)} ${r.n} attachment(s)`);

// How many priced leaves sit under one assembly? This is the size of the
// divergence between the two candidate populations.
const fan = (await db.execute(sql`
  select n::text as leaves_per_assembly, count(*)::text as assemblies
    from (select assembly_id, count(*) as n from quote_leaves
           where assembly_id is not null group by assembly_id) t
   group by n order by n
`)) as unknown as { leaves_per_assembly: string; assemblies: string }[];
console.log("\n=== leaves per assembly ===");
for (const r of fan) console.log(`  ${r.leaves_per_assembly} leaf/leaves -> ${r.assemblies} assembly(ies)`);

process.exit(0);
