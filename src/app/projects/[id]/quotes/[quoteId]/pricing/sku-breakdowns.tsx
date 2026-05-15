"use client";

import { InternalOnlyBadge } from "@/components/internal-only-badge";
import type {
  FreightLegBreakdown,
  QuoteCostingResult,
  SkuPerTierRollup,
  SkuRollup,
} from "@/lib/costing";

// Slice RI.5 Room 3 sweep — per-SKU cost decomposition drawer.
// R2 doesn't have this drawer in its prototype, but the rollup is
// load-bearing PM workflow ("show me why this number is what it is")
// so it's preserved as a Designer-authorized R2 extension. Restyled
// to R2 register: paper-2 card chrome, mono labels, ink-token colors,
// internal-only badges on customer-invisible freight components.
//
// Mounted from sku-summary-row.tsx as expandable drawer per row.
// Shows the same cost decomposition that lives canonically on Cost
// Build (per the redesign IA split); having it here too is the
// debugging affordance PMs rely on without leaving the verdict surface.

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const cellNumStyle: React.CSSProperties = {
  padding: "6px 12px 6px 0",
  textAlign: "right",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
  color: "var(--ink-2)",
  fontVariantNumeric: "tabular-nums",
};

const cellNumBoldStyle: React.CSSProperties = {
  ...cellNumStyle,
  color: "var(--ink)",
  fontWeight: 500,
};

const cellLabelStyle: React.CSSProperties = {
  padding: "6px 12px 6px 16px",
  fontSize: 12,
  color: "var(--ink-3)",
};

const cellLabelBoldStyle: React.CSSProperties = {
  ...cellLabelStyle,
  color: "var(--ink-2)",
  fontWeight: 500,
};

export function SkuBreakdown({
  sku,
  tiers,
}: {
  sku: SkuRollup;
  tiers: QuoteCostingResult["tiers"];
}) {
  if (sku.skuRole === "assembly") {
    return (
      <div
        style={{
          background: "oklch(from var(--accent) l c h / 0.04)",
          border: "1px solid oklch(from var(--accent) l c h / 0.20)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="r2-chip accent">Assembly</span>
          <span
            className="r2-mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            {sku.skuLabel}
          </span>
          <span
            style={{
              fontFamily: "var(--display)",
              fontSize: 14,
              color: "var(--ink)",
              letterSpacing: "-0.005em",
            }}
          >
            {sku.productName}
          </span>
          {sku.qtyPerParent !== null && (
            <span
              className="r2-mono"
              style={{ fontSize: 10.5, color: "var(--ink-4)" }}
            >
              × {sku.qtyPerParent} per parent
            </span>
          )}
        </div>
        <BreakdownTable tiers={tiers}>
          <Row label="Contribution cost / unit (rolled up)" sku={sku}>
            {(pt) => fmtCurr4(pt.contributionCostPerUnit)}
          </Row>
          <Row label="Required sell / unit (rolled up)" sku={sku} bold>
            {(pt) => fmtCurr4(pt.requiredSellPerUnit)}
          </Row>
          <Row label="Margin" sku={sku}>
            {(pt) => fmtPct(pt.marginPct)}
          </Row>
          <Row label="Revenue (× tier qty)" sku={sku}>
            {(pt) => fmtCurr2(pt.revenue)}
          </Row>
          <Row label="Cost (× tier qty)" sku={sku}>
            {(pt) => fmtCurr2(pt.cost)}
          </Row>
        </BreakdownTable>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--paper-2)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <BreakdownTable tiers={tiers}>
        <Row label="Packaging cost / unit" sku={sku}>
          {(pt) => fmtCurr4(pt.packagingCostPerUnit)}
        </Row>
        <Row label="Production cost / unit" sku={sku}>
          {(pt) => fmtCurr4(pt.productionCostPerUnit)}
        </Row>
        <Row label="Raw cost / unit" sku={sku}>
          {(pt) => fmtCurr4(pt.rawCostPerUnit)}
        </Row>
        <Row label="Factory cost / unit" sku={sku} bold>
          {(pt) => fmtCurr4(pt.factoryCostPerUnit)}
        </Row>
        <FreightLines sku={sku} tiers={tiers} />
        <Row
          label={
            <>
              Landed freight before markup{" "}
              <InternalOnlyBadge short className="ml-1" />
            </>
          }
          sku={sku}
        >
          {(pt) => fmtCurr4(pt.totalLandedFreightBeforeMarkup)}
        </Row>
        <Row label="Landed freight with markup" sku={sku} bold>
          {(pt) => fmtCurr4(pt.totalLandedFreightWithMarkup)}
        </Row>
        <Row label="Separate service fees / unit" sku={sku}>
          {(pt) => fmtCurr4(pt.separateServiceFeesPerUnit)}
        </Row>
        <Row label="Contribution cost / unit" sku={sku} bold>
          {(pt) => fmtCurr4(pt.contributionCostPerUnit)}
        </Row>
        <Row label="Required sell / unit" sku={sku} bold>
          {(pt) => fmtCurr4(pt.requiredSellPerUnit)}
        </Row>
        <Row label="Margin" sku={sku}>
          {(pt) => fmtPct(pt.marginPct)}
        </Row>
        <Row label="Revenue (× tier qty)" sku={sku}>
          {(pt) => fmtCurr2(pt.revenue)}
        </Row>
        <Row label="Cost (× tier qty)" sku={sku}>
          {(pt) => fmtCurr2(pt.cost)}
        </Row>
      </BreakdownTable>
    </div>
  );
}

function BreakdownTable({
  tiers,
  children,
}: {
  tiers: QuoteCostingResult["tiers"];
  children: React.ReactNode;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <th
              style={{
                padding: "8px 12px 8px 16px",
                textAlign: "left",
                fontFamily: "var(--mono)",
                fontSize: 9.5,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                fontWeight: 500,
              }}
            >
              Component
            </th>
            {tiers.map((t) => (
              <th
                key={t.tierId}
                style={{
                  padding: "8px 12px 8px 0",
                  textAlign: "right",
                  fontFamily: "var(--mono)",
                  fontSize: 9.5,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                  fontWeight: 500,
                }}
              >
                {t.label}
                <span
                  style={{
                    marginLeft: 4,
                    color: "var(--ink-4)",
                    fontWeight: 400,
                    letterSpacing: 0,
                    textTransform: "none",
                    fontSize: 9.5,
                  }}
                >
                  ({t.qty.toLocaleString()})
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  sku,
  bold,
  children,
}: {
  label: React.ReactNode;
  sku: SkuRollup;
  bold?: boolean;
  children: (pt: SkuPerTierRollup) => React.ReactNode;
}) {
  return (
    <tr style={{ borderTop: "1px solid var(--rule)" }}>
      <td style={bold ? cellLabelBoldStyle : cellLabelStyle}>{label}</td>
      {sku.perTier.map((pt) => (
        <td
          key={pt.tierId}
          style={bold ? cellNumBoldStyle : cellNumStyle}
        >
          {children(pt)}
        </td>
      ))}
    </tr>
  );
}

function FreightLines({
  sku,
  tiers,
}: {
  sku: SkuRollup;
  tiers: QuoteCostingResult["tiers"];
}) {
  // Slice R6.2 — breakdown is now per-leg (`freightLegs`) rather than
  // per legacy line_group. Same display grammar; ID key is `legId`.
  const legIds = new Set<string>();
  for (const pt of sku.perTier) {
    for (const fl of pt.freightLegs) legIds.add(fl.legId);
  }
  if (legIds.size === 0) return null;

  return (
    <>
      {Array.from(legIds).map((legId, idx) => {
        const linesByTier = new Map<string, FreightLegBreakdown>();
        for (const pt of sku.perTier) {
          const fl = pt.freightLegs.find((f) => f.legId === legId);
          if (fl) linesByTier.set(pt.tierId, fl);
        }
        const treatment =
          [...linesByTier.values()][0]?.treatment ?? "bundled";
        return (
          <tr
            key={legId}
            style={{
              borderTop: "1px solid var(--rule)",
              background: "var(--paper-3)",
            }}
          >
            <td
              colSpan={1 + tiers.length}
              style={{ padding: "10px 16px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  fontFamily: "var(--mono)",
                  fontSize: 9.5,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                <span>Freight leg #{idx + 1}</span>
                <span
                  className={
                    treatment === "pass_through"
                      ? "r2-chip"
                      : "r2-chip accent"
                  }
                  style={{ fontSize: 9 }}
                >
                  {treatment === "pass_through" ? "Pass-through" : "Bundled"}
                </span>
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                }}
              >
                <tbody>
                  <FreightSubRow
                    label="Container freight / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.containerFreightPerUnit)}
                  />
                  <FreightSubRow
                    label="Duty / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.dutyPerUnit)}
                  />
                  <FreightSubRow
                    label="Tariff / unit"
                    badge
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.tariffPerUnit)}
                  />
                  <FreightSubRow
                    label="Line landed before markup"
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.landedFreightBeforeMarkup)}
                  />
                  <FreightSubRow
                    label="Line landed with markup"
                    tiers={tiers}
                    linesByTier={linesByTier}
                    pick={(fl) => fmtCurr4(fl.landedFreightWithMarkup)}
                  />
                </tbody>
              </table>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function FreightSubRow({
  label,
  badge = false,
  tiers,
  linesByTier,
  pick,
}: {
  label: string;
  badge?: boolean;
  tiers: QuoteCostingResult["tiers"];
  linesByTier: Map<string, FreightLegBreakdown>;
  pick: (fl: FreightLegBreakdown) => string;
}) {
  return (
    <tr>
      <td
        style={{
          padding: "3px 12px 3px 0",
          color: "var(--ink-3)",
          fontSize: 11,
        }}
      >
        {label}
        {badge && <InternalOnlyBadge short className="ml-1" />}
      </td>
      {tiers.map((t) => {
        const fl = linesByTier.get(t.tierId);
        return (
          <td
            key={t.tierId}
            style={{
              padding: "3px 12px 3px 0",
              textAlign: "right",
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-2)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fl ? pick(fl) : "—"}
          </td>
        );
      })}
    </tr>
  );
}
