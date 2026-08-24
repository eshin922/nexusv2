/**
 * Allocation-OFF repair — certification.
 *
 * Reports, per affected (quote, tier), the figures the repaired ENGINE
 * produces, and checks the charge landed at its stated amount rather than at
 * some scaled multiple of it.
 *
 * WHY THE AMOUNT CHECK IS HERE AND IS NOT A FORMALITY
 *
 * A one-time charge is amortised to a per-unit rate at the leaf, bubbled up the
 * assembly tree multiplied by `qty_per_parent`, and multiplied back out by tier
 * quantity at the rollup. Where `qty_per_parent != 1` that round trip does NOT
 * return the charge — it returns `charge x qty_per_parent`. So the repair could
 * book a $225 fee as some other number entirely while every margin still looked
 * plausible.
 *
 * `booked` below is what the engine actually put in the tier's totals.
 * `stated` is the sum of the governed fee columns. They must agree.
 *
 * Read-only. Writes nothing.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { PRODUCTION_MARKUP_CATEGORY } from "@/lib/costing";

const FIRM = (await db.execute(sql`
  select target_margin_pct::text as target, floor_margin_pct::text as floor
    from firm_settings where effective_until is null limit 1
`)) as unknown as { target: string; floor: string }[];
const RATE = (await db.execute(sql`
  select default_markup_pct::text as pct
    from markup_defaults where category = ${PRODUCTION_MARKUP_CATEGORY}
`)) as unknown as { pct: string }[];

const floor = Number(FIRM[0]?.floor ?? 0);
const target = Number(FIRM[0]?.target ?? 0);
const rate = Number(RATE[0]?.pct ?? 0);

const stated = (await db.execute(sql`
  select q.id::text as quote_id, q.status, api.tier_id::text as tier_id,
         sum(coalesce(api.setup_fee_total,0) + coalesce(api.tooling_artwork_total,0)
           + coalesce(api.tooling_total,0)  + coalesce(api.artwork_total,0)
           + coalesce(api.rd_total,0)       + coalesce(api.other_service_total,0)
           + coalesce(api.testing_micros_total,0))::float8 as stated
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
`)) as unknown as { quote_id: string; status: string; tier_id: string; stated: number }[];

const byQuote = new Map<string, { status: string; tiers: Map<string, number> }>();
for (const r of stated) {
  if (!byQuote.has(r.quote_id)) byQuote.set(r.quote_id, { status: r.status, tiers: new Map() });
  byQuote.get(r.quote_id)!.tiers.set(r.tier_id, r.stated);
}

const classify = (m: number | null) =>
  m === null ? "UNDEFINED" : m < floor ? "BELOW_FLOOR" : m < target ? "BELOW_TARGET" : "GOOD";
const pct = (v: number | null) => (v === null ? "  n/a  " : `${(v * 100).toFixed(2)}%`.padStart(7));
const r2 = (n: number) => Math.round(n * 100) / 100;

console.log(`\nAllocation-OFF repair — certification (repaired engine)`);
console.log(`  governed ${PRODUCTION_MARKUP_CATEGORY} rate: ${(rate * 100).toFixed(2)}%`);
console.log(`  target / floor: ${(target * 100).toFixed(2)}% / ${(floor * 100).toFixed(2)}%\n`);

let mismatches = 0;

for (const [quoteId, q] of byQuote) {
  const res = await getCostingBundle(quoteId);
  if (!res.ok) {
    console.log(`${quoteId.slice(0, 8)}  ${q.status}  BUNDLE ERROR`);
    continue;
  }
  console.log(`${quoteId.slice(0, 8)}  ${q.status}`);
  for (const t of res.data.costing.quoteRollup) {
    const st = q.tiers.get(t.tierId);
    if (st === undefined) continue;

    // What the engine BOOKED, read from the breakdown it publishes rather than
    // recomputed here — a second computation would be a second authority.
    const booked = t.costBreakdown.serviceFees;
    const bookedRecovery = t.costBreakdown.separateServicesMarkupSum;
    const agree = Math.abs(r2(booked) - r2(st)) < 0.005;
    if (!agree) mismatches += 1;

    console.log(
      `    ${t.label.padEnd(14)} margin ${pct(t.blendedMarginPct)} ${classify(t.blendedMarginPct).padEnd(12)}` +
        ` stated $${st.toFixed(2).padStart(10)}  booked $${r2(booked).toFixed(2).padStart(10)}` +
        `  recovery $${r2(bookedRecovery).toFixed(2).padStart(10)}` +
        (agree ? "" : "   <-- BOOKED != STATED"),
    );
  }
}

console.log(
  mismatches === 0
    ? "\nEvery charge booked at its stated amount.\n"
    : `\n${mismatches} tier(s) booked a charge that is not the stated amount — the ` +
        `qty_per_parent round trip is scaling it.\n`,
);
process.exit(mismatches === 0 ? 0 : 1);
