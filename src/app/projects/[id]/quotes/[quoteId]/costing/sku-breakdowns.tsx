"use client";

import {
  selectSkuRollups,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { InternalOnlyBadge } from "@/components/internal-only-badge";
import type {
  FreightLineBreakdown,
  QuoteCostingResult,
  SkuPerTierRollup,
  SkuRollup,
} from "@/lib/costing";

// Slice 8 sub-step 6 follow-up: this entire section is store-driven.
// The previous version rendered server-side from the snapshot, which
// produced visible inconsistency on /costing — the QuoteSummaryCard
// above (store-driven) updated optimistically on GPA edits while the
// per-SKU breakdown below stayed stale until server revalidation.
//
// Now everything reads from the same Zustand store; the entire page
// updates in lockstep on every keystroke. The store-driven framing is
// "all math display reads from the store; static page chrome (header,
// project name, etc.) stays server-rendered."

// ---- formatting helpers (mirror page.tsx) ----

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ---- list-level component (subscribes to store) ----

export function CostingSkuBreakdownsList() {
  const skuRollups = useCostingStore(selectSkuRollups);
  const tiers = useCostingStore(selectTiers);

  if (skuRollups.length === 0) {
    return (
      <p className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        No SKUs in this quote yet.
      </p>
    );
  }
  return (
    <div className="grid gap-4">
      {skuRollups.map((sku) => (
        <SkuBreakdown key={sku.skuId} sku={sku} tiers={tiers} />
      ))}
    </div>
  );
}

// ---- presentational components (pure props in, JSX out) ----

function SkuBreakdown({
  sku,
  tiers,
}: {
  sku: SkuRollup;
  tiers: QuoteCostingResult["tiers"];
}) {
  const indentStyle = { marginLeft: `${sku.indentDepth * 24}px` };

  if (sku.skuRole === "assembly") {
    return (
      <div
        style={indentStyle}
        className="rounded-md border border-blue-200 bg-blue-50 p-3"
      >
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800">
            Assembly
          </span>
          <span className="font-semibold text-gray-900">{sku.skuLabel}</span>
          <span className="text-gray-500">· {sku.productName}</span>
          {sku.qtyPerParent !== null && (
            <span className="text-xs text-gray-500">
              × {sku.qtyPerParent} per parent
            </span>
          )}
        </div>
        <table className="min-w-full divide-y divide-blue-100 text-xs">
          <thead className="text-left uppercase tracking-wide text-blue-800">
            <tr>
              <th className="py-1 pr-3">Component</th>
              {tiers.map((t) => (
                <th key={t.tierId} className="py-1 pr-3 text-right">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-100">
            <Row label="Contribution cost / unit (rolled up)" sku={sku}>
              {(pt) => fmtCurr4(pt.contributionCostPerUnit)}
            </Row>
            <Row label="Required sell / unit (rolled up)" sku={sku} bold>
              {(pt) => fmtCurr4(pt.requiredSellPerUnit)}
            </Row>
            <Row label="Margin" sku={sku}>
              {(pt) => fmtPct(pt.marginPct)}
            </Row>
            <Row label="Revenue (× tier qty)" sku={sku}>
              {(pt) => fmtCurr2(pt.revenue)}
            </Row>
            <Row label="Cost (× tier qty)" sku={sku}>
              {(pt) => fmtCurr2(pt.cost)}
            </Row>
          </tbody>
        </table>
      </div>
    );
  }

  // Leaf — full decomposition table
  return (
    <div
      style={indentStyle}
      className="rounded-md border border-gray-200 bg-white p-3"
    >
      <div className="mb-2 text-sm">
        <span className="font-semibold text-gray-900">{sku.skuLabel}</span>
        <span className="ml-1 text-gray-500">· {sku.productName}</span>
        {sku.qtyPerParent !== null && (
          <span className="ml-2 text-xs text-gray-500">
            × {sku.qtyPerParent} per parent
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-1.5 pl-3 pr-3">Component</th>
              {tiers.map((t) => (
                <th key={t.tierId} className="py-1.5 pr-3 text-right">
                  {t.label}
                  <span className="ml-1 font-normal text-gray-400">
                    ({t.qty.toLocaleString()})
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <Row label="Packaging cost / unit" sku={sku}>
              {(pt) => fmtCurr4(pt.packagingCostPerUnit)}
            </Row>
            <Row label="Production cost / unit" sku={sku}>
              {(pt) => fmtCurr4(pt.productionCostPerUnit)}
            </Row>
            <Row label="Raw cost / unit" sku={sku}>
              {(pt) => fmtCurr4(pt.rawCostPerUnit)}
            </Row>
            <Row label="Factory cost / unit" sku={sku} bold>
              {(pt) => fmtCurr4(pt.factoryCostPerUnit)}
            </Row>
            <FreightLines sku={sku} tiers={tiers} />
            <Row
              label={
                <>
                  Landed freight before markup{" "}
                  <InternalOnlyBadge short className="ml-1" />
                </>
              }
              sku={sku}
            >
              {(pt) => fmtCurr4(pt.totalLandedFreightBeforeMarkup)}
            </Row>
            <Row label="Landed freight with markup" sku={sku} bold>
              {(pt) => fmtCurr4(pt.totalLandedFreightWithMarkup)}
            </Row>
            <Row label="Separate service fees / unit" sku={sku}>
              {(pt) => fmtCurr4(pt.separateServiceFeesPerUnit)}
            </Row>
            <Row label="Contribution cost / unit" sku={sku} bold>
              {(pt) => fmtCurr4(pt.contributionCostPerUnit)}
            </Row>
            <Row label="Required sell / unit" sku={sku} bold>
              {(pt) => fmtCurr4(pt.requiredSellPerUnit)}
            </Row>
            <Row label="Margin" sku={sku}>
              {(pt) => fmtPct(pt.marginPct)}
            </Row>
            <Row label="Revenue (× tier qty)" sku={sku}>
              {(pt) => fmtCurr2(pt.revenue)}
            </Row>
            <Row label="Cost (× tier qty)" sku={sku}>
              {(pt) => fmtCurr2(pt.cost)}
            </Row>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label,
  sku,
  bold,
  children,
}: {
  label: React.ReactNode;
  sku: SkuRollup;
  bold?: boolean;
  children: (pt: SkuPerTierRollup) => React.ReactNode;
}) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className="py-1 pl-3 pr-3 text-gray-700">{label}</td>
      {sku.perTier.map((pt) => (
        <td key={pt.tierId} className="py-1 pr-3 text-right tabular-nums">
          {children(pt)}
        </td>
      ))}
    </tr>
  );
}

function FreightLines({
  sku,
  tiers,
}: {
  sku: SkuRollup;
  tiers: QuoteCostingResult["tiers"];
}) {
  const lineIds = new Set<string>();
  for (const pt of sku.perTier) {
    for (const fl of pt.freightLines) lineIds.add(fl.lineGroupId);
  }
  if (lineIds.size === 0) return null;

  return (
    <>
      {Array.from(lineIds).map((lineId, idx) => {
        const linesByTier = new Map<string, FreightLineBreakdown>();
        for (const pt of sku.perTier) {
          const fl = pt.freightLines.find((f) => f.lineGroupId === lineId);
          if (fl) linesByTier.set(pt.tierId, fl);
        }
        const treatment =
          [...linesByTier.values()][0]?.freightTreatment ?? "bundled";
        return (
          <tr key={lineId} className="bg-gray-50/50">
            <td colSpan={1 + tiers.length} className="px-3 py-1">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">
                Freight line #{idx + 1}
                <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium normal-case text-gray-700">
                  {treatment === "pass_through" ? "Pass-through" : "Bundled"}
                </span>
              </div>
              <table className="mt-1 min-w-full text-xs">
                <tbody>
                  <FreightSubRow
                    label="Container freight / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.containerFreightPerUnit)}
                  />
                  <FreightSubRow
                    label="Duty / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.dutyPerUnit)}
                  />
                  <FreightSubRow
                    label="Tariff / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.tariffPerUnit)}
                  />
                  <FreightSubRow
                    label="Line landed before markup"
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.landedFreightBeforeMarkup)}
                  />
                  <FreightSubRow
                    label="Line landed with markup"
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.landedFreightWithMarkup)}
                  />
                </tbody>
              </table>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function FreightSubRow({
  label,
  badge = false,
  tiers,
  linesByTier,
  pick,
}: {
  label: string;
  badge?: boolean;
  tiers: QuoteCostingResult["tiers"];
  linesByTier: Map<string, FreightLineBreakdown>;
  pick: (fl: FreightLineBreakdown) => string;
}) {
  return (
    <tr>
      <td className="pr-3 text-gray-600">
        {label}
        {badge && <InternalOnlyBadge short className="ml-1" />}
      </td>
      {tiers.map((t) => {
        const fl = linesByTier.get(t.tierId);
        return (
          <td key={t.tierId} className="pr-3 text-right tabular-nums">
            {fl ? pick(fl) : "—"}
          </td>
        );
      })}
    </tr>
  );
}
