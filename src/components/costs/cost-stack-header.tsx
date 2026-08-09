"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  selectActiveTierId,
  selectFirmSettings,
  selectGraph,
  selectQuoteRollup,
  selectSetActiveTier,
  selectTargetMargin,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  quoteScopeKey,
  readEffectiveTargetMargin,
  readNodeValue,
} from "@/lib/costing-nodes";

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
//
// ── Gate 1B · A-6 consumer cutover ────────────────────────────────────────
//
// Every commercial number below is READ from the canonical graph. This surface
// used to derive them: it summed component totals, divided each by tier
// quantity, summed the results into a subtotal, and subtracted that subtotal
// from revenue. Four separate derivations of quantities the engine had already
// computed — which is how two surfaces labelled the same thing came to disagree
// by 9% and neither was wrong.
//
// WHAT THIS SURFACE ASSERTS, and why it is not the Pricing blend. These are the
// quote's tier TOTALS allocated over the tier quantity: "what does one unit of
// this tier contribute, all products combined". Pricing blends across the
// governed SKU population: "what does an average SKU sell for". On production
// data the two differ on 22 of 40 defined tiers, by factors of 2x, 3x and 9x.
// Both are correct. They must not be collapsed into one another, and the
// tooltips below name the basis so an operator is not left to assume.
//
// THE STACK SHOWS INDEPENDENTLY GOVERNED QUANTITIES AND NOTHING ELSE. Bulk raw
// is costed inside Production and has no node of its own, so it gets no row —
// it is explanatory metadata on the row that carries the money, not a line of
// its own. See `PROD_INCLUDES_BULK_RAW`.

const URL_PARAM = "tier";

/**
 * The rows with an independently governed per-unit value, in render order.
 *
 * `node` addresses the canonical graph; `label` and `swatch` are presentation.
 * Bulk raw is deliberately absent — it has no independently governed value, so
 * it is metadata on Production rather than a row. See `PROD_INCLUDES_BULK_RAW`.
 */
const GOVERNED_ROWS = [
  { node: "pkg", label: "PKG", swatch: "pkg", mod: "" },
  { node: "prod", label: "PROD", swatch: "prod", mod: "" },
  { node: "frt", label: "FRT", swatch: "frt", mod: "" },
  { node: "dt", label: "D+T", swatch: "dt", mod: "dt" },
] as const;

type GovernedRow = (typeof GOVERNED_ROWS)[number];

type RowValues = { total: number; cost: number; markup: number };

/** Every per-unit value one tier column displays. Present only when ALL of them
 *  resolved — a stack half-read from the graph and half-invented is the exact
 *  failure this cutover removes. */
type TierPerUnit = {
  rows: Array<{ row: GovernedRow; values: RowValues }>;
  subtotal: number;
  departure: number;
  revenue: number;
  costTotal: number;
};

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
  const graph = useCostingStore(selectGraph);
  // Effective target, READ — value and provenance together.
  //
  // This was a private `quoteTargetMargin ?? firmSettings.targetMarginPct`, one
  // of five. The number was right; what it could not say is WHY. "BELOW 35"
  // reads identically whether 35 is firm policy or this quote's own decision,
  // and 12 of 62 quotes override — so the tag now names its source.
  const effectiveTarget = readEffectiveTargetMargin(graph.nodes);
  const effectiveTargetPct =
    effectiveTarget !== null ? effectiveTarget.value * 100 : null;

  // Resolved HERE, once, and passed down as data — the same discipline the
  // Pricing Cost Stack cutover established. The columns render what they are
  // given and have no access to the graph, so there is one place where a
  // commercial value can enter this surface.
  //
  // `readNodeValue` fails closed on missing, duplicate AND flagged-out. The
  // third matters here specifically: a zero-quantity tier emits a flagged-out
  // node at `per-unit`, so reading `.value` off it would render $0.00 for a
  // figure that is undefined rather than zero.
  const perUnitByTier = useMemo(() => {
    const out = new Map<string, TierPerUnit>();
    for (const tier of tiers) {
      const read = (name: string): number | null =>
        readNodeValue(graph.nodes, quoteScopeKey(tier.id, `per-unit/${name}`));

      const rows: Array<{ row: GovernedRow; values: RowValues }> = [];
      let complete = true;
      for (const row of GOVERNED_ROWS) {
        const total = read(row.node);
        const cost = read(`${row.node}/cost`);
        const markup = read(`${row.node}/markup`);
        if (total === null || cost === null || markup === null) {
          complete = false;
          break;
        }
        rows.push({ row, values: { total, cost, markup } });
      }
      if (!complete) continue;

      const subtotal = readNodeValue(
        graph.nodes,
        quoteScopeKey(tier.id, "per-unit"),
      );
      const departure = read("departure");
      const revenue = read("revenue");
      const costTotal = read("cost-total");
      if (
        subtotal === null ||
        departure === null ||
        revenue === null ||
        costTotal === null
      ) {
        continue;
      }

      out.set(tier.id, { rows, subtotal, departure, revenue, costTotal });
    }
    return out;
  }, [graph, tiers]);

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

  // Bar geometry, NOT a commercial value: segment widths are a percentage of
  // the widest tier's per-unit cost, so the bars are comparable across columns.
  // This arithmetic is about pixels and stays local by design — the dollars it
  // scales were all read from the graph.
  const maxPerUnitCost = Math.max(
    ...[...perUnitByTier.values()].map((t) => t.costTotal),
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
          {/* A legend swatch is a promise that a colour appears in the bars.
              Bulk raw has no segment to colour, so it gets no entry of its own
              — it qualifies the Production swatch instead. */}
          <LegendItem
            label="Production"
            tail={showRaw ? "incl. bulk raw" : undefined}
            variant="prod"
          />
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
              perUnit={perUnitByTier.get(tier.id)}
              showRaw={showRaw}
              marginPct={rollup?.blendedMarginPct ?? null}
              marginStatus={rollup?.blendedMarginStatus ?? "GOOD"}
              maxPerUnitCost={maxPerUnitCost}
              isActive={isActive}
              effectiveTargetPct={effectiveTargetPct}
              targetSource={effectiveTarget?.source ?? null}
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
  variant: "pkg" | "prod" | "frt" | "dt" | "pass";
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
  perUnit,
  showRaw,
  marginPct,
  marginStatus,
  maxPerUnitCost,
  isActive,
  effectiveTargetPct,
  targetSource,
  onSelect,
}: {
  tier: { id: string; label: string; qty: number | null };
  perUnit: TierPerUnit | undefined;
  showRaw: boolean;
  marginPct: number | null;
  marginStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  maxPerUnitCost: number;
  isActive: boolean;
  effectiveTargetPct: number | null;
  targetSource: string | null;
  onSelect: () => void;
}) {
  // Unavailable, not empty. Either the graph does not carry per-unit values for
  // this tier (zero quantity — the allocation is undefined, and undefined is
  // not zero), or the tier has not been priced yet. Both render the same
  // honest dash rather than a figure.
  const unavailable = perUnit === undefined || perUnit.revenue <= 0;

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
        {GOVERNED_ROWS.map((row) => {
          const found = perUnit?.rows.find((r) => r.row.node === row.node);
          return (
            <CompRow
              key={row.node}
              row={row}
              values={found ? found.values : null}
              maxPerUnitCost={maxPerUnitCost}
              hint={
                showRaw && row.node === "prod" ? PROD_INCLUDES_BULK_RAW : null
              }
            />
          );
        })}
      </div>

      <div className="r6-tier-col-foot">
        {perUnit && !unavailable ? (
          <>
            <div
              className="row sub"
              title="All products in this tier, per unit: component cost plus markup, allocated over the tier quantity. A whole-quote figure — not the per-SKU blended average shown on Pricing."
            >
              <span>Subtotal</span>
              <span className="v">{fmtCurr2(perUnit.subtotal)}</span>
            </div>
            {Math.abs(perUnit.departure) >= 0.005 && (
              <div
                className="row sub"
                title="Quoted price less the component build-up above, per unit. Non-zero when a cell override is set, when a per-tier price adjustment applies, or when there are cost components not rendered above (passthrough services)."
              >
                <span>
                  {perUnit.departure < 0 ? "Override" : "Adjustment"}
                </span>
                <span
                  className="v"
                  style={{
                    color: perUnit.departure < 0 ? "var(--bad)" : undefined,
                  }}
                >
                  {perUnit.departure >= 0 ? "+" : "−"}
                  {fmtCurr2(Math.abs(perUnit.departure))}
                </span>
              </div>
            )}
            <div className="row sell">
              <span className="lab">Sell</span>
              <span className="v">{fmtCurr2(perUnit.revenue)}</span>
            </div>
            <MarginRow
              status={marginStatus}
              pct={marginPct}
              targetPct={effectiveTargetPct}
              targetSource={targetSource}
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
              targetSource={targetSource}
            />
          </>
        )}
      </div>
    </button>
  );
}

/**
 * Bulk raw, when the quote sources its own.
 *
 * It IS costed — folded into Production, which `productionMarkupSum` already
 * carries. What does not exist is an independently attributable raw figure, so
 * there is no node to read.
 *
 * IT THEREFORE GETS NO ROW. The stack shows independently governed commercial
 * quantities and nothing else; a line that carries no value is not a member of
 * that set, however carefully it explains itself. An earlier pass shipped it as
 * a row reading "included in PROD" — accurate, and still a stack line an
 * operator has to read past to find the figures. The relationship is metadata
 * about Production, so it lives on Production: a tail on the legend entry and a
 * tooltip on the row that actually carries the money.
 *
 * Scoped to `dps_sources` exactly as the row was. Under `cm_sources` the
 * contract manufacturer buys the raws and they arrive inside their price; under
 * `customer_supplies` there is no raw cost to fold. Only DPS-sourced raws land
 * in this quote's Production figure.
 */
const PROD_INCLUDES_BULK_RAW =
  "Includes DPS-sourced bulk raw material, which is costed inside Production " +
  "and is not separately attributable in this stack.";

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
  row,
  values,
  maxPerUnitCost,
  hint,
}: {
  row: GovernedRow;
  values: RowValues | null;
  maxPerUnitCost: number;
  /** Explanatory metadata about what this row's figure already contains. */
  hint: string | null;
}) {
  // No values at all (tier unavailable), or a governed zero. Both draw an empty
  // bar; only the first refuses to print a number.
  const isEmpty = values === null || values.total <= 0;

  // R6 bar: segments scale via width:% of the cell's max per-unit
  // subtotal. Pixel geometry, not commercial arithmetic.
  const costPct = values
    ? Math.max(0.5, (values.cost / maxPerUnitCost) * 100)
    : 0;
  const markupPct = values
    ? Math.max(0, (values.markup / maxPerUnitCost) * 100)
    : 0;

  const rowMods = [row.mod, isEmpty ? "empty" : ""].filter(Boolean).join(" ");

  return (
    <div
      className={`r6-comp-row${rowMods ? ` ${rowMods}` : ""}`}
      title={hint ?? undefined}
    >
      <span className="key">{row.label}</span>

      {isEmpty ? (
        <span className="r6-bar empty" />
      ) : (
        <span className="r6-bar">
          <span
            className={`seg cost ${row.swatch}`}
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
        {values === null || isEmpty ? "—" : fmtCurr2(values.total)}
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
  targetSource,
}: {
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR" | "incomplete";
  pct: number | null;
  /** Null when the graph cannot state one — the tag is then withheld rather
   *  than printed against a number nobody resolved. */
  targetPct: number | null;
  targetSource: string | null;
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
        ? "awaiting inputs"
        : pct != null
          ? `${fmtPct(pct)} margin`
          : "—"}
      {status === "BELOW_TARGET" && targetPct !== null && (
        <span
          style={{ marginLeft: "auto", fontSize: "9.5px", letterSpacing: "0.06em" }}
          title={
            targetSource
              ? `Target ${Math.round(targetPct)}% — ${targetSource.toLowerCase()}.`
              : undefined
          }
        >
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
