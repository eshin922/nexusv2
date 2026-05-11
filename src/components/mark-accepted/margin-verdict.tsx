// Slice RI.6 — 56px Mark-Accepted MarginVerdict.
//
// DISTINCT FROM Costing Sheet's 96px <VerdictBand>. Both read the
// same blendedMarginPct + blendedMarginStatus selectors when wired
// to the costing store, but compose differently:
//
// - VerdictBand (RI.5) — 96px, room organizer with global-adj slider.
// - MarginVerdict (RI.6) — 56px, header strip paired with CTA cluster.
//
// Per Designer memory feedback_r3_compact_verdict_distinct.md:
// do NOT extract a shared "compact variant" primitive. Two distinct
// surfaces reading the same selectors is the right shape.

export function MarginVerdict({
  blendedMarginPct,
  status,
  targetPct,
  floorPct,
}: {
  blendedMarginPct: number;
  status: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  targetPct: number;
  floorPct: number;
}) {
  const cls =
    status === "GOOD" ? "good" : status === "BELOW_TARGET" ? "warn" : "bad";
  const verdictLabel =
    status === "GOOD"
      ? "GOOD"
      : status === "BELOW_TARGET"
        ? "BELOW TARGET"
        : "BELOW FLOOR";
  return (
    <div className="macc-verdict">
      <div className={"margin-num " + cls}>{blendedMarginPct.toFixed(1)}%</div>
      <div className="margin-meta">
        <div className="lbl">Blended margin · {verdictLabel}</div>
        <div className="sub">
          Target {(targetPct * 100).toFixed(1)}% · Floor{" "}
          {(floorPct * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
