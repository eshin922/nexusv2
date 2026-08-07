/**
 * A-6 · cost-stack-header.tsx:305 — semantic contract check. Read-only.
 *
 * The header sums component values into a "subtotal". The question is NOT
 * whether that number happens to equal a graph node on one fixture, but
 * whether it is the SAME BUSINESS QUANTITY. Two figures can agree on a quote
 * whose shape makes their bases coincide and diverge everywhere else — that is
 * the exact mistake the reverted increment 7 made.
 *
 * So this prints both bases side by side and states which is which.
 */

import { getCostingBundle } from "@/app/actions/costing";
import { resolveNode, quoteScopeKey } from "@/lib/costing-nodes";

const QUOTE = process.argv[2] ?? "52bd0077-20af-4345-8856-45003bfca8b3";

const res = await getCostingBundle(QUOTE);
if (!res.ok) throw new Error(res.error.code);
const c = res.data.costing;
const f = (v: number | null) => (v === null ? "     —    " : v.toFixed(4).padStart(10));

console.log(`\nQuote ${QUOTE}\n`);
console.log(
  "TIER   qty       header subtotal   graph sell-before   header revenue/u   graph sell",
);

for (const tier of c.tiers) {
  const r = c.quoteRollup.find((q) => q.tierId === tier.tierId);
  if (!r) continue;
  const b = r.costBreakdown;
  const qty = r.qty;

  // Exactly what the header computes: component tier TOTALS over tier qty.
  // cost + markup per component collapses to the component's marked-up sum.
  const headerSubtotal =
    qty > 0
      ? (b.packagingMarkupSum +
          b.productionMarkupSum +
          b.freightContainerMarkupSum +
          b.dutyAndTariffMarkupSum) /
        qty
      : null;
  const headerRevenuePerUnit = qty > 0 ? r.totalRevenue / qty : null;

  const sellBefore = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "sell-before"));
  const sell = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "sell"));

  console.log(
    `${tier.label.padEnd(7)}${String(qty).padStart(6)}   ${f(headerSubtotal)}        ${f(
      sellBefore ? sellBefore.value : null,
    )}        ${f(headerRevenuePerUnit)}       ${f(sell ? sell.value : null)}`,
  );
}

console.log(`
  The header basis is a SUM ACROSS TOP-LEVEL PRODUCTS of per-unit values:
  every component total is a quote-level tier total, divided by tier qty.

  The graph blend basis is a WEIGHTED MEAN ACROSS THE GOVERNED SKU POPULATION.

  If the two columns differ, the graph does not currently expose the quantity
  this header displays, and replacing the local sum with sell-before would
  change what the surface asserts rather than where it reads it from.
`);

const leaves = c.skuRollups.filter((r) => r.skuRole === "leaf").length;
const tops = c.skuRollups.filter((r) => r.parentSkuId === null).length;
console.log(`  this quote: ${tops} top-level product(s), ${leaves} governed SKU(s)\n`);
process.exit(0);
