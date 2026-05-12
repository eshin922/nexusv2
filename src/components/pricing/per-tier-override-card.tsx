"use client";

import {
  selectActiveTierId,
  selectTierPriceAdj,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { TierPriceAdjInput } from "@/components/tier-price-adj-input";

// Slice RI.5 — Pricing per-tier override card (Slice 9.2 logic).
//
// R2 source `costing.jsx:357-381`. Card placed BETWEEN Room 2 (verdict
// band) and Room 3 (per-SKU breakdown table). Conceptually the
// override is an action the PM takes in response to the verdict —
// visual separation respects that. Edward + Designer + CC, May 2026.
//
// When tiers.length === 1, the card hides — single-tier quote uses
// the global adj slider in Room 2; per-tier override is redundant.

export function PerTierOverrideCard({ editable }: { editable: boolean }) {
  const tiers = useCostingStore(selectTiers);
  const activeTierId = useCostingStore(selectActiveTierId);

  if (tiers.length <= 1) return null;
  if (!activeTierId) return null;

  const activeTier = tiers.find((t) => t.tierId === activeTierId);
  if (!activeTier) return null;

  return (
    <div
      className="r2-card"
      style={{
        marginBottom: 12,
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div className="r2-eyebrow" style={{ flexShrink: 0 }}>
        {activeTier.label} · price adjustment
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        <TierPriceAdjInput tierId={activeTierId} disabled={!editable} />
      </div>
      <OverrideStatusIndicator tierId={activeTierId} />
    </div>
  );
}

function OverrideStatusIndicator({ tierId }: { tierId: string }) {
  const tierAdj = useCostingStore(selectTierPriceAdj(tierId));
  const isOverride = tierAdj !== null;
  return (
    <div
      className="r2-mono"
      style={{
        fontSize: 11,
        color: isOverride ? "var(--accent-ink)" : "var(--ink-4)",
      }}
    >
      {isOverride ? "OVERRIDE active" : "inheriting global"}
    </div>
  );
}
