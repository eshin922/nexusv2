import type { CustomerViewTierMoney } from "@/types/quote";

/**
 * The customer-facing monetary facts for one tier, composed exactly once.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────────
 *
 * It is COMPOSITION: sums and quotients of figures that are already resolved
 * and already governed by the time they arrive. Unit prices come from the
 * commercial projection, fee amounts from the recovery construction, tier
 * quantities from the quote.
 *
 * It is NOT pricing. No rate is looked up here, no markup is decided, no
 * recovery treatment is resolved, and no default is invented for a missing
 * value. Adding any of those would make a second costing engine out of a
 * projection, which is the thing this whole lift exists to prevent.
 *
 * ── WHY IT IS A FUNCTION RATHER THAN INLINE IN THE RESOLVER ──────────────
 *
 * So the tests can call the SAME code the resolver calls. The alternative was
 * a fixture that restates the composition, and a restatement is a second
 * implementation that agrees until the day it does not — the tests would then
 * be certifying a mirror rather than the thing that ships.
 *
 * ── ORDER IS LOAD-BEARING ────────────────────────────────────────────────
 *
 * Goods accumulate in SKU order and fees are added after, because that is the
 * order the previous render-layer implementation used. A sum reordered is a
 * sum changed in its last bits: 6.281024 × 5000 is 31405.12 in decimal and
 * 31405.120000000003 in IEEE-754, and the preservation baseline asserts the
 * latter. Do not "tidy" this into a different accumulation.
 */
export function composeTierMoney(input: {
  /** The tier's governed quantity — the only correct divisor for a per-unit. */
  quantity: number;
  /**
   * Extended amounts for this tier, one per SKU, in SKU order.
   * NULL = unpriced at this tier, which is not zero: an unpriced line is not
   * a free one, and the document says "total on request" rather than "$0.00".
   */
  lineTotals: ReadonlyArray<number | null>;
  /**
   * One-time fee amounts billed AT THIS TIER, in fee order.
   * NULL = not billed at this tier.
   */
  feeAmounts: ReadonlyArray<number | null>;
  /**
   * In-unit-price recovery already embedded in these line totals, summed from
   * the costing ladder's own report. NULL where attribution is unavailable.
   *
   * Passed IN rather than derived: the amount depends on the pricing ladder -
   * a legacy charge rode the adjustment and any lift, an elected one was added
   * after them - and a formula for it here would be a second authority for the
   * ladder. This composer states figures; it does not price.
   */
  embeddedRecovery: number | null;
}): CustomerViewTierMoney {
  let goodsTotal = 0;
  let pricedCount = 0;
  let hasUnpricedLine = false;

  for (const amount of input.lineTotals) {
    if (amount === null) {
      hasUnpricedLine = true;
      continue;
    }
    goodsTotal += amount;
    pricedCount++;
  }

  const feesTotal = input.feeAmounts.reduce<number>((a, f) => a + (f ?? 0), 0);
  const turnkeyTotal = goodsTotal + feesTotal;

  // `pricedCount` is the "nothing priced here" signal, NOT a divisor.
  //
  // Dividing by it is precisely the T-1 defect: the per-unit came out at 1/N
  // of its true value, N being the priced row count, and it read correctly only
  // at N = 1 — which is why it survived to reach customers. The governed
  // shipped quantity is the only correct divisor, and the document tells the
  // customer as much ("the turnkey total divided by units shipped").
  const perUnitGoods = pricedCount > 0 ? goodsTotal / input.quantity : null;
  const perUnitTurnkey = pricedCount > 0 ? turnkeyTotal / input.quantity : null;

  return {
    // Stated, never recomputed. It is already inside `goodsTotal`.
    embeddedRecovery: input.embeddedRecovery,
    goodsTotal,
    feesTotal,
    turnkeyTotal,
    perUnitGoods,
    perUnitTurnkey,
    hasUnpricedLine,
  };
}

/**
 * Extended amounts for one SKU across the tiers.
 *
 * NULL in, NULL out — never 0. The distinction is customer-visible.
 */
export function composeLineTotals(
  unitPrices: ReadonlyArray<number | null>,
  tierQuantities: ReadonlyArray<number>,
): ReadonlyArray<number | null> {
  return unitPrices.map((p, ti) => (p === null ? null : p * tierQuantities[ti]));
}
