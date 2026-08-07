/**
 * Packaging TOTAL node (OD-018) — verification. Read-only.
 *
 * Four properties, and the last two are the ones that matter most because they
 * are the ones a plausible-looking wrong implementation would still pass.
 *
 *   1. The node reproduces what the foot summed locally. A cutover that moves
 *      the number is a redesign, and this row's meaning was just settled.
 *   2. It reconciles with the Cost Stack's Packaging row. This is the business
 *      contract: the row exists to show Packaging's contribution to the stack.
 *   3. IT IS NOT THE PRICING BLEND. Same component, same tier, same population,
 *      and a factor of the SKU count between them. On a single-SKU quote they
 *      coincide, so a script that only checked multi-SKU-free data would pass
 *      while reading the wrong node. Divergence must be exercised.
 *   4. It is a SUM, not an alias. Its operands must add up to it — otherwise it
 *      is a number that agrees with the header today and cannot say why.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import {
  collectCellSectionNodes,
  quoteScopeKey,
  readNodeValue,
  resolveNode,
} from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as id from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string }[];

const failures: string[] = [];
let checked = 0;
let reconciledToHeader = 0;
let headerUndefined = 0;
let distinctFromBlend = 0;
let coincidesWithBlend = 0;
let emptyTiers = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.id);
  if (!res.ok) { failures.push(`${q.id}: ${res.error.code}`); continue; }
  const c = res.data.costing;

  for (const tier of c.tiers) {
    const where = `${q.id.slice(0, 8)} ${tier.label}`;
    const key = quoteScopeKey(tier.tierId, "cost-stack/pkg-total");
    const node = resolveNode(c.graph.nodes, key);

    // The per-SKU packaging nodes for this tier. This selector used to be
    // written out here, and got it wrong: `quote/{tier}/pkg` is also three
    // segments ending in `pkg`, so the Pricing blend was being added to the sum
    // this script checks the blend against. `collectCellSectionNodes` states
    // the scope and the depth once, where it can be tested.
    const sectionNodes = collectCellSectionNodes(c.graph.nodes, "pkg", {
      tierId: tier.tierId,
    });
    const localSum = sectionNodes.reduce((a, n) => a + n.value, 0);
    const skuNodes = sectionNodes.length;
    if (skuNodes === 0) continue;

    if (!node) { failures.push(`${where}: cost-stack/pkg-total missing`); continue; }
    checked += 1;

    // 1 · reproduces the local sum.
    if (Math.abs(node.value - localSum) > 1e-9) {
      failures.push(`${where}: node ${node.value} != Σ per-SKU ${localSum}`);
    }

    // 4 · it is a sum, and its operands say so.
    const operandSum = (node.operands ?? []).reduce((a, o) => a + o.value, 0);
    if (node.kind !== "sum") failures.push(`${where}: kind is ${node.kind}, not sum`);
    if (Math.abs(operandSum - node.value) > 1e-9) {
      failures.push(`${where}: operands sum to ${operandSum}, node says ${node.value}`);
    }
    if ((node.operands ?? []).length === 0) {
      failures.push(`${where}: a sum with no operands cannot be checked`);
    }

    // 2 · reconciles with the Cost Stack's Packaging row.
    const header = readNodeValue(c.graph.nodes, quoteScopeKey(tier.tierId, "per-unit/pkg"));
    if (header === null) headerUndefined += 1;
    else if (Math.abs(header - node.value) > 1e-9) {
      failures.push(
        `${where}: does NOT reconcile to the Cost Stack PKG row — ` +
        `total ${node.value.toFixed(6)} vs header ${header.toFixed(6)}`,
      );
    } else reconciledToHeader += 1;

    // 3 · distinct from the Pricing blend wherever the quote has >1 SKU.
    const blend = readNodeValue(c.graph.nodes, quoteScopeKey(tier.tierId, "pkg"));
    if (blend !== null) {
      if (Math.abs(blend - node.value) <= 1e-9) coincidesWithBlend += 1;
      else distinctFromBlend += 1;
      // A tier with no packaging cost at all is zero on both bases, legitimately
      // — a sum of nothing and a mean of nothings are both nothing. Counted
      // rather than asserted on, so it can neither be mistaken for evidence of
      // divergence nor reported as a collapse. Same treatment the per-unit
      // verifier needed for the same reason.
      if (node.value === 0 && blend === 0) emptyTiers += 1;
      else if (skuNodes > 1 && Math.abs(blend - node.value) <= 1e-9) {
        failures.push(
          `${where}: total equals the Pricing blend across ${skuNodes} SKUs — ` +
          `a sum and a mean cannot agree there`,
        );
      }
    }
  }
}

console.log(`\n  tiers with a packaging total          ${checked}`);
console.log(`  reconciling to the Cost Stack PKG row ${reconciledToHeader}`);
console.log(`  header undefined (zero-qty tier)      ${headerUndefined}`);
console.log(`  distinct from the Pricing blend       ${distinctFromBlend}`);
console.log(`  coinciding with it (single-SKU tiers) ${coincidesWithBlend}`);
console.log(`  tiers with no packaging cost at all   ${emptyTiers}  (zero on both bases)`);

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (distinctFromBlend === 0) {
  console.log(`\n  FAIL  no multi-SKU tier separated the total from the Pricing blend.` +
              `\n        The distinction the key exists to preserve went untested.`);
  process.exit(1);
}
console.log(`\n  ok    a real sum, reconciling to the Cost Stack, distinct from the blend\n`);
process.exit(0);
