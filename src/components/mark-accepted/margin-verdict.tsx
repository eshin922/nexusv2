// Slice RI.6 — 56px Mark-Accepted MarginVerdict.
//
// DISTINCT FROM Pricing's 96px <VerdictBand>. Both read the
// same blendedMarginPct + blendedMarginStatus selectors when wired
// to the costing store, but compose differently:
//
// - VerdictBand (RI.5) — 96px, room organizer with global-adj slider.
// - MarginVerdict (RI.6) — 56px, header strip paired with CTA cluster.
//
// Per Designer memory feedback_r3_compact_verdict_distinct.md:
// do NOT extract a shared "compact variant" primitive. Two distinct
// surfaces reading the same selectors is the right shape.

import type { QuoteMarginStatus } from "@/lib/costing";

export function MarginVerdict({
  blendedMarginPct,
  status,
  targetPct,
  floorPct,
}: {
  /** Already in percent units (0..100), or null when there is no margin. */
  blendedMarginPct: number | null;
  status: QuoteMarginStatus;
  targetPct: number;
  floorPct: number;
}) {
  // No margin: render its absence. The engine used to hand this surface a
  // fabricated 0.0% carrying a BELOW FLOOR verdict, which read as "this quote
  // breaches the floor" for a quote that has simply not been priced.
  if (status === "UNAVAILABLE" || blendedMarginPct === null) {
    return (
      <div className="macc-verdict">
        <div className="margin-num" style={{ opacity: 0.55 }}>
          —
        </div>
        <div className="margin-meta">
          <div className="lbl">Blended margin · UNAVAILABLE</div>
          <div className="sub">No revenue on this quote yet — no margin to assess.</div>
        </div>
      </div>
    );
  }

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
