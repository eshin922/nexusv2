"use client";

// Pricing Reframe v1 — SuggestionEngine
//
// Scaffold component. Step 5 (brief §11) fills in the context-aware
// ranking logic (surgical / global / accept-risk gating). Step 7 wires
// the apply paths with audit-log discipline per Disposition B:
//   - Surgical:  diff_json.source = 'pricing_suggestion_surgical'
//   - Global:    diff_json.source = 'pricing_suggestion_global'
//                (cascade audit pattern: root + N derived rows)
//
// Pattern 30 path-B-default — class names match canonical pricing.jsx
// (`.pr-suggestions` + `.pr-suggestion` + `.recommended` + `.preview`).
//
// This Step 3 scaffold renders a "no suggestions" structural shell when
// any tier is below target; Step 5 populates real options.

import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteRollup,
} from "@/lib/costing-store";

export function SuggestionEngine() {
  const rollup = useCostingStore(selectQuoteRollup);
  const firm = useCostingStore(selectFirmSettings);

  const target = Number(firm?.targetMarginPct ?? 0.35);
  const floor = Number(firm?.floorMarginPct ?? 0.25);

  const belowTarget = rollup.filter((t) => t.blendedMarginPct < target).length;
  const belowFloor = rollup.filter((t) => t.blendedMarginPct < floor).length;

  if (belowTarget === 0 && belowFloor === 0) return null;

  const className = `pr-suggestions${belowFloor > 0 ? " below-floor" : ""}`;

  return (
    <div className={className}>
      <div className="pr-suggestions-head">
        <h3>Tier-aware suggestions</h3>
        <span className="auto">↻ Auto-fired · context-aware ranking</span>
      </div>
      <div className="pr-suggestions-list">
        <div
          className="pr-accept-risk-unavailable"
          style={{ textTransform: "none", letterSpacing: 0 }}
        >
          Suggestion engine landing in Step 5 — ranking logic, surgical /
          global / accept-risk options, and apply paths wire next.
        </div>
      </div>
    </div>
  );
}
