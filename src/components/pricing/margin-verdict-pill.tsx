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

// Sweep Step 3.3/5 — migrated to canonical `.r2-chip` primitive
// from r7b-primitives.css (restored chrome primitives section).
// Visual register: mono uppercase chip with tone-soft bg + tone
// border + tone-color ink. Matches the canonical R2 verdict-chip
// shape used cross-surface (Pricing margin verdict + Mark Accepted
// margin verdict + future surfaces).
//
// Token discipline upgrade: previous shape used Tailwind utility
// classes (`inline-block rounded font-medium uppercase tracking-
// wide bg-good-soft text-good` etc.) which work in light mode but
// require token-shim alignment for dark mode. Canonical `.r2-chip`
// uses --good-soft / --good / --warn-* / --bad-* tokens directly
// + flex grammar consistent with other chips across surfaces.
const STATUS_TONE: Record<MarginStatus, string> = {
  GOOD: "good",
  BELOW_TARGET: "warn",
  BELOW_FLOOR: "bad",
};
const STATUS_LABEL: Record<MarginStatus, string> = {
  GOOD: "GOOD",
  BELOW_TARGET: "BELOW TARGET",
  BELOW_FLOOR: "BELOW FLOOR",
};

export function MarginVerdictPill({
  status,
  size = "md",
}: {
  status: MarginStatus;
  size?: "sm" | "md";
}) {
  // size "sm" → tighter padding; canonical .r2-chip has fixed
  // padding so the sm variant is a small inline override.
  const sizeStyle: React.CSSProperties | undefined =
    size === "sm" ? { padding: "2px 6px", fontSize: 9 } : undefined;
  return (
    <span
      className={`r2-chip ${STATUS_TONE[status]}`}
      style={sizeStyle}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
