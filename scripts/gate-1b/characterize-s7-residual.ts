/**
 * S-7 residual characterization for 2f29af72 after the Pattern 58 freight repair.
 *
 * The question is NOT "did anything move" — `confirm-s7-delta.ts` already answers
 * that, and answers it as a multiset with array indices erased, which is exactly
 * what cannot say WHICH product a value moved to. This resolves each remaining
 * path down to the owning SKU on both sides, so "attribution moved" and "money
 * moved" can be told apart by inspection rather than asserted.
 *
 * READ ONLY. Creates nothing, deletes nothing, refreshes nothing.
 */
import { readFileSync } from "node:fs";
import { getCostingBundle } from "@/app/actions/costing";
import type { QuoteCostingResult } from "@/lib/costing";

const QUOTE = "2f29af72-805b-446c-866c-73e9b0991b1a";
const NOISE = 1e-9;
const isNoise = (x: number, y: number) =>
  x === y || Math.abs(x - y) <= NOISE * Math.max(1, Math.abs(x), Math.abs(y));

const PATHS = [
  "contributionCostPerUnit",
  "sellBeforeAdjustmentPerUnit",
  "adjDeltaPerUnit",
  "sellAfterAdjustmentPerUnit",
  "sellAfterLiftPerUnit",
  "computedSellPerUnit",
  "requiredSellPerUnit",
  "revenue",
  "cost",
  "marginPct",
] as const;

const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8"),
) as Record<string, { skuRollups: any[]; quoteRollup: any[]; quoteSummary: any }>;

function fmt(v: unknown) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number(v.toFixed(6)).toString();
  return String(v);
}

async function main() {
  const base = baseline[QUOTE];
  const res = await getCostingBundle(QUOTE);
  if (!res.ok) throw new Error("bundle failed");
  const cur: QuoteCostingResult = res.data.costing;

  const label = new Map<string, string>();
  for (const s of cur.skuRollups) label.set(s.skuId, `${s.skuId.slice(0, 8)} ${s.skuRole}`);
  for (const s of base.skuRollups) if (!label.has(s.skuId)) label.set(s.skuId, `${s.skuId.slice(0, 8)} ${s.skuRole}`);

  const tierLabel = new Map<string, string>();
  for (const t of cur.quoteRollup) tierLabel.set(t.tierId, t.label);

  // Who bears freight, per tier, on each side.
  const bearer = (rollups: any[], tierId: string) =>
    rollups
      .filter((s) => {
        const pt = s.perTier.find((p: any) => p.tierId === tierId);
        return pt && s.skuRole === "leaf" && (pt.totalContainerFreightBeforeMarkup ?? 0) > 0;
      })
      .map((s) => s.skuId.slice(0, 8));

  console.log("\n=== freight owner, baseline vs current ===");
  for (const t of cur.quoteRollup)
    console.log(
      `  ${t.label.padEnd(8)} baseline=[${bearer(base.skuRollups, t.tierId)}]  current=[${bearer(cur.skuRollups, t.tierId)}]`,
    );

  console.log("\n=== the 10 residual paths, resolved to the owning SKU ===");
  console.log(
    "  path".padEnd(32) + "tier".padEnd(9) + "SKU".padEnd(20) +
    "baseline".padEnd(16) + "current".padEnd(16) + "class",
  );
  let aggregateBreach = 0;
  let rows = 0;
  const pathSkus = new Map<string, Set<string>>();

  for (const p of PATHS) {
    for (const t of cur.quoteRollup) {
      for (const s of cur.skuRollups) {
        const b = base.skuRollups.find((x: any) => x.skuId === s.skuId);
        const bpt = b?.perTier.find((x: any) => x.tierId === t.tierId);
        const cpt = s.perTier.find((x: any) => x.tierId === t.tierId);
        if (!bpt || !cpt) continue;
        const bv = bpt[p];
        const cv = cpt[p];
        if (bv === null || cv === null) {
          if (bv === cv) continue;
        } else if (isNoise(Number(bv), Number(cv))) continue;
        rows++;
        (pathSkus.get(p) ?? pathSkus.set(p, new Set()).get(p)!).add(s.skuId.slice(0, 8));
        console.log(
          `  ${p}`.padEnd(34) + String(tierLabel.get(t.tierId)).padEnd(9) +
          String(label.get(s.skuId)).padEnd(20) +
          fmt(bv).padEnd(16) + fmt(cv).padEnd(16) + "attribution",
        );
      }
    }
  }
  if (rows === 0) console.log("  (none)");

  console.log("\n=== aggregate / tier invariants ===");
  for (const t of cur.quoteRollup) {
    const b = base.quoteRollup.find((x: any) => x.tierId === t.tierId);
    if (!b) { console.log(`  ${t.label}: absent from baseline`); aggregateBreach++; continue; }
    const checks: Array<[string, number | null, number | null]> = [
      ["totalRevenue", b.totalRevenue, t.totalRevenue],
      ["totalCost", b.totalCost, t.totalCost],
      ["blendedMarginPct", b.blendedMarginPct, t.blendedMarginPct],
      ["costBreakdown.freight", b.costBreakdown?.freight ?? null, t.costBreakdown?.freight ?? null],
      ["costBreakdown.freightContainer", b.costBreakdown?.freightContainer ?? null, t.costBreakdown?.freightContainer ?? null],
      ["costBreakdown.dutyAndTariff", b.costBreakdown?.dutyAndTariff ?? null, t.costBreakdown?.dutyAndTariff ?? null],
      ["costBreakdown.packaging", b.costBreakdown?.packaging ?? null, t.costBreakdown?.packaging ?? null],
      ["costBreakdown.production", b.costBreakdown?.production ?? null, t.costBreakdown?.production ?? null],
    ];
    for (const [n, x, y] of checks) {
      const ok = x === null || y === null ? x === y : isNoise(x, y);
      if (!ok) aggregateBreach++;
      const delta = x !== null && y !== null ? Math.abs(x - y) : NaN;
      console.log(
        `  ${ok ? "ok  " : "BREACH"} ${t.label.padEnd(8)} ${n.padEnd(32)} ${fmt(x).padEnd(18)} ${fmt(y).padEnd(18)} |d|=${Number.isNaN(delta) ? "n/a" : delta.toExponential(2)}`,
      );
    }
  }
  const bs = base.quoteSummary ?? {};
  for (const k of ["blendedRevenue", "blendedCost", "blendedMarginPct"] as const) {
    const x = bs[k] ?? null;
    const y = (cur.quoteSummary as any)[k] ?? null;
    const ok = x === null || y === null ? x === y : isNoise(x, y);
    if (!ok) aggregateBreach++;
    console.log(
      `  ${ok ? "ok  " : "BREACH"} ${"quote".padEnd(8)} ${("quoteSummary." + k).padEnd(32)} ${fmt(x).padEnd(18)} ${fmt(y).padEnd(18)} |d|=${x !== null && y !== null ? Math.abs(x - y).toExponential(2) : "n/a"}`,
    );
  }

  console.log("\n=== verdict ===");
  console.log(`  per-SKU cells moved      : ${rows}`);
  console.log(`  distinct paths           : ${pathSkus.size}`);
  console.log(`  SKUs involved            : ${[...new Set([...pathSkus.values()].flatMap((s) => [...s]))].join(", ")}`);
  console.log(`  aggregate/tier breaches  : ${aggregateBreach}`);
  console.log(
    aggregateBreach === 0
      ? "  ATTRIBUTION-ONLY — owner moved, quote/tier arithmetic did not."
      : "  *** AGGREGATE MOVEMENT — stop and report. ***",
  );
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
