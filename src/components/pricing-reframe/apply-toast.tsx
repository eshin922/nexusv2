"use client";

// Pricing Reframe v1 — ApplyToast (success + error variants)
//
// Brief §4.6 disposition: persist-until-next-action; no fade timer.
// Bug #3 fix: error variant renders on failed apply (red-tinted) at
// the same render slot as success (green-tinted). Symmetric pattern
// per CA's disposition.
//
// Pattern 30 path-B-default — canonical `.pr-toast` rule covers the
// success variant. Error variant uses inline style (warn/bad tokens)
// until canonical CSS ships an explicit `.pr-toast.error` rule —
// banked as a Pattern 39 nexus extension.

import { useReframeState } from "@/components/pricing-reframe/reframe-state-context";

type TierLite = {
  id: string;
  label: string;
};

const fmtDelta = (v: number) =>
  (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";

export function ApplyToast({ tiers }: { tiers: TierLite[] }) {
  const { lastApply, lastApplyError } = useReframeState();

  // Error variant takes precedence — only one toast renders at a time
  // (an error replaces any prior success state per failApply().
  if (lastApplyError) {
    return (
      <div
        className="pr-toast"
        role="alert"
        style={{
          background: "var(--bad-soft)",
          borderColor: "var(--bad)",
          borderLeftColor: "var(--bad)",
        }}
      >
        <span className="glyph" style={{ color: "var(--bad)" }}>
          ✕
        </span>
        <span className="msg">
          <strong>Apply failed · </strong>
          {lastApplyError}
        </span>
      </div>
    );
  }

  if (!lastApply) return null;

  const labelById = new Map(tiers.map((t) => [t.id, t.label]));
  const affectedLabels = lastApply.tierIds.map(
    (tid) => labelById.get(tid) ?? tid,
  );

  // Summary copy. Single-tier: "Lifted T1 by +2.9pp." Multi-tier:
  // "Lifted 4 tiers (T1 +2.3pp, T2 +2.1pp, ...)."
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
