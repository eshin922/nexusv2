/**
 * Allocation-OFF margin exposure — sizing evidence for the defect repair.
 *
 * WHAT THIS MEASURES AND WHAT IT DOES NOT
 *
 * Today an allocation-OFF one-time charge is absent from the engine entirely:
 * not in `contributionCostPerUnit`, not in `requiredSellPerUnit`, and therefore
 * in neither `totalCost` nor `totalRevenue` nor `blendedMarginPct`
 * (`costing.ts:1858`). This reports, per affected tier, the margin as computed
 * TODAY alongside a FIRST-ORDER ESTIMATE of the margin once the charge
 * participates on both sides.
 *
 * The estimate is deliberately labelled an estimate. It applies the governed
 * Production rate to the excluded total and adds cost and recovery to the tier:
 *
 *     revenue' = revenue + excluded x (1 + rate)
 *     cost'    = cost    + excluded
 *     margin'  = (revenue' - cost') / revenue'
 *
 * That is the arithmetic the repair should produce, but it is NOT the repair's
 * output — the real figure comes from the engine once the charge is emitted
 * through the normal path, with the same rounding and the same per-charge rate
 * resolution the rest of the stack uses. Anyone tempted to certify the repair
 * against THIS number instead of against the engine would be certifying a
 * reimplementation. It exists to answer one question before the slice opens:
 * DOES ANY QUOTE CHANGE FLOOR STATUS?
 *
 * Read-only. Writes nothing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { PRODUCTION_MARKUP_CATEGORY } from "@/lib/costing";

// The SAME category constant the engine prices OTC with. Reading a different
// row here would make the estimate disagree with the repair for a reason that
// had nothing to do with the repair.
const RATE_ROW = (await db.execute(sql`
  select default_markup_pct::text as pct
    from markup_defaults where category = ${PRODUCTION_MARKUP_CATEGORY}
`)) as unknown as { pct: string }[];

const FIRM = (await db.execute(sql`
  select target_margin_pct::text as target, floor_margin_pct::text as floor
    from firm_settings where effective_until is null limit 1
`)) as unknown as { target: string; floor: string }[];

const rate = Number(RATE_ROW[0]?.pct ?? 0);
const floor = Number(FIRM[0]?.floor ?? 0);
const target = Number(FIRM[0]?.target ?? 0);

// Per (quote, tier) excluded one-time money. Allocation-OFF rows only — those
// are precisely the ones the engine drops.
const excluded = (await db.execute(sql`
  select q.id::text as quote_id, q.status, api.tier_id::text as tier_id,
         sum(coalesce(api.setup_fee_total,0) + coalesce(api.tooling_artwork_total,0)
           + coalesce(api.tooling_total,0)  + coalesce(api.artwork_total,0)
           + coalesce(api.rd_total,0)       + coalesce(api.other_service_total,0)
           + coalesce(api.testing_micros_total,0))::float8 as excluded
    from quotes q
    join assemblies a on a.quote_id = q.id
    join assembly_production_inputs api on api.assembly_id = a.id
   where api.allocate_service_fees_to_cost = false
   group by q.id, q.status, api.tier_id
  having sum(coalesce(api.setup_fee_total,0) + coalesce(api.tooling_artwork_total,0)
           + coalesce(api.tooling_total,0)  + coalesce(api.artwork_total,0)
           + coalesce(api.rd_total,0)       + coalesce(api.other_service_total,0)
           + coalesce(api.testing_micros_total,0)) > 0
   order by q.id
`)) as unknown as { quote_id: string; status: string; tier_id: string; excluded: number }[];

const byQuote = new Map<string, { status: string; tiers: Map<string, number> }>();
for (const r of excluded) {
  if (!byQuote.has(r.quote_id)) byQuote.set(r.quote_id, { status: r.status, tiers: new Map() });
  byQuote.get(r.quote_id)!.tiers.set(r.tier_id, r.excluded);
}

console.log(`\nAllocation-OFF margin exposure`);
console.log(`  governed ${PRODUCTION_MARKUP_CATEGORY} rate : ${(rate * 100).toFixed(2)}%`);
console.log(`  firm target / floor         : ${(target * 100).toFixed(2)}% / ${(floor * 100).toFixed(2)}%`);
console.log(`  affected quotes             : ${byQuote.size}\n`);

const status = (m: number | null) =>
  m === null ? "UNDEFINED" : m < floor ? "BELOW_FLOOR" : m < target ? "BELOW_TARGET" : "GOOD";

let crossings = 0;

for (const [quoteId, q] of byQuote) {
  const res = await getCostingBundle(quoteId);
  if (!res.ok) {
    console.log(`${quoteId.slice(0, 8)}  ${q.status.padEnd(9)}  BUNDLE ERROR`);
    continue;
  }
  console.log(`${quoteId.slice(0, 8)}  ${q.status}`);
  for (const t of res.data.costing.quoteRollup) {
    const ex = q.tiers.get(t.tierId) ?? 0;
    if (ex === 0) continue;

    const now = t.blendedMarginPct;
    const rev2 = t.totalRevenue + ex * (1 + rate);
    const cost2 = t.totalCost + ex;
    const est = rev2 > 0 ? (rev2 - cost2) / rev2 : null;

    const s1 = status(now);
    const s2 = status(est);
    const crossed = s1 !== s2;
    if (crossed) crossings += 1;

    const pct = (v: number | null) => (v === null ? "  n/a  " : `${(v * 100).toFixed(2)}%`.padStart(7));
    console.log(
      `    ${t.label.padEnd(14)} excluded $${ex.toFixed(2).padStart(10)}` +
        `   now ${pct(now)} ${s1.padEnd(12)}` +
        `   est ${pct(est)} ${s2.padEnd(12)}` +
        (crossed ? "  <-- STATUS CHANGES" : ""),
    );
  }
}

console.log(
  `\n${crossings === 0 ? "No tier changes floor/target status under the estimate." : `${crossings} tier(s) change status under the estimate.`}`,
);
console.log(
  "The estimate is not the repair's output. Certify against the engine, not against this.\n",
);
process.exit(0);
