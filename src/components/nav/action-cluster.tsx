// Slice RI.9 § 3.4 — <ActionCluster> grammar primitive.
//
// Three slots:
//   [back] | [secondary…] [primary]
//
//   left:    back-direction (with vertical divider after)
//   middle:  secondary actions (non-forward, non-back)
//   right:   primary action (forward-pointing)
//
// Pushback 3 disposition: back labels are destination-only
// ("← Costs" — not "← Resume Cost build"). The arrow encodes
// direction; the verb would be redundant ceremony.
//
// Vertical divider sits between back and the rest, visually
// separating back-affordance from current-flow actions.
//
// Each slot accepts ReactNode so callers can pass plain buttons,
// disabled-with-tooltip variants, dropdowns, etc. The component
// owns layout + divider; callers own per-button visual register.

import type { ReactNode } from "react";

export function ActionCluster({
  back,
  secondary,
  primary,
  className,
  style,
}: {
  /** Back-direction affordance — left of vertical divider. NULL when surface has no back. */
  back?: ReactNode;
  /** Secondary actions — middle slot. Variable count; renders inline. */
  secondary?: ReactNode[];
  /** Primary action — right slot. Forward-pointing. NULL on terminal surfaces. */
  primary?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const hasBack = back !== undefined && back !== null;
  const hasSecondary = secondary && secondary.length > 0;
  const hasPrimary = primary !== undefined && primary !== null;

  return (
    <div
      className={`r9-action-cluster ${className ?? ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        ...style,
      }}
    >
      {hasBack && (
        <>
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            {back}
          </div>
          {/* Vertical divider — separates back from current-flow actions. */}
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 1,
              height: 22,
              background: "var(--rule)",
              margin: "0 2px",
            }}
          />
        </>
      )}
      {hasSecondary &&
        secondary.map((node, i) => (
          <div
            key={i}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            {node}
          </div>
        ))}
      {hasPrimary && (
        <div style={{ display: "inline-flex", alignItems: "center" }}>
          {primary}
        </div>
      )}
    </div>
  );
}
