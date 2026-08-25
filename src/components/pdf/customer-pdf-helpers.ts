// Slice 11 Step 3 — Pattern-30 verbatim port of CD's formatters + totals.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:12-38
//
// qtyK/longDate match CD's formatters byte-for-byte. money/unit no longer do:
// both now delegate to the governed money-display path (2026-08-17), which
// supersedes CD's magnitude-inferred precision and its double-rounding. See
// `src/lib/money-display.ts` for the rule and the defect it replaces.
// lineTotal/tierGrand consume the fixture tier shape (`tiers[ti].quantity`)
// per CD's source. Adapter (Step 4) supplies tier data sourced from
// the costing bundle.
//
// Pattern 45 boundary: pure functions over customer-visible numerics.
// No costing-store imports, no cost-side reads, no margin/markup access.

import { extendedAmount, unitPrice } from "@/lib/money-display";

import type { CpdfServiceFee, CpdfSku, CpdfTier } from "./customer-pdf-types";

/**
 * An extended amount — line total, service fee, turnkey total, grand total.
 * 2 dp at every magnitude; null → "—".
 *
 * CD `pdf-render.jsx:15-19` specified 0 dp at ≥ $100. That is superseded by the
 * governed customer-display rule (2026-08-17): trailing cents are preserved, so
 * `$100.50` no longer prints as `$101`. Pattern 30 keeps canonical CSS
 * verbatim; it does not license a formatter that rounds fifty cents off a
 * customer document.
 */
export const money = extendedAmount;

/** A per-unit price. 2 dp; null → "—". CD `pdf-render.jsx:20`.
 *
 * Was `"$" + n.toFixed(2)`, which rounds the IEEE-754 double and therefore
 * disagreed with Pricing on exact halves — `2.8350` printed `$2.83` here and
 * `$2.84` there. ROUND-1. */
export const unit = unitPrice;

/** "5k" vs "5,000". CD `pdf-render.jsx:21`. */
export function qtyK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString("en-US");
}

/** ISO yyyy-mm-dd → "May 17, 2026". CD `pdf-render.jsx:22-24`.
 *
 * Slice 11 Step 6 FU (2026-07-14) — null-safe. Returns "—" for
 * null / empty / invalid inputs (matches money()/unit() convention).
 * Prevents "Invalid Date" rendering on drafts before sendQuote
 * computes validUntil (`quote.valid_until` NULL until send). Draft-
 * mode "—" for Valid-until reads honestly as "not yet computed";
 * real send populates real date per firm_settings.days_valid_default.
 */
/**
 * Re-exported from `@/lib/customer-dates` so the PDF and the live HTML
 * renderer write dates identically. It used to be defined here, and the live
 * renderer — which must not import from this tree — printed the raw ISO
 * string instead, so a sent quote read "September 20, 2026" in one document
 * and "2026-09-20" in the other. Composed once, read twice.
 */
export { longDate } from "@/lib/customer-dates";

/** Σ the fees separately billed AT TIER `ti`. CD `pdf-render.jsx:12`.
 *
 * Was tier-agnostic (`Σ f.amount`), which folded the same fee total into every
 * tier's grand total. Fees are stored per (assembly, tier) and are billed per
 * tier, so the sum is taken down one column — a NULL entry meaning the fee is
 * allocated into that tier's unit prices and must not be added again.
 */
/**
 * ── THESE READ; THEY NO LONGER COMPUTE ───────────────────────────────────
 *
 * Each of these used to do commercial arithmetic here, at render time:
 * `lineTotal` multiplied price by quantity, `serviceFeesTotal` summed the
 * per-tier fee amounts, and `tierGrand` summed the line totals, folded in the
 * fees and divided to get the displayed per-unit price.
 *
 * That made the renderer an authority over customer economics, and it cost a
 * customer-facing defect: the T-1 repair found the per-unit divided by a ROW
 * CARDINALITY, printing $4.00 where $12.00 was owed, correct only at one
 * priced row — which is why it survived.
 *
 * The figures are now composed once on `CustomerView` and carried through the
 * adapter unchanged. What is left here is lookup and selection: given the
 * shape the document is being drawn in, which already-composed figure does it
 * show? That is a presentation question, and it belongs here.
 *
 * The signatures are unchanged so that call sites did not have to move in the
 * same commit that moved the arithmetic. One thing at a time.
 */

/** The tier's one-time fee total, as composed upstream. */
export function serviceFeesTotal(
  _serviceFees: ReadonlyArray<CpdfServiceFee>,
  ti: number,
  tiers?: ReadonlyArray<CpdfTier>
): number {
  return tiers?.[ti]?.money.feesTotal ?? 0;
}

/** The extended amount for a SKU at a tier, as composed upstream. */
export function lineTotal(
  sku: CpdfSku,
  _tiers: ReadonlyArray<CpdfTier>,
  ti: number
): number | null {
  return sku.tier_line_totals?.[ti] ?? null;
}

/**
 * The tier's displayed figures.
 *
 * `foldFees` SELECTS between two already-composed totals; it does not create
 * one. Folded is the turnkey figure, unfolded is goods only, and both were
 * summed upstream in one place.
 */
export function tierGrand(
  _skuSet: ReadonlyArray<CpdfSku>,
  tiers: ReadonlyArray<CpdfTier>,
  ti: number,
  foldFees: boolean,
  _serviceFees: ReadonlyArray<CpdfServiceFee>
): { total: number; hasUnpriced: boolean; perUnit: number | null } {
  const m = tiers[ti].money;
  return {
    total: foldFees ? m.turnkeyTotal : m.goodsTotal,
    hasUnpriced: m.hasUnpricedLine,
    perUnit: foldFees ? m.perUnitTurnkey : m.perUnitGoods,
  };
}
