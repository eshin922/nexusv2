/**
 * Costs cost-stack header — A-6 consumer cutover verification. Read-only.
 *
 * The header no longer derives anything. It reads sixteen values per tier out
 * of the canonical graph and renders nothing unless all sixteen are there.
 *
 * Two things have to hold across production for that to be a cutover rather
 * than a rewrite:
 *
 *   1. NO NUMBER MOVED. Every value the header now reads equals the value the
 *      removed local arithmetic produced. A cutover that quietly changes what a
 *      surface asserts is a redesign wearing a refactor's clothes.
 *   2. NO TIER LOST ITS NUMBERS. The set of tiers that render figures is
 *      unchanged. Fail-closed is correct only if it closes on the cases that
 *      were already blank.
 *
 * And two things that must NOT hold, checked because a change that collapsed
 * them would look like a success:
 *
 *   3. RAW never resolves. It has no independently governed value; the row
 *      states "included in PROD" instead of reading one.
 *   4. The header basis stays distinct from the Pricing blend wherever the
 *      quote's shape makes them distinct.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { readNodeValue, quoteScopeKey } from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as id from quotes q
   where exists (select 1 from quote_leaves ql where ql.quote_id = q.id)
   order by q.id
`)) as unknown as { id: string }[];

const COMPONENTS = [
  { node: "pkg", cost: "packaging", marked: "packagingMarkupSum" },
  { node: "prod", cost: "production", marked: "productionMarkupSum" },
  { node: "frt", cost: "freightContainer", marked: "freightContainerMarkupSum" },
  { node: "dt", cost: "dutyAndTariff", marked: "dutyAndTariffMarkupSum" },
] as const;

const failures: string[] = [];
let renderingTiers = 0;
let blankTiers = 0;
let pricedAtZeroTiers = 0;
let divergent = 0;
let emptyTiers = 0;

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

for (const q of quotes) {
  const res = await getCostingBundle(q.id);
  if (!res.ok) { failures.push(`${q.id}: ${res.error.code}`); continue; }
  const c = res.data.costing;

  for (const tier of c.tiers) {
    const r = c.quoteRollup.find((x) => x.tierId === tier.tierId);
    if (!r) continue;
    const b = r.costBreakdown as unknown as Record<string, number>;
    const qty = r.qty;
    const where = `${q.id} ${tier.label}`;

    const read = (name: string) =>
      readNodeValue(c.graph, quoteScopeKey(tier.tierId, `per-unit/${name}`));

    // ---- what the header requires, exactly as the component asks for it ----
    const values: Record<string, number | null> = {};
    for (const comp of COMPONENTS) {
      values[comp.node] = read(comp.node);
      values[`${comp.node}/cost`] = read(`${comp.node}/cost`);
      values[`${comp.node}/markup`] = read(`${comp.node}/markup`);
    }
    values["subtotal"] = readNodeValue(c.graph,
      quoteScopeKey(tier.tierId, "per-unit"),
    );
    values["departure"] = read("departure");
    values["revenue"] = read("revenue");
    values["cost-total"] = read("cost-total");

    const resolvedAll = Object.values(values).every((v) => v !== null);

    // 3 · RAW is never readable, on any tier, in any mode.
    if (read("raw") !== null) {
      failures.push(`${where}: a RAW node resolved — the row must stay non-numeric`);
    }

    // ---- what the OLD header computed, reproduced verbatim -----------------
    //
    // TWO gates, not one, because the old component had two. `tierQty > 0`
    // decided whether the component ROWS carried figures; `totalRevenue > 0`
    // decided the FOOT separately. Three production tiers sit between them —
    // priced at zero with a real quantity — and collapsing the two gates into
    // one would skip exactly those, leaving the rows they do render unverified.
    const oldRowsRender = qty > 0;
    const oldFootRenders = oldRowsRender && r.totalRevenue > 0;
    const newRowsRender = resolvedAll;
    const newFootRenders = resolvedAll && (values["revenue"] as number) > 0;

    // 2 · the rendering population is unchanged, on both gates.
    if (oldRowsRender !== newRowsRender || oldFootRenders !== newFootRenders) {
      failures.push(
        `${where}: renders changed — rows ${oldRowsRender}->${newRowsRender}, ` +
        `foot ${oldFootRenders}->${newFootRenders} (qty ${qty})`,
      );
      continue;
    }

    if (!newRowsRender) {
      blankTiers += 1;
      // A zero-quantity tier must expose NOTHING readable. A partially resolved
      // set is worse than none: it is half a stack read and half invented.
      if (resolvedAll) {
        failures.push(`${where}: zero-qty tier still resolved every node`);
      }
      continue;
    }
    if (newFootRenders) renderingTiers += 1;
    else pricedAtZeroTiers += 1;

    // 1 · no number moved.
    let oldSubtotal = 0;
    for (const comp of COMPONENTS) {
      const oldCost = b[comp.cost] / qty;
      const oldMarkup = (b[comp.marked] - b[comp.cost]) / qty;
      oldSubtotal += oldCost + oldMarkup;
      if (!near(values[`${comp.node}/cost`] as number, oldCost)) {
        failures.push(`${where}: ${comp.node} cost ${values[`${comp.node}/cost`]} != ${oldCost}`);
      }
      if (!near(values[`${comp.node}/markup`] as number, oldMarkup)) {
        failures.push(`${where}: ${comp.node} markup ${values[`${comp.node}/markup`]} != ${oldMarkup}`);
      }
      // The row's price cell now reads the component's own sum node rather
      // than adding the two segments in the display.
      if (!near(values[comp.node] as number, oldCost + oldMarkup)) {
        failures.push(`${where}: ${comp.node} total ${values[comp.node]} != ${oldCost + oldMarkup}`);
      }
    }
    if (!near(values["subtotal"] as number, oldSubtotal)) {
      failures.push(`${where}: subtotal ${values["subtotal"]} != ${oldSubtotal}`);
    }
    const oldRevenuePerUnit = r.totalRevenue / qty;
    if (!near(values["revenue"] as number, oldRevenuePerUnit)) {
      failures.push(`${where}: revenue/unit ${values["revenue"]} != ${oldRevenuePerUnit}`);
    }
    if (!near(values["departure"] as number, oldRevenuePerUnit - oldSubtotal)) {
      failures.push(
        `${where}: departure ${values["departure"]} != ${oldRevenuePerUnit - oldSubtotal}`,
      );
    }
    if (!near(values["cost-total"] as number, r.totalCost / qty)) {
      failures.push(`${where}: cost-total ${values["cost-total"]} != ${r.totalCost / qty}`);
    }

    // 4 · still a different quantity from the Pricing blend.
    const blend = readNodeValue(c.graph, quoteScopeKey(tier.tierId, "sell-before"));
    const leaves = c.skuRollups.filter((x) => x.skuRole === "leaf").length;
    if (blend !== null && leaves > 1) {
      if ((values["subtotal"] as number) === 0 && blend === 0) emptyTiers += 1;
      else if (near(blend, values["subtotal"] as number)) {
        failures.push(`${where}: header and blend collapsed to one value on ${leaves} SKUs`);
      } else divergent += 1;
    }
  }
}

console.log(`\n  tiers rendering a full column, every value graph-read  ${renderingTiers}`);
console.log(`  tiers with rows but no sell (priced at zero)     ${pricedAtZeroTiers}`);
console.log(`  tiers blank, before and after                    ${blankTiers}`);
console.log(`  multi-SKU tiers where header != Pricing blend     ${divergent}`);
console.log(`  multi-SKU tiers with no cost data at all          ${emptyTiers}  (both bases legitimately 0)`);

if (failures.length) {
  console.log(`\n  FAIL ${failures.length}:`);
  for (const f of failures.slice(0, 20)) console.log(`    ${f}`);
  process.exit(1);
}
if (renderingTiers === 0) {
  console.log(`\n  FAIL  no tier rendered figures — the cutover went unverified.`);
  process.exit(1);
}
if (divergent === 0) {
  console.log(`\n  FAIL  no multi-SKU tier exercised the divergence — the` +
              `\n        distinction between the two quantities went untested.`);
  process.exit(1);
}
console.log(`\n  ok    header values unchanged, population unchanged, RAW non-numeric\n`);
process.exit(0);
