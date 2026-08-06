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

// Slice RI.8 Option 2 — return BOTH cost AND markup per component
// (raw totals, NOT per-unit). Caller divides by tier.qty for display.
// Sourced from per-component marked-up primitives on the math layer
// (no more proportional-share approximation). Reconciles with section
// mini-stack + drilldown TOTAL — all three read the same source.
type CostMarkup = { cost: number; markup: number };
function tierTotalFor(
  key: ComponentKey,
  rollup: ReturnType<typeof selectQuoteRollup>[number],
): CostMarkup {
  const b = rollup.costBreakdown;
  switch (key) {
    case "packaging":
      // packagingMarkupSum is the MARKED-UP value (cost × (1+markup));
      // markup contribution = markedUp − cost.
      return {
        cost: b.packaging,
        markup: b.packagingMarkupSum - b.packaging,
      };
    case "production":
      return {
        cost: b.production,
        markup: b.productionMarkupSum - b.production,
      };
    case "freight":
      // FRT row reads container-only. Markup = container_marked_up − container.
      return {
        cost: b.freightContainer,
        markup: b.freightContainerMarkupSum - b.freightContainer,
      };
    case "internal":
      // D+T row reads dutyAndTariff with its share of the freight
      // line's markup_pct applied (math layer applies freight markup
      // uniformly to container + D+T per line).
      return {
        cost: b.dutyAndTariff,
        markup: b.dutyAndTariffMarkupSum - b.dutyAndTariff,
      };
    case "raw":
    case "passthrough":
      // Not yet rendered (UX_BACKLOG: RAW for dps_sources mode,
      // PASS for separateServiceFees > 0).
      return { cost: 0, markup: 0 };
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
      <div
        className="r6-stack"
        style={{
          padding: "20px",
          fontSize: "14px",
          fontStyle: "italic",
          color: "var(--ink-4)",
        }}
      >
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

  // §6.b path-B Costs migration commit 3/5 — canonical .r6-stack
  // structure per r6_cost-stack.jsx lines 24-55 + 6styles.css
  // .r6-stack rules. Drops Tailwind utility chrome that canonical
  // CSS now provides via descendant selectors (.r6-stack /
  // .r6-stack-head / .r6-stack-head h2 / .r6-stack-head .legend).
  return (
    <div className="r6-stack">
      {/* Head bar: H2 + component legend. Canonical .r6-stack-head
          provides grid + padding + bottom-rule; LegendItem children
          render .swatch + label per canonical .legend grammar. */}
      <div className="r6-stack-head">
        <h2>Cost stack</h2>
        <div className="legend">
          <LegendItem label="Packaging" variant="pkg" />
          <LegendItem label="Production" variant="prod" />
          {showRaw && (
            <LegendItem label="Raws" tail="(DPS-sourced)" variant="raw" />
          )}
          <LegendItem label="Freight" variant="frt" />
          <LegendItem label="D+T" tail="internal" variant="dt" />
          {/* Passthrough legend slot — R6 commitment to stack grammar
              consistency across states (the PASS row may render empty
              but the legend slot stays present). Restored per Designer
              audit M1 — slot was dropped during Option B+ fold-in
              alongside the row; row stays dropped pending companion
              math layer split (UX_BACKLOG: RAW + PASS restoration). */}
          <LegendItem label="Passthrough" variant="pass" />
        </div>
      </div>

      {/* Grid: canonical .r6-stack-grid provides 1px gap on --rule bg
          for hairline tier dividers; only column count is dynamic. */}
      <div
        className="r6-stack-grid"
        style={{
          gridTemplateColumns: `repeat(${tiers.length}, 1fr)`,
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

// Canonical .r6-stack-head .legend grammar: each item is
// <span><span class="swatch {variant}" />Label [tail]</span>.
// CSS provides variant-specific swatch fill (.pkg/.prod/.frt/.dt/
// .pass/.raw) — no inline color. DT swatch uses repeating-linear-
// gradient pattern; others are solid component colors.
function LegendItem({
  label,
  tail,
  variant,
}: {
  label: string;
  tail?: string;
  variant: "pkg" | "prod" | "frt" | "dt" | "pass" | "raw";
}) {
  return (
    <span>
      <span aria-hidden className={`swatch ${variant}`} />
      {label}
      {tail && <span style={{ opacity: 0.7, marginLeft: 4 }}>{tail}</span>}
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
  // totalCostPerUnit retained for the MarginRow + bar normalization;
  // proportional markup distribution no longer used post-Option 2.
  const marginPct = rollup?.blendedMarginPct ?? null;
  const marginStatus = rollup?.blendedMarginStatus ?? "GOOD";
  const isEmpty = totalRevenueTier <= 0;

  // Slice RI.8 Option 2 — each component reads its cost AND its real
  // per-line markup directly from the math layer
  // (rollup.costBreakdown.*MarkupSum). No more proportional-share
  // approximation. Subtotal = sum of (cost + markup) = sellWithoutGlobalAdj
  // when no cell-overrides; the Adjustment row surfaces the gap to
  // Sell when adjustments / overrides apply.
  const componentValues = components.map((key) => {
    const cm = rollup
      ? tierTotalFor(key, rollup)
      : { cost: 0, markup: 0 };
    return {
      key,
      cost: tierQty > 0 ? cm.cost / tierQty : 0,
      markup: tierQty > 0 ? cm.markup / tierQty : 0,
    };
  });
  const subtotalPerUnit = componentValues.reduce(
    (sum, c) => sum + c.cost + c.markup,
    0,
  );
  const adjustmentPerUnit = totalRevenuePerUnit - subtotalPerUnit;

  // Canonical .r6-tier-col rules (6styles.css L155-166) provide paper
  // bg, flex column, cursor, hover bg-shift, and .active inset-bottom
  // underline. JSX uses native `<button>` for role=tab affordance +
  // applies .active modifier for the underline.
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={`Select ${tier.label} as active tier`}
      onClick={onSelect}
      className={`r6-tier-col${isActive ? " active" : ""}`}
      style={{
        textAlign: "left",
        border: "none",
        outline: "none",
        font: "inherit",
        color: "inherit",
      }}
    >
      <div className="r6-tier-col-head">
        <span className="label">{tier.label}</span>
        <span className="qty">
          {tier.qty !== null ? tier.qty.toLocaleString() : "—"}
          {tier.qty !== null && <span className="units">units</span>}
        </span>
      </div>

      <div className="r6-tier-col-bars">
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

      <div className="r6-tier-col-foot">
        {!isEmpty ? (
          <>
            <div
              className="row sub"
              title="Sum of (cost + markup) across component rows above"
            >
              <span>Subtotal</span>
              <span className="v">
                {subtotalPerUnit > 0 ? fmtCurr2(subtotalPerUnit) : "—"}
              </span>
            </div>
            {Math.abs(adjustmentPerUnit) >= 0.005 && (
              <div
                className="row sub"
                title="Difference between Sell and the sum of component rows. Non-zero when a cell override is set, when a per-tier price adjustment applies, or when there are hidden cost components (passthrough services) not rendered above."
              >
                <span>{adjustmentPerUnit < 0 ? "Override" : "Adjustment"}</span>
                <span
                  className="v"
                  style={{
                    color:
                      adjustmentPerUnit < 0 ? "var(--bad)" : undefined,
                  }}
                >
                  {adjustmentPerUnit >= 0 ? "+" : "−"}
                  {fmtCurr2(Math.abs(adjustmentPerUnit))}
                </span>
              </div>
            )}
            <div className="row sell">
              <span className="lab">Sell</span>
              <span className="v">{fmtCurr2(totalRevenuePerUnit)}</span>
            </div>
            <MarginRow
              status={marginStatus}
              pct={marginPct}
              targetPct={effectiveTargetPct}
            />
          </>
        ) : (
          <>
            <div className="row sell">
              <span className="lab">Sell</span>
              <span className="v empty">—</span>
            </div>
            <MarginRow
              status="incomplete"
              pct={null}
              targetPct={effectiveTargetPct}
              // Tier quantity is the denominator for every per-unit figure
              // in this stack. When it is unset the stack cannot render, and
              // a generic "awaiting inputs" misattributes that to the cost
              // sections — which may be complete and correct. Name the real
              // blocker instead.
              missingTierQty={!(tierQty > 0)}
            />
          </>
        )}
      </div>
    </button>
  );
}

// Canonical .r6-comp-row grammar:
//   <div class="r6-comp-row {dt|raw|empty}">
//     <span class="key">PKG</span>
//     <span class="r6-bar [.empty]">
//       <span class="seg cost {pkg|prod|frt|raw|dt|pass}" style="width:%"/>
//       <span class="seg markup" style="width:%"/>
//     </span>
//     <span class="price">$1.23</span>
//   </div>
// CSS provides grid columns, font-mono register, key/price colors per
// modifier, and bar/seg sizing. JSX only sets dynamic segment widths.
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
  const isPassthrough = componentKey === "passthrough";
  const totalValue = cost + markup;
  const isEmpty = totalValue <= 0;

  // R6 bar: segments scale via width:% of the cell's max per-unit
  // subtotal. Passthrough never has markup per R6 source.
  const costPct = Math.max(0.5, (cost / maxPerUnitCost) * 100);
  const markupPct = isPassthrough ? 0 : Math.max(0, (markup / maxPerUnitCost) * 100);

  const rowMods = [
    componentKey === "internal" ? "dt" : "",
    componentKey === "raw" ? "raw" : "",
    isEmpty ? "empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`r6-comp-row${rowMods ? ` ${rowMods}` : ""}`}>
      <span className="key">{meta.label}</span>

      {isEmpty ? (
        <span className="r6-bar empty" />
      ) : (
        <span className="r6-bar">
          <span
            className={`seg cost ${meta.key}`}
            style={{
              width: `${costPct}%`,
              transition: "width 200ms ease-out",
            }}
          />
          {markupPct > 0 && (
            <span
              className="seg markup"
              style={{
                width: `${markupPct}%`,
                transition: "width 200ms ease-out",
              }}
            />
          )}
        </span>
      )}

      <span className="price">
        {isEmpty ? "—" : fmtCurr2(totalValue)}
      </span>
    </div>
  );
}

// Canonical .r6-tier-col-foot .margin grammar:
//   <div class="margin {good|warn|bad|below_target|incomplete}">
//     <span class="pip" />
//     {text}
//     [<span class="below">BELOW 35</span>]
//   </div>
// CSS provides flex layout, font-mono register, color per status,
// pip background per status, and italic for incomplete.
function MarginRow({
  status,
  pct,
  targetPct,
  missingTierQty = false,
}: {
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR" | "incomplete";
  pct: number | null;
  targetPct: number;
  /**
   * True when this tier has no usable quantity. Distinguishes "the cost
   * sections are still being filled in" from "there is no quantity to divide
   * by", which are different problems on different surfaces. Reported an
   * operator against Packaging when Packaging was complete and correct.
   */
  missingTierQty?: boolean;
}) {
  const statusClass =
    status === "GOOD"
      ? "good"
      : status === "BELOW_TARGET"
        ? "below_target"
        : status === "BELOW_FLOOR"
          ? "bad"
          : "incomplete";
  return (
    <div className={`margin ${statusClass}`}>
      <span className="pip" aria-hidden />
      {status === "incomplete"
        ? missingTierQty
          ? "missing tier quantity"
          : "awaiting inputs"
        : pct != null
          ? `${fmtPct(pct)} margin`
          : "—"}
      {status === "BELOW_TARGET" && (
        <span style={{ marginLeft: "auto", fontSize: "9.5px", letterSpacing: "0.06em" }}>
          BELOW {Math.round(targetPct)}
        </span>
      )}
      {status === "BELOW_FLOOR" && (
        <span style={{ marginLeft: "auto", fontSize: "9.5px", letterSpacing: "0.06em" }}>
          BELOW FLOOR
        </span>
      )}
    </div>
  );
}
