// Slice RI.9 § 3.1 — <Eyebrow> primitive.
//
// Always present on quote-scoped + admin surfaces (when rail is
// visible). Never navigable — eyebrow is a LABEL, not a path.
// Separator: `·`. Visual register: `.r2-eyebrow` (mono caption,
// uppercase, ink-3, tracking 0.13em — Slice RI.0 R2-anchored).
//
// XOR pair with <Breadcrumb>. Use `shouldShowBreadcrumb(surface)`
// from `surface-meta` to decide which to render. NEVER render both.
//
// Composition pattern — segments are React nodes (strings, spans,
// etc.) so callers can mix plain text and styled fragments
// (e.g., italic scenario label) while the eyebrow controls
// separator + typography.
//
// Examples:
//   <Eyebrow segments={["Lumen & Co.", "Primary", "v3"]} />
//   <Eyebrow segments={["Admin", "Audit log"]} />

import type { ReactNode } from "react";

export function Eyebrow({
  segments,
  className,
  style,
}: {
  segments: ReactNode[];
  className?: string;
  style?: React.CSSProperties;
}) {
  const visible = segments.filter((s) => s !== null && s !== undefined && s !== "");
  return (
    <p
      className={`r2-eyebrow ${className ?? ""}`}
      style={style}
      aria-label="Surface context"
    >
      {visible.map((seg, i) => (
        <span key={i}>
          {seg}
          {i < visible.length - 1 && (
            <span
              aria-hidden
              style={{
                margin: "0 6px",
                color: "var(--ink-4)",
              }}
            >
              ·
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
