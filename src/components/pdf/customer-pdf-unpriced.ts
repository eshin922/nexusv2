/**
 * Which lines on this quote are "quote on request", named from the quote.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Two customer-facing sentences carried CD's mock identity as a literal:
 *
 *     Totals exclude lines marked "quote on request" (CAP-60 · Tier 1)
 *     CAP-60 · Tier 1 — quote on request; the total finalizes once …
 *
 * CAP-60 is a prototype SKU. Any real quote with an unpriced line told the
 * customer the pending line was a product that is not in their quote — while
 * the actual pending line went unnamed. The sentence was doing its job in
 * form and lying in substance.
 *
 * Same class as the "★ T2 is our recommended first-PO tier" literal in
 * `customer-pdf-pricing-foot`, found in the same sweep: a Pattern-30 verbatim
 * port that copied the mock's DATA along with its copy. The tell in both is
 * that nothing consulted the quote, so the mock's own value survived into a
 * system that could compute the real one.
 *
 * Pattern 45 boundary: pure over the projected customer shape. No costing,
 * schema, or action imports — it reads `tier_prices`, which the projection
 * already decided.
 */

import type { CpdfSku, CpdfTier } from "./customer-pdf-types";

/** How many lines to name before summarising the rest. */
const NAME_LIMIT = 3;

/**
 * `"CAP-60 · Tier 1"` for each unpriced (sku, tier) cell, in reading order.
 *
 * A NULL price means "quote on request" — NOT zero — per `CpdfSku.tier_prices`.
 */
export function unpricedLineLabels(
  skus: ReadonlyArray<CpdfSku>,
  tiers: ReadonlyArray<CpdfTier>,
): string[] {
  const out: string[] = [];
  for (const sku of skus) {
    tiers.forEach((tier, i) => {
      if (sku.tier_prices[i] === null) out.push(`${sku.code} · ${tier.full}`);
    });
  }
  return out;
}

/**
 * The same list as a human phrase, or null when nothing is unpriced.
 *
 * Null rather than an empty string so the caller must decide what an absent
 * list means, instead of rendering an empty parenthetical. Long lists are
 * summarised — a quote with thirty pending cells should not print thirty
 * identities into one sentence, and the itemised table above already carries
 * every one of them.
 */
export function unpricedLinePhrase(
  skus: ReadonlyArray<CpdfSku>,
  tiers: ReadonlyArray<CpdfTier>,
): string | null {
  const labels = unpricedLineLabels(skus, tiers);
  if (labels.length === 0) return null;
  if (labels.length <= NAME_LIMIT) return labels.join("; ");
  const rest = labels.length - NAME_LIMIT;
  return `${labels.slice(0, NAME_LIMIT).join("; ")}, and ${rest} more`;
}
