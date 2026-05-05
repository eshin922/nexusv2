"use client";

import {
  selectQuoteRollup,
  selectActiveTierId,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.4 — Cost Stack horizontal header per Round 6 Change A.
// Multi-tier side-by-side per-tier columns; rows = cost component bars.
//
// Five rows by default (PKG / PROD / FRT / D+T / PASS); six rows when
// raws-mode = dps_sources (PKG / PROD / RAW indented under PROD / FRT /
// D+T / PASS).
//
// Reads the QuoteCostingResult quoteRollup from the optimistic store
// (already hydrated by the parent's CostingStoreProvider). Each per-tier
// column shows: tier label + qty + per-component bars + subtotal + sell.
//
// Live animation: bar widths animate to new state via CSS transition
// on input change (optimistic store updates fire re-render). 200ms eased.

const ROWS = [
  { key: "packaging", label: "PKG", color: "var(--accent)" },
  { key: "production", label: "PROD", color: "var(--good)" },
  { key: "freight", label: "FRT", color: "var(--good)" },
  { key: "internal", label: "D+T", color: "var(--internal)" },
  { key: "passthrough", label: "PASS", color: "var(--ink-3)" },
] as const;

function fmtCurr0(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function CostStackHeader({
  tiers,
  rawsMode,
}: {
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const activeTierId = useCostingStore(selectActiveTierId);

  // Show RAW row when DPS sources raws (per Round 6 Change A 6-row
  // composition). Otherwise 5 rows.
  const rows =
    rawsMode === "dps_sources"
      ? [
          ROWS[0], // PKG
          ROWS[1], // PROD
          { key: "raw", label: "RAW", color: "var(--good)" },
          ROWS[2], // FRT
          ROWS[3], // D+T
          ROWS[4], // PASS
        ]
      : ROWS;

  if (tiers.length === 0) {
    return (
      <div className="rounded border border-rule bg-paper-2 p-4 text-sm italic text-ink-4">
        Add at least one tier to see the cost stack.
      </div>
    );
  }

  // Find max total cost across tiers for proportional bar widths.
  const maxTotalCost = Math.max(
    ...quoteRollup.map((t) => t.totalCost),
    1, // floor — avoid divide-by-zero on empty rollup
  );

  return (
    <div className="overflow-hidden rounded border border-rule bg-paper">
      <div className="border-b border-rule bg-paper-2 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
        How this number is built
      </div>
      <div className="grid" style={{ gridTemplateColumns: `auto repeat(${tiers.length}, 1fr)` }}>
        {/* Header row: empty corner + tier columns with label + qty */}
        <div className="border-b border-rule p-2"></div>
        {tiers.map((t) => {
          const rollup = quoteRollup.find((q) => q.tierId === t.id);
          const isActive = activeTierId === t.id;
          return (
            <div
              key={t.id}
              className={`border-b border-l border-rule p-2 ${
                isActive ? "bg-accent-soft/30" : ""
              }`}
            >
              <div className="font-mono text-[10.5px] uppercase tracking-[0.13em] text-ink-3">
                {t.label}
              </div>
              <div className="font-mono text-[10px] text-ink-4">
                {t.qty?.toLocaleString() ?? "—"} units
              </div>
            </div>
          );
        })}

        {/* Component bar rows */}
        {rows.map((row, rowIdx) => (
          <RowGroup
            key={row.key}
            row={row}
            tiers={tiers}
            quoteRollup={quoteRollup}
            activeTierId={activeTierId}
            maxTotalCost={maxTotalCost}
            isLast={rowIdx === rows.length - 1}
          />
        ))}

        {/* Subtotal row */}
        <div className="border-t border-rule bg-paper-3 p-2 font-mono text-[10px] uppercase tracking-wide text-ink-2">
          Subtotal
        </div>
        {tiers.map((t) => {
          const rollup = quoteRollup.find((q) => q.tierId === t.id);
          const isActive = activeTierId === t.id;
          return (
            <div
              key={t.id}
              className={`border-l border-t border-rule bg-paper-3 p-2 text-right tabular-nums ${
                isActive ? "bg-accent-soft/30" : ""
              }`}
            >
              <div className="text-sm font-medium text-ink">
                {rollup ? fmtCurr0(rollup.totalCost) : "—"}
              </div>
            </div>
          );
        })}

        {/* Sell row */}
        <div className="border-t border-rule bg-paper-3 p-2 font-mono text-[10px] uppercase tracking-wide text-ink-2">
          Sell
        </div>
        {tiers.map((t) => {
          const rollup = quoteRollup.find((q) => q.tierId === t.id);
          const isActive = activeTierId === t.id;
          return (
            <div
              key={t.id}
              className={`border-l border-t border-rule bg-paper-3 p-2 text-right tabular-nums ${
                isActive ? "bg-accent-soft/30" : ""
              }`}
            >
              <div className="text-sm font-medium text-ink">
                {rollup ? fmtCurr0(rollup.totalRevenue) : "—"}
              </div>
              {rollup && rollup.totalRevenue > 0 && (
                <div className="font-mono text-[10px] text-ink-3">
                  {(rollup.blendedMarginPct * 100).toFixed(1)}% margin
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowGroup({
  row,
  tiers,
  quoteRollup,
  activeTierId,
  maxTotalCost,
  isLast,
}: {
  row: { key: string; label: string; color: string };
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  quoteRollup: ReturnType<typeof selectQuoteRollup>;
  activeTierId: string | null;
  maxTotalCost: number;
  isLast: boolean;
}) {
  const isRaw = row.key === "raw";
  return (
    <>
      <div
        className={`p-2 font-mono text-[10px] uppercase tracking-wide ${
          isRaw ? "pl-6 text-ink-4" : "text-ink-2"
        } ${!isLast ? "border-b border-rule" : ""}`}
      >
        {row.label}
      </div>
      {tiers.map((t) => {
        const rollup = quoteRollup.find((q) => q.tierId === t.id);
        const isActive = activeTierId === t.id;
        const value = rollup ? rowValue(rollup, row.key) : 0;
        const widthPct = maxTotalCost > 0 ? (value / maxTotalCost) * 100 : 0;
        return (
          <div
            key={t.id}
            className={`border-l border-rule p-2 ${
              !isLast ? "border-b" : ""
            } ${isActive ? "bg-accent-soft/30" : ""}`}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 rounded-sm transition-all duration-200 ease-out"
                style={{
                  width: `${widthPct}%`,
                  background: row.color,
                  minWidth: value > 0 ? "2px" : "0",
                }}
              />
              <span className="font-mono text-[10px] tabular-nums text-ink-3">
                {value > 0 ? fmtCurr0(value) : ""}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function rowValue(
  rollup: ReturnType<typeof selectQuoteRollup>[number],
  rowKey: string,
): number {
  // Map cost stack row keys to QuoteCostBreakdown fields. RAW row
  // currently rolls into production; v1.5 will split when bulk-raw
  // costing wiring lands. D+T (duty + tariff) + PASS (passthrough)
  // not yet broken out from costBreakdown; render as 0 for v1.
  switch (rowKey) {
    case "packaging":
      return rollup.costBreakdown.packaging;
    case "production":
      return rollup.costBreakdown.production;
    case "raw":
      // For now, RAW is amortized into production; standalone bulk
      // raw breakout requires cost-rollup math extension (RI.4
      // follow-up — UX_BACKLOG candidate).
      return 0;
    case "freight":
      return rollup.costBreakdown.freight;
    case "internal":
      // D+T (duty + tariff) is part of freight landed cost in current
      // schema; not yet broken out here. Render 0 until separated.
      return 0;
    case "passthrough":
      // PASS is currently bundled into freight/serviceFees depending
      // on freightTreatment; surface as 0 until breakout lands.
      return 0;
    default:
      return 0;
  }
}
