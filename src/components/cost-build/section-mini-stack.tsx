"use client";

import {
  selectActiveTierId,
  selectQuoteRollup,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.4 — Per-tier mini-stack rendered in section-row headers
// per Round 6 Pushback #1: "load-bearing in the empty/incomplete
// states (when the stack header has nothing to read) and because
// they're a tactile preview before the drill-down opens."
//
// Reads section-specific values from quoteRollup.costBreakdown
// (already hydrated by the parent's CostingStoreProvider). For
// section_kind = bulk_raw, value is currently 0 (cost-rollup
// breakout not yet wired; UX_BACKLOG entry tracks). For freight,
// uses costBreakdown.freight; packaging uses .packaging; production
// uses .production.
//
// Active-tier highlight: if user has focused a tier, that column
// gets accent treatment. Same hook as cost stack header.

function fmtCurr0Compact(n: number): string {
  if (n >= 1000) {
    return `$${Math.round(n / 100) / 10}k`;
  }
  return `$${Math.round(n)}`;
}

function valueFor(
  sectionKind: "packaging" | "production" | "bulk_raw" | "freight",
  rollup: ReturnType<typeof selectQuoteRollup>[number],
): number {
  switch (sectionKind) {
    case "packaging":
      return rollup.costBreakdown.packaging;
    case "production":
      return rollup.costBreakdown.production;
    case "freight":
      return rollup.costBreakdown.freight;
    case "bulk_raw":
      // Cost-rollup doesn't yet break out RAW from production
      // (UX_BACKLOG: Cost rollup component breakout for RAW + D+T +
      // PASS rows). Render 0 for v1; mini-stack still shows the
      // per-tier slot for when the breakout lands.
      return 0;
  }
}

export function SectionMiniStack({
  tiers,
  sectionKind,
}: {
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  sectionKind: "packaging" | "production" | "bulk_raw" | "freight";
}) {
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const activeTierId = useCostingStore(selectActiveTierId);

  if (tiers.length === 0) return null;

  return (
    <div className="hidden items-baseline gap-3 lg:flex">
      {tiers.map((t) => {
        const rollup = quoteRollup.find((r) => r.tierId === t.id);
        const value = rollup ? valueFor(sectionKind, rollup) : 0;
        const isActive = activeTierId === t.id;
        return (
          <div
            key={t.id}
            className={`flex flex-col items-end leading-tight ${
              isActive ? "text-accent-ink" : "text-ink-3"
            }`}
            title={`${t.label}${t.qty ? ` · ${t.qty.toLocaleString()} units` : ""}`}
          >
            <span className="font-mono text-[9px] uppercase tracking-wide text-ink-4">
              {t.label}
            </span>
            <span className="font-mono text-[11px] tabular-nums">
              {value > 0 ? fmtCurr0Compact(value) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
