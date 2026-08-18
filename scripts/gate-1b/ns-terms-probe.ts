/** READ-ONLY. Which Terms do the firm's customers actually carry, and what is
 *  that Terms record called?
 *
 *  `term` is not a queryable SuiteQL record, and `GROUP BY ... ORDER BY
 *  COUNT(*)` 500s. So: tally the ids from `customer` in JS, then read one
 *  customer through the REST record API — the SAME path `readCustomerTerms`
 *  uses — to learn the refName rather than assuming what an id means. */
import { suiteQL, getRecord } from "@/lib/netsuite/client";

const { items: used } = await suiteQL<{ terms: string }>(
  `SELECT terms FROM customer WHERE terms IS NOT NULL`, { limit: 1000 });
const tally = new Map<string, number>();
for (const r of used) tally.set(String(r.terms), (tally.get(String(r.terms)) ?? 0) + 1);
const ranked = [...tally].sort((a, b) => b[1] - a[1]);
console.log(`\nterms ids across ${used.length} sampled customers:`);
for (const [id, n] of ranked.slice(0, 8)) console.log(`  terms=${id.padStart(4)}  ${String(n).padStart(4)} customers`);

for (const [id] of ranked.slice(0, 3)) {
  const { items: one } = await suiteQL<{ id: string }>(
    `SELECT id FROM customer WHERE terms = ${Number(id)}`, { limit: 1 });
  if (!one[0]) continue;
  const rec = await getRecord<{ terms?: { id?: string; refName?: string } }>("customer", String(one[0].id));
  console.log(`  terms=${id.padStart(4)} -> refName "${rec.terms?.refName ?? "—"}" (via customer ${one[0].id})`);
}
process.exit(0);
