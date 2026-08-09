/**
 * Cell-level zero-revenue margin — pre-flight. READ ONLY.
 *
 * Third instance of the same shape, and the one with the widest surface: a
 * cell is per (SKU x tier), so the population is larger than the tier count by
 * roughly the SKU count.
 *
 * Two questions decide the S-7 proof:
 *
 *   1. How many CELLS report zero revenue, across how many quotes? Those quote
 *      ids are what the classified proof pins.
 *   2. How many carry cost with no revenue — the `COST_WITHOUT_REVENUE` case?
 *      At tier scope it was zero, which left the state defined but unexercised.
 *      A cell can reach it where a tier could not: a per-cell override of 0 on
 *      a costed line drives sell to nothing while cost stands.
 *
 * Also counted: cells the classifier adapter currently calls "missing" via its
 * local `isMissing` heuristic, so the correction can be checked against the
 * heuristic it replaces rather than merely against itself.
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

const movers = new Set<string>();
let cells = 0;
let zeroRev = 0;
let zeroRevZeroCost = 0;
let zeroRevWithCost = 0;
let heuristicMissing = 0;
let disagreements = 0;
const withCost: string[] = [];

for (const q of quotes) {
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    console.error(`  ERR ${q.quote_id.slice(0, 8)} ${res.error.code}`);
    continue;
  }
  const where = q.quote_id.slice(0, 8);
  for (const sr of res.data.costing.skuRollups) {
    for (const pt of sr.perTier) {
      cells += 1;
      // The adapter's current heuristic, reproduced exactly so the two can be
      // compared rather than assumed equivalent.
      const heuristic =
        pt.requiredSellPerUnit === 0 && pt.contributionCostPerUnit === 0;
      if (heuristic) heuristicMissing += 1;

      if (pt.requiredSellPerUnit !== 0) continue;
      zeroRev += 1;
      movers.add(where);
      if (pt.contributionCostPerUnit > 0) {
        zeroRevWithCost += 1;
        withCost.push(
          `${where}  ${sr.skuLabel ?? sr.skuId?.slice(0, 8)}  tier ${pt.tierId.slice(0, 8)}  ` +
            `cost=${pt.contributionCostPerUnit}  status=${pt.marginStatus}`,
        );
      } else {
        zeroRevZeroCost += 1;
      }
      // Where the heuristic and the engine's own facts diverge: zero revenue
      // WITH cost is a cell the heuristic calls priced, and today the engine
      // bands it BELOW_FLOOR off a fabricated 0%.
      if (!heuristic) disagreements += 1;
    }
  }
}

console.log(`\n  quotes                                ${quotes.length}`);
console.log(`  cells                                 ${cells}`);
console.log(`  zero revenue                          ${zeroRev}`);
console.log(`    ...and zero cost   -> UNAVAILABLE          ${zeroRevZeroCost}`);
console.log(`    ...and cost > 0    -> COST_WITHOUT_REVENUE ${zeroRevWithCost}`);
console.log(`  adapter heuristic calls "missing"     ${heuristicMissing}`);
console.log(
  `  zero-revenue cells the heuristic MISSES ${disagreements}` +
    `  <- banded BELOW_FLOOR off a fabricated 0% today`,
);

if (withCost.length) {
  console.log(`\n  Cost without revenue:`);
  for (const w of withCost.slice(0, 20)) console.log(`    ${w}`);
}

console.log(`\n  quotes that would move (${movers.size}):`);
console.log(`    ${[...movers].sort().join("  ")}\n`);
process.exit(0);
