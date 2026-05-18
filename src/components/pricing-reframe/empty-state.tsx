"use client";

// Pricing Reframe v1 — EmptyState
//
// Renders when the quote has no tier rollup data yet. Pattern 30
// path-B-default — `.pr-empty` class from canonical CSS.

import { useCostingStore } from "@/components/costing-store-provider";
import { selectQuoteRollup } from "@/lib/costing-store";

export function EmptyState() {
  const rollup = useCostingStore(selectQuoteRollup);
  if (rollup.length > 0) return null;

  return (
    <div className="pr-empty">
      <div className="glyph">∅</div>
      <h4>Pricing waits on cost data</h4>
      <p>
        This quote has no tier costs yet. Once cost build is in progress,
        blended margin computes and per-tier compliance appears here. Return
        to Costs to enter cost data.
      </p>
    </div>
  );
}
