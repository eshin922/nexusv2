"use client";

// Pricing Reframe v1 — FloorBlock
//
// Separate below-floor escalation block. Q5 disposition: scales with
// severity — floor breach gets its own prominent block above the
// TierComplianceBlock (vs warn-state inline callouts within tier rows).
//
// Pattern 30 path-B-default — `.pr-floor-block` class from canonical CSS.

import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteRollup,
} from "@/lib/costing-store";

export function FloorBlock() {
  const rollup = useCostingStore(selectQuoteRollup);
  const firm = useCostingStore(selectFirmSettings);

  const floor = Number(firm?.floorMarginPct ?? 0.25);
  const breach = rollup.find((t) => t.blendedMarginPct < floor);
  if (!breach) return null;

  const breachPp = (floor - breach.blendedMarginPct) * 100;

  return (
    <div className="pr-floor-block">
      <div className="icon">!</div>
      <div className="body">
        <div className="eyebrow">Below floor · deal-blocking</div>
        <h3 className="head">
          {breach.label} below the {(floor * 100).toFixed(0)}% floor by{" "}
          {breachPp.toFixed(1)}pp
        </h3>
        <p className="desc">
          If customer picks {breach.label}, realized margin{" "}
          {(breach.blendedMarginPct * 100).toFixed(1)}%. Sending requires
          firm-owner override per Round 5 firm-policy gate.
        </p>
      </div>
      <button className="cta" type="button" disabled>
        Request override
      </button>
    </div>
  );
}
