/**
 * Increment 7 production smoke — the values the Pricing Cost Stack must show.
 * Read-only.
 *
 * Prints the canonical graph nodes for each tier, and the per-SKU cell values
 * beneath them with their weights. The per-SKU rows are the blend's operands,
 * so the relationship to check is not "do these numbers match" but "is the
 * stack the weighted mean of the rows" — a stack that equalled the row SUM
 * would also be numerically self-consistent, and that is exactly the defect
 * that shipped.
 */

import { getCostingBundle } from "@/app/actions/costing";
import { resolveNode, quoteScopeKey } from "@/lib/costing-nodes";

const QUOTE = process.argv[2] ?? "52bd0077-20af-4345-8856-45003bfca8b3";
const COMPONENTS = ["pkg", "prod", "raw", "frt", "dt"] as const;

const res = await getCostingBundle(QUOTE);
if (!res.ok) throw new Error(res.error.code);
const c = res.data.costing;

const f = (v: number) => v.toFixed(4);

console.log(`\nQuote ${QUOTE}`);
console.log(`graph version ${c.graph.version} · complete ${c.graph.complete}\n`);

for (const tier of c.tiers) {
  console.log(`TIER ${tier.label}  (qty ${tier.qty})`);
  const read = (n: string) => resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, n));

  const cells: string[] = [];
  for (const comp of COMPONENTS) {
    const node = read(comp);
    if (!node) { console.log(`   ${comp}: UNRESOLVED`); continue; }
    cells.push(`${comp.toUpperCase()}=${f(node.value)}`);
  }
  const sellBefore = read("sell-before");
  const sell = read("sell");
  console.log(`   COST STACK ROW must read:`);
  console.log(`     ${cells.join("  ")}`);
  console.log(`     Sell before adj   ${sellBefore ? f(sellBefore.value) : "UNRESOLVED"}`);
  console.log(`     Quoted sell/unit  ${sell ? f(sell.value) : "UNRESOLVED"}`);

  // The operands are the per-SKU rows. Printing them with weights is what
  // makes the mean-vs-sum distinction checkable by eye.
  const pkg = read("pkg");
  if (pkg?.operands) {
    console.log(`   per-SKU contributors to PKG (the blend's operands):`);
    const w = pkg.weights ?? [];
    let sum = 0;
    pkg.operands.forEach((o, i) => {
      sum += o.value;
      console.log(`     ${o.label.padEnd(22)} value ${f(o.value).padStart(10)}   weight ${w[i]}`);
    });
    console.log(`     ${"SUM of rows".padEnd(22)}       ${f(sum).padStart(10)}   <- stack must NOT equal this`);
    console.log(`     ${"weighted MEAN".padEnd(22)}       ${f(pkg.value).padStart(10)}   <- stack must equal this`);
  }
  console.log("");
}

// Per-SKU margin rows, so the smoke can check the grid against the stack.
console.log("PER-SKU ROWS (leaf population):");
for (const sku of c.skuRollups.filter((r) => r.skuRole === "leaf")) {
  const parts = sku.perTier.map((pt) => `${f(pt.requiredSellPerUnit)}`).join("  ");
  console.log(`  ${sku.skuLabel.padEnd(20)} qty/parent ${String(sku.qtyPerParent ?? 1).padEnd(4)} sell/unit by tier: ${parts}`);
  console.log(`  ${"".padEnd(20)} canonical id ${sku.canonicalQuoteLeafId}`);
}
process.exit(0);
