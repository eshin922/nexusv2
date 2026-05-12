"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  selectActiveTierId,
  selectFirmSettings,
  selectQuoteRollup,
  selectSetActiveTier,
  selectTargetMargin,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice RI.4 — Cost stack header per R6 actual source (extracted from
// docs/design-prototypes/dist/source/round-6/index.html lines
// 2403-2607 + cost-stack-header.jsx). Comprehensive sweep against R6
// actual class register, May 2026 — replaces prior synthetic
// `r6-*` vocabulary the implementation invented before extraction.
//
// Structure:
//   .r6-stack — outer card (paper bg + 1px rule border + 12px radius)
//     .r6-stack-head — H2 "Cost stack" + 5/6-item COMPONENT legend
//     .r6-stack-grid — 1px gap on --rule bg (gap-as-hairline-divider)
//       .r6-tier-col (one per tier; cursor pointer; active = inset bottom underline)
//         .r6-tier-col-head — mono label + 22px display qty<sup>units</sup>
//         .r6-tier-col-bars — component rows
//           .r6-comp-row — [38px key | 1fr bar | 64px price]
//             .r6-bar (always full cell width; segments scale via width:%)
//               .seg.cost.{key} | .seg.markup
//         .r6-tier-col-foot — Subtotal / Sell (display 22px) / Margin (bare with pip)
//
// Active-tier propagation: cost stack header tier-card click drives
// the active-tier store (mirrors active-tier-selector.tsx pattern).
// No separate <ActiveTierSelector> mounted on Costs — the tier
// columns ARE the selector.

const URL_PARAM = "tier";

const COMPONENT_TOKENS = {
  packaging: { key: "pkg", label: "PKG" },
  production: { key: "prod", label: "PROD" },
  raw: { key: "raw", label: "RAW" },
  freight: { key: "frt", label: "FRT" },
  internal: { key: "dt", label: "D+T" },
  passthrough: { key: "pass", label: "PASS" },
} as const;

type ComponentKey = keyof typeof COMPONENT_TOKENS;

// R6 cost stack values are PER-UNIT at 2 decimals (cost-build-data.jsx
// comment: "Numbers below are per-unit dollars at that tier"). Sell at
// 22px display reads "$3.95" not "$3,950". Per Designer comprehensive
// audit C-1 — single biggest "doesn't look like R6" driver.
function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// Total tier value (raw, NOT per-unit). Caller divides by tier.qty.
function tierTotalFor(
  key: ComponentKey,
  rollup: ReturnType<typeof selectQuoteRollup>[number],
): number {
  switch (key) {
    case "packaging":
      return rollup.costBreakdown.packaging;
    case "production":
      return rollup.costBreakdown.production;
    case "freight":
      // Slice RI.8 Option B+ — FRT row reads container-only.
      // D+T renders separately via the "internal" row below.
      return rollup.costBreakdown.freightContainer;
    case "internal":
      // Slice RI.8 Option B+ — D+T (duty + tariff) cost-stack row.
      // Edward locked position: own row with real numbers, not a
      // freight-fold or hardcoded zero.
      return rollup.costBreakdown.dutyAndTariff;
    case "raw":
    case "passthrough":
      // Not yet broken out from costBreakdown (UX_BACKLOG: companion
      // restoration with the per-component split — RAW for
      // dps_sources mode, PASS for separateServiceFees > 0).
      return 0;
  }
}

export function CostStackHeader({
  tiers,
  rawsMode,
}: {
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  rawsMode: "cm_sources" | "dps_sources" | "customer_supplies";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const activeTierId = useCostingStore(selectActiveTierId);
  const setActiveTier = useCostingStore(selectSetActiveTier);
  const firmSettings = useCostingStore(selectFirmSettings);
  const quoteTargetMargin = useCostingStore(selectTargetMargin);
  // Effective target — quote override or firm default. Used in
  // margin row's "BELOW {N}" inline tag (R6 hardcodes "BELOW 35"
  // because their fixture target is 35%; CC reads the actual value).
  const effectiveTargetPct =
    (quoteTargetMargin ?? firmSettings.targetMarginPct) * 100;

  const selectTier = (tierId: string) => {
    setActiveTier(tierId);
    const next = new URLSearchParams(searchParams);
    next.set(URL_PARAM, tierId);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  if (tiers.length === 0) {
    return (
      <div className="rounded-xl border border-rule bg-paper p-5 text-sm italic text-ink-4">
        Add at least one tier to see the cost stack.
      </div>
    );
  }

  const showRaw = rawsMode === "dps_sources";
  // Slice RI.8 Option B+ — D+T row restored with real numbers
  // sourced from breakdown.dutyAndTariff. PASS still hardcoded
  // to zero and dropped pending companion restoration work
  // (UX_BACKLOG entry referenced from RI.9 cost-stack work).
  const components: ComponentKey[] = showRaw
    ? ["packaging", "production", "raw", "freight", "internal"]
    : ["packaging", "production", "freight", "internal"];

  // R6 normalizes bar segment widths to max per-unit SUBTOTAL (cost,
  // NOT revenue) across tiers per cost-stack-header.jsx lines 14-19:
  //   reduce((m, t) => Math.max(m, t.subtotal != null ? t.subtotal : 0), 1)
  // Bars represent cost+markup contribution; normalizing to max-cost
  // makes the segments span 30-40% of cell width (R6 visual register)
  // rather than 15-20% (which is what max-revenue normalization gives).
  const maxPerUnitCost = Math.max(
    ...quoteRollup.map((t) => {
      const q = tiers.find((tt) => tt.id === t.tierId)?.qty ?? 0;
      return q > 0 ? t.totalCost / q : 0;
    }),
    0.01,
  );

  return (
    <div
      className="r6-stack overflow-hidden rounded-xl"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        marginBottom: "24px",
      }}
    >
      {/* Head bar: H2 + component legend */}
      <div
        className="r6-stack-head grid items-center gap-4 px-[22px] py-3.5"
        style={{
          gridTemplateColumns: "1fr auto",
          background: "var(--paper)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <h2 className="m-0 font-display text-[17px] font-medium tracking-[-0.005em] text-ink">
          Cost stack
        </h2>
        <div className="flex items-center gap-3.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">
          <LegendItem label="Packaging" color="var(--comp-pkg)" />
          <LegendItem label="Production" color="var(--comp-prod)" />
          {showRaw && (
            <LegendItem label="Raws" tail="(DPS-sourced)" color="var(--comp-raw)" />
          )}
          <LegendItem label="Freight" color="var(--comp-frt)" />
          <LegendItem label="D+T" tail="internal" hatched />
        </div>
      </div>

      {/* Grid: 1px gap on --rule bg renders hairline tier dividers */}
      <div
        className="r6-stack-grid grid"
        style={{
          gridTemplateColumns: `repeat(${tiers.length}, 1fr)`,
          gap: "1px",
          background: "var(--rule)",
        }}
      >
        {tiers.map((tier) => {
          const rollup = quoteRollup.find((r) => r.tierId === tier.id);
          const isActive = activeTierId === tier.id;
          return (
            <TierColumn
              key={tier.id}
              tier={tier}
              rollup={rollup}
              components={components}
              maxPerUnitCost={maxPerUnitCost}
              isActive={isActive}
              effectiveTargetPct={effectiveTargetPct}
              onSelect={() => selectTier(tier.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function LegendItem({
  label,
  tail,
  color,
  hatched,
}: {
  label: string;
  tail?: string;
  color?: string;
  hatched?: boolean;
}) {
  const swatchStyle: React.CSSProperties = hatched
    ? {
        background:
          "repeating-linear-gradient(135deg, var(--comp-dt) 0 3px, var(--comp-dt-stripe) 3px 6px)",
      }
    : { background: color };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-[9px] w-[9px] rounded-[2px] align-middle"
        style={swatchStyle}
      />
      <span>{label}</span>
      {tail && <span className="opacity-70">{tail}</span>}
    </span>
  );
}

function TierColumn({
  tier,
  rollup,
  components,
  maxPerUnitCost,
  isActive,
  effectiveTargetPct,
  onSelect,
}: {
  tier: { id: string; label: string; qty: number | null };
  rollup: ReturnType<typeof selectQuoteRollup>[number] | undefined;
  components: ComponentKey[];
  maxPerUnitCost: number;
  isActive: boolean;
  effectiveTargetPct: number;
  onSelect: () => void;
}) {
  const tierQty = tier.qty ?? 0;
  const totalCostTier = rollup?.totalCost ?? 0;
  const totalRevenueTier = rollup?.totalRevenue ?? 0;
  // Per-unit values per R6 (cost-build-data.jsx fixture comment).
  const totalCostPerUnit = tierQty > 0 ? totalCostTier / tierQty : 0;
  const totalRevenuePerUnit = tierQty > 0 ? totalRevenueTier / tierQty : 0;
  const totalMarkupPerUnit = totalRevenuePerUnit - totalCostPerUnit;
  const marginPct = rollup?.blendedMarginPct ?? null;
  const marginStatus = rollup?.blendedMarginStatus ?? "GOOD";
  const isEmpty = totalRevenueTier <= 0;

  // Slice RI.8 hotfix — Subtotal reconciliation bug (Edward smoke).
  // R6's "Subtotal" semantic = sum of (cost + markup) across rendered
  // component rows (verified against cost-build-data.jsx:43-51:
  // each tier's `subtotal` field = sum of its components' cost+markup).
  // Prior code displayed rollup.totalCost (cost-only) as Subtotal,
  // which doesn't reconcile with the rows that show cost+markup.
  //
  // New Subtotal = sum of what's literally rendered above. The
  // "Adjustment" delta to Sell shows when the rendered rows don't
  // fully account for Sell (cell overrides, hidden components like
  // serviceFees / passthrough — both UX_BACKLOG items pending the
  // per-component split for RI.9 cost-stack work).
  const componentValues = components.map((key) => {
    const tierTotal = rollup ? tierTotalFor(key, rollup) : 0;
    const componentCostPerUnit = tierQty > 0 ? tierTotal / tierQty : 0;
    const componentMarkupPerUnit =
      totalCostPerUnit > 0 && totalMarkupPerUnit > 0
        ? (componentCostPerUnit / totalCostPerUnit) * totalMarkupPerUnit
        : 0;
    return { key, cost: componentCostPerUnit, markup: componentMarkupPerUnit };
  });
  const subtotalPerUnit = componentValues.reduce(
    (sum, c) => sum + c.cost + c.markup,
    0,
  );
  const adjustmentPerUnit = totalRevenuePerUnit - subtotalPerUnit;

  // R6 tier-col: paper bg + cursor + active = inset bottom underline.
  // No border on the column; gap-as-rule from parent grid renders dividers.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={`Select ${tier.label} as active tier`}
      onClick={onSelect}
      className="r6-tier-col flex flex-col text-left transition-colors hover:bg-paper-2 focus:outline-none"
      style={{
        background: "var(--paper)",
        boxShadow: isActive ? "inset 0 -3px 0 var(--ink)" : undefined,
      }}
    >
      <div className="r6-tier-col-head flex flex-col gap-1 px-[18px] pt-3.5 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-ink-4">
          {tier.label}
        </span>
        <span className="font-display text-[22px] font-medium leading-none tracking-[-0.015em] text-ink">
          {tier.qty !== null ? tier.qty.toLocaleString() : "—"}
          {tier.qty !== null && (
            <span className="ml-1.5 align-super font-mono text-[10px] tracking-[0.04em] text-ink-4">
              units
            </span>
          )}
        </span>
      </div>

      <div className="r6-tier-col-bars flex flex-1 flex-col gap-0.5 px-[18px] pt-3 pb-1.5">
        {componentValues.map((c) => (
          <CompRow
            key={c.key}
            componentKey={c.key}
            cost={c.cost}
            markup={c.markup}
            maxPerUnitCost={maxPerUnitCost}
          />
        ))}
      </div>

      <div className="r6-tier-col-foot mt-auto flex flex-col gap-1.5 border-t border-rule px-[18px] pt-3.5 pb-4">
        {!isEmpty ? (
          <>
            <div className="flex items-baseline justify-between text-[11px] text-ink-4">
              <span>Subtotal</span>
              <span
                className="font-mono text-[11px] text-ink-3"
                title="Sum of (cost + markup) across component rows above"
              >
                {subtotalPerUnit > 0 ? fmtCurr2(subtotalPerUnit) : "—"}
              </span>
            </div>
            {Math.abs(adjustmentPerUnit) >= 0.005 && (
              <div
                className="flex items-baseline justify-between text-[11px] text-ink-4"
                title="Difference between Sell and the sum of component rows. Non-zero when a cell override is set, when a per-tier price adjustment applies, or when there are hidden cost components (passthrough services) not rendered above."
              >
                <span>{adjustmentPerUnit < 0 ? "Override" : "Adjustment"}</span>
                <span
                  className="font-mono text-[11px]"
                  style={{
                    color:
                      adjustmentPerUnit < 0 ? "var(--bad)" : "var(--ink-3)",
                  }}
                >
                  {adjustmentPerUnit >= 0 ? "+" : "−"}
                  {fmtCurr2(Math.abs(adjustmentPerUnit))}
                </span>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between border-t border-rule pt-1.5">
              <span className="font-display text-[14px] text-ink">Sell</span>
              <span className="font-display text-[22px] font-medium leading-none tracking-[-0.02em] text-ink">
                {fmtCurr2(totalRevenuePerUnit)}
              </span>
            </div>
            <MarginRow
              status={marginStatus}
              pct={marginPct}
              targetPct={effectiveTargetPct}
            />
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between border-t border-rule pt-1.5">
              <span className="font-display text-[14px] text-ink">Sell</span>
              <span className="font-display text-[22px] italic font-normal text-ink-4">
                —
              </span>
            </div>
            <MarginRow
              status="incomplete"
              pct={null}
              targetPct={effectiveTargetPct}
            />
          </>
        )}
      </div>
    </button>
  );
}

function CompRow({
  componentKey,
  cost,
  markup,
  maxPerUnitCost,
}: {
  componentKey: ComponentKey;
  cost: number;
  markup: number;
  maxPerUnitCost: number;
}) {
  const meta = COMPONENT_TOKENS[componentKey];
  const isInternal = componentKey === "internal";
  const isRaw = componentKey === "raw";
  const isPassthrough = componentKey === "passthrough";
  const totalValue = cost + markup;
  const isEmpty = totalValue <= 0;

  // R6 bar: always 100% of grid cell. Segments scale via width:% of the
  // cell's max per-unit subtotal. Two segments per bar (R6 source
  // cost-stack-header.jsx:196-199 + index.html:2541-2544):
  //   .seg.cost.{key} → component color
  //   .seg.markup    → --ink with --paper border-left (1px hairline)
  // Passthrough never has markup per R6 source.
  const costPct = Math.max(0.5, (cost / maxPerUnitCost) * 100);
  const markupPct = isPassthrough ? 0 : Math.max(0, (markup / maxPerUnitCost) * 100);

  return (
    <div
      className={`r6-comp-row grid items-center gap-2 font-mono text-[10.5px] ${
        isRaw ? "r6-comp-row-raw relative pl-[14px]" : ""
      }`}
      style={{ gridTemplateColumns: "38px 1fr 64px" }}
    >
      <span
        className={`uppercase tracking-[0.06em] font-medium ${
          isInternal ? "text-internal" : "text-ink-4"
        }`}
      >
        {isRaw && (
          <span
            aria-hidden
            className="absolute"
            style={{
              left: "4px",
              top: "50%",
              width: "7px",
              height: "7px",
              borderLeft: "1px solid var(--rule-2)",
              borderBottom: "1px solid var(--rule-2)",
              transform: "translateY(-90%)",
              borderBottomLeftRadius: "2px",
            }}
          />
        )}
        {meta.label}
      </span>

      {isEmpty ? (
        <span
          className="r6-bar empty"
          style={{
            display: "block",
            height: "18px",
            background: "var(--paper-2)",
            border: "1px dashed var(--rule-2)",
            borderRadius: "3px",
          }}
        />
      ) : (
        <span
          className="r6-bar"
          style={{
            display: "flex",
            height: "18px",
            background: "var(--paper-3)",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <span
            className="seg cost"
            style={{
              display: "block",
              height: "100%",
              width: `${costPct}%`,
              ...segCostStyle(meta.key),
              transition: "width 200ms ease-out",
            }}
          />
          {markupPct > 0 && (
            <span
              className="seg markup"
              style={{
                display: "block",
                height: "100%",
                width: `${markupPct}%`,
                background: "var(--ink)",
                borderLeft: "1px solid var(--paper)",
                transition: "width 200ms ease-out",
              }}
            />
          )}
        </span>
      )}

      <span
        className={`text-right font-mono text-[11px] tracking-[-0.005em] ${
          isEmpty ? "italic text-ink-4" : "text-ink-2"
        }`}
      >
        {isEmpty ? "—" : fmtCurr2(totalValue)}
      </span>
    </div>
  );
}

function segCostStyle(key: string): React.CSSProperties {
  switch (key) {
    case "pkg":
      return { background: "var(--comp-pkg)" };
    case "prod":
      return { background: "var(--comp-prod)" };
    case "frt":
      return { background: "var(--comp-frt)" };
    case "raw":
      return { background: "var(--comp-raw)" };
    case "dt":
      return {
        background:
          "repeating-linear-gradient(135deg, var(--comp-dt) 0 4px, var(--comp-dt-stripe) 4px 8px)",
      };
    case "pass":
      return { background: "var(--ink-4)" };
    default:
      return {};
  }
}

function MarginRow({
  status,
  pct,
  targetPct,
}: {
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR" | "incomplete";
  pct: number | null;
  targetPct: number;
}) {
  const cls = (() => {
    switch (status) {
      case "GOOD":
        return "text-good";
      case "BELOW_TARGET":
        return "text-warn";
      case "BELOW_FLOOR":
        return "text-bad";
      case "incomplete":
        return "italic text-ink-4";
    }
  })();
  return (
    <div
      className={`flex items-center gap-2 font-mono text-[11px] tracking-[0.04em] ${cls}`}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{
          background:
            status === "incomplete" ? "var(--rule-2)" : "currentColor",
          border: status === "incomplete" ? "1px dashed var(--ink-4)" : undefined,
        }}
      />
      {status === "incomplete"
        ? "awaiting inputs"
        : pct != null
          ? `${fmtPct(pct)} margin`
          : "—"}
      {status === "BELOW_TARGET" && (
        <span className="ml-auto text-[9.5px] tracking-[0.06em]">
          BELOW {Math.round(targetPct)}
        </span>
      )}
      {status === "BELOW_FLOOR" && (
        <span className="ml-auto text-[9.5px] tracking-[0.06em]">
          BELOW FLOOR
        </span>
      )}
    </div>
  );
}
