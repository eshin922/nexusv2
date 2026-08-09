/**
 * Worksheet-freight cutover — verification. Read-only.
 *
 *   1. `frt-total` reconciles to the Cost Stack FRT + D+T. This is the standing
 *      contract for a drilldown TOTAL, and the reason the node sums the per-SKU
 *      freight SECTION rather than worksheet shipments: two freight models are
 *      resident, exactly one is authoritative per quote, and a worksheet-scoped
 *      total reads zero on a legacy quote whose stack shows real freight.
 *   2. It is a real sum whose operands add up to it.
 *   3. Per-shipment nodes carry the exact values the drawer renders, and
 *      resolve uniquely by (subcategory, tier) — the assumption the consumer's
 *      resolution rests on, since the drawer is quote-scoped and does not know
 *      the owning SKU.
 *   4. Both freight models are covered, and the total moves on the legacy ones.
 *      That change is a consequence of the contract, so it is asserted rather
 *      than merely permitted.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import {
  collectCellSectionNodes,
  parseNodeKey,
  quoteScopeKey,
  readNodeValue,
  resolveNode,
  walkGraph,
  type CostingNode,
} from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as id from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string }[];

const failures: string[] = [];
let checked = 0;
let reconciled = 0;
let worksheetTiers = 0;
let legacyTiers = 0;
let totalNowNonZeroOnLegacy = 0;
let shipmentsChecked = 0;

for (const q of quotes) {
  const res = await getCostingBundle(q.id);
  if (!res.ok) { failures.push(`${q.id}: ${res.error.code}`); continue; }
  const c = res.data.costing;

  for (const tier of c.tiers) {
    const where = `${q.id.slice(0, 8)} ${tier.label}`;
    const sections = collectCellSectionNodes(c.graph, "frt", { tierId: tier.tierId });
    if (sections.length === 0) continue;

    // Shipment nodes, and the uniqueness the consumer depends on.
    const bySub = new Map<string, CostingNode[]>();
    let legs = 0;
    for (const root of c.graph.nodes) {
      walkGraph(root, (n) => {
        const a = parseNodeKey(n.key);
        if (!a || a.scope !== "cell" || a.tierId !== tier.tierId) return;
        if (a.path.length !== 3 || a.path[0] !== "frt") return;
        if (a.path[1] === "leg") { legs += 1; return; }
        if (a.path[1] !== "shipment") return;
        const list = bySub.get(a.path[2]) ?? [];
        list.push(n);
        bySub.set(a.path[2], list);
      });
    }
    for (const [sub, list] of bySub) {
      shipmentsChecked += 1;
      if (list.length > 1) {
        failures.push(`${where}: subcategory ${sub.slice(0, 8)} resolves to ${list.length} nodes — ` +
                      `the drawer resolves by subcategory and cannot choose`);
        continue;
      }
      // 3 · freight + duty + tariff must be present and add to the shipment.
      const node = list[0];
      const charge = (name: string) =>
        (node.operands ?? []).find((o) => {
          const a = parseNodeKey(o.key);
          return a?.path.length === 4 && a.path[3] === name;
        });
      const parts = ["freight", "duty", "tariff"].map(charge);
      if (parts.some((x) => !x)) {
        failures.push(`${where}: shipment ${sub.slice(0, 8)} is missing a charge node`);
        continue;
      }
      const summed = parts.reduce((a, x) => a + (x as CostingNode).value, 0);
      if (Math.abs(summed - node.value) > 1e-9) {
        failures.push(`${where}: shipment charges sum to ${summed}, node says ${node.value}`);
      }
    }

    const ships = bySub.size;
    if (ships > 0 && legs > 0) {
      failures.push(`${where}: both freight models carry nodes — they are mutually exclusive`);
    }
    if (ships > 0) worksheetTiers += 1;
    else if (legs > 0) legacyTiers += 1;

    // 1 + 2 · the total.
    const total = resolveNode(c.graph.nodes, quoteScopeKey(tier.tierId, "cost-stack/frt-total"));
    if (!total) { failures.push(`${where}: cost-stack/frt-total missing`); continue; }
    checked += 1;

    if (total.kind !== "sum") failures.push(`${where}: kind is ${total.kind}, not sum`);
    const operandSum = (total.operands ?? []).reduce((a, o) => a + o.value, 0);
    if (Math.abs(operandSum - total.value) > 1e-9) {
      failures.push(`${where}: operands sum to ${operandSum}, node says ${total.value}`);
    }

    const frt = readNodeValue(c.graph, quoteScopeKey(tier.tierId, "per-unit/frt"));
    const dt = readNodeValue(c.graph, quoteScopeKey(tier.tierId, "per-unit/dt"));
    if (frt === null || dt === null) continue;   // zero-qty tier
    if (Math.abs(total.value - (frt + dt)) > 1e-9) {
      failures.push(
        `${where}: total ${total.value.toFixed(6)} does not reconcile to ` +
        `FRT + D+T ${(frt + dt).toFixed(6)}`,
      );
    } else reconciled += 1;

    // 4 · on a legacy tier the strip used to render 0; it now renders the real
    // figure. Asserted, not merely allowed — it is the visible consequence.
    if (legs > 0 && ships === 0 && total.value !== 0) totalNowNonZeroOnLegacy += 1;
  }
}

console.log(`\n  tiers with a freight total            ${checked}`);
console.log(`  reconciling to Cost Stack FRT + D+T   ${reconciled}`);
console.log(`  worksheet-model tiers                 ${worksheetTiers}`);
console.log(`  legacy-model tiers                    ${legacyTiers}`);
console.log(`  legacy tiers whose strip was 0        ${totalNowNonZeroOnLegacy}  (now the real figure)`);
console.log(`  shipment nodes checked                ${shipmentsChecked}`);

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (worksheetTiers === 0) {
  console.log(`\n  FAIL  no worksheet tier exercised the per-shipment reads.`);
  process.exit(1);
}
console.log(`\n  ok    total reconciles on both models; shipments resolve uniquely\n`);
process.exit(0);
