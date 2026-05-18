"use client";

// Pricing Reframe v1 — TierComplianceBlock
//
// Per-tier compliance rows. Pattern 30 path-B-default — class names match
// canonical pricing.jsx (`.pr-tcb` + `.pr-tier-row` + state modifiers
// `good`/`warn`/`bad`). Canonical CSS at src/styles/pricing-reframe.css.
//
// Q4 disposition: collapsed to single-line summary when all tiers at target.

import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFirmSettings,
  selectQuoteRollup,
} from "@/lib/costing-store";
import { useReframeState } from "@/components/pricing-reframe/reframe-state-context";

const fmtPct = (v: number | null) =>
  v == null ? "—" : (v * 100).toFixed(1);

// Whether a tier is "recommended" (★) per Slice RI.7 — surfaced from
// quote_tiers.recommended via the bundle. Looking up via the rollup row
// doesn't carry this flag today (QuotePerTierRollup excludes it);
// retrieved separately via the store's tiers list.
type TierWithRecommended = {
  id: string;
  label: string;
  recommended: boolean;
};

export function TierComplianceBlock({
  tiers,
}: {
  tiers: TierWithRecommended[];
}) {
  const rollup = useCostingStore(selectQuoteRollup);
  const firm = useCostingStore(selectFirmSettings);
  const { applyingTierIds, lastApply } = useReframeState();

  if (rollup.length === 0) return null;

  const target = Number(firm?.targetMarginPct ?? 0.35);
  const floor = Number(firm?.floorMarginPct ?? 0.25);

  const belowTarget = rollup.filter((t) => t.blendedMarginPct < target).length;
  const belowFloor = rollup.filter((t) => t.blendedMarginPct < floor).length;
  const allHealthy = belowTarget === 0 && belowFloor === 0;

  const recById = new Map(tiers.map((t) => [t.id, t.recommended]));

  if (allHealthy) {
    return (
      <div className="pr-tcb collapsed">
        <div className="pr-tcb-head">
          <h3>Per-tier compliance</h3>
          <span className="summary good">
            ✓ All {rollup.length} tier{rollup.length === 1 ? "" : "s"} at
            target ·{" "}
            {rollup
              .map((t) => `${t.label} ${(t.blendedMarginPct * 100).toFixed(1)}%`)
              .join(" · ")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pr-tcb">
      <div className="pr-tcb-head">
        <h3>Per-tier compliance</h3>
        <span className={`summary ${belowFloor > 0 ? "bad" : "warn"}`}>
          {belowTarget} of {rollup.length} below target
          {belowFloor > 0 ? ` · ${belowFloor} below floor` : ""}
        </span>
      </div>

      {rollup.map((t) => {
        const state: "good" | "warn" | "bad" =
          t.blendedMarginPct < floor
            ? "bad"
            : t.blendedMarginPct < target
              ? "warn"
              : "good";
        const isRecommended = recById.get(t.tierId) ?? false;
        const isApplying = applyingTierIds.has(t.tierId);
        const isChanged =
          !isApplying &&
          lastApply !== null &&
          lastApply.tierIds.includes(t.tierId);

        // Sell per unit (weighted) — derived from totalRevenue / qty per
        // brief §3 data-source map clarification (margin_pct and
        // sell_per_unit are derived, not persisted).
        const sellPerUnit = t.qty > 0 ? t.totalRevenue / t.qty : null;

        // Inline callout for below-target (warn); below-floor renders an
        // additional separate FloorBlock above. Suppressed while applying
        // (the APPLYING… chip carries the live signal instead).
        const showInlineCallout = state === "warn" && !isApplying;
        const showFloorRow = state === "bad" && !isApplying;
        const breachPp =
          state === "warn"
            ? (target - t.blendedMarginPct) * 100
            : state === "bad"
              ? (target - t.blendedMarginPct) * 100
              : 0;

        // Compose row class. Canonical CSS supports modifiers:
        // `pr-tier-row ${state}` plus optional `applying` (Step 8) and
        // `changed` (Step 9). `changed` overrides the state-based bg
        // tint via cascade order in pricing_styles.css.
        const rowClass = [
          "pr-tier-row",
          state,
          isApplying ? "applying" : "",
          isChanged ? "changed" : "",
        ]
          .filter(Boolean)
          .join(" ");

        const deltaPp = isChanged
          ? (lastApply?.deltaPpByTier[t.tierId] ?? 0)
          : 0;

        return (
          <div key={t.tierId} className={rowClass}>
            <div className="tier-label">
              {t.label}
              {isRecommended && (
                <span className="recommended-star" title="Recommended tier">
                  ★
                </span>
              )}
              {isApplying && (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 9.5,
                    color: "var(--accent-ink)",
                    letterSpacing: "0.06em",
                    marginLeft: 6,
                  }}
                >
                  APPLYING…
                </span>
              )}
            </div>
            <div className="units">{t.qty.toLocaleString()} units</div>
            <div className="callout">
              {showInlineCallout && (
                <>
                  <span className="glyph">!</span>
                  <span>
                    If customer picks {t.label}, realized margin{" "}
                    {fmtPct(t.blendedMarginPct)}% ({breachPp.toFixed(1)}pp
                    under target)
                  </span>
                </>
              )}
              {showFloorRow && (
                <>
                  <span className="glyph" style={{ color: "var(--bad)" }}>
                    ■
                  </span>
                  <span style={{ color: "var(--bad)" }}>
                    {t.label} below floor by{" "}
                    {((floor - t.blendedMarginPct) * 100).toFixed(1)}pp
                  </span>
                </>
              )}
            </div>
            <div className={`margin ${state}`}>
              <span className="num">{fmtPct(t.blendedMarginPct)}</span>
              <span className="pct">%</span>
              {isChanged && (
                <span className="delta-chip">
                  {deltaPp >= 0 ? "+" : ""}
                  {deltaPp.toFixed(1)}pp
                </span>
              )}
            </div>
            <div className="sell">
              {sellPerUnit != null ? `$${sellPerUnit.toFixed(2)}` : "—"}
              <span className="lbl">sell · unit</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
