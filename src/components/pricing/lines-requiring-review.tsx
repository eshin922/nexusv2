"use client";

import {
  selectActiveTierId,
  selectFirmSettings,
  selectQuoteSummary,
  selectSetActiveTier,
  selectSkuRollups,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.5 — Pricing Room 0: Lines Requiring Review block.
//
// Conditional, BELOW_FLOOR-only block anchored ABOVE the verdict band
// per R2 source rationale (`costing.jsx:167-209`): "Lifted ABOVE the
// verdict in BELOW FLOOR so the first thing the user sees is the
// actionable list, not the score."
//
// Data source: derived from per-(SKU, tier) `marginStatus ===
// 'BELOW_FLOOR'` filter on the existing skuRollups. NO dependency on
// Slice 9.5 quote_warnings engine — that ships richer warnings-driven
// version later; for RI.5 the R2-shaped margin-status-derived block
// is the v1 (decision banked: Edward + Designer + CC, May 2026).

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function LinesRequiringReview() {
  const summary = useCostingStore(selectQuoteSummary);
  const skuRollups = useCostingStore(selectSkuRollups);
  const tiers = useCostingStore(selectTiers);
  const firmSettings = useCostingStore(selectFirmSettings);
  const setActiveTier = useCostingStore(selectSetActiveTier);
  const activeTierId = useCostingStore(selectActiveTierId);

  // Only render when blended verdict is BELOW_FLOOR
  if (summary.blendedMarginStatus !== "BELOW_FLOOR") return null;

  // Flatten leaf-SKU per-tier cells where marginStatus === BELOW_FLOOR
  const flagged: Array<{
    skuId: string;
    skuLabel: string;
    productName: string;
    tierId: string;
    tierLabel: string;
    contributionCost: number;
    sell: number;
    marginPct: number;
  }> = [];
  const tierLabelById = new Map(tiers.map((t) => [t.tierId, t.label]));
  for (const sku of skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const t of sku.perTier) {
      // UNAVAILABLE and COST_WITHOUT_REVENUE are excluded here by the same
      // strict comparison, which is correct: this block lists cells whose
      // margin breaches the floor, and a cell with no margin has not breached
      // anything. A quote that is merely unpriced must not appear as a quote
      // in trouble.
      if (t.marginStatus !== "BELOW_FLOOR") continue;
      if (t.marginPct === null) continue;
      flagged.push({
        skuId: sku.skuId,
        skuLabel: sku.skuLabel,
        productName: sku.productName,
        tierId: t.tierId,
        tierLabel: tierLabelById.get(t.tierId) ?? t.tierId,
        contributionCost: t.contributionCostPerUnit,
        sell: t.requiredSellPerUnit,
        marginPct: t.marginPct,
      });
    }
  }

  if (flagged.length === 0) return null;
  flagged.sort((a, b) => a.marginPct - b.marginPct);

  const floorPct = firmSettings.floorMarginPct * 100;
  // Required sell to clear floor: cost / (1 - floorPct/100)
  const needForFloor = (cost: number) => cost / (1 - firmSettings.floorMarginPct);

  function jumpToFirst() {
    if (flagged.length > 0) setActiveTier(flagged[0].tierId);
  }

  function jumpToTier(tierId: string) {
    setActiveTier(tierId);
  }

  return (
    <div
      style={{
        background: "var(--bad-soft)",
        border: "2px solid var(--bad)",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <div
            className="r2-eyebrow"
            style={{ color: "var(--bad)", fontWeight: 600, marginBottom: 2 }}
          >
            ● {flagged.length} line{flagged.length === 1 ? "" : "s"} below floor — resolve before send
          </div>
          <div
            className="r2-mono"
            style={{
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: 0,
            }}
          >
            Each line is below the {floorPct.toFixed(0)}% floor. Either tune up sell price, accept and request admin override, or push back on cost.
          </div>
        </div>
        <button
          type="button"
          className="r2-btn sm"
          onClick={jumpToFirst}
        >
          Anchor first underpriced cell →
        </button>
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
        {flagged.map((c, i) => (
          <div
            key={`${c.skuId}::${c.tierId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--paper-2)",
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 12.5,
            }}
          >
            <span
              className="r2-mono"
              style={{ color: "var(--ink-4)", width: 30 }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="r2-chip">{c.skuLabel}</span>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <span>{c.tierLabel}</span>
            <span style={{ flex: 1 }} />
            <span
              className="r2-mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              contrib {fmtCurr2(c.contributionCost)} · selling {fmtCurr2(c.sell)} · need{" "}
              {fmtCurr2(needForFloor(c.contributionCost))}
            </span>
            <span className="r2-chip bad">
              {(c.marginPct * 100).toFixed(1)}% · floor {floorPct.toFixed(0)}%
            </span>
            <button
              type="button"
              className="r2-btn sm"
              onClick={() => jumpToTier(c.tierId)}
            >
              Fix →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
