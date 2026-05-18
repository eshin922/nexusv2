"use client";

// Pricing Reframe v1 — SuggestionEngine
//
// Renders context-aware suggestion options per brief §4.4. Ranking logic
// and math live in src/lib/pricing-suggestions.ts (pure module). This
// component wires the helper to live store state and renders the option
// list.
//
// Apply paths land in Step 7 (brief §11). For now, the Apply button
// is wired but only logs the option id; Step 7 swaps the onClick for
// the server action.
//
// Pattern 30 path-B-default — class names match canonical pricing.jsx.

import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteRollup,
} from "@/lib/costing-store";
import {
  type SuggestionOption,
  type SuggestionPreview,
  rankPricingSuggestions,
} from "@/lib/pricing-suggestions";

type Props = {
  // ★ recommended tier id (from quote_tiers.recommended). Passed
  // through from page.tsx because the rollup type doesn't carry it.
  recommendedTierId: string | null;
};

const fmtPct = (v: number | null) =>
  v == null ? "—" : (v * 100).toFixed(1);

const fmtDelta = (v: number) =>
  (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";

export function SuggestionEngine({ recommendedTierId }: Props) {
  const rollup = useCostingStore(selectQuoteRollup);
  const firm = useCostingStore(selectFirmSettings);

  if (rollup.length === 0) return null;

  const target = Number(firm?.targetMarginPct ?? 0.35);
  const floor = Number(firm?.floorMarginPct ?? 0.25);

  const suggestions = rankPricingSuggestions({
    rollup,
    recommendedTierId,
    target,
    floor,
  });
  if (!suggestions) return null;

  const belowFloor = rollup.filter((t) => t.blendedMarginPct < floor).length;
  const className = `pr-suggestions${belowFloor > 0 ? " below-floor" : ""}`;

  return (
    <div className={className}>
      <div className="pr-suggestions-head">
        <h3>Tier-aware suggestions</h3>
        <span className="auto">↻ Auto-fired · context-aware ranking</span>
      </div>
      <div className="pr-suggestions-list">
        {suggestions.options
          .filter((opt) => {
            // Hide accept-risk entirely when unavailable AND there's an
            // explainer to surface separately. Brief §4.4: "with reason
            // surfaced below suggestions list in dashed-border explainer."
            if (
              opt.id === "accept_risk" &&
              !suggestions.acceptRiskGating.available
            ) {
              return false;
            }
            return true;
          })
          .map((opt) => (
            <SuggestionOptionRow key={opt.id} option={opt} />
          ))}
        {!suggestions.acceptRiskGating.available &&
          suggestions.acceptRiskGating.reason && (
            <div className="pr-accept-risk-unavailable">
              <strong style={{ color: "var(--ink-3)" }}>
                Accept-risk unavailable:
              </strong>{" "}
              {suggestions.acceptRiskGating.reason}
            </div>
          )}
      </div>
    </div>
  );
}

function SuggestionOptionRow({ option }: { option: SuggestionOption }) {
  function onApplyClick() {
    // Step 7 swaps this for the server action call. For Step 5 the
    // button surfaces the option id only; useful to confirm wiring.
    // eslint-disable-next-line no-console
    console.log("[suggestion-engine] apply clicked:", option.id);
  }

  return (
    <div className={`pr-suggestion ${option.recommended ? "recommended" : ""}`}>
      <div className="lhs">
        <div className="label-row">
          <span className="label">{option.label}</span>
          {option.recommended && (
            <span className="ranked-chip">★ Recommended</span>
          )}
        </div>
        <div className="description">{option.description}</div>
        {option.preview && (
          <div className="preview">
            {option.preview.map((p) => (
              <PreviewTile key={p.tierId} preview={p} />
            ))}
          </div>
        )}
      </div>
      <button className="apply" type="button" onClick={onApplyClick}>
        {option.id === "accept_risk" ? "Send as-is" : "Apply"}
      </button>
    </div>
  );
}

function PreviewTile({ preview }: { preview: SuggestionPreview }) {
  const isZero = Math.abs(preview.deltaPp) < 0.05;
  return (
    <div className="ptile">
      <span className="pt-tier">{preview.label}</span>
      <span className="pt-margin">{fmtPct(preview.newMarginPct)}%</span>
      <span className={`pt-delta${isZero ? " zero" : ""}`}>
        {isZero ? "·" : fmtDelta(preview.deltaPp)}
      </span>
    </div>
  );
}
