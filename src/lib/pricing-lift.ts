import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "./costing";
import type { HydrateSnapshot } from "./costing-store";
import { composePricingAdjustment } from "./pricing-adjustment";

export type GlobalPricingPreviewTier = {
  tierId: string;
  label: string;
  priorPersistedAdjustment: string | null;
  currentAdjustment: number;
  currentCustomerPrice: number;
  adjustmentDelta: number;
  resultingAdjustment: number;
  resultingCustomerPrice: number;
};

export type GlobalPricingPreview = {
  quoteId: string;
  applyDelta: number;
  tiers: GlobalPricingPreviewTier[];
};

export function buildGlobalPricingPreview(
  snapshot: HydrateSnapshot,
  adjustmentDelta: number,
): GlobalPricingPreview {
  const resultingByTier = new Map(
    snapshot.tiers.map((tier) => [
      tier.id,
      composePricingAdjustment(
        tier.tierPriceAdjPct ?? snapshot.globalPriceAdjPct,
        adjustmentDelta,
      ),
    ]),
  );
  const input: QuoteCostingInput = {
    quote: {
      id: snapshot.quoteId,
      globalPriceAdjPct: snapshot.globalPriceAdjPct,
      targetMarginPct: snapshot.targetMarginPct,
    },
    firmSettings: snapshot.firmSettings,
    markupDefaults: snapshot.markupDefaults,
    skus: snapshot.skus,
    tiers: snapshot.tiers.map((tier) => ({
      ...tier,
      tierPriceAdjPct: resultingByTier.get(tier.id) ?? null,
    })),
    packaging: snapshot.packaging,
    production: snapshot.production,
    freightLegGroups: snapshot.freightLegGroups,
    freightLegs: snapshot.freightLegs,
    freightLegTiers: snapshot.freightLegTiers,
    cellOverrides: snapshot.cellOverrides,
    cellTargets: snapshot.cellTargets,
  };
  const resulting = computeQuoteCosting(input);
  const currentRollups = new Map(
    snapshot.costing.quoteRollup.map((tier) => [tier.tierId, tier]),
  );
  const resultingRollups = new Map(
    resulting.quoteRollup.map((tier) => [tier.tierId, tier]),
  );

  return {
    quoteId: snapshot.quoteId,
    applyDelta: adjustmentDelta,
    tiers: snapshot.tiers.map((tier) => {
      const current = currentRollups.get(tier.id);
      const next = resultingRollups.get(tier.id);
      if (!current || !next) {
        throw new Error(`Missing costing rollup for tier ${tier.id}`);
      }
      const currentAdjustment =
        tier.tierPriceAdjPct ?? snapshot.globalPriceAdjPct;
      return {
        tierId: tier.id,
        label: tier.label,
        priorPersistedAdjustment:
          tier.tierPriceAdjPct == null ? null : String(tier.tierPriceAdjPct),
        currentAdjustment,
        currentCustomerPrice: current.totalRevenue / current.qty,
        adjustmentDelta,
        resultingAdjustment: resultingByTier.get(tier.id)!,
        resultingCustomerPrice: next.totalRevenue / next.qty,
      };
    }),
  };
}
