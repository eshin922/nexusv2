/** READ-ONLY. Quote/tier economics and per-cell margins, for before/after.
 *
 *  The control OD-028 turns on: an ordinary computed-price quote must not move
 *  at all. Run on `main`, run on the branch, diff. Anything that moves on a
 *  quote with no member-specific lever is a defect in the repair, not a
 *  correction — Edward's disposition A, 2026-08-28.
 *
 *  Captures per-CELL margins too, because removing false member attribution is
 *  expected to move those and the movement has to be explicit rather than
 *  discovered later.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { projectCommercial } from "@/lib/commercial-projection";
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("usage: od-028-economics-capture <out.json>");
  process.exit(1);
}
const rows = <T,>(r: unknown) => r as unknown as T[];

const quotes = rows<{ id: string; label: string | null }>(
  await db.execute(sql`
    select q.id::text id, q.scenario_label label
      from quotes q
     where exists (select 1 from assemblies a where a.quote_id = q.id)
       and exists (select 1 from quote_tiers t where t.quote_id = q.id)
     order by q.id`),
);
console.log(`[capture] ${quotes.length} quotes carrying an assembly`);

type Cap = {
  quoteId: string;
  tiers: string[];
  doc: string[];
  cells: string[];
  ok: boolean;
};
const caps: Cap[] = [];
let failed = 0;

for (const q of quotes) {
  const b = await getCostingBundle(q.id);
  if (!b.ok) {
    // A quote the bundle cannot resolve is recorded as UNRESOLVED, never as
    // "no economics" — the two must not compare equal.
    caps.push({ quoteId: q.id, tiers: ["UNRESOLVED"], doc: ["UNRESOLVED"], cells: ["UNRESOLVED"], ok: false });
    failed++;
    continue;
  }
  const c = b.data.costing;
  const tiers = c.quoteRollup.map(
    (r) =>
      `${r.label}|rev=${r.totalRevenue.toFixed(4)}|cost=${r.totalCost.toFixed(4)}|margin=${(r.blendedMarginPct ?? -1).toFixed(8)}`,
  );
  const cells: string[] = [];
  for (const sku of c.skuRollups) {
    for (const pt of sku.perTier) {
      cells.push(
        `${sku.skuId}|${pt.tierId}|cost=${pt.contributionCostPerUnit.toFixed(8)}` +
          `|sell=${pt.requiredSellPerUnit.toFixed(8)}|margin=${(pt.marginPct ?? -1).toFixed(8)}` +
          `|prod=${pt.productionCostPerUnit.toFixed(8)}`,
      );
    }
  }
  // THE DOCUMENT, not only the engine.
  //
  // The engine-only capture certified a quote whose customer document was short
  // by 1,400: placement moved money out of the unit lines and nothing checked
  // that it arrived anywhere. Document totals are captured here and compared
  // against governed engine revenue, so that class cannot pass unseen again.
  const doc: string[] = [];
  try {
    const proj = projectCommercial(b.data as never);
    for (const t of proj.tiers) {
      const eng = c.quoteRollup.find((r) => r.tierId === t.tierId);
      doc.push(
        `${t.tierLabel}|unit=${t.unitSubtotal.toFixed(4)}|otc=${t.otcSubtotal.toFixed(4)}` +
          `|total=${t.tierCommercialTotal.toFixed(4)}` +
          `|vsEngineRevenue=${eng ? (t.tierCommercialTotal - eng.totalRevenue).toFixed(4) : "NO_TIER"}`,
      );
    }
  } catch (e) {
    // INDETERMINATE, never silently clean.
    doc.push(`PROJECTION_FAILED: ${(e as Error).message.slice(0, 80)}`);
  }
  caps.push({ quoteId: q.id, tiers, doc, cells: cells.sort(), ok: true });
}

caps.sort((a, b) => a.quoteId.localeCompare(b.quoteId));
writeFileSync(out, JSON.stringify(caps, null, 2));
console.log(`[capture] wrote ${out} · ${caps.length} quotes · ${failed} unresolved`);
process.exit(0);
