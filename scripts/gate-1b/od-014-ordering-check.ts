/**
 * C-2 pre-flight — read-only. The population query orders by
 * (assembly_id, position) with no tiebreaker. Before moving the population
 * source to quote_leaves, prove that key is already unique; otherwise today's
 * order is nondeterministic and the S-7 baseline holds by luck rather than by
 * construction.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

const ties = (await db.execute(sql`
  select quote_id::text as quote_id,
         coalesce(assembly_id::text, '(direct)') as assembly_id,
         position::text as position,
         count(*)::text as n
    from quote_leaves
   group by quote_id, assembly_id, position
  having count(*) > 1
   order by count(*) desc
   limit 20
`)) as unknown as { quote_id: string; assembly_id: string; position: string; n: string }[];

console.log(`\n=== (assembly_id, position) ties within a quote ===`);
console.log(`  ${ties.length === 0 ? "none — the ordering key is unique" : `${ties.length} tie group(s)`}`);
for (const t of ties) {
  console.log(`  quote ${t.quote_id.slice(0, 8)}  assembly ${t.assembly_id.slice(0, 8)}  position ${t.position}  x${t.n}`);
}

// Parity between the canonical row and its legacy compatibility row on every
// field the identity module asserts. A drifting pair would make the population
// swap change ordering or quantity.
const drift = (await db.execute(sql`
  select count(*)::text as n
    from quote_leaves ql
    join assembly_leaves al on al.quote_leaf_id = ql.id
   where al.assembly_id is distinct from ql.assembly_id
      or al.leaf_id     is distinct from ql.leaf_id
      or al.position    is distinct from ql.position
      or al.quantity::numeric is distinct from ql.quantity::numeric
`)) as unknown as { n: string }[];
console.log(`\n=== canonical/legacy parity drift ===\n  ${drift[0].n} drifting pair(s)`);

// Canonical rows with no legacy row, and legacy rows with no canonical row.
const orphans = (await db.execute(sql`
  select
    (select count(*) from quote_leaves ql
      where not exists (select 1 from assembly_leaves al where al.quote_leaf_id = ql.id))::text as canonical_without_legacy,
    (select count(*) from assembly_leaves al
      where al.quote_leaf_id is null
         or not exists (select 1 from quote_leaves ql where ql.id = al.quote_leaf_id))::text as legacy_without_canonical
`)) as unknown as { canonical_without_legacy: string; legacy_without_canonical: string }[];
console.log(`\n=== orphans ===`);
console.log(`  canonical without legacy  ${orphans[0].canonical_without_legacy}`);
console.log(`  legacy without canonical  ${orphans[0].legacy_without_canonical}`);

process.exit(0);
