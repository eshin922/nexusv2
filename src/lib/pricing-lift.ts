/**
 * The global-adjustment PREVIEW: current governed state versus the exact state
 * Apply would persist.
 *
 * WHAT THIS REPLACED, AND WHY IT WAS TWO DEFECTS. The previous projection had
 * its own pricing semantics. It treated the entered figure as a DELTA TO
 * COMPOUND — committed 1% with 10% entered previewed 11.1%, while Apply
 * persisted 10% — and it wrote that compounded rate into `tierPriceAdjPct` FOR
 * EVERY TIER, which is the fan-out the pricing-authority disposition removed.
 * So it projected a state Apply would never produce, by a rule Apply does not
 * use, and its resulting prices could fall under a positive proposed lift.
 *
 * THE FIX IS NOT NEW MATH. The proposed state is built by asking the SAME
 * planner Apply asks — `planApply` — what the quote would look like after this
 * global is applied, and then running that state through the same governed
 * engine. Preview and Apply cannot disagree about the destination because only
 * one of them decides it, and it is not this file.
 *
 * `proposedGlobalAdj` is the rate the operator entered, as a decimal fraction.
 * It SETS the quote-wide rate; it does not compound onto the current one.
 */

import { computeQuoteCosting, type QuoteCostingInput } from "./costing";
import { costingInputFromSnapshot, type HydrateSnapshot } from "./costing-store";
import { planApply } from "./pricing-apply-plan";

export type GlobalPricingPreviewTier = {
  tierId: string;
  label: string;
  priorPersistedAdjustment: string | null;
  currentAdjustment: number;
  currentCustomerPrice: number;
  /**
   * The actual change, in PERCENTAGE POINTS.
   *
   * It used to carry the entered figure and be rendered as "+30%" beside a
   * current of 20% and a resulting of 56% — three numbers that only cohere
   * under compounding. Under set-semantics the honest statement is
   * `proposed − current`, so 20% to 30% is +10 points.
   */
  adjustmentDeltaPoints: number;
  resultingAdjustment: number;
  resultingCustomerPrice: number;
};

export type GlobalPricingPreview = {
  quoteId: string;
  /** The rate Apply would persist quote-wide. Not a delta. */
  proposedGlobalAdj: number;
  tiers: GlobalPricingPreviewTier[];
};

const money = (n: number) => (Number.isFinite(n) ? n : 0);

export function buildGlobalPricingPreview(
  snapshot: HydrateSnapshot,
  proposedGlobalAdj: number,
): GlobalPricingPreview {
  // What is persisted per tier today. NULL means "no override of its own".
  const persistedTierAdj = new Map<string, string>();
  for (const tier of snapshot.tiers) {
    if (tier.tierPriceAdjPct !== null && tier.tierPriceAdjPct !== undefined) {
      persistedTierAdj.set(tier.id, String(tier.tierPriceAdjPct));
    }
  }

  // ASK THE PLANNER, do not re-derive. A global Apply clears tier overrides
  // and reclaims quote-wide authority; that rule lives in `planApply` and is
  // read from there so the two cannot drift. Nothing per-tier is staged in a
  // global preview, so intended equals persisted and only the global moves.
  const plan = planApply({
    intendedLifts: new Map(),
    intendedOverrides: new Map(),
    persistedLifts: new Map(),
    persistedOverrides: new Map(),
    intendedTierAdj: new Map(persistedTierAdj),
    persistedTierAdj,
    globalAdjFrom: String(snapshot.globalPriceAdjPct),
    globalAdjTo: String(proposedGlobalAdj),
  });
  const proposedTierAdj = new Map(persistedTierAdj);
  for (const removed of plan.tierAdjRemoved) proposedTierAdj.delete(removed.key);
  for (const set of plan.tierAdjSet) proposedTierAdj.set(set.key, set.to);

  // ONE definition of "the quote's economic input", shared with the Apply
  // staleness guard. Hand-assembling it here is what let worksheet freight,
  // per-component freight costs and applied lifts go missing while the
  // projection still looked coherent.
  const input: QuoteCostingInput = {
    ...costingInputFromSnapshot(snapshot),
    quote: {
      id: snapshot.quoteId,
      globalPriceAdjPct: proposedGlobalAdj,
      targetMarginPct: snapshot.targetMarginPct,
    },
    tiers: snapshot.tiers.map((tier) => {
      const proposed = proposedTierAdj.get(tier.id);
      return { ...tier, tierPriceAdjPct: proposed === undefined ? null : Number(proposed) };
    }),
  };
  const resulting = computeQuoteCosting(input);

  // BOTH SIDES FROM THE SAME BASIS. `current` used to come from the store's
  // committed rollup while `resulting` came from a fresh compute over the
  // snapshot's raw inputs — two bases for one comparison, so a difference
  // between them could be the adjustment or could be the basis. Recomputing
  // the current state from the same inputs makes the delta attributable.
  const current = computeQuoteCosting({
    ...input,
    quote: { ...input.quote, globalPriceAdjPct: snapshot.globalPriceAdjPct },
    tiers: snapshot.tiers,
  });
  const currentRollups = new Map(current.quoteRollup.map((t) => [t.tierId, t]));
  const resultingRollups = new Map(resulting.quoteRollup.map((t) => [t.tierId, t]));

  return {
    quoteId: snapshot.quoteId,
    proposedGlobalAdj,
    tiers: snapshot.tiers.map((tier) => {
      const now = currentRollups.get(tier.id);
      const next = resultingRollups.get(tier.id);
      if (!now || !next) throw new Error(`Missing costing rollup for tier ${tier.id}`);
      const currentAdjustment = tier.tierPriceAdjPct ?? snapshot.globalPriceAdjPct;
      const proposed = proposedTierAdj.get(tier.id);
      const resultingAdjustment =
        proposed === undefined ? proposedGlobalAdj : Number(proposed);
      return {
        tierId: tier.id,
        label: tier.label,
        priorPersistedAdjustment:
          tier.tierPriceAdjPct == null ? null : String(tier.tierPriceAdjPct),
        currentAdjustment,
        currentCustomerPrice: now.qty > 0 ? money(now.totalRevenue / now.qty) : 0,
        adjustmentDeltaPoints: resultingAdjustment - currentAdjustment,
        resultingAdjustment,
        resultingCustomerPrice: next.qty > 0 ? money(next.totalRevenue / next.qty) : 0,
      };
    }),
  };
}
