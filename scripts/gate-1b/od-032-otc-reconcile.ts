/** READ-ONLY. cost -> derived recovery -> treatment -> engine revenue -> PDF
 *  one-time-fee subtotal, per tier, for one quote.
 *
 *  Built to answer whether the engine and the customer document disagree about
 *  one-time fees, or whether a charge-level figure is being read against a
 *  per-tier one.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";

const quoteId = process.argv[2];
if (!quoteId) {
  console.error("usage: od-032-otc-reconcile <quoteId>");
  process.exit(1);
}
const rows = <T,>(r: unknown) => r as unknown as T[];
const m = (v: number | null | undefined) =>
  v === null || v === undefined ? "     —   " : v.toFixed(2).padStart(10);

// ---- 1 · the governed COSTS, per tier -------------------------------------
const costs = rows<{ tier: string; so: string; total: string; alloc: string }>(
  await db.execute(sql`
    select t.label tier, t.sort_order::text so, t.qty::text qty,
           coalesce(sum(
             coalesce(p.setup_fee_total,0) + coalesce(p.tooling_artwork_total,0) +
             coalesce(p.tooling_total,0)   + coalesce(p.artwork_total,0) +
             coalesce(p.rd_total,0)        + coalesce(p.other_service_total,0)
           ),0)::text total,
           bool_and(p.allocate_service_fees_to_cost)::text alloc
      from quote_tiers t
      left join assembly_production_inputs p on p.tier_id = t.id
     where t.quote_id = ${quoteId}::uuid
     group by t.label, t.sort_order, t.qty
     order by t.sort_order`),
);

// ---- 2 · the ELECTIONS -----------------------------------------------------
const elections = rows<{ ck: string; mode: string }>(
  await db.execute(sql`
    select i.charge_key::text ck, r.mode::text mode
      from quote_charge_instances i
      join quote_charge_recovery r on r.charge_instance_id = i.id
     where i.quote_id = ${quoteId}::uuid order by i.charge_key`),
);

const b = await getCostingBundle(quoteId);
if (!b.ok) { console.log("bundle failed"); process.exit(1); }
const c = b.data.costing;
const doc = projectCommercial(b.data as never);

console.log(`quote ${quoteId}`);
console.log(`elections: ${elections.map((e) => `${e.ck}=${e.mode}`).join(", ") || "(none)"}`);
console.log();
console.log(
  "tier      | governed cost |  engine rev |   doc unit |    doc otc |  doc total | otc lines",
);
console.log("-".repeat(96));

for (const t of costs) {
  const eng = c.quoteRollup.find((r) => r.label === t.tier);
  const d = doc.tiers.find((x) => x.tierLabel === t.tier);
  const otcLines = doc.lines.filter(
    (l) => l.kind === "otc" && l.cells.some((cell, i) =>
      doc.tiers[i]?.tierLabel === t.tier && cell.state === "priced" && cell.lineAmount !== 0),
  ).length;
  console.log(
    `${t.tier.padEnd(9)} | ${m(Number(t.total))}    | ${m(eng?.totalRevenue)} | ` +
      `${m(d?.unitSubtotal)} | ${m(d?.otcSubtotal)} | ${m(d?.tierCommercialTotal)} | ${otcLines}`,
  );
}

console.log();
console.log("OTC LINES, per tier amount:");
for (const l of doc.lines.filter((x) => x.kind === "otc")) {
  const per = l.cells
    .map((cell, i) => `${doc.tiers[i]?.tierLabel}=${cell.state === "priced" ? cell.lineAmount.toFixed(2) : cell.state}`)
    .join("  ");
  console.log(`  ${(l.displayName ?? l.key).slice(0, 34).padEnd(36)} ${per}`);
}

console.log();
console.log("RECONCILIATION per tier — doc unit + doc otc == doc total == engine revenue?");
for (const t of costs) {
  const eng = c.quoteRollup.find((r) => r.label === t.tier);
  const d = doc.tiers.find((x) => x.tierLabel === t.tier);
  if (!d || !eng) continue;
  const sum = d.unitSubtotal + d.otcSubtotal;
  console.log(
    `  ${t.tier.padEnd(9)} unit+otc=${sum.toFixed(2).padStart(12)}  docTotal=${d.tierCommercialTotal.toFixed(2).padStart(12)}` +
      `  engineRev=${eng.totalRevenue.toFixed(2).padStart(12)}  residual=${(d.tierCommercialTotal - eng.totalRevenue).toFixed(4)}`,
  );
}
process.exit(0);
