/** READ-ONLY. Dumps the live shape of a quote and, if present, its frozen
 *  matrix — the two sides the #300 walk compares. */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const quoteId = process.argv[2];
if (!quoteId) { console.error("usage: freeze-walk-inspect <quoteId>"); process.exit(1); }
const rows = <T,>(r: unknown) => r as unknown as T[];

const [q] = rows<{ status: string; version_number: number; label: string; qn: string | null; accepted_tier: string | null }>(
  await db.execute(sql`select status::text, version_number, coalesce(scenario_label,'—') as label,
                              quote_number as qn, customer_accepted_tier_id::text as accepted_tier
                         from quotes where id = ${quoteId}::uuid`));
console.log(`\nquote ${quoteId}\n  status=${q.status} v${q.version_number} "${q.label}" number=${q.qn ?? "—"} acceptedTier=${q.accepted_tier ?? "—"}`);

const tiers = rows<{ id: string; label: string; qty: number }>(
  await db.execute(sql`select id::text, label, qty from quote_tiers where quote_id=${quoteId}::uuid order by qty`));
console.log("\n  tiers:", tiers.map((t) => `${t.label}@${t.qty}`).join("  "));

const lines = rows<{ leaf: string; name: string; sku: string; kind: string; svc: string | null; asm: string | null }>(
  await db.execute(sql`
    select ql.id::text as leaf, l.name, l.sku, ql.commercial_kind::text as kind,
           l.service_identity::text as svc, a.sku as asm
      from quote_leaves ql
      join leaves l on l.id = ql.leaf_id
      left join assembly_leaves al on al.quote_leaf_id = ql.id
      left join assemblies a on a.id = al.assembly_id
     where ql.quote_id = ${quoteId}::uuid order by kind, l.sku`));
console.log("\n  live lines:");
for (const l of lines) console.log(`    ${l.kind.padEnd(8)} ${(l.svc ?? "").padEnd(16)} ${(l.sku ?? "").padEnd(22)} ${l.name}  ${l.asm ? `[in ${l.asm}]` : "[top-level]"}`);

const prod = rows<{ asm: string | null; leaf: string | null; tier: string; alloc: boolean;
  setup: string | null; tooling: string | null; rd: string | null; other: string | null; tm: string | null }>(
  await db.execute(sql`
    select a.sku as asm, ql.id::text as leaf, t.label as tier,
           api.allocate_service_fees_to_cost as alloc,
           api.setup_fee_total::text as setup, api.tooling_artwork_total::text as tooling,
           api.rd_total::text as rd, api.other_service_total::text as other,
           api.testing_micros_total::text as tm
      from assembly_production_inputs api
      join quote_tiers t on t.id = api.tier_id
      left join assemblies a on a.id = api.assembly_id
      left join quote_leaves ql on ql.id = api.quote_leaf_id
     where t.quote_id = ${quoteId}::uuid order by a.sku nulls last, t.qty`));
console.log("\n  production rows (owner · tier · alloc · setup/tooling/rd/other/testing):");
for (const p of prod)
  console.log(`    ${(p.asm ?? `leaf:${p.leaf?.slice(0,8)}`).padEnd(24)} ${p.tier.padEnd(8)} alloc=${String(p.alloc).padEnd(5)} ${[p.setup,p.tooling,p.rd,p.other,p.tm].map(v=>v??"—").join(" / ")}`);

const snap = rows<{ id: string; v: number; sent: string; superseded: string | null }>(
  await db.execute(sql`select id::text, version_number as v, sent_at::text as sent, superseded_at::text as superseded
                         from quote_snapshots where quote_id=${quoteId}::uuid order by version_number`));
console.log(`\n  snapshots: ${snap.length === 0 ? "none" : ""}`);
for (const s of snap) console.log(`    v${s.v} ${s.id} sent=${s.sent} superseded=${s.superseded ?? "—"}`);

for (const s of snap) {
  const tot = rows<{ tier_label: string; qty: number | null; unit: string; otc: string; total: string; prov: boolean }>(
    await db.execute(sql`select tier_label, quantity as qty, unit_subtotal::text as unit,
                                otc_subtotal::text as otc, tier_commercial_total::text as total,
                                total_is_provisional as prov
                           from quote_snapshot_tier_totals where quote_snapshot_id=${s.id}::uuid order by quantity`));
  if (tot.length === 0) { console.log(`    v${s.v}: NO FROZEN MATRIX`); continue; }
  console.log(`\n  ── frozen matrix · v${s.v} ──`);
  console.log("    tier        qty      unit_subtotal   otc_subtotal   tier_commercial_total  provisional");
  for (const t of tot)
    console.log(`    ${t.tier_label.padEnd(10)} ${String(t.qty ?? "—").padStart(6)} ${t.unit.padStart(16)} ${t.otc.padStart(14)} ${t.total.padStart(22)}  ${t.prov}`);

  const cells = rows<{ kind: string; name: string; sku: string | null; svc: string | null; pos: number;
    tier_label: string; state: string; rate: string | null; amount: string | null; alloc: string | null }>(
    await db.execute(sql`
      select ln.line_kind::text as kind, ln.display_name as name, ln.display_sku as sku,
             ln.service_identity::text as svc, ln.position as pos,
             ct.tier_label, ct.pricing_state::text as state, ct.unit_rate::text as rate,
             ct.line_amount::text as amount, ct.allocation_state::text as alloc
        from quote_snapshot_lines ln
        join quote_snapshot_line_tiers ct on ct.quote_snapshot_line_id = ln.id
       where ln.quote_snapshot_id = ${s.id}::uuid
       order by ln.position, ct.quantity`));
  console.log("\n    line                                   kind              tier      state             rate         amount   alloc");
  for (const c of cells)
    console.log(`    ${`${c.sku ?? ""} ${c.name}`.slice(0,38).padEnd(38)} ${c.kind.padEnd(17)} ${c.tier_label.padEnd(9)} ${c.state.padEnd(17)} ${(c.rate ?? "—").padStart(10)} ${(c.amount ?? "—").padStart(12)}   ${c.alloc ?? "—"}`);
}
process.exit(0);
