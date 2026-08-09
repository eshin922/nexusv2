/**
 * Zero-revenue margin — measure the population before correcting it. READ ONLY.
 *
 * Two questions, and the second is the one that decides scope:
 *
 *   1. Which quotes have `blendedRevenue === 0`? Those are the quote-wide
 *      correction's blast radius, and the S-7 proof names them individually.
 *   2. Do zero-revenue TIERS occur inside revenue-bearing quotes? The per-tier
 *      rollup carries the identical `revenue > 0 ? … : 0` shape at
 *      `costing.ts:2819`. If such tiers exist, correcting per-tier in the same
 *      package would move quotes beyond the authorised eight, and the S-7
 *      proof could no longer say "exactly these, for this reason".
 *
 * Question 2 is asked before implementation deliberately. Discovering it
 * afterwards would present as an unexplained S-7 failure.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q
   where exists (select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id where a.quote_id = q.id)
   order by q.id
`)) as unknown as { quote_id: string }[];

const zeroRevenueQuotes: string[] = [];
const zeroTiersInRevenueQuotes: { quote: string; tier: string; status: string }[] = [];
let revenueBearing = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    console.error(`  ERR   ${q.quote_id.slice(0, 8)} ${res.error.code}`);
    continue;
  }
  const c = res.data.costing;
  const s = c.quoteSummary;
  const where = q.quote_id.slice(0, 8);

  if (s.blendedRevenue === 0) {
    zeroRevenueQuotes.push(where);
    console.log(
      `  rev=0   ${where}  margin=${s.blendedMarginPct}  status=${s.blendedMarginStatus}` +
        `  suggestedAdj=${s.suggestedAdj}  tiers=${c.quoteRollup.length}`,
    );
  } else {
    revenueBearing += 1;
    for (const t of c.quoteRollup) {
      if (t.totalRevenue === 0) {
        zeroTiersInRevenueQuotes.push({
          quote: where,
          tier: t.label,
          status: t.blendedMarginStatus,
        });
      }
    }
  }
}

console.log(`\n  quotes                              ${quotes.length}`);
console.log(`  zero blended revenue                ${zeroRevenueQuotes.length}`);
console.log(`  revenue-bearing                     ${revenueBearing}`);
console.log(
  `  zero-revenue TIERS inside those     ${zeroTiersInRevenueQuotes.length}`,
);

if (zeroTiersInRevenueQuotes.length) {
  console.log(
    `\n  Per-tier correction would move revenue-bearing quotes too:` +
      `\n  (out of scope for this package — recorded, not fixed)`,
  );
  for (const z of zeroTiersInRevenueQuotes.slice(0, 20)) {
    console.log(`    ${z.quote}  tier "${z.tier}"  status=${z.status}`);
  }
}

console.log(`\n  zero-revenue quote ids:\n    ${zeroRevenueQuotes.join("  ")}\n`);
process.exit(0);
