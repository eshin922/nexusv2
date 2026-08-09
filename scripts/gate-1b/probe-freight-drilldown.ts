/**
 * Freight drilldown — §0.5 pre-flight. Read-only, decides nothing.
 *
 * The inventory says the engine computes freight per (leaf, leg) while the
 * drilldown displays per (shipment, tier), and that the gap is a granularity
 * the graph does not expose. Packaging proved the inventory can be stale, so
 * this checks rather than assumes.
 *
 * Answers, per tier, across production:
 *
 *   1. Do per-(shipment, tier) nodes exist, and do they carry the exact
 *      quantities the drilldown renders?
 *   2. Does the drilldown's TOTAL follow the standing contract — this
 *      category's contribution to the Cost Stack?
 *   3. Legacy legs vs worksheet shipments: which model is live, and does the
 *      drilldown render one the graph does not?
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import {
  parseNodeKey,
  quoteScopeKey,
  readNodeValue,
  walkGraph,
  type CostingNode,
} from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as id from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string }[];

let shipmentNodes = 0;
let legNodes = 0;
let tiersWithFreight = 0;
let totalMatchesStack = 0;
let totalDiffersFromStack = 0;
let bothZero = 0;
const examples: string[] = [];
const chargeShapes = new Set<string>();

for (const q of quotes) {
  const res = await getCostingBundle(q.id);
  if (!res.ok) continue;
  const c = res.data.costing;

  for (const tier of c.tiers) {
    // Per-shipment and per-leg freight nodes at this tier, cell-scope only.
    const ships: CostingNode[] = [];
    const legs: CostingNode[] = [];
    for (const root of c.graph.nodes) {
      walkGraph(root, (n) => {
        const a = parseNodeKey(n.key);
        if (!a || a.scope !== "cell" || a.tierId !== tier.tierId) return;
        if (a.path.length === 3 && a.path[0] === "frt" && a.path[1] === "shipment") {
          ships.push(n);
          for (const o of n.operands ?? []) {
            const oa = parseNodeKey(o.key);
            if (oa && oa.path.length === 4) chargeShapes.add(oa.path[3]);
          }
        }
        if (a.path.length === 3 && a.path[0] === "frt" && a.path[1] === "leg") legs.push(n);
      });
    }
    shipmentNodes += ships.length;
    legNodes += legs.length;
    if (ships.length === 0 && legs.length === 0) continue;
    tiersWithFreight += 1;

    // THE STANDING CONTRACT: the drilldown TOTAL is this category's
    // contribution to the Cost Stack. The strip sums shipment totals, which
    // are freight + duty + tariff; the header splits those across FRT and D+T,
    // so the comparison is against their sum.
    const stripTotal = ships.reduce((a, n) => a + n.value, 0);
    const frt = readNodeValue(c.graph, quoteScopeKey(tier.tierId, "per-unit/frt"));
    const dt = readNodeValue(c.graph, quoteScopeKey(tier.tierId, "per-unit/dt"));
    if (frt === null || dt === null) continue;
    const stack = frt + dt;

    if (stripTotal === 0 && stack === 0) { bothZero += 1; continue; }
    if (Math.abs(stripTotal - stack) <= 1e-9) totalMatchesStack += 1;
    else {
      totalDiffersFromStack += 1;
      if (examples.length < 8) {
        examples.push(
          `${q.id.slice(0, 8)} ${tier.label}: strip Σshipments ${stripTotal.toFixed(6)} ` +
          `vs stack FRT+D+T ${stack.toFixed(6)} (frt ${frt.toFixed(6)} dt ${dt.toFixed(6)}) ` +
          `[${ships.length} shipment(s), ${legs.length} leg(s)]`,
        );
      }
    }
  }
}

console.log(`\n  per-(shipment, tier) nodes in production   ${shipmentNodes}`);
console.log(`  per-(leg, tier) nodes  (legacy model)      ${legNodes}`);
console.log(`  charge nodes beneath each shipment         ${[...chargeShapes].sort().join(", ") || "none"}`);
console.log(`\n  tiers carrying freight                    ${tiersWithFreight}`);
console.log(`  TOTAL matches the Cost Stack FRT + D+T     ${totalMatchesStack}`);
console.log(`  TOTAL differs                              ${totalDiffersFromStack}`);
console.log(`  both zero (nothing entered)                ${bothZero}`);
if (examples.length) {
  console.log(`\n  where they differ:`);
  for (const e of examples) console.log(`    ${e}`);
}
console.log();
process.exit(0);
