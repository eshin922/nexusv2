"use client";

import {
  selectFirmSettings,
  selectGlobalAdj,
  selectQuoteId,
  selectQuoteSummary,
  selectSkuRollups,
  selectTargetMargin,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import { GlobalPriceAdjInput } from "@/components/global-price-adj-input";
import { QuoteTargetMarginPopover } from "@/components/quote-target-margin-popover";

// Slice RI.5 — Pricing Room 2: Margin verdict band.
//
// R2 source `costing.jsx:211-339`. Two-column grid:
//   LEFT — the number (96px display blended margin %, status color
//          driven by blendedMarginStatus, target/floor/flagged-count
//          detail line, admin-override-path BELOW_FLOOR conditional)
//   RIGHT — the tuning (Global price adj label + slider via existing
//           GlobalPriceAdjInput component which carries the system-
//           suggestion banner per Slice 9.2 + Apply button)
//
// Below the verdict band, healthy-state (GOOD) shows three insight
// cards: Most headroom + Client benchmark + 0 lines need review.

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function VerdictBand({ editable }: { editable: boolean }) {
  const summary = useCostingStore(selectQuoteSummary);
  const firmSettings = useCostingStore(selectFirmSettings);
  const targetMargin = useCostingStore(selectTargetMargin);
  const globalAdj = useCostingStore(selectGlobalAdj);
  const quoteId = useCostingStore(selectQuoteId);
  const skuRollups = useCostingStore(selectSkuRollups);

  // Null when the quote has no revenue. Kept null rather than multiplied,
  // since `null * 100` is 0 and would put a fabricated number back on the
  // largest type on the surface.
  const blendedPct =
    summary.blendedMarginPct === null ? null : summary.blendedMarginPct * 100;
  const status = summary.blendedMarginStatus; // GOOD | BELOW_TARGET | BELOW_FLOOR | UNAVAILABLE
  const effectiveTargetPct = summary.effectiveTargetMarginPct * 100;
  const floorPct = firmSettings.floorMarginPct * 100;
  const hasQuoteOverride = targetMargin !== null;

  // Count flagged cells (per-(SKU, tier) where marginStatus === BELOW_FLOOR)
  let flaggedCount = 0;
  for (const sku of skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const t of sku.perTier) {
      if (t.marginStatus === "BELOW_FLOOR") flaggedCount++;
    }
  }

  // Status -> token color for border + status text.
  //
  // UNAVAILABLE takes a NEUTRAL token, not the `bad` default the old
  // else-branch would have handed it. A muted band says "not assessed"; a red
  // one would say "assessed and failing", which is the claim this whole
  // correction exists to stop making.
  const statusToken =
    status === "GOOD"
      ? "good"
      : status === "BELOW_TARGET"
        ? "warn"
        : status === "UNAVAILABLE"
          ? "ink-3"
          : "bad";

  // Wrapper styling — bad = full red border + bad-soft bg; good/warn =
  // calm card with border-left accent in their semantic color.
  const wrapperStyle: React.CSSProperties =
    status === "BELOW_FLOOR"
      ? {
          background: "var(--bad-soft)",
          border: "2px solid var(--bad)",
          borderLeft: "2px solid var(--bad)",
          borderRadius: 12,
          padding: "32px 36px",
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "1.1fr 1.2fr",
          gap: 44,
          alignItems: "center",
          transition:
            "background 200ms ease-out, border-color 200ms ease-out",
        }
      : {
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderLeft: `4px solid var(--${statusToken})`,
          borderRadius: 12,
          padding: "32px 36px",
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "1.1fr 1.2fr",
          gap: 44,
          alignItems: "center",
          transition:
            "background 200ms ease-out, border-color 200ms ease-out",
        };

  const numberColor =
    status === "BELOW_FLOOR"
      ? "var(--bad)"
      : status === "UNAVAILABLE"
        ? "var(--ink-3)"
        : "var(--ink)";
  const statusText =
    status === "GOOD"
      ? "● above target — sendable"
      : status === "BELOW_TARGET"
        ? "● below target — soft warning"
        : status === "UNAVAILABLE"
          ? "● no revenue — margin not assessed"
          : "● below floor — send blocked";

  return (
    <>
      <div style={wrapperStyle}>
        {/* LEFT — the number */}
        <div>
          <div className="r2-row r2-gap-3" style={{ marginBottom: 8 }}>
            <span className="r2-eyebrow">
              Blended margin · all SKUs · all tiers
            </span>
            {hasQuoteOverride && (
              <span
                className="r2-chip accent"
                style={{ fontSize: 9 }}
              >
                quote target override · {effectiveTargetPct.toFixed(0)}%
              </span>
            )}
            <QuoteTargetMarginPopover disabled={!editable} />
          </div>
          <div
            style={{
              fontFamily: "var(--display)",
              fontSize: 96,
              fontWeight: 400,
              letterSpacing: "-0.04em",
              lineHeight: 0.92,
              color: numberColor,
              transition: "color 200ms ease-out",
            }}
          >
            {blendedPct === null ? "—" : blendedPct.toFixed(1)}
            {blendedPct !== null && (
              <span
                style={{
                  fontSize: 44,
                  color: "var(--ink-3)",
                  fontStyle: "italic",
                  marginLeft: 4,
                }}
              >
                %
              </span>
            )}
          </div>
          <div
            className="r2-mono"
            style={{
              fontSize: 11.5,
              marginTop: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: `var(--${statusToken})`,
              fontWeight: 500,
            }}
          >
            {statusText}
          </div>
          <div
            className="r2-mono"
            style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}
          >
            target {effectiveTargetPct.toFixed(0)}% · floor{" "}
            {floorPct.toFixed(0)}% · {flaggedCount} line
            {flaggedCount === 1 ? "" : "s"} below floor
          </div>

          {/* Admin override path — BELOW_FLOOR only */}
          {status === "BELOW_FLOOR" && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--paper)",
                border: "1px dashed var(--bad)",
                borderRadius: 6,
                fontSize: 11.5,
                color: "var(--ink-2)",
                lineHeight: 1.45,
              }}
            >
              <div
                className="r2-mono"
                style={{
                  fontSize: 9.5,
                  color: "var(--bad)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                ⚿ Admin override path
              </div>
              Send is blocked at the firm-wide floor (
              {floorPct.toFixed(0)}%). Request admin override to proceed; the
              request logs to the quote audit. Approval routing wires up in
              Slice 12 (Mark-Accepted writeback).
            </div>
          )}
        </div>

        {/* RIGHT — the tuning */}
        <div>
          <div
            className="r2-row r2-gap-3"
            style={{ marginBottom: 4, justifyContent: "space-between" }}
          >
            <span className="r2-eyebrow">Global price adjustment</span>
            <span
              className="r2-mono"
              style={{ fontSize: 11, color: "var(--ink-4)" }}
            >
              applies to every cell unless overridden
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <GlobalPriceAdjInput
              quoteId={quoteId}
              initialDecimal={globalAdj}
              suggestedDecimal={summary.suggestedAdj}
              disabled={!editable}
            />
          </div>
        </div>
      </div>

      {/* Healthy-state insight cards */}
      {status === "GOOD" && <HealthyInsightCards />}
    </>
  );
}

function HealthyInsightCards() {
  const summary = useCostingStore(selectQuoteSummary);
  const skuRollups = useCostingStore(selectSkuRollups);
  const tiers = useCostingStore(selectTiers);
  const globalAdj = useCostingStore(selectGlobalAdj);

  // Most headroom — leaf cell with highest marginPct
  const tierLabelById = new Map(tiers.map((t) => [t.tierId, t.label]));
  let headroom: {
    skuLabel: string;
    productName: string;
    tierLabel: string;
    marginPct: number;
  } | null = null;
  // Aggregate competitive counts
  let benchmarkedCount = 0;
  let totalCells = 0;
  let overCount = 0;
  for (const sku of skuRollups) {
    if (sku.skuRole !== "leaf") continue;
    for (const t of sku.perTier) {
      totalCells++;
      if (t.competitiveStatus !== null) {
        benchmarkedCount++;
        if (t.competitiveStatus === "OVER_CLIENT_TARGET") overCount++;
      }
      if (headroom === null || t.marginPct > headroom.marginPct) {
        headroom = {
          skuLabel: sku.skuLabel,
          productName: sku.productName,
          tierLabel: tierLabelById.get(t.tierId) ?? t.tierId,
          marginPct: t.marginPct,
        };
      }
    }
  }

  const targetPct = summary.effectiveTargetMarginPct * 100;
  const globalAdjPct = globalAdj * 100;

  // Card 2 copy — Designer recommendation: when zero benchmarked, swap
  // to "No client targets" to avoid false-positive optimism (Edward +
  // Designer + CC, May 2026).
  const card2Display =
    benchmarkedCount === 0
      ? "No client targets"
      : overCount === 0
        ? "All competitive"
        : `${overCount} over`;
  const card2DetailColor =
    benchmarkedCount === 0
      ? "var(--ink-3)"
      : overCount === 0
        ? "var(--good)"
        : "var(--warn)";
  const card2Detail =
    benchmarkedCount === 0
      ? "Set client targets per cell to compare against retail"
      : `vs client_target_price_per_unit · ${benchmarkedCount} of ${totalCells} cells benchmarked`;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 12,
        marginBottom: 18,
      }}
    >
      {/* Card 1 — Most headroom */}
      <div className="r2-card" style={{ padding: "14px 18px" }}>
        <p className="r2-eyebrow" style={{ marginBottom: 4 }}>
          Most headroom
        </p>
        <div
          style={{
            fontFamily: "var(--display)",
            fontSize: 22,
            letterSpacing: "-0.015em",
          }}
        >
          {headroom
            ? `${headroom.skuLabel} · ${headroom.tierLabel}`
            : "—"}
        </div>
        <div
          className="r2-mono"
          style={{ fontSize: 11.5, color: "var(--good)", marginTop: 4 }}
        >
          {headroom
            ? `${(headroom.marginPct * 100).toFixed(1)}% · ${(headroom.marginPct * 100 - targetPct).toFixed(1)}pp above target`
            : ""}
        </div>
      </div>

      {/* Card 2 — Client benchmark */}
      <div className="r2-card" style={{ padding: "14px 18px" }}>
        <p className="r2-eyebrow" style={{ marginBottom: 4 }}>
          Client benchmark
        </p>
        <div
          style={{
            fontFamily: "var(--display)",
            fontSize: 22,
            letterSpacing: "-0.015em",
          }}
        >
          {card2Display}
        </div>
        <div
          className="r2-mono"
          style={{ fontSize: 11.5, color: card2DetailColor, marginTop: 4 }}
        >
          {card2Detail}
        </div>
      </div>

      {/* Card 3 — 0 lines need review */}
      <div className="r2-card" style={{ padding: "14px 18px" }}>
        <p className="r2-eyebrow" style={{ marginBottom: 4 }}>
          0 lines need review
        </p>
        <div
          style={{
            fontFamily: "var(--display)",
            fontSize: 22,
            letterSpacing: "-0.015em",
          }}
        >
          You can send.
        </div>
        <div
          className="r2-mono"
          style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}
        >
          all margins above floor · global adj{" "}
          {globalAdjPct >= 0 ? "+" : ""}
          {globalAdjPct.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
