// Slice 9.4b — secondary competitive indicator. Renders alongside the
// primary <MarginVerdictPill> on the per-SKU summary row when the cell
// has a client target set; renders nothing otherwise (NULL-as-empty-
// signal — no "no benchmark" placeholder).
//
// Visual hierarchy (per Edward + CD's "primary pill + secondary annotation"
// call): margin pill is the room-organizer for verdict; this indicator
// is the supporting comparison axis. Same text scale as the margin
// pill's sm size; visual hierarchy comes from fill-vs-outline split
// (margin = filled chip; competitive = border-only outline).
//
// Surface convention (per CLAUDE.md "Verdict surfacing convention"):
// both pieces of the verdict — direction AND magnitude — render
// inline on the chip. "under target by $0.74" / "over target by
// $0.74". The earlier shape carried magnitude only in the tooltip,
// which forced PMs to discover it via hover (no discoverability
// cue); corrected during 9.4b smoke. Tooltip carries the underlying
// raw values being compared (not the interpretation), at full
// 4-decimal precision for verification math.
//
// Underlying data enum stays `COMPETITIVE | OVER_CLIENT_TARGET`
// (math/data layer); UI labels diverge for display, matching the
// MarginVerdictPill pattern.

const STATUS_STYLES: Record<
  "COMPETITIVE" | "OVER_CLIENT_TARGET",
  { directionLabel: string; cls: string }
> = {
  COMPETITIVE: {
    directionLabel: "under target by",
    cls: "border-emerald-300 text-emerald-800",
  },
  OVER_CLIENT_TARGET: {
    directionLabel: "over target by",
    cls: "border-amber-300 text-amber-800",
  },
};

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

export function CompetitiveIndicator({
  status,
  requiredSellPerUnit,
  clientTarget,
}: {
  status: "COMPETITIVE" | "OVER_CLIENT_TARGET" | null;
  requiredSellPerUnit: number;
  clientTarget: number | null;
}) {
  // NULL-as-empty-signal: render nothing when no target on this cell.
  if (status === null || clientTarget === null) return null;

  const style = STATUS_STYLES[status];
  // Magnitude (always positive — direction encoded in the label).
  // - COMPETITIVE: gap = target - required_sell (positive headroom)
  // - OVER_CLIENT_TARGET: gap = required_sell - target (positive overshoot)
  const gap =
    status === "COMPETITIVE"
      ? clientTarget - requiredSellPerUnit
      : requiredSellPerUnit - clientTarget;
  // Tooltip carries the raw values being compared, NOT interpretation
  // (the chip already shows interpretation). 4-decimal precision so
  // PMs can verify cell math without expanding a drawer.
  const tooltip = `Required sell: ${fmtCurr4(requiredSellPerUnit)} / Client target: ${fmtCurr4(clientTarget)}`;

  return (
    <span
      title={tooltip}
      className={`inline-block whitespace-nowrap rounded border bg-white px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide ${style.cls}`}
    >
      {style.directionLabel} {fmtCurr2(gap)}
    </span>
  );
}
