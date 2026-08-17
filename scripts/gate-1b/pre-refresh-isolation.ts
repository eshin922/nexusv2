/**
 * Pre-refresh isolation for the V1 freight distribution policy.
 *
 * The question a refresh has to answer is not "did anything move" — the delta
 * script already says that — but "is EVERY material movement explained by the
 * policy we just dispositioned, and nothing else". So this checks the property
 * the policy implies rather than re-deriving the policy:
 *
 *   Distribution changes WHO bears a shipment's freight. It cannot change how
 *   much the shipment costs. Therefore every tier's freight COST, and every
 *   non-freight cost component, must be unchanged on every quote in the basket.
 *
 *   Revenue may move ONLY where a member of a shipment carries an operator
 *   lever — a direct price or a lift — because that member's share is then
 *   inside the operator's number instead of flowing through the markup chain.
 *
 * A quote whose freight cost moved, or whose revenue moved with no lever on any
 * member, is unexplained and stops the refresh.
 *
 * READ ONLY.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { basketPredicate } from "./basket.ts";

const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8"),
) as Record<string, any>;

const NOISE = 1e-9;
const near = (x: number | null, y: number | null) =>
  x === null || y === null
    ? x === y
    : x === y || Math.abs(x - y) <= NOISE * Math.max(1, Math.abs(x), Math.abs(y));

type Row = {
  quote: string;
  label: string;
  movedPaths: string[];
  costMoved: string[];
  revenueMoved: { tier: string; before: number; after: number }[];
  shipments: { id: string; members: number; leverMembers: number }[];
};

async function main() {
  const quotes = (await db.execute(sql`
    select q.id::text quote_id, coalesce(q.scenario_label,'') label
      from quotes q where ${basketPredicate()} order by q.id`)) as unknown as
    { quote_id: string; label: string }[];

  console.log(`\n=== Pre-refresh isolation · ${quotes.length} basket quotes ===\n`);
  const changed: Row[] = [];
  let unexplained = 0;

  for (const q of quotes) {
    const base = baseline[q.quote_id];
    if (!base) continue;
    const res = await getCostingBundle(q.quote_id);
    if (!res.ok) { console.log(`  FAIL ${q.quote_id} bundle error`); unexplained++; continue; }
    const cur = res.data.costing;

    // Cost components that distribution MUST NOT touch.
    const costMoved: string[] = [];
    for (let i = 0; i < (base.quoteRollup?.length ?? 0); i++) {
      const b = base.quoteRollup[i], c = cur.quoteRollup[i];
      if (!c) { costMoved.push(`tier ${i} absent`); continue; }
      for (const k of ["freight","freightContainer","dutyAndTariff","packaging","production","serviceFees"] as const) {
        if (!near(b.costBreakdown?.[k] ?? null, c.costBreakdown?.[k] ?? null))
          costMoved.push(`${b.label}.${k} ${b.costBreakdown?.[k]} -> ${c.costBreakdown?.[k]}`);
      }
      if (!near(b.totalCost ?? null, c.totalCost ?? null))
        costMoved.push(`${b.label}.totalCost ${b.totalCost} -> ${c.totalCost}`);
      if (!near(b.qty ?? null, c.qty ?? null))
        costMoved.push(`${b.label}.qty ${b.qty} -> ${c.qty}`);
    }

    const revenueMoved: Row["revenueMoved"] = [];
    for (let i = 0; i < (base.quoteRollup?.length ?? 0); i++) {
      const b = base.quoteRollup[i], c = cur.quoteRollup[i];
      if (c && !near(b.totalRevenue ?? null, c.totalRevenue ?? null))
        revenueMoved.push({ tier: b.label, before: b.totalRevenue, after: c.totalRevenue });
    }

    // Membership + levers, the explanation the policy offers.
    const ships = (await db.execute(sql`
      select fs.id,
             (select count(*)::int from freight_subcategory_items i
               where i.freight_subcategory_id = fs.id) members,
             (select count(*)::int from freight_subcategory_items i
                where i.freight_subcategory_id = fs.id
                  and (exists (select 1 from assembly_leaf_overrides o where o.quote_leaf_id = i.quote_leaf_id)
                    or exists (select 1 from quote_leaf_lifts l where l.quote_leaf_id = i.quote_leaf_id))) lever
        from freight_subcategories fs where fs.quote_id = ${q.quote_id}`)) as unknown as
      { id: string; members: number; lever: number }[];

    if (costMoved.length === 0 && revenueMoved.length === 0) continue;

    changed.push({
      quote: q.quote_id, label: q.label, movedPaths: [], costMoved, revenueMoved,
      shipments: ships.map(s => ({ id: s.id, members: Number(s.members), leverMembers: Number(s.lever) })),
    });
  }

  for (const r of changed) {
    const leverTotal = r.shipments.reduce((a, s) => a + s.leverMembers, 0);
    const explained = r.costMoved.length === 0 && (r.revenueMoved.length === 0 || leverTotal > 0);
    if (!explained) unexplained++;
    console.log(`${explained ? "  EXPLAINED" : "  *** UNEXPLAINED ***"}  ${r.quote}  ${r.label}`);
    console.log(`      shipments: ${r.shipments.map(s => `${s.id.slice(0,8)} N=${s.members} levers=${s.leverMembers}`).join(" · ") || "none"}`);
    for (const c of r.costMoved) console.log(`      COST MOVED (not permitted): ${c}`);
    for (const v of r.revenueMoved)
      console.log(`      revenue ${v.tier}: ${v.before} -> ${v.after}   (Δ ${(v.after - v.before).toFixed(2)})`);
  }
  if (changed.length === 0) console.log("  (no quote moved)");

  console.log(`\n  materially changed quotes : ${changed.length}`);
  console.log(`  unexplained               : ${unexplained}`);
  console.log(unexplained === 0 ? "\nISOLATION CLEAN — safe to refresh\n" : "\nSTOP — unexplained movement\n");
  process.exit(unexplained === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
