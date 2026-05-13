// Slice RI.9 § 3.3 — <YourNextMoveBanner> primitive.
//
// Three states (default · gated · terminal-muted) sharing the same
// banner shell so vertical rhythm stays consistent. Visual adapts
// per state; structure stays fixed.
//
//   default · prominent
//     accent-bordered, full-width, CTA right
//     CTA = surfaceMeta.nextMove.label
//
//   gated
//     same prominence; CTA points at resolution path
//     CTA = surfaceMeta.nextMove.gatedLabel (fallback to label)
//     (Example: Costing below-floor — "Resolve override before
//      sending →" instead of "Preview Quote PDF →")
//
//   terminal · muted
//     neutral border, no CTA
//     text: "Terminal surface — return via Home or rail."
//     Mark-Accepted post-acceptance.
//
// Banner is structurally always present for surfaces that opt in.
// Surfaces opt in by passing a non-null `nextMove` from surface-meta.

import Link from "next/link";
import type { ReactNode } from "react";

export type BannerState = "default" | "gated" | "terminal";

export function YourNextMoveBanner({
  state,
  label,
  href,
  helpText,
  subtitle,
  className,
}: {
  state: BannerState;
  /** CTA copy. Ignored when state = "terminal". */
  label?: string;
  /** CTA destination URL. Ignored when state = "terminal". */
  href?: string;
  /**
   * Stacked-below explanatory line (e.g., "Below floor — admin
   * override required"). Used by Pricing's gated state.
   */
  helpText?: ReactNode;
  /**
   * §6.b polish — inline-italic qualifier after the CTA label on
   * the SAME visual line (e.g., "Continue to Cost build → once
   * SKUs and tiers are settled"). When both subtitle and helpText
   * are provided, subtitle renders inline + helpText renders below.
   */
  subtitle?: ReactNode;
  className?: string;
}) {
  const isTerminal = state === "terminal";
  const isGated = state === "gated";

  const accentBorder = isTerminal
    ? "1px solid var(--rule)"
    : "1px solid oklch(from var(--accent) l c h / 0.40)";
  const accentBg = isTerminal
    ? "var(--paper-2)"
    : "oklch(from var(--accent) l c h / 0.05)";

  return (
    <section
      className={`r9-banner ${className ?? ""}`}
      role={isTerminal ? "note" : "region"}
      aria-label={isTerminal ? "Terminal surface notice" : "Your next move"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 20px",
        marginBottom: 18,
        background: accentBg,
        border: accentBorder,
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          className="r2-eyebrow"
          style={{
            marginBottom: 4,
            color: isTerminal ? "var(--ink-4)" : "var(--accent-ink)",
          }}
        >
          {isTerminal ? "Terminal surface" : "Your next move"}
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--display)",
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: "-0.005em",
            color: isTerminal ? "var(--ink-3)" : "var(--ink)",
            lineHeight: 1.45,
          }}
        >
          {isTerminal ? (
            "Return via Home or rail."
          ) : (
            <>
              {label ?? "—"}
              {subtitle && (
                <span
                  style={{
                    marginLeft: 8,
                    fontStyle: "italic",
                    fontWeight: 400,
                    fontSize: 14,
                    color: "var(--ink-3)",
                  }}
                >
                  {subtitle}
                </span>
              )}
            </>
          )}
        </p>
        {helpText && !isTerminal && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: isGated ? "var(--bad)" : "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            {helpText}
          </p>
        )}
      </div>

      {!isTerminal && label && href && (
        <Link
          href={href}
          className="r9-banner-cta"
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.05em",
            color: "var(--paper)",
            background: isGated ? "var(--bad)" : "var(--accent)",
            padding: "10px 18px",
            borderRadius: 6,
            textDecoration: "none",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {label}
        </Link>
      )}
    </section>
  );
}
