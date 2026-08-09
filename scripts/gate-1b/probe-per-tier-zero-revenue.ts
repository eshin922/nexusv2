/**
 * Per-tier zero-revenue margin — pre-flight. READ ONLY.
 *
 * The quote-wide correction is done; this measures its per-tier twin before
 * repeating the shape, because the population is NOT simply "the eight quotes
 * again" and the blast radius has to be known before the S-7 proof is written.
 *
 * Questions:
 *
 *   1. How many tiers report zero revenue, in how many quotes, and how many of
 *      those quotes are otherwise revenue-bearing? The last number is the one
 *      that separates this from the quote-wide move.
 *   2. Does zero revenue coincide with zero QUANTITY? The Costs header already
 *      treats zero-qty tiers as unavailable, so if the two populations are the
 *      same set, this correction is making the engine agree with something the
 *      UI already believes. If they differ, there is a second case (priced-at-
 *      zero tiers with real quantity) that needs its own answer.
 *   3. What verdict do they carry today, and does the per-tier suggested
 *      adjustment already suppress? (`suggestedAdj` guards `revenue <= 0`, so
 *      the expectation is null — worth confirming rather than assuming, since
 *      a moving suggestion would widen the S-7 diff beyond two fields.)
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

type Row = {
  quote: string;
  tier: string;
  qty: number;
  cost: number;
  status: string;
  margin: number | null;
  suggested: number | null;
  quoteHasRevenue: boolean;
};

const zeroTiers: Row[] = [];
const movedQuotes = new Set<string>();
const movedRevenueBearing = new Set<string>();
let totalTiers = 0;
let zeroQty = 0;
let qtyButNoRevenue = 0;
let suggestionNonNull = 0;
let statusNotBelowFloor = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    console.error(`  ERR ${q.quote_id.slice(0, 8)} ${res.error.code}`);
    continue;
  }
  const c = res.data.costing;
  const where = q.quote_id.slice(0, 8);
  const quoteHasRevenue = c.quoteSummary.blendedRevenue > 0;

  for (const t of c.quoteRollup) {
    totalTiers += 1;
    if (t.totalRevenue !== 0) continue;

    zeroTiers.push({
      quote: where,
      tier: t.label,
      qty: t.qty,
      cost: t.totalCost,
      status: t.blendedMarginStatus,
      margin: t.blendedMarginPct,
      suggested: t.suggestedGlobalAdjPct,
      quoteHasRevenue,
    });
    movedQuotes.add(where);
    if (quoteHasRevenue) movedRevenueBearing.add(where);
    if (t.qty === 0) zeroQty += 1;
    else qtyButNoRevenue += 1;
    if (t.suggestedGlobalAdjPct !== null) suggestionNonNull += 1;
    if (t.blendedMarginStatus !== "BELOW_FLOOR") statusNotBelowFloor += 1;
  }
}

console.log(`\n  tiers, all quotes                        ${totalTiers}`);
console.log(`  tiers with zero revenue                  ${zeroTiers.length}`);
console.log(`  quotes containing at least one           ${movedQuotes.size}`);
console.log(
  `  ...of which are REVENUE-BEARING          ${movedRevenueBearing.size}` +
    `  <- the difference from the quote-wide move`,
);
console.log(`\n  zero revenue AND zero quantity           ${zeroQty}`);
console.log(
  `  zero revenue WITH quantity               ${qtyButNoRevenue}` +
    `  <- priced at zero, not merely unquantified`,
);
console.log(`\n  carrying a non-null suggested adj        ${suggestionNonNull}`);
console.log(`  carrying a status other than BELOW_FLOOR ${statusNotBelowFloor}`);

console.log(`\n  Zero-revenue tiers inside revenue-bearing quotes:`);
for (const r of zeroTiers.filter((r) => r.quoteHasRevenue)) {
  console.log(
    `    ${r.quote}  "${r.tier}"  qty=${r.qty}  cost=${r.cost}  ` +
      `margin=${r.margin}  status=${r.status}  sugg=${r.suggested}`,
  );
}

// The sub-case that decides whether one contract covers both: zero revenue
// with a POSITIVE cost is not "nothing entered yet" — it is a certain loss.
const costly = zeroTiers.filter((r) => r.cost > 0);
console.log(
  `\n  zero revenue WITH positive cost          ${costly.length}` +
    `  <- a certain loss, not an unpriced tier`,
);
for (const r of costly) {
  console.log(
    `    ${r.quote}  "${r.tier}"  qty=${r.qty}  cost=${r.cost}  ` +
      `quoteHasRevenue=${r.quoteHasRevenue}`,
  );
}

console.log(`\n  Quotes that would move (${movedQuotes.size}):`);
console.log(`    ${[...movedQuotes].sort().join("  ")}\n`);
process.exit(0);
