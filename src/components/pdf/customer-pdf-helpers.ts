// Slice 11 Step 3 — Pattern-30 verbatim port of CD's formatters + totals.
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         pdf-render.jsx:12-38
//
// money/unit/qtyK/longDate match CD's formatters byte-for-byte.
// lineTotal/tierGrand consume the fixture tier shape (`tiers[ti].quantity`)
// per CD's source. Adapter (Step 4) supplies tier data sourced from
// the costing bundle.
//
// Pattern 45 boundary: pure functions over customer-visible numerics.
// No costing-store imports, no cost-side reads, no margin/markup access.

import type { CpdfServiceFee, CpdfSku, CpdfTier } from "./customer-pdf-types";

/** USD; 0 dp ≥ $100 else 2 dp; null → "—".
 * CD `pdf-render.jsx:15-19`. */
export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  const dp = Math.abs(n) >= 100 ? 0 : 2;
  return (
    "$" +
    n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
  );
}

/** Always 2 dp; null → "—". CD `pdf-render.jsx:20`. */
export function unit(n: number | null | undefined): string {
  return n == null ? "—" : "$" + n.toFixed(2);
}

/** "5k" vs "5,000". CD `pdf-render.jsx:21`. */
export function qtyK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString("en-US");
}

/** ISO yyyy-mm-dd → "May 17, 2026". CD `pdf-render.jsx:22-24`. */
export function longDate(s: string): string {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Σ service_fees[i].amount. CD `pdf-render.jsx:12`. */
export function serviceFeesTotal(
  serviceFees: ReadonlyArray<CpdfServiceFee>
): number {
  return serviceFees.reduce((a, f) => a + f.amount, 0);
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
  const total = priced + (foldFees ? serviceFeesTotal(serviceFees) : 0);
  const units = pricedCount * tiers[ti].quantity;
  const perUnit = units > 0 ? total / units : null;
  return { total, hasUnpriced, perUnit };
}
