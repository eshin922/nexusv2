// Slice RI.9 § 3.2 — <Breadcrumb> primitive.
//
// Conditional render: only when `rail.visible = false` for the
// current surface. Currently this is Customer view (Quote); future
// rail-shed surfaces inherit the same rule.
//
// Every segment except the last IS a Link. Separator: `›` (right-
// pointing chevron, signals traversal). Visual register: same
// `.r2-eyebrow` token as <Eyebrow> — different semantic component.
//
// XOR with <Eyebrow>. The surface-meta layer enforces the XOR via
// `shouldShowBreadcrumb()` so callers don't have to know.
//
// Path derivation: <Breadcrumb /> renders the segments computed via
// `breadcrumbPath(target)` from `surface-routes`. Caller supplies
// the target surface key + project/quote ids; component derives
// the chain.

import Link from "next/link";
import {
  breadcrumbPath,
  resolveSurfaceHref,
  SURFACE_ROUTES,
  type SurfaceKey,
} from "@/lib/nav/surface-routes";

export function Breadcrumb({
  target,
  projectId,
  quoteId,
  className,
  style,
}: {
  target: SurfaceKey;
  projectId: string;
  quoteId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const path = breadcrumbPath(target);
  return (
    <p
      className={`r2-eyebrow ${className ?? ""}`}
      style={style}
      aria-label={`Breadcrumb to ${SURFACE_ROUTES[target].displayLabel}`}
    >
      {path.map((surface, i) => {
        const isLast = i === path.length - 1;
        const meta = SURFACE_ROUTES[surface];
        return (
          <span key={surface}>
            {isLast ? (
              <span
                style={{ color: "var(--ink)" }}
                aria-current="page"
              >
                {meta.displayLabel}
              </span>
            ) : (
              <Link
                href={resolveSurfaceHref(surface, projectId, quoteId)}
                style={{ color: "var(--ink-3)" }}
              >
                {meta.displayLabel}
              </Link>
            )}
            {!isLast && (
              <span
                aria-hidden
                style={{
                  margin: "0 6px",
                  color: "var(--ink-4)",
                }}
              >
                ›
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
