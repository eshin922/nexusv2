/**
 * Does the repaired engine's tier revenue reconcile with what was FROZEN?
 *
 * The projection has always billed the separately-billed charge — it emits the
 * line — so `quote_snapshot_tier_totals.tier_commercial_total` has always
 * included it. The ENGINE did not. If that is right, then pre-repair the two
 * disagreed by exactly the charge's recovery, and post-repair they agree.
 *
 * Which would mean the frozen record was correct all along and the engine was
 * the side that was wrong — the strongest available statement that this repair
 * moves the engine toward the customer's document rather than away from it.
 *
 * Read-only.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";

const frozen = (await db.execute(sql`
  select q.id::text as quote_id, q.status, s.version_number,
         tt.tier_id::text as tier_id, tt.tier_label,
         tt.unit_subtotal::float8 as unit_subtotal,
         tt.otc_subtotal::float8 as otc_subtotal,
         tt.tier_commercial_total::float8 as frozen_total
    from quote_snapshot_tier_totals tt
    join quote_snapshots s on s.id = tt.quote_snapshot_id
    join quotes q on q.id = s.quote_id
   where exists (
     select 1 from assemblies a
       join assembly_production_inputs api on api.assembly_id = a.id
      where a.quote_id = q.id and api.allocate_service_fees_to_cost = false
   )
   order by q.id::text, s.version_number, tt.tier_label
`)) as unknown as {
  quote_id: string; status: string; version_number: number;
  tier_id: string; tier_label: string;
  unit_subtotal: number; otc_subtotal: number; frozen_total: number;
}[];

const r2 = (n: number) => Math.round(n * 100) / 100;
const bundles = new Map<string, Awaited<ReturnType<typeof getCostingBundle>>>();

console.log(`\nFrozen commercial total vs repaired engine revenue\n`);
let agree = 0;
let disagree = 0;

for (const f of frozen) {
  if (!bundles.has(f.quote_id)) bundles.set(f.quote_id, await getCostingBundle(f.quote_id));
  const res = bundles.get(f.quote_id)!;
  if (!res.ok) continue;
  const t = res.data.costing.quoteRollup.find((x) => x.tierId === f.tier_id);
  if (!t) continue;

  const live = r2(t.totalRevenue);
  const froz = r2(f.frozen_total);
  const otc = r2(f.otc_subtotal);
  const match = Math.abs(live - froz) < 0.005;
  match ? (agree += 1) : (disagree += 1);

  console.log(
    `  ${f.quote_id.slice(0, 8)} v${f.version_number} ${f.tier_label.padEnd(12)}` +
      ` frozen $${froz.toFixed(2).padStart(12)}  (otc $${otc.toFixed(2).padStart(9)})` +
      `  engine $${live.toFixed(2).padStart(12)}` +
      (match ? "   reconciles" : `   DIFFERS by ${r2(live - froz).toFixed(2)}`),
  );
}

console.log(
  `\n${agree} tier(s) reconcile, ${disagree} differ.\n` +
    `A tier that reconciles is one where the engine now agrees with the document\n` +
    `the customer actually received.\n`,
);
process.exit(0);
