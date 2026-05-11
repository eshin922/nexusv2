// Slice 9.4b — per-SKU all-tiers margin sparkline. Inline SVG; no
// chart library dependency (per architect Q3 + Edward's brief: pick lib
// or inline ~30 LOC; inline is the lower-weight choice for one viz at
// Nexus scale).
//
// Renders a per-row sparkline showing margin variance across all tiers.
// Active-tier point is highlighted (larger circle + saturated color)
// so PMs see "where am I currently looking" against the variance
// pattern. Hover surfaces per-point tooltip via SVG <title>.
//
// Data shape: one point per tier in tiers-sort-order. Y-axis scales
// to the margin range observed across this SKU's tiers (autoscale per
// SKU; no shared y-axis across rows in v1). X-axis is uniform tier
// index (tier qty doesn't drive horizontal spacing — labeling tier
// scale across SKUs would require a second axis pass; out of scope).
//
// Vocabulary the sparkline can show (per CD's Round 2.5):
//   - flat: margins similar across tiers (small range)
//   - step↓: margin drops at higher tiers (typical when fixed costs
//     amortize but sell prices don't scale)
//   - partial: some tiers have data, others don't → gap in the line
//   - no costs: all tiers have insufficient data → empty (no sparkline)
//
// Edge cases:
//   - Single-tier SKU: render single point, no connecting line
//   - Tier with marginPct === 0 because revenue is 0 (no cost data
//     entered yet): treat as a "no data" gap, not a 0% data point
//   - All tiers no data: render empty space

const SPARKLINE_W = 96; // px — fits per-row column without dominating
const SPARKLINE_H = 24; // px — proportional, single-line height
const PAD_X = 4; // horizontal padding inside SVG (point radius + room)
const PAD_Y = 4; // vertical padding
const POINT_R = 2.5;
const ACTIVE_POINT_R = 3.5;

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export type SparklinePoint = {
  tierId: string;
  tierLabel: string;
  // null = "no data" (rendered as gap; no circle, line breaks here)
  marginPct: number | null;
  // Used to detect "0% margin because revenue is 0" — treat as gap,
  // not as a 0% data point. Sparkline's job is variance signal, not
  // verdict-band rendering; "we haven't entered cost data" is a gap.
  hasRevenue: boolean;
};

export function MarginSparkline({
  points,
  activeTierId,
}: {
  points: SparklinePoint[];
  activeTierId: string | null;
}) {
  // Filter "real" points: tiers with revenue (so marginPct is meaningful).
  // Tiers without revenue render as gaps in the line (skipped from
  // path; no circle).
  const realPoints = points.filter(
    (p): p is SparklinePoint & { marginPct: number } =>
      p.hasRevenue && p.marginPct !== null,
  );

  // All tiers no data → empty space. Empty <span> preserves cell
  // alignment without rendering chrome.
  if (realPoints.length === 0) {
    return (
      <span
        className="inline-block text-[10px] text-ink-4"
        title="No margin data — enter costs to populate"
        style={{ width: SPARKLINE_W, height: SPARKLINE_H, lineHeight: `${SPARKLINE_H}px` }}
      >
        no data
      </span>
    );
  }

  // Y-axis: autoscale to the observed margin range. Pad by 5% of range
  // so points don't sit exactly on the edge. Single-tier or zero-range
  // (all margins identical) → render a horizontal line at midpoint.
  const margins = realPoints.map((p) => p.marginPct);
  const yMin = Math.min(...margins);
  const yMax = Math.max(...margins);
  const yRange = yMax - yMin;
  const yPad = yRange === 0 ? 0.01 : yRange * 0.1; // 10% padding
  const yLow = yMin - yPad;
  const yHigh = yMax + yPad;
  const yScale = yHigh - yLow;

  function yPos(margin: number): number {
    if (yScale === 0) return SPARKLINE_H / 2;
    // SVG y is top-to-bottom; flip so higher margin = higher (lower y).
    return PAD_Y + ((yHigh - margin) / yScale) * (SPARKLINE_H - 2 * PAD_Y);
  }

  // X-axis: uniform spacing across ALL points (including gap tiers) so
  // the gap tier slots are preserved horizontally. Index = original
  // tier order, not real-points order.
  const totalSlots = points.length;
  function xPos(idx: number): number {
    if (totalSlots === 1) return SPARKLINE_W / 2;
    return PAD_X + (idx / (totalSlots - 1)) * (SPARKLINE_W - 2 * PAD_X);
  }

  // Build path segments — break the path at gap tiers so the line
  // doesn't connect across them. Walk the original points array in
  // order; group consecutive real points into separate <path> "M-L-L"
  // segments. Single-point segments render only as circles (no path).
  const segments: { startIdx: number; pts: { idx: number; m: number }[] }[] = [];
  let currentSegment: { startIdx: number; pts: { idx: number; m: number }[] } | null = null;
  points.forEach((p, idx) => {
    if (p.hasRevenue && p.marginPct !== null) {
      if (!currentSegment) {
        currentSegment = { startIdx: idx, pts: [{ idx, m: p.marginPct }] };
      } else {
        currentSegment.pts.push({ idx, m: p.marginPct });
      }
    } else {
      // Gap: close current segment.
      if (currentSegment && currentSegment.pts.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = null;
    }
  });
  if (currentSegment !== null) {
    const seg = currentSegment as { startIdx: number; pts: { idx: number; m: number }[] };
    if (seg.pts.length > 0) segments.push(seg);
  }

  return (
    <svg
      width={SPARKLINE_W}
      height={SPARKLINE_H}
      viewBox={`0 0 ${SPARKLINE_W} ${SPARKLINE_H}`}
      className="inline-block"
      role="img"
      aria-label={`Margin across ${points.length} tiers: ${realPoints.map((p) => fmtPct(p.marginPct)).join(", ")}`}
    >
      {/* Slice RI.0 — color tokens swapped from raw sRGB hex
          (#94a3b8 / #4338ca) to CD's OKLCH semantic tokens via
          currentColor inheritance. Inactive points use --ink-3
          (the muted body-text tier); active point uses --accent
          (CD's confident ink-blue). Smoke-target wiring. */}
      {/* Connecting lines per segment (skipped for single-point segments) */}
      {segments.map((seg, segIdx) => {
        if (seg.pts.length < 2) return null;
        const d = seg.pts
          .map((p, i) => {
            const x = xPos(p.idx);
            const y = yPos(p.m);
            return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ");
        return (
          <path
            key={segIdx}
            d={d}
            fill="none"
            className="text-ink-3"
            stroke="currentColor"
            strokeWidth={1}
          />
        );
      })}
      {/* Points: small circles for non-active, larger saturated for active.
          Each circle has a <title> for hover tooltip. Gap-tier slots
          render no circle (the points.filter at top excludes them). */}
      {points.map((p, idx) => {
        if (!p.hasRevenue || p.marginPct === null) return null;
        const isActive = p.tierId === activeTierId;
        return (
          <circle
            key={p.tierId}
            cx={xPos(idx)}
            cy={yPos(p.marginPct)}
            r={isActive ? ACTIVE_POINT_R : POINT_R}
            className={isActive ? "text-accent" : "text-ink-3"}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={isActive ? 0 : 0.5}
          >
            <title>
              {p.tierLabel}: {fmtPct(p.marginPct)}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
