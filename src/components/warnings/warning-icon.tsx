// Slice 9.5 — inline warning icon component. Per Designer extension memo
// (CR-11 in cross-round-reconciliation.md): 10px geometric SVG, single-
// color via currentColor (so caller controls severity color via Tailwind).
//
// Fill-vs-outline split mirrors Slice 9.4b convention:
//   - info: outlined info circle (advisory)
//   - review: outlined warning triangle (review-tier; matches
//     CompetitiveIndicator outlined posture)
//   - action_required: filled exclamation circle (blocking-class;
//     matches MarginVerdictPill BELOW_FLOOR filled posture)
//
// Severity color tokens (pre-RI Tailwind placeholders; reskin to
// canonical OKLCH tokens during RI.0 per CR-11 reskin checklist):
//   info → --ink-3 (text-slate-500)
//   review → --warn (text-amber-600)
//   action_required → --bad (text-red-600)

import type { WarningSpec } from "@/lib/validation";

const SEVERITY_COLOR: Record<WarningSpec["severity"], string> = {
  info: "text-slate-500",
  review: "text-amber-600",
  action_required: "text-red-600",
};

const SEVERITY_LABEL: Record<WarningSpec["severity"], string> = {
  info: "Info",
  review: "Review",
  action_required: "Action required",
};

export function WarningIcon({
  severity,
  className = "",
  "aria-label": ariaLabel,
}: {
  severity: WarningSpec["severity"];
  className?: string;
  "aria-label"?: string;
}) {
  const colorClass = SEVERITY_COLOR[severity];
  const label = ariaLabel ?? `${SEVERITY_LABEL[severity]} warning`;

  if (severity === "info") {
    // Outlined info circle: thin-stroke "i" in circle.
    return (
      <svg
        width={10}
        height={10}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className={`${colorClass} ${className}`}
        role="img"
        aria-label={label}
      >
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="7" x2="8" y2="11.5" strokeLinecap="round" />
        <circle cx="8" cy="4.75" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (severity === "review") {
    // Outlined warning triangle.
    return (
      <svg
        width={10}
        height={10}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        className={`${colorClass} ${className}`}
        role="img"
        aria-label={label}
      >
        <path d="M8 1.5 L14.5 13.5 L1.5 13.5 Z" />
        <line x1="8" y1="6" x2="8" y2="9.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  // action_required: filled exclamation circle.
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 16 16"
      className={`${colorClass} ${className}`}
      role="img"
      aria-label={label}
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <line
        x1="8"
        y1="4"
        x2="8"
        y2="9"
        stroke="white"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.75" r="0.85" fill="white" />
    </svg>
  );
}
