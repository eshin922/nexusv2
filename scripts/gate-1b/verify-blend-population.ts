/**
 * Gate 1B increment 7 — blend verification against production data. Read-only.
 *
 * The unit fixture proves the blend is a weighted mean over the governed
 * population, using quantities production does not currently have. This checks
 * the same property on real quotes: the contributor set must equal the
 * governed quote-leaf population exactly, and the blend must be the mean of
 * those contributors rather than their sum.
 *
 * It reads no expected value from a table of magic numbers. Every assertion is
 * a relationship the node must satisfy against its own operands, so it stays
 * true as the underlying costs change.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { findNode, parseNodeKey, quoteScopeKey, resolveNode } from "@/lib/costing-nodes";

const COMPONENTS = ["pkg", "prod", "raw", "frt", "dt"] as const;

const quotes = (await db.execute(sql`
  select q.id::text as quote_id
    from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { quote_id: string }[];

const failures: string[] = [];
let tiersChecked = 0;
let blendsChecked = 0;
let meanBelowSum = 0;
let undefinedTiers = 0;

for (const q of quotes) {
  const expected = (await db.execute(sql`
    select id::text as id from quote_leaves where quote_id = ${q.quote_id} order by id
  `)) as unknown as { id: string }[];
  const governed = expected.map((e) => e.id).sort();

  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) {
    failures.push(`${q.quote_id}  bundle error ${res.error.code}`);
    continue;
  }
  const graph = res.data.costing.graph;

  for (const tier of res.data.costing.tiers) {
    tiersChecked += 1;

    // A tier whose total weight is zero has NO blend — the mean is undefined,
    // and the graph states that as a flagged-out exclusion rather than
    // publishing a zero. Its component keys are absent by design, so a
    // missing node here is the contract working, not a failure.
    const container = graph.nodes.find((n) => n.key === `quote/${tier.tierId}`);
    if (container?.kind === "flagged-out") {
      undefinedTiers += 1;
      for (const comp of COMPONENTS) {
        if (resolveNode(graph.nodes, quoteScopeKey(tier.tierId, comp))) {
          failures.push(
            `${q.quote_id} ${tier.label} ${comp}: readable blend exposed on an undefined tier`,
          );
        }
      }
      continue;
    }

    for (const comp of COMPONENTS) {
      let node = null;
      for (const root of graph.nodes) {
        const hit = findNode(root, `quote/${tier.tierId}/${comp}`);
        if (hit) { node = hit; break; }
      }
      if (!node) {
        failures.push(`${q.quote_id} ${tier.label} ${comp}: node missing`);
        continue;
      }
      blendsChecked += 1;

      // 1 · contributors are exactly the governed population
      const contributors = (node.operands ?? [])
        // Contributor identity is the last segment of a quote-scope operand
        // key. Routed through the shared parser so this file holds no
        // opinion about the grammar of its own inputs.
        .map((o) => {
          const a = parseNodeKey(o.key);
          return a ? a.path[a.path.length - 1] : "";
        })
        .sort();
      if (contributors.length !== governed.length ||
          contributors.some((c, i) => c !== governed[i])) {
        failures.push(
          `${q.quote_id} ${tier.label} ${comp}: contributors ${contributors.length} vs governed ${governed.length}`,
        );
        continue;
      }

      // 2 · the value is the weighted mean of those contributors
      const ops = node.operands ?? [];
      const w = node.weights ?? [];
      const total = w.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const mean = ops.reduce((acc, o, i) => acc + o.value * w[i], 0) / total;
        if (Math.abs(node.value - mean) > 1e-9) {
          failures.push(`${q.quote_id} ${tier.label} ${comp}: ${node.value} != mean ${mean}`);
        }
      }

      // 3 · with more than one contributor carrying value, a mean is strictly
      //     below the sum. This is the reverted defect stated as a property.
      const sum = ops.reduce((a, o) => a + o.value, 0);
      const nonZero = ops.filter((o) => o.value !== 0).length;
      if (nonZero > 1) {
        if (node.value >= sum) {
          failures.push(`${q.quote_id} ${tier.label} ${comp}: blend ${node.value} >= sum ${sum}`);
        } else {
          meanBelowSum += 1;
        }
      }
    }
  }
}

console.log(`\n  quotes checked                  ${quotes.length}`);
console.log(`  tiers checked                   ${tiersChecked}`);
console.log(`  component blends checked        ${blendsChecked}`);
console.log(`  tiers with undefined blend      ${undefinedTiers}  (zero total weight, flagged out)`);
console.log(`  blends with >1 valued SKU       ${meanBelowSum}  (mean strictly below sum)`);

if (failures.length > 0) {
  console.log(`\n  FAIL  ${failures.length}:`);
  for (const f of failures.slice(0, 25)) console.log(`    ${f}`);
  process.exit(1);
}
if (meanBelowSum === 0) {
  console.log(`\n  FAIL  no blend had more than one valued contributor — the` +
              `\n        mean-vs-sum property was never actually exercised.`);
  process.exit(1);
}
console.log(`\n  ok    every blend is a weighted mean over the governed population\n`);
process.exit(0);
