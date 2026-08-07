/**
 * Costs cost-stack header — per-unit allocation verification. Read-only.
 *
 * Proves two things across every production quote:
 *
 *  1. The canonical per-unit nodes REPRODUCE what the header computes today.
 *     Anything else is a silent change to what the Costs surface asserts.
 *  2. The header quantity and the Pricing blend REMAIN DIFFERENT where they
 *     should. They are different commercial questions, and a change that
 *     accidentally collapsed one into the other would look like a success.
 *     The script fails if no multi-leaf tier exercises that divergence.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { resolveNode, quoteScopeKey } from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as id from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string }[];

const failures: string[] = [];
let checked = 0;
let undefinedTiers = 0;
let divergent = 0;
let emptyTiers = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.id);
  if (!res.ok) { failures.push(`${q.id}: ${res.error.code}`); continue; }
  const c = res.data.costing;

  for (const tier of c.tiers) {
    const r = c.quoteRollup.find((x) => x.tierId === tier.tierId);
    if (!r) continue;
    const b = r.costBreakdown;
    const qty = r.qty;
    const node = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "per-unit"));

    if (qty <= 0) {
      undefinedTiers += 1;
      // Undefined, so nothing readable may be exposed.
      for (const k of ["per-unit", "per-unit/revenue", "per-unit/cost-total"]) {
        const n = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, k));
        if (n && n.kind !== "flagged-out") {
          failures.push(`${q.id} ${tier.label}: readable ${k} on a zero-qty tier`);
        }
      }
      continue;
    }

    if (!node) { failures.push(`${q.id} ${tier.label}: per-unit node missing`); continue; }
    checked += 1;

    // Exactly today's header arithmetic: cost + markup per component, over qty.
    // RAW is excluded because the header's raw row is a stub returning 0 and
    // production already folds bulk raw in.
    const headerSubtotal =
      (b.packagingMarkupSum + b.productionMarkupSum +
       b.freightContainerMarkupSum + b.dutyAndTariffMarkupSum) / qty;
    if (Math.abs(node.value - headerSubtotal) > 1e-9) {
      failures.push(`${q.id} ${tier.label}: node ${node.value} != header ${headerSubtotal}`);
    }

    const rev = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "per-unit/revenue"));
    if (!rev || Math.abs(rev.value - r.totalRevenue / qty) > 1e-9) {
      failures.push(`${q.id} ${tier.label}: revenue/unit mismatch`);
    }
    const cst = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "per-unit/cost-total"));
    if (!cst || Math.abs(cst.value - r.totalCost / qty) > 1e-9) {
      failures.push(`${q.id} ${tier.label}: cost/unit mismatch`);
    }

    // The two quantities must stay distinct where the quote's shape makes them
    // distinct. Collapsing them would be the failure that looks like success.
    const blend = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "sell-before"));
    const leaves = c.skuRollups.filter((x) => x.skuRole === "leaf").length;
    // A tier with no cost data at all is zero on both bases, legitimately —
    // there is nothing there to be measured two ways. Counted, not asserted
    // on, so an all-zero tier cannot be mistaken for evidence of divergence
    // NOR reported as a collapse.
    if (blend && leaves > 1) {
      if (node.value === 0 && blend.value === 0) emptyTiers += 1;
      else if (Math.abs(blend.value - node.value) < 1e-9) {
        failures.push(
          `${q.id} ${tier.label}: header and blend collapsed to one value on ${leaves} SKUs`,
        );
      } else divergent += 1;
    }
  }
}

console.log(`\n  tiers verified against header arithmetic  ${checked}`);
console.log(`  tiers correctly undefined (zero qty)      ${undefinedTiers}`);
console.log(`  multi-SKU tiers where header != blend     ${divergent}`);
console.log(`  multi-SKU tiers with no cost data at all  ${emptyTiers}  (both bases legitimately 0)`);

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (divergent === 0) {
  console.log(`\n  FAIL  no multi-SKU tier exercised the divergence — the` +
              `\n        distinction between the two quantities went untested.`);
  process.exit(1);
}
console.log(`\n  ok    per-unit nodes reproduce the header, and stay distinct from the blend\n`);
process.exit(0);
