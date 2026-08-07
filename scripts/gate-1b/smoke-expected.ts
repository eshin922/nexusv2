/**
 * Gate 1B increment 6 — expected values for the live smoke. READ ONLY.
 *
 * Prints, per tier, the canonical graph values an operator surface should now
 * be displaying, since those surfaces read scalars whose authority is the
 * graph. Comparing the UI to numbers derived from the same run would prove
 * nothing; these come from the engine, which is what the UI now ultimately
 * reads.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { walkGraph } from "@/lib/costing-nodes";

const QUOTE = "52bd0077-20af-4345-8856-45003bfca8b3";

const money = (v: number) => (v === 0 ? "0" : v.toFixed(4));

const res = await getCostingBundle(QUOTE);
if (!res.ok) throw new Error(res.error.code);
const c = res.data.costing;

console.log(`\nQuote ${QUOTE}`);
console.log(`graph: version ${c.graph.version} · complete ${c.graph.complete} · ${c.graph.nodes.length} roots\n`);

for (const t of c.tiers) {
  console.log(`TIER ${t.label} (qty ${t.qty})`);
  for (const sku of c.skuRollups) {
    const pt = sku.perTier.find((p) => p.tierId === t.tierId);
    if (!pt) continue;
    if (sku.skuRole !== "leaf") continue;
    console.log(`  ${sku.skuLabel} — ${sku.productName}`);
    console.log(`     packaging sell/u   ${money(pt.packagingMarkupSumPerUnit)}   cost/u ${money(pt.packagingCostPerUnit)}`);
    console.log(`     production sell/u  ${money(pt.productionMarkupSumPerUnit)}  cost/u ${money(pt.productionCostPerUnit)}`);
    console.log(`     bulk raw sell/u    ${money(pt.rawMarkupSumPerUnit)}         cost/u ${money(pt.rawCostPerUnit)}`);
    console.log(`     freight sell/u     ${money(pt.totalLandedFreightWithMarkup)}  container ${money(pt.freightContainerMarkupSumPerUnit)}  D+T ${money(pt.freightDutyTariffMarkupSumPerUnit)}`);
    console.log(`     computed sell/u    ${money(pt.computedSellPerUnit)}`);
    console.log(`     REQUIRED sell/u    ${money(pt.requiredSellPerUnit)}   (${pt.sellSource})`);
    console.log(`     margin             ${(pt.marginPct * 100).toFixed(2)}%  ${pt.marginStatus}`);
  }
  const q = c.quoteRollup.find((r) => r.tierId === t.tierId)!;
  console.log(`  QUOTE TOTALS  revenue ${money(q.totalRevenue)}  cost ${money(q.totalCost)}  blended margin ${(q.blendedMarginPct * 100).toFixed(2)}%`);
  console.log("");
}

// The graph's own view of the same tier, so the smoke can name the node keys.
const first = c.graph.nodes.find((n) => !n.key.startsWith("quote/"));
if (first) {
  console.log("Node chain for the first cell (key · kind · value):");
  walkGraph(first, (n, d) => {
    if (d <= 2) console.log(`  ${"  ".repeat(d)}${n.key}  [${n.kind}]  ${money(n.value)}`);
  });
}

const [row] = (await db.execute(sql`
  select count(*)::text as overrides from assembly_leaf_overrides alo
    join assembly_leaves al on al.id = alo.assembly_leaf_id
    join assemblies a on a.id = al.assembly_id
   where a.quote_id = ${QUOTE}
`)) as unknown as { overrides: string }[];
console.log(`\nexisting overrides on this quote: ${row.overrides}`);
process.exit(0);
