/**
 * Cost Stack margin row — which "blended margin"? READ ONLY.
 *
 * Finding 3 of the Phase 3 mount asks what commercial quantity the Cost Stack
 * margin row is intended to represent. The Design Authority answers the
 * question in words (R11 designer notes §12.1: blended margin per tier is "a
 * genuine independent fact"; worst margin "was never an independent fact"), and
 * the canonical prototype answers it in code (`app/r11/data.js:88` computes
 * `margin` from weighted means and `worstMargin` as a separate field; the stack
 * renders `margin`).
 *
 * That settles worst-versus-blended. It does NOT settle WHICH blended, and the
 * page turns out to carry THREE quantities under that name:
 *
 *   A. `QuotePerTierRollup.blendedMarginPct` — (totalRevenue − totalCost) /
 *      totalRevenue, summed over TOP-LEVEL skus via `pt.revenue` / `pt.cost`.
 *      Revenue-weighted.
 *
 *   B. `quote/{tier}/margin` — the OD-019 ratio, over units-weighted means of
 *      `requiredSellPerUnit` and `contributionCostPerUnit` across LEAVES
 *      (`skuRole === "leaf"`, weight = tierQty × qtyPerParent).
 *
 *   C. `TierRollup.blended_margin_pct` (`pricing-classifier.ts:463`) — an
 *      UNWEIGHTED arithmetic mean of per-cell margin PERCENTAGES. This is what
 *      the Per-tier compliance table renders under the heading "BLENDED".
 *
 * A and B differ in population and weighting and could diverge in principle.
 * C differs in kind: a mean of ratios is not a ratio of sums, and it weights a
 * $0.20 label the same as a $4.90 bottle.
 *
 * Wiring the Cost Stack column to any of them without knowing how they compare
 * would risk a fresh instance of the same-label-different-quantity problem this
 * finding is about. So: measure before recommending.
 *
 * RESULT (2026-08-10, 24 quotes / 52 tiers / 37 with readable revenue):
 *   A vs B — 0 disagreements. Identical on every tier.
 *   A vs C — 18 of 37 disagree, up to 2.29pp.
 *   worst vs blended — 18 of 52 tiers differ, up to 2.1pp.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { readNodeValue, quoteScopeKey } from "@/lib/costing-nodes";

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q
   where exists (select 1 from assemblies a
      join assembly_leaves al on al.assembly_id = a.id where a.quote_id = q.id)
   order by q.id
`)) as unknown as { quote_id: string }[];

type Row = {
  quote: string;
  tier: string;
  /** (A) the classifier / per-tier rollup value. */
  rollup: number | null;
  /** (B) the graph ratio OD-019 added. */
  graph: number | null;
  /** what the Cost Stack renders today. */
  worst: number | null;
  /** (C) the classifier's unweighted mean of per-cell margins. */
  meanOfCells: number | null;
  agree: boolean;
  gapPoints: number | null;
};

const rows: Row[] = [];
let unreadable = 0;

for (const { quote_id } of quotes) {
  const bundle = await getCostingBundle(quote_id);
  if (!bundle.ok) continue;
  const { costing } = bundle.data;
  const graph = costing.graph;

  for (const tier of costing.quoteRollup) {
    const rollup = tier.blendedMarginPct;
    const graphMargin = readNodeValue(graph, quoteScopeKey(tier.tierId, "margin"));
    if (graphMargin === null) unreadable++;

    // The worst SKU margin at this tier — what the column shows today — and
    // the classifier's OWN "blended", which is a third quantity again: an
    // UNWEIGHTED arithmetic mean of per-cell margin percentages
    // (`pricing-classifier.ts:463`). A mean of ratios is not a ratio of sums,
    // so this need not equal A or B, and it is what the Per-tier compliance
    // table renders under the heading "BLENDED".
    let worst: number | null = null;
    const cellMargins: number[] = [];
    for (const sr of costing.skuRollups) {
      const pt = sr.perTier.find((p) => p.tierId === tier.tierId);
      if (!pt || pt.marginPct === null) continue;
      worst = worst === null ? pt.marginPct : Math.min(worst, pt.marginPct);
      cellMargins.push(pt.marginPct);
    }
    const meanOfCells = cellMargins.length
      ? cellMargins.reduce((s, m) => s + m, 0) / cellMargins.length
      : null;

    const agree =
      rollup !== null && graphMargin !== null && Math.abs(rollup - graphMargin) < 1e-9;
    rows.push({
      quote: quote_id.slice(0, 8),
      tier: tier.label,
      rollup,
      graph: graphMargin,
      worst,
      meanOfCells,
      agree,
      gapPoints:
        rollup !== null && graphMargin !== null ? (graphMargin - rollup) * 100 : null,
    });
  }
}

const both = rows.filter((r) => r.rollup !== null && r.graph !== null);
const disagree = both.filter((r) => !r.agree);
const worstDiffers = rows.filter(
  (r) => r.rollup !== null && r.worst !== null && Math.abs(r.rollup - r.worst) > 1e-9,
);

console.log(`tiers measured           ${rows.length}`);
console.log(`both values readable     ${both.length}`);
console.log(`graph margin unreadable  ${unreadable}  (zero-revenue / zero-qty tiers)`);
console.log("");
console.log(`(A) rollup vs (B) graph — DISAGREE: ${disagree.length} of ${both.length}`);
if (disagree.length > 0) {
  const worstGap = disagree.reduce((w, r) =>
    Math.abs(r.gapPoints!) > Math.abs(w.gapPoints!) ? r : w,
  );
  console.log(`  largest gap ${worstGap.gapPoints!.toFixed(4)}pp on ${worstGap.quote} · ${worstGap.tier}`);
  for (const r of disagree.slice(0, 10)) {
    console.log(
      `  ${r.quote} · ${r.tier}: rollup ${(r.rollup! * 100).toFixed(4)}%  graph ${(r.graph! * 100).toFixed(4)}%  Δ${r.gapPoints!.toFixed(4)}pp`,
    );
  }
}
const meanDiffers = both.filter(
  (r) => r.meanOfCells !== null && Math.abs(r.rollup! - r.meanOfCells) > 1e-9,
);
console.log(
  `(A) rollup vs (C) unweighted mean of cells — DISAGREE: ${meanDiffers.length} of ${both.length}`,
);
if (meanDiffers.length > 0) {
  const w = meanDiffers.reduce((a, r) =>
    Math.abs(r.rollup! - r.meanOfCells!) > Math.abs(a.rollup! - a.meanOfCells!) ? r : a,
  );
  console.log(
    `  largest gap ${((w.meanOfCells! - w.rollup!) * 100).toFixed(2)}pp on ${w.quote} · ${w.tier}`,
  );
  for (const r of meanDiffers.slice(0, 8)) {
    console.log(
      `  ${r.quote} · ${r.tier}: revenue-weighted ${(r.rollup! * 100).toFixed(2)}%  mean-of-cells ${(r.meanOfCells! * 100).toFixed(2)}%  Δ${((r.meanOfCells! - r.rollup!) * 100).toFixed(2)}pp`,
    );
  }
}
console.log("");
console.log(
  `worst-SKU margin differs from blended: ${worstDiffers.length} of ${rows.length} tiers`,
);
for (const r of worstDiffers.slice(0, 8)) {
  console.log(
    `  ${r.quote} · ${r.tier}: blended ${(r.rollup! * 100).toFixed(1)}%  worst ${(r.worst! * 100).toFixed(1)}%  Δ${((r.rollup! - r.worst!) * 100).toFixed(1)}pp`,
  );
}

process.exit(0);
