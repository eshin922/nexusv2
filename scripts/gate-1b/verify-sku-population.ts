/**
 * OD-014 / C-2 — representation check. Read-only.
 *
 * S-7 proves the 24 baseline quotes produce byte-identical commercial scalars.
 * It does NOT prove that every canonical attachment in the database reaches the
 * engine, because a quote outside the baseline could lose a SKU silently.
 *
 * This walks every quote that has at least one canonical attachment and asserts
 * that the engine's leaf population equals the canonical attachment set exactly
 * — by identity, not by count. A count check would pass if one attachment were
 * dropped and another duplicated.
 *
 * It compares through the id the engine EMITS, which is the legacy
 * `assembly_leaf_id` where one exists and the `quote_leaf_id` otherwise — the
 * same coalesce the adapter applies. Comparing on `canonicalQuoteLeafId`
 * directly is not possible today: that field is carried on the engine's INPUT
 * (`CostingSku`) and is never copied onto its OUTPUT (`SkuRollup`).
 *
 * That gap is a sequencing fact for Gate 1B increment 7, which needs
 * `quote_leaf_id` as contributor identity. Surfacing it on the rollup is an
 * additive change to the S-7 payload and will legitimately move the digest, so
 * it must be classified as such before any re-baseline rather than discovered
 * as a surprise failure.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id,
         count(ql.id)::text as attachments
    from quotes q
    join quote_leaves ql on ql.quote_id = q.id
   group by q.id
   order by q.id
`)) as unknown as { quote_id: string; attachments: string }[];

let checked = 0;
let totalAttachments = 0;
const failures: string[] = [];

for (const q of quotes) {
  // One row per canonical attachment, carrying the id the engine should emit.
  const expected = (await db.execute(sql`
    select coalesce(al.id::text, ql.id::text) as id
      from quote_leaves ql
      left join assembly_leaves al on al.quote_leaf_id = ql.id
     where ql.quote_id = ${q.quote_id}
     order by 1
  `)) as unknown as { id: string }[];

  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    failures.push(`${q.quote_id}  bundle error ${res.error.code}`);
    continue;
  }

  const actual = res.data.costing.skuRollups
    .filter((r) => r.skuRole === "leaf")
    .map((r) => r.skuId)
    .sort();

  const want = expected.map((e) => e.id).sort();
  checked += 1;
  totalAttachments += want.length;

  if (actual.length !== want.length || actual.some((v, i) => v !== want[i])) {
    const missing = want.filter((w) => !actual.includes(w));
    const extra = actual.filter((a) => !want.includes(a));
    failures.push(
      `${q.quote_id}  expected ${want.length} got ${actual.length}` +
        (missing.length ? `  missing ${missing.length}` : "") +
        (extra.length ? `  extra ${extra.length}` : ""),
    );
  }
}

console.log(`\n  quotes checked        ${checked}`);
console.log(`  attachments verified  ${totalAttachments}`);
if (failures.length === 0) {
  console.log(`  ok    every canonical attachment is represented, by identity\n`);
  process.exit(0);
}
console.log(`\n  FAIL  ${failures.length} quote(s):`);
for (const f of failures) console.log(`    ${f}`);
process.exit(1);
