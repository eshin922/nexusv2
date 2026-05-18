"use client";

// Pricing Reframe v1 — ApplyToast
//
// Renders after a successful apply per brief §4.6. Reads lastApply
// from ReframeStateProvider. Persists until next apply (no fade
// timer; CD disposition).
//
// Pattern 30 path-B-default — `.pr-toast` class from canonical CSS.

import { useReframeState } from "@/components/pricing-reframe/reframe-state-context";

type TierLite = {
  id: string;
  label: string;
};

const fmtDelta = (v: number) =>
  (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";

export function ApplyToast({ tiers }: { tiers: TierLite[] }) {
  const { lastApply } = useReframeState();
  if (!lastApply) return null;

  const labelById = new Map(tiers.map((t) => [t.id, t.label]));
  const affectedLabels = lastApply.tierIds.map(
    (tid) => labelById.get(tid) ?? tid,
  );

  // Summary copy. For single-tier (surgical), "Lifted T1 by +2.9pp."
  // For N-tier (global), "Lifted 4 tiers (T1 +2.3pp, T2 +2.1pp, ...)."
  let message: string;
  if (lastApply.tierIds.length === 1) {
    const tid = lastApply.tierIds[0];
    const label = labelById.get(tid) ?? tid;
    const delta = lastApply.deltaPpByTier[tid] ?? 0;
    message = `Lifted ${label} by ${fmtDelta(delta)} (${lastApply.optionLabel}).`;
  } else {
    const deltas = lastApply.tierIds
      .map((tid) => {
        const label = labelById.get(tid) ?? tid;
        const delta = lastApply.deltaPpByTier[tid] ?? 0;
        return `${label} ${fmtDelta(delta)}`;
      })
      .join(", ");
    message = `Lifted ${affectedLabels.length} tiers (${deltas}) — ${lastApply.optionLabel}.`;
  }

  return (
    <div className="pr-toast">
      <span className="glyph">✓</span>
      <span className="msg">
        <strong>Applied · </strong>
        {message}
      </span>
      {lastApply.auditRef && (
        <span className="audit">audit_id={lastApply.auditRef}</span>
      )}
    </div>
  );
}
