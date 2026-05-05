"use client";

import {
  selectActiveTierId,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.5 — Costing Sheet Room 3 section head per R2
// (`docs/design-prototypes/dist/source/round-2/app/r2/costing.jsx:342-355`).
//
// `<h2>Per-SKU breakdown <em>· active tier {label}</em></h2>` —
// italic-em annotation surfaces which tier the per-SKU rows are
// reading. NO tier-tab cluster (the cost stack panel above IS the
// active-tier selector per R6 grammar).

export function CostingSectionHead() {
  const tiers = useCostingStore(selectTiers);
  const activeTierId = useCostingStore(selectActiveTierId);
  const activeLabel =
    tiers.find((t) => t.tierId === activeTierId)?.label ?? "—";

  return (
    <div className="r2-section-head">
      <h2>
        Per-SKU breakdown <em>· active tier {activeLabel}</em>
      </h2>
    </div>
  );
}
