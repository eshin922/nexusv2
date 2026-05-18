"use client";

// Pricing Reframe v1 — SuggestionEngine
//
// Renders context-aware suggestion options per brief §4.4. Ranking logic
// and math live in src/lib/pricing-suggestions.ts (pure module). This
// component wires the helper to live store state and renders the option
// list.
//
// Step 6 — telemetry: `recommended_fired` fires once per render-of-
// recommended event. Ref-based dedupe so the same continuous
// surfacing doesn't double-fire on rerender. Tier-context capture
// (violation_tier_id + suggestion_target_tier_ids) is load-bearing
// for v1.1 Path 2 promotion analysis per brief Notes §4.
//
// Step 7 wires the apply paths (Disposition B: pricing_suggestion_surgical
// / pricing_suggestion_global). For now the Apply button surfaces a
// server-action stub.
//
// Pattern 30 path-B-default — class names match canonical pricing.jsx.

import { useEffect, useRef, useState, useTransition } from "react";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteId,
  selectQuoteRollup,
} from "@/lib/costing-store";
import {
  type SuggestionOption,
  type SuggestionPreview,
  rankPricingSuggestions,
} from "@/lib/pricing-suggestions";
import { logPricingEvent } from "@/app/actions/pricing-events";
import {
  applyGlobalAdj,
  applySurgicalAdj,
} from "@/app/actions/pricing-apply";

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
  const quoteId = useCostingStore(selectQuoteId);

  const target = Number(firm?.targetMarginPct ?? 0.35);
  const floor = Number(firm?.floorMarginPct ?? 0.25);

  const suggestions =
    rollup.length === 0
      ? null
      : rankPricingSuggestions({
          rollup,
          recommendedTierId,
          target,
          floor,
        });

  // Telemetry — fire `recommended_fired` once per surfacing of the
  // recommended option. Ref tracks "last fired state" so the same
  // continuous-has-recommended state doesn't double-fire on rerender.
  // If recommended disappears (e.g., PM applies and tier moves GOOD)
  // and then reappears, that's a second surfacing.
  const recommendedOpt = suggestions?.options.find((o) => o.recommended) ?? null;
  const lastFiredRef = useRef(false);
  const [, startTelemetry] = useTransition();

  useEffect(() => {
    if (recommendedOpt && !lastFiredRef.current) {
      // Identify the worst-below-target tier (violation context).
      const worstBelow = rollup
        .filter((t) => t.blendedMarginPct < target)
        .sort((a, b) => a.blendedMarginPct - b.blendedMarginPct)[0];

      const belowFloor = rollup.find((t) => t.blendedMarginPct < floor);
      const floorBreachPp =
        belowFloor != null
          ? (floor - belowFloor.blendedMarginPct) * 100
          : null;

      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("eventType", "recommended_fired");
      if (worstBelow) fd.set("violationTierId", worstBelow.tierId);
      if (recommendedOpt.applyTo.length > 0) {
        fd.set("suggestionTargetTierIds", recommendedOpt.applyTo.join(","));
      }
      if (floorBreachPp != null) {
        fd.set("floorBreachPp", floorBreachPp.toFixed(2));
      }
      startTelemetry(async () => {
        await logPricingEvent(fd);
      });
      lastFiredRef.current = true;
    }
    if (!recommendedOpt) {
      lastFiredRef.current = false;
    }
  }, [recommendedOpt, rollup, quoteId, target, floor, startTelemetry]);

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
            <SuggestionOptionRow
              key={opt.id}
              option={opt}
              quoteId={quoteId}
            />
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

function SuggestionOptionRow({
  option,
  quoteId,
}: {
  option: SuggestionOption;
  quoteId: string;
}) {
  const [pending, startApply] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onApplyClick() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("applyDelta", String(option.applyDelta));
    fd.set("optionRecommended", option.recommended ? "true" : "false");

    if (option.id === "surgical") {
      // Surgical writes a single tier — the (only) entry in applyTo.
      const tierId = option.applyTo[0];
      if (!tierId) {
        setError("Surgical option missing tier");
        return;
      }
      fd.set("tierId", tierId);
      startApply(async () => {
        const r = await applySurgicalAdj(fd);
        if (!r.ok) setError(r.error.message);
      });
    } else if (option.id === "global") {
      fd.set("applyTo", option.applyTo.join(","));
      startApply(async () => {
        const r = await applyGlobalAdj(fd);
        if (!r.ok) setError(r.error.message);
      });
    } else if (option.id === "accept_risk") {
      // Accept-risk doesn't write tier_price_adj_pct; it's an in-session
      // signal captured later via gate_overridden when PM hits Send.
      // No action fires here; brief §4.4 line 145-146.
      // eslint-disable-next-line no-console
      console.log("[suggestion-engine] accept-risk: no write");
    }
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
      <button
        className="apply"
        type="button"
        onClick={onApplyClick}
        disabled={pending}
      >
        {pending
          ? "Applying…"
          : option.id === "accept_risk"
            ? "Send as-is"
            : "Apply"}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            gridColumn: "1 / -1",
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--bad)",
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
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
