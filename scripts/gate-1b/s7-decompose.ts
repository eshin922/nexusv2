/**
 * #310 decomposition — attribute every commercial movement in the four movers
 * to a governed authority, or report it as UNEXPLAINED.
 *
 * Two confirmed authorities:
 *   BV-013 (5b8d428) · PRODUCTION_MARKUP_CATEGORY "Manufacturing"(0.30) -> "Production"(0.40)
 *                      RAW_MARKUP_CATEGORY "Raw ingredients"->Other(0.30) -> "Production"(0.40)
 *   #298   (8433e07) · a Direct Service's cost now reaches the engine
 *
 * BV-013 predicts markup-sum fields re-rate at a CONSTANT factor with the base
 * cost held: sum_after == base * 1.40 where sum_before == base * 1.30.
 * #298 predicts the BASE COST itself moves (cost appears where there was none).
 *
 * Anything matching neither is reported UNEXPLAINED — the point of the exercise
 * is to find those, not to confirm the ones we already understand.
 */
import { readFileSync } from "node:fs";
import { getCostingBundle } from "@/app/actions/costing";

const OLD = 1.30, NEW = 1.40, EPS = 1e-6;
const MOVERS = [
  "27581262-14b3-4f3f-86e8-b12123f7d899",
  "2f29af72-805b-446c-866c-73e9b0991b1a",
  "f5f5ac14-4d6b-4a48-98da-e6285a2cd9be",
  "f88c22e3-2d50-419e-b923-c771f5784531",
];
const base = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8"),
) as Record<string, any>;

const near = (a: number, b: number) =>
  a === b || Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

type Row = { quote: string; tier: string; field: string; before: number; after: number; verdict: string };
const rows: Row[] = [];

/** Attribute one costBreakdown field pair. */
function attribute(q: string, tier: string, field: string, b: any, a: any) {
  const before = b[field] ?? 0, after = a[field] ?? 0;
  if (near(before, after)) return;

  // Markup-sum fields carry their own base cost.
  const baseField = field === "productionMarkupSum" ? "production"
                  : field === "rawMarkupSum" ? "rawCost"
                  : null;
  if (baseField) {
    const cb = b[baseField] ?? 0, ca = a[baseField] ?? 0;
    if (near(cb, ca)) {
      // base held -> pure re-rate. BV-013 iff before==base*1.30 and after==base*1.40
      if (near(before, cb * OLD) && near(after, ca * NEW))
        return rows.push({ quote: q, tier, field, before, after, verdict: "BV-013 re-rate 1.30->1.40" });
      return rows.push({ quote: q, tier, field, before, after,
        verdict: `UNEXPLAINED (base held ${cb}; ratios ${(before / (cb || 1)).toFixed(4)} -> ${(after / (ca || 1)).toFixed(4)})` });
    }
    // base moved -> #298 cost restoration, then re-rate on the new base
    if (near(before, cb * OLD) && near(after, ca * NEW))
      return rows.push({ quote: q, tier, field, before, after, verdict: "#298 base moved + BV-013 re-rate" });
    return rows.push({ quote: q, tier, field, before, after,
      verdict: `UNEXPLAINED (base ${cb} -> ${ca}; ratios ${(before / (cb || 1)).toFixed(4)} -> ${(after / (ca || 1)).toFixed(4)})` });
  }

  if (field === "production" || field === "rawCost")
    return rows.push({ quote: q, tier, field, before, after, verdict: "#298 cost reaches engine" });

  rows.push({ quote: q, tier, field, before, after, verdict: "UNEXPLAINED" });
}

async function main() {
  for (const q of MOVERS) {
    const r = await getCostingBundle(q);
    if (!(r as any).ok) { console.log(`${q}: bundle FAILED`); continue; }
    const cur = (r as any).data.costing;
    const b = base[q];
    if (!b) { console.log(`${q}: absent from baseline`); continue; }

    for (const bt of b.quoteRollup) {
      const at = cur.quoteRollup.find((x: any) => x.label === bt.label);
      if (!at) { rows.push({ quote: q, tier: bt.label, field: "(tier)", before: 0, after: 0, verdict: "UNEXPLAINED tier missing" }); continue; }
      const fields = new Set([...Object.keys(bt.costBreakdown), ...Object.keys(at.costBreakdown)]);
      for (const f of fields) attribute(q, bt.label, f, bt.costBreakdown, at.costBreakdown);
      // revenue + margin are DERIVED from the above; report separately, not as causes
      for (const f of ["totalRevenue", "totalCost", "blendedMarginPct"] as const) {
        if (!near(bt[f] ?? 0, at[f] ?? 0))
          rows.push({ quote: q, tier: bt.label, field: f, before: bt[f], after: at[f], verdict: "derived" });
      }
    }
  }

  // ---- per-SKU tier fields. The quote rollup alone cannot report movement
  // here, so a decomposition that stops there cannot claim "all accounted for".
  for (const q of MOVERS) {
    const r = await getCostingBundle(q);
    if (!(r as any).ok) continue;
    const cur = (r as any).data.costing;
    const b = base[q];
    if (!b) continue;
    for (const bs of b.skuRollups ?? []) {
      const as_ = (cur.skuRollups ?? []).find((x: any) =>
        x.canonicalQuoteLeafId === bs.canonicalQuoteLeafId && x.skuLabel === bs.skuLabel);
      if (!as_) { rows.push({ quote: q, tier: "-", field: `sku ${bs.skuLabel}`, before: 0, after: 0, verdict: "UNEXPLAINED sku missing" }); continue; }
      for (const bp of bs.perTier ?? []) {
        const ap = (as_.perTier ?? []).find((x: any) => x.tierId === bp.tierId);
        if (!ap) continue;
        const tag = `${bs.skuLabel ?? bs.skuId?.slice(0,6)}`;
        for (const f of Object.keys(bp)) {
          const bv = bp[f], av = ap[f];
          if (typeof bv !== "number" || typeof av !== "number") continue;
          if (near(bv, av)) continue;
          const baseF = f === "productionMarkupSumPerUnit" ? "productionCostPerUnit"
                      : f === "rawMarkupSumPerUnit" ? "rawCostPerUnit" : null;
          if (baseF) {
            const cb = bp[baseF] ?? 0, ca = ap[baseF] ?? 0;
            if (near(cb, ca) && near(bv, cb * OLD) && near(av, ca * NEW)) {
              rows.push({ quote: q, tier: tag, field: f, before: bv, after: av, verdict: "BV-013 re-rate 1.30->1.40" });
              continue;
            }
            if (near(bv, cb * OLD) && near(av, ca * NEW)) {
              rows.push({ quote: q, tier: tag, field: f, before: bv, after: av, verdict: "#298 base moved + BV-013 re-rate" });
              continue;
            }
            rows.push({ quote: q, tier: tag, field: f, before: bv, after: av,
              verdict: `UNEXPLAINED (base ${cb} -> ${ca})` });
            continue;
          }
          if (f === "productionCostPerUnit" || f === "rawCostPerUnit") {
            rows.push({ quote: q, tier: tag, field: f, before: bv, after: av, verdict: "#298 cost reaches engine" });
            continue;
          }
          // everything else on a cell is downstream of cost+markup
          const DERIVED = ["cost","contributionCostPerUnit","factoryCostPerUnit","computedSellPerUnit",
            "requiredSellPerUnit","sellBeforeAdjustmentPerUnit","sellAfterAdjustmentPerUnit",
            "sellAfterLiftPerUnit","adjDeltaPerUnit","liftDeltaPerUnit","overrideDeltaPerUnit",
            "marginPct","revenue"];
          rows.push({ quote: q, tier: tag, field: f, before: bv, after: av,
            verdict: DERIVED.includes(f) ? "derived" : "UNEXPLAINED" });
        }
      }
    }
  }

  const unex = rows.filter((r) => r.verdict.startsWith("UNEXPLAINED"));
  const attributed = rows.filter((r) => !r.verdict.startsWith("UNEXPLAINED") && r.verdict !== "derived");
  const derived = rows.filter((r) => r.verdict === "derived");

  console.log(`\n=== attributed to a governed authority: ${attributed.length}`);
  for (const r of attributed)
    console.log(`  ${r.quote.slice(0, 8)} ${r.tier.padEnd(8)} ${r.field.padEnd(22)} ${r.before} -> ${r.after}   [${r.verdict}]`);

  console.log(`\n=== derived (revenue/cost/margin follow the above): ${derived.length}`);

  console.log(`\n=== UNEXPLAINED: ${unex.length}`);
  for (const r of unex)
    console.log(`  ${r.quote.slice(0, 8)} ${r.tier.padEnd(8)} ${r.field.padEnd(22)} ${r.before} -> ${r.after}   ${r.verdict}`);

  console.log(unex.length === 0
    ? "\nEvery commercial movement is accounted for by BV-013 / #298.\n"
    : "\nUnexplained movement remains. DO NOT re-baseline.\n");
  process.exit(0);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
