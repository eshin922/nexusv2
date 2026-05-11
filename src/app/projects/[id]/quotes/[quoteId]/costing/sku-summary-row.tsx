"use client";

import { useState } from "react";
import {
  selectActiveTierId,
  selectActiveTierRollup,
  selectCellTarget,
  selectSkuRollups,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { ClientTargetCell } from "@/components/costing/client-target-cell";
import { CompetitiveIndicator } from "@/components/costing/competitive-indicator";
import {
  MarginSparkline,
  type SparklinePoint,
} from "@/components/costing/margin-sparkline";
import { MarginVerdictPill } from "@/components/costing/margin-verdict-pill";
import { RequiredSellCell } from "@/components/required-sell-cell";
import type { SkuRollup } from "@/lib/costing";
import { SkuBreakdown } from "./sku-breakdowns";

// Slice 9.4a — per-SKU summary table. Replaces sku-breakdowns.tsx as
// the primary per-SKU surface on the Costing Sheet. Cost-decomposition
// (the prior surface) survives as the drawer-only inspection view
// triggered from each row's disclosure button (Task 6 wires the actual
// drawer content; this scaffold renders the empty drawer container so
// the layout is reviewable end-to-end).
//
// Table structure (per IA-spec Costing Sheet § per-SKU breakdown):
//   <table>
//     <thead>: SKU | Contribution | → | Required sell | Margin | (drawer toggle)
//     <tbody>: one <tr> per SKU; ALL cells render the ACTIVE-TIER slice.
//              Each <tr> is followed by a conditional drawer <tr>
//              (colspan-full) when expandedSkuId matches.
//
// Visual treatment:
//   - Subtle borders + hover tint, NOT card-per-row containers
//     (matches IA-spec table-style framing; cards-per-SKU was the
//     prior wrong-shape inference from sku-breakdowns.tsx)
//   - Drawer row visually extends its summary row above: border-top
//     suppressed, slight gray bg tint, no spacing between
//   - Assembly rows: subtle blue-tint left border + small "Assembly"
//     badge inline with SKU label (assemblies are still per-SKU rows
//     in this table; they just render rolled-up values from children)
//
// Drawer expansion model:
//   - Single source of truth: expandedSkuId in <SkuSummaryRowList>
//   - One drawer open at a time per page (clicking another row
//     auto-collapses the prior). Disclosure chevron derives from
//     expandedSkuId === sku.skuId; no per-row local state.
//
// Per-SKU active-tier values:
//   - Active tier resolved by parent via store (selectActiveTierId).
//     Active tier doesn't render an explicit per-row indicator; the
//     page-level selector (Task 5) is the source of truth for "which
//     tier am I looking at" — trust the user.
//   - When active tier changes, every row re-renders with the new
//     tier's slice; per-cell overrides persist per-(SKU, tier).

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

// Number of <td> cells in the summary <tr> — used by the drawer <tr>'s
// <td colspan> so it spans the full table width. Update when columns
// change. Slice 9.4b: client-target column (#5) + sparkline column
// (#7) brought count from 6 → 8.
const SUMMARY_COL_COUNT = 8;

function SkuSummaryRow({
  sku,
  expanded,
  onToggleExpand,
  editable,
}: {
  sku: SkuRollup;
  expanded: boolean;
  onToggleExpand: (skuId: string) => void;
  editable: boolean;
}) {
  const activeTierId = useCostingStore(selectActiveTierId);
  const tiers = useCostingStore(selectTiers);
  const perTier = sku.perTier.find((pt) => pt.tierId === activeTierId);
  // Slice 9.4b — read the cell's client target from the store (sparse;
  // null when no benchmark on this cell). Required for the
  // CompetitiveIndicator's tooltip math (gap calculation reads target).
  // Curried selector so this row only re-renders when ITS cell's target
  // changes, not when other cells' targets change.
  const clientTarget = useCostingStore(
    selectCellTarget(sku.skuId, activeTierId ?? ""),
  );

  if (!activeTierId || !perTier) {
    // Mid-reconcile race: ActiveTierUrlSync hasn't yet landed a valid
    // tier or active tier was just removed. Render minimal placeholder
    // row that doesn't break the table column alignment.
    return (
      <tr className="border-t border-gray-100">
        <td colSpan={SUMMARY_COL_COUNT} className="px-3 py-2 text-xs text-gray-400">
          {sku.skuLabel} · waiting for tier…
        </td>
      </tr>
    );
  }

  const isAssembly = sku.skuRole === "assembly";
  const indentPx = sku.indentDepth * 16;

  return (
    <>
      <tr
        className={`border-t border-gray-200 transition-colors hover:bg-gray-50 ${
          isAssembly ? "bg-blue-50/30" : "bg-white"
        } ${expanded ? "border-b-0" : ""}`}
      >
        {/* SKU identity */}
        <td className="px-3 py-2 text-sm">
          <div
            style={{ paddingLeft: `${indentPx}px` }}
            className="flex items-baseline gap-2"
          >
            {isAssembly && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-blue-800">
                Assembly
              </span>
            )}
            <span className="font-semibold text-gray-900">{sku.skuLabel}</span>
            <span className="truncate text-xs text-gray-500">
              {sku.productName}
            </span>
            {sku.qtyPerParent !== null && (
              <span className="whitespace-nowrap text-[10px] text-gray-400">
                × {sku.qtyPerParent} per parent
              </span>
            )}
          </div>
        </td>

        {/* Contribution cost (active tier) */}
        <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-700">
          {fmtCurr4(perTier.contributionCostPerUnit)}
        </td>

        {/* Arrow flourish */}
        <td className="px-1 py-2 text-center text-gray-300" aria-hidden="true">
          →
        </td>

        {/* Required sell (active tier) — Slice 9.3 click-to-edit */}
        <td className="px-3 py-2 text-right text-sm">
          <RequiredSellCell
            quoteSkuId={sku.skuId}
            tierId={activeTierId}
            editable={editable}
          />
        </td>

        {/* Slice 9.4b — Client target (active tier). Leaf-only —
            customers state targets at SKU level (this column on leaf
            rows) or quote level (Slice 9.4c). Assembly rows render an
            empty cell for layout; no click affordance, no reverse-
            solve. Stripped from 9.4b before commit after smoke
            surfaced the workflow correction. */}
        <td className="px-3 py-2 text-right text-sm">
          {!isAssembly && (
            <ClientTargetCell
              quoteSkuId={sku.skuId}
              skuLabel={sku.skuLabel}
              tierId={activeTierId}
              editable={editable}
            />
          )}
        </td>

        {/* Margin: percent + verdict pill (primary) + competitive
            indicator (secondary, Slice 9.4b). Secondary is leaf-only
            — assembly rows show just margin % + pill (their cells can
            never have client targets). Within leaves, indicator
            renders only when client target is set on this cell. */}
        <td className="px-3 py-2 text-right">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-sm tabular-nums text-gray-900">
              {(perTier.marginPct * 100).toFixed(1)}%
            </span>
            <MarginVerdictPill status={perTier.marginStatus} size="sm" />
            {!isAssembly && (
              <CompetitiveIndicator
                status={perTier.competitiveStatus}
                requiredSellPerUnit={perTier.requiredSellPerUnit}
                clientTarget={clientTarget}
              />
            )}
          </div>
        </td>

        {/* Slice 9.4b — All-tiers margin sparkline. Inline SVG;
            autoscale per SKU; active-tier point highlighted. Hover
            tooltips per point via SVG <title>. Built from this SKU's
            perTier slices in tier-sort-order; tiers with no revenue
            render as gaps in the line (no circle, line breaks). */}
        <td className="px-3 py-2 text-right">
          <MarginSparkline
            points={sku.perTier.map((pt): SparklinePoint => {
              const tierMeta = tiers.find((t) => t.tierId === pt.tierId);
              return {
                tierId: pt.tierId,
                tierLabel: tierMeta?.label ?? pt.tierId,
                marginPct: pt.marginPct,
                hasRevenue: pt.revenue > 0,
              };
            })}
            activeTierId={activeTierId}
          />
        </td>

        {/* Drawer disclosure trigger: icon-only, derives state from
            shared expandedSkuId — opening Row B auto-collapses Row A. */}
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={() => onToggleExpand(sku.skuId)}
            title={expanded ? "Hide breakdown" : "Show breakdown"}
            aria-label={expanded ? "Hide breakdown" : "Show breakdown"}
            aria-expanded={expanded}
            className="rounded border border-gray-200 px-1.5 py-0.5 text-xs leading-none text-gray-600 hover:border-gray-400 hover:text-gray-900"
          >
            {expanded ? "▴" : "▾"}
          </button>
        </td>
      </tr>

      {/* Drawer row — only renders when expanded. border-top: 0 +
          subtle bg tint visually anchors this as the summary row's
          extension. Renders the existing <SkuBreakdown> (cost-
          decomposition) — preserved analytical view for "show me why
          this number" debugging. Single drawer open at a time per
          page (controlled by parent's expandedSkuId). */}
      {expanded && (
        <tr className="border-t-0 bg-gray-50/60">
          <td colSpan={SUMMARY_COL_COUNT} className="px-3 pb-3 pt-1">
            <SkuBreakdown sku={sku} tiers={tiers} />
          </td>
        </tr>
      )}
    </>
  );
}

// List + table chrome. Owns the single expandedSkuId state (one
// drawer open at a time per page). Empty-states for zero-SKU and
// zero-tier quotes.
export function SkuSummaryRowList({ editable }: { editable: boolean }) {
  const skuRollups = useCostingStore(selectSkuRollups);
  const activeTier = useCostingStore(selectActiveTierRollup);
  const [expandedSkuId, setExpandedSkuId] = useState<string | null>(null);

  function handleToggleExpand(skuId: string) {
    // Toggle: clicking the currently-open row collapses it; clicking
    // any other row collapses the prior + opens the new (single-source-
    // of-truth means setting expandedSkuId to the new id implicitly
    // collapses the old).
    setExpandedSkuId((prev) => (prev === skuId ? null : skuId));
  }

  if (skuRollups.length === 0) {
    return (
      <p className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        No SKUs in this quote yet.
      </p>
    );
  }

  if (!activeTier) {
    return (
      <p className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        Add a tier to see required sell.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full text-sm">
        {/* Slice RI.0 — column-header typography moved to JetBrains Mono
            small caps per CD's eyebrow pattern (R2 styles.css `.eyebrow`
            line 93: --mono, 10.5px, letter-spacing 0.13em, uppercase,
            color --ink-3). Background --paper-2 per R1 table-header
            convention (R1 line 348). Smoke-target wiring for token
            foundation. */}
        <thead className="bg-paper-2 text-left font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
          <tr>
            <th className="px-3 py-2 font-normal">SKU</th>
            <th className="px-3 py-2 text-right font-normal">Contribution</th>
            <th className="px-1 py-2" aria-hidden="true" />
            <th className="px-3 py-2 text-right font-normal">Required sell</th>
            <th className="px-3 py-2 text-right font-normal">Client target</th>
            <th className="px-3 py-2 text-right font-normal">Margin</th>
            <th className="px-3 py-2 text-right font-normal">All tiers</th>
            <th className="px-3 py-2 text-right" aria-label="Expand row" />
          </tr>
        </thead>
        <tbody>
          {skuRollups.map((sku) => (
            <SkuSummaryRow
              key={sku.skuId}
              sku={sku}
              expanded={expandedSkuId === sku.skuId}
              onToggleExpand={handleToggleExpand}
              editable={editable}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
