// Slice 9.4a — extracted from quote-summary-card.tsx so the per-SKU
// summary row can render the same verdict pill consistently. Both call
// sites (existing per-tier rollup table in QuoteSummaryCard, new per-
// SKU summary row in SkuSummaryRow) import this component.
//
// Visual treatment matches the prior inline JSX exactly — no design
// changes here. Visual rebuild is redesign-implementation slice work.
//
// Size variants: "md" matches the prior quote-summary-card treatment
// (used in the per-tier rollup table); "sm" is a tighter variant for
// the per-SKU summary row where horizontal density matters more.

export type MarginStatus = "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";

// Slice RI.0 — palette swapped from raw Tailwind sRGB hex (bg-green-100
// etc.) to CD's OKLCH-tuned semantic tokens. --good-soft / --good for
// GOOD, --warn-soft / --warn for BELOW_TARGET, --bad-soft / --bad for
// BELOW_FLOOR. Light + dark mode adapt automatically via design-tokens.css.
// Smoke-target wiring for the token foundation.
const STATUS_STYLES: Record<
  MarginStatus,
  { label: string; cls: string }
> = {
  GOOD: { label: "GOOD", cls: "bg-good-soft text-good" },
  BELOW_TARGET: {
    label: "BELOW TARGET",
    cls: "bg-warn-soft text-warn",
  },
  BELOW_FLOOR: { label: "BELOW FLOOR", cls: "bg-bad-soft text-bad" },
};

const SIZE_STYLES: Record<"sm" | "md", string> = {
  sm: "px-1.5 py-0.5 text-[9px]",
  md: "px-2 py-0.5 text-[10px]",
};

export function MarginVerdictPill({
  status,
  size = "md",
}: {
  status: MarginStatus;
  size?: "sm" | "md";
}) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-block rounded font-medium uppercase tracking-wide ${SIZE_STYLES[size]} ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
