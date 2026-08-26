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

// The pill also renders quote/tier statuses, which carry a fourth member.
// Per-CELL statuses stay `MarginStatus` — a cell always has a margin.
import type { QuoteMarginStatus } from "@/lib/costing";

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
// UNAVAILABLE is a MUTED tone, not `bad`. The distinction is the whole point:
// `bad` says the margin was measured and failed; this says there was nothing to
// measure. Rendering it red would restate the defect this member was added to
// remove.
const STATUS_TONE: Record<QuoteMarginStatus, string> = {
  GOOD: "good",
  BELOW_TARGET: "warn",
  BELOW_FLOOR: "bad",
  // Empty string, not a new modifier: bare `.r2-chip` IS the neutral register
  // in the canonical stylesheet (--paper-3 / --ink-3 / --rule). Adding a
  // `.muted` variant would mean editing canonical CSS to express something it
  // already expresses.
  UNAVAILABLE: "",
  // `bad` tone, because a cost with no revenue against it is bad news. The
  // LABEL is what must not lie — see below.
  COST_WITHOUT_REVENUE: "bad",
  // `warn`, not `bad`. The quote is not failing a margin test -- it is not
  // in a state where the test means anything. Red would assert a verdict that
  // was never reached; neutral would understate a quote that cannot be sent.
  UNRESOLVED: "warn",
};
const STATUS_LABEL: Record<QuoteMarginStatus, string> = {
  GOOD: "GOOD",
  BELOW_TARGET: "BELOW TARGET",
  BELOW_FLOOR: "BELOW FLOOR",
  UNAVAILABLE: "NOT ASSESSED",
  // Never "BELOW FLOOR". That label asserts a margin was computed and compared
  // against the floor; here no margin exists to compare. This says what is
  // actually true, which is arguably worse news and certainly clearer.
  COST_WITHOUT_REVENUE: "COST, NO REVENUE",
  // Never a band. A band would say the margin was measured against the floor
  // and placed; here it was measured over revenue the customer is not billed,
  // so the number exists and describes a quote that cannot be sent.
  UNRESOLVED: "UNRESOLVED",
};

export function MarginVerdictPill({
  status,
  size = "md",
}: {
  status: QuoteMarginStatus;
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
