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
export function longDate(s: string | null | undefined): string {
  if (s == null || s === "" || s === "Invalid Date") return "—";
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Σ the fees separately billed AT TIER `ti`. CD `pdf-render.jsx:12`.
 *
 * Was tier-agnostic (`Σ f.amount`), which folded the same fee total into every
 * tier's grand total. Fees are stored per (assembly, tier) and are billed per
 * tier, so the sum is taken down one column — a NULL entry meaning the fee is
 * allocated into that tier's unit prices and must not be added again.
 */
export function serviceFeesTotal(
  serviceFees: ReadonlyArray<CpdfServiceFee>,
  ti: number
): number {
  return serviceFees.reduce((a, f) => a + (f.tier_amounts[ti] ?? 0), 0);
}

/** price × tiers[ti].quantity; null-safe. CD `pdf-render.jsx:27`. */
export function lineTotal(
  price: number | null,
  tiers: ReadonlyArray<CpdfTier>,
  ti: number
): number | null {
  return price == null ? null : price * tiers[ti].quantity;
}

/** Per-tier grand total + flags. CD `pdf-render.jsx:28-38`.
 *
 * Returns:
 * - `total`: sum of (price × tier qty) across priced SKUs, plus
 *   `serviceFeesTotal` if `foldFees` true
 * - `hasUnpriced`: any SKU in set with null at this tier
 * - `perUnit`: blended all-in unit price (total ÷ units shipped at this tier)
 */
export function tierGrand(
  skuSet: ReadonlyArray<CpdfSku>,
  tiers: ReadonlyArray<CpdfTier>,
  ti: number,
  foldFees: boolean,
  serviceFees: ReadonlyArray<CpdfServiceFee>
): { total: number; hasUnpriced: boolean; perUnit: number | null } {
  let priced = 0;
  let pricedCount = 0;
  let hasUnpriced = false;
  skuSet.forEach((s) => {
    const p = s.tier_prices[ti];
    if (p == null) {
      hasUnpriced = true;
    } else {
      priced += p * tiers[ti].quantity;
      pricedCount++;
    }
  });
  const total = priced + (foldFees ? serviceFeesTotal(serviceFees, ti) : 0);

  // T-1 repair (2026-08-11). Was `pricedCount * tiers[ti].quantity`.
  //
  // `pricedCount` is a ROW CARDINALITY, not a quantity — it counts priced
  // SKU rows. Multiplying shipped quantity by it produced a denominator
  // with no commercial meaning, and the printed per-unit came out at 1/N
  // of the true value (N = priced row count). It read correctly only at
  // N = 1, which is why it survived.
  //
  // Every row's price is per finished unit of the order: `lineTotal` (and
  // `priced` above) multiplies EVERY row by the same `tiers[ti].quantity`.
  // So `total` is already Σ(per-unit prices) × quantity, and the governed
  // shipped quantity is the only correct divisor. Component-level
  // multiplicity (`assembly_leaves.quantity`) is folded into each row's
  // per-unit price upstream in the math layer, never into tier quantity.
  //
  // Invariant this restores — and the docstring's, and the one the PDF
  // prints for the customer in `customer-pdf-grand-total-row.tsx`
  // ("the turnkey total divided by units shipped"):
  //
  //     perUnit × tiers[ti].quantity === total
  //
  // `pricedCount > 0` is retained deliberately: it is the "no rows priced"
  // signal. `customer-pdf-grand-total-row.tsx:82` reads `perUnit == null`
  // to render "total on request" rather than a governed $0.00 (OD-005).
  // Dropping that guard would print "from $0.00 /unit" on a fully
  // unpriced tier carrying folded fees.
  const shippedQty = tiers[ti].quantity;
  const perUnit =
    pricedCount > 0 && shippedQty > 0 ? total / shippedQty : null;
  return { total, hasUnpriced, perUnit };
}
