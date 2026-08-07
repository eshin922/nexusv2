import {
  GRAPH_VERSION,
  graphIsComplete,
  nodeKey,
  type CostingGraph,
  type CostingNode,
  type NodeCandidate,
} from "./costing-nodes";

// Slice 8 — Pricing rollup. Pure TypeScript, no Drizzle imports,
// no server-only. Takes plain data structures (caller assembles from DB),
// returns plain data structures. Unit-testable via a fixture script.
// Same pattern as src/lib/sku-tree.ts — client-safe in principle; the
// server-only concern lives at the data-fetching wrapping action layer.
//
// Math reference (Slice R6.2 commit 2 — multi-leg journey model
// replaces the per-SKU per-tier `freight_inputs` row shape):
//
//   factoryCost/unit  = packagingCost/unit
//                       + productionCost/unit (when allocate_service_fees=true)
//                       + rawCost/unit (when not customer_ships_raws)
//
//   Freight is per-quote, not per-SKU (R6.2 Gap 22 disposition). The
//   journey is a sequence of legs grouped into one or more
//   `freight_leg_groups`. Each leg carries:
//     · mode / carrier / incoterm / dates / crosses_international_border
//     · per-component markups (freight / duty / tariff — default 0.3000)
//     · customs JSONB { duty_pct, tariff_pct } when DPS owes customs
//     · per-tier rate row(s) in `freight_leg_tiers` with PM-entered
//       `total_freight` + optional `units_in_shipment` override.
//
//   Per leg, per tier (the math contract Edward signed off):
//
//     freight_cost      = freight_leg_tiers.total_freight
//     freight_billable  = freight_cost × (1 + leg.freight_markup_pct)
//     effective_units   = freight_leg_tiers.units_in_shipment ?? tier.qty
//     container/unit    = freight_cost / effective_units
//     container_billable/unit = container/unit × (1 + leg.freight_markup_pct)
//
//     duty_cost/unit    = factoryCost/unit × leg.customs.duty_pct
//     duty_billable/unit = duty_cost/unit × (1 + leg.duty_markup_pct)
//     tariff_cost/unit  = factoryCost/unit × leg.customs.tariff_pct
//     tariff_billable/unit = tariff_cost/unit × (1 + leg.tariff_markup_pct)
//
//   `customs-eligible` per leg = crosses_international_border AND
//   incoterm = 'DDP'. Each leg evaluates independently — a Shenzhen
//   → Busan → Long Beach journey renders customs on BOTH legs (Korea
//   entry + US entry); a Shenzhen → Shanghai → LA journey renders
//   customs only on the international leg. Markup is on the AMOUNT,
//   not the rate, per Cally's tariff-anomaly case (when tariff hit
//   125% the per-component markup model lets PMs zero out
//   `tariff_markup_pct` without losing margin on freight or duty).
//
//   Per-leaf, per-tier freight contribution accretes across all legs
//   in all leg-groups for the quote:
//
//     container_per_unit = Σ legs of freight_cost / effective_units
//     duty_per_unit      = factoryCost/unit × Σ customs-eligible
//                                          leg.customs.duty_pct
//     tariff_per_unit    = (parallel)
//     (the with-markup sums apply leg-specific component markups
//      before summing — see implementation)
//
//   Every leaf at a given tier gets the SAME per-unit container
//   contribution (freight is per-journey, not per-SKU). D+T scales
//   with the leaf's own factoryCost (each leaf carries its own
//   customs invoice value).
//
//   landed_before/unit = container + duty + tariff
//   landed_with_markup/unit = container_billable + duty_billable + tariff_billable
//
//   contribution_cost/unit = factoryCost + sum(landed_before across lines)
//                            + separateServiceFees
//
//   required_sell/unit = (sum across components of cost × (1+markup))
//                        × (1 + global_price_adj_pct)
//     i.e. each cost component carries its OWN markup from its source
//     (packaging line markup_pct, freight line markup_pct, Manufacturing
//     default for production amortized fees, Raw ingredients/Other for
//     bulk raw). Then global adj multiplies the markup-stacked total.
//
// Assembly rollup (recursive, post-order):
//   contribution_cost/unit = sum across children of
//                            (child.contribution_cost × child.qty_per_parent)
//   required_sell/unit     = sum across children of
//                            (child.required_sell × child.qty_per_parent)
//   No additional markup applied at assembly level (would double-markup).
//
// Quote-level rollup (per tier):
//   revenue = sum across top-level SKUs (parent_sku_id IS NULL) of
//             required_sell × tier.qty
//   cost    = sum across top-level SKUs of contribution_cost × tier.qty
//   margin  = (revenue - cost) / revenue
//   status  = GOOD if margin ≥ target
//             BELOW_TARGET if floor ≤ margin < target
//             BELOW_FLOOR if margin < floor
//
// Suggested global adjustment (closed-form solve):
//   Want: target = 1 - cost / (current_revenue × (1 + adj_new) / (1 + adj_old))
//   But our `current_revenue` ALREADY includes adj_old. To find the
//   adj_new that produces the target margin, simplify:
//     target = (newRev - cost) / newRev where newRev = currentRev × k
//     → k = cost / (currentRev × (1 - target))
//     → adj_new = (1 + adj_old) × k - 1
//                = (1 + adj_old) × cost / (currentRev × (1 - target)) - 1
//   In the common case (current adj_old ≈ 0): adj_new = cost / (rev × (1 - target)) - 1
//   We solve in the general form to support stacking on existing adj.
//   Round to nearest 1%. Return null if margin already ≥ target.
//
// Worked example (Slice 8 unit test in scripts/test-costing.mjs):
// Tree: Gift Set → Lip Oil 10ml → {Bottle, Cap, Label}, tier qty 50,000
//
//   Bottle (leaf):
//     factoryCost   = $0.50 (packaging) + $0.10 (filling) = $0.60
//     freight: sku_total_cbm = 5, line.total_freight = $5000, eff units = 50000
//     this_sku_freight$ = (5/5) × $5000 = $5000  // single-SKU shipment
//     container/unit = $5000 / 50000 = $0.10
//     duty          = $0.60 × 0.04 = $0.024
//     tariff        = $0.60 × 0.25 = $0.15
//     landed_before = $0.274
//     landed_marked = $0.274 × 1.30 = $0.3562
//     contribution  = $0.60 + $0.274 = $0.874
//     required_sell = $0.50×1.40 + $0.10×1.30 + $0.3562 = $1.1862
//
//   Cap (leaf):  contribution=$0.05, required_sell=$0.05×1.40=$0.07
//   Label (leaf): contribution=$0.02, required_sell=$0.02×1.50=$0.03
//
//   Lip Oil (assembly):
//     contribution = $0.874 + $0.05 + $0.02 = $0.944
//     required_sell = $1.1862 + $0.07 + $0.03 = $1.2862
//
//   Gift Set (top-level assembly): contribution=$0.944, required_sell=$1.2862
//
//   At 50,000 units:
//     revenue = $64,310
//     cost    = $47,200
//     margin  = 26.6% (BELOW_TARGET)
//     adj for 35% target = 47200 / (64310 × 0.65) - 1 = 0.1291 → 13%

// ---------- input/output types ----------

export type SkuRoleValue = "leaf" | "assembly";

export type CostingSku = {
  id: string;
  canonicalQuoteLeafId?: string | null;
  parentSkuId: string | null;
  qtyPerParent: number | null;
  skuRole: SkuRoleValue;
  skuLabel: string;
  productName: string;
  sortOrder: number;
  // Slice R6.2 commit 2 — duty_pct / tariff_pct dropped from
  // CostingSku. Customs is now per-leg (freight_legs.customs JSONB),
  // not per-SKU. The DB columns quote_skus.duty_pct / tariff_pct still
  // exist post-additive-commit but no UI writes them and the math
  // layer ignores them. Drop migration retires the columns in a
  // follow-up cleanup commit.
  // Slice 9.5 — surfaced for validation engine's
  // retail_benchmark_no_cost rule (info-level: SKU has retail target
  // but no cost data yet; ambient nudge).
  retailBenchmark: number | null;
};

export type CostingTier = {
  id: string;
  label: string;
  qty: number | null; // null treated as 0 in revenue, but indicates "not yet specified"
  sortOrder: number;
  // Slice 9.2 — per-tier override of quote.globalPriceAdjPct.
  // NULL = inherit global (current behavior). Non-NULL = REPLACE
  // global for this tier's costing math (does not stack). Tiers with
  // an override are immune to GPA changes — quote-wide suggested-GPA
  // math partitions on this field.
  tierPriceAdjPct: number | null;
};

export type CostingPackagingInput = {
  quoteSkuId: string;
  tierId: string;
  lineGroupId: string;
  unitCost: number | null;
  qtyPerSellableUnit: number | null;
  category: string | null;
  markupPct: number | null;
};

export type CostingProductionInput = {
  quoteSkuId: string;
  tierId: string;
  customerShipsRaws: boolean;
  allocateServiceFeesToCost: boolean;
  fillingBlendingCost: number | null;
  cmAssemblyTotal: number | null;
  setupFeeTotal: number | null;
  toolingArtworkTotal: number | null;
  rdTotal: number | null;
  otherServiceTotal: number | null;
  bulkRawCost: number | null;
  actualUnitsProduced: number | null;
};

// ---------- R6.2 freight inputs (multi-leg journey model) ----------
//
// Slice R6.2 commit 2 replaces the per-(SKU, line, tier)
// `CostingFreightInput` shape with a leg-group → leg → leg-tier
// structure. See top-of-file comment for the math contract.
//
// `CostingFreightLegGroup` is the journey container ("Outbound ·
// Shenzhen → Busan → Long Beach"). v1 quotes typically have one
// group; multi-route is P2.
export type CostingFreightLegGroup = {
  id: string;
  label: string;
  displayOrder: number;
};

// Customs is JSONB per CD commitment — extensible to broker fees /
// classification annotations later without schema churn. Shape v1:
// { duty_pct?, tariff_pct? } as decimal fractions (0.058 = 5.8%).
export type CostingLegCustoms = {
  dutyPct?: number;
  tariffPct?: number;
};

export type CostingFreightLeg = {
  id: string;
  legGroupId: string;
  direction: "inbound" | "outbound";
  label: string | null;
  origin: string | null;
  destination: string | null;
  crossesInternationalBorder: boolean;
  treatment: "bundled" | "pass_through";
  mode:
    | "parcel"
    | "ocean_fcl"
    | "ocean_lcl"
    | "air_freight"
    | "air_express"
    | "ltl_truck"
    | "truckload"
    | "drayage"
    | "exw_pickup"
    | "other"
    | null;
  carrier: string | null;
  incoterm: "DDP" | "DAP" | "FOB" | "EXW" | "FCA" | "CIF" | null;
  cargoReadyDate: string | null;
  vesselEtd: string | null;
  // Slice R6.2 commit 4 — additive forwarder-visibility metadata.
  // Both nullable; no math impact (PM-reference only).
  vesselEta: string | null;
  actualDeliveryDate: string | null;
  dutyMarkupPct: number;
  tariffMarkupPct: number;
  customs: CostingLegCustoms;
  displayOrder: number;
};

export type CostingFreightLegTier = {
  freightLegId: string;
  tierId: string;
  totalFreight: number | null;
  unitsInShipment: number | null;
};

export type CostingFreightComponentTierCost = {
  freightLegId: string;
  quoteLeafId: string;
  tierId: string;
  actualFreightCost: number | null;
  effectiveUnits?: number;
};

/**
 * Worksheet freight is owned by one commercial product. Component membership
 * describes what is inside the shipment and is deliberately absent from this
 * arithmetic boundary: changing membership can never change the contribution.
 */
export type ShipmentContributionInput = {
  tierUnits: number;
  freightAmount: number | null;
  freightMarkupPct: number;
  dutyAmount: number | null;
  dutyMarkupPct: number;
  tariffAmount: number | null;
  tariffMarkupPct: number;
};

export type ShipmentContribution = {
  freightCostPerUnit: number;
  freightBillablePerUnit: number;
  dutyCostPerUnit: number;
  dutyBillablePerUnit: number;
  tariffCostPerUnit: number;
  tariffBillablePerUnit: number;
  totalCostPerUnit: number;
  totalBillablePerUnit: number;
};

export type CostingFreightShipmentBreak = ShipmentContributionInput & {
  freightSubcategoryId: string;
  ownerSkuId: string;
  tierId: string;
  treatment: "bundled" | "pass_through";
};

export function computeShipmentContribution(
  input: ShipmentContributionInput,
): ShipmentContribution {
  const units = num(input.tierUnits);
  const perUnit = (amount: number | null) =>
    units > 0 ? num(amount) / units : 0;
  const freightCostPerUnit = perUnit(input.freightAmount);
  const dutyCostPerUnit = perUnit(input.dutyAmount);
  const tariffCostPerUnit = perUnit(input.tariffAmount);
  const freightBillablePerUnit =
    freightCostPerUnit * (1 + num(input.freightMarkupPct));
  const dutyBillablePerUnit =
    dutyCostPerUnit * (1 + num(input.dutyMarkupPct));
  const tariffBillablePerUnit =
    tariffCostPerUnit * (1 + num(input.tariffMarkupPct));

  return {
    freightCostPerUnit,
    freightBillablePerUnit,
    dutyCostPerUnit,
    dutyBillablePerUnit,
    tariffCostPerUnit,
    tariffBillablePerUnit,
    totalCostPerUnit:
      freightCostPerUnit + dutyCostPerUnit + tariffCostPerUnit,
    totalBillablePerUnit:
      freightBillablePerUnit + dutyBillablePerUnit + tariffBillablePerUnit,
  };
}

// Slice 9.3 — per-cell sell-price override. Sparse: rows exist ONLY
// when a PM has set an explicit override on a (SKU, tier) cell.
// Absent entry = "use computed sell" (which itself respects per-tier
// and global price adjustments). NOT NULL on the column at the DB
// level guarantees override > 0 by way of the action layer's reject-
// non-positive guard; the math layer also defends against negative
// requiredSellPerUnit (see computeLeafPerTier).
export type CostingCellOverride = {
  quoteSkuId: string;
  tierId: string;
  sellPriceOverride: number;
};

// Slice 9.4b — per-cell client target benchmark. Sister sparse table to
// CostingCellOverride / quote_sku_tiers. Customer-stated price the PM
// captures during negotiation ("client wants $5 landed at 50k for this
// SKU"). Drives the per-(SKU, tier) competitive verdict (COMPETITIVE /
// OVER_CLIENT_TARGET / null) and the "Apply suggested adj to match
// client target" reverse-solve affordance. Independent lifecycle from
// sell_price_override — PM may benchmark a cell without overriding it,
// override without knowing the target, or set both. Assemblies allowed
// (per Edward's pressure-test B resolution).
//
// Customer-view boundary: this data is INTERNAL ONLY — never surfaces
// in the customer-facing PDF or sent-version snapshot. See CLAUDE.md
// "Customer-view boundary guard" forbidden-field enumeration.
export type CostingCellTarget = {
  quoteSkuId: string;
  tierId: string;
  clientTargetPricePerUnit: number;
};

export type QuoteCostingInput = {
  // Slice 9.2 — quote.targetMarginPct is per-quote override of
  // firmSettings.targetMarginPct. NULL = inherit firm-level.
  // Replaces the firm-level target for THIS quote's verdict bands
  // (GOOD / BELOW_TARGET threshold). Floor stays firm-level always.
  quote: {
    id: string;
    globalPriceAdjPct: number;
    targetMarginPct: number | null;
    freightMarkupPct?: number;
  };
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  // Record (not Map) so the snapshot survives RSC server→client
  // serialization. Maps don't round-trip across the RSC boundary —
  // they arrive as `{}` on the client and `defaults.has(...)` throws
  // TypeError. Record is plain JSON, serializes cleanly. Caught
  // Slice 8 sub-step 4 verification.
  markupDefaults: Record<string, number>;
  skus: CostingSku[];
  tiers: CostingTier[];
  packaging: CostingPackagingInput[];
  production: CostingProductionInput[];
  // Slice R6.2 — multi-leg journey freight model. Three sparse arrays
  // describing the quote's journey(s); see CostingFreightLeg /
  // CostingFreightLegTier types. Empty = no freight entered yet.
  // Math is per-(leaf, tier) but accumulates over all legs in all
  // groups; every leaf at a given tier gets the same per-unit
  // container contribution (freight is per-quote, not per-SKU).
  freightLegGroups: CostingFreightLegGroup[];
  freightLegs: CostingFreightLeg[];
  freightLegTiers: CostingFreightLegTier[];
  freightComponentTierCosts?: CostingFreightComponentTierCost[];
  freightShipmentBreaks?: CostingFreightShipmentBreak[];
  // Slice 9.3 — sparse per-cell sell-price overrides. Empty array =
  // no overrides anywhere. Order doesn't matter; computeQuoteCosting
  // builds a `${skuId}::${tierId}` lookup map internally.
  cellOverrides: CostingCellOverride[];
  // Slice 9.4b — sparse per-cell client target benchmarks. Mirror
  // shape to cellOverrides; lazy rows on `quote_sku_tier_targets`.
  cellTargets: CostingCellTarget[];
};

// Slice R6.2 — per-leg breakdown surfaced to UI for the cost-stack
// drilldown. One entry per leg in the journey, with this leaf's
// per-unit contribution from that leg. `dutyPerUnit` / `tariffPerUnit`
// are zero on legs that aren't customs-eligible
// (!crosses_international_border OR incoterm !== 'DDP').
//
// Pre-R6.2 the breakdown was per-`lineGroupId` (per freight line);
// the new model surfaces per-leg so PMs see which border-crossing
// leg contributes which D+T burden. legGroupId is included so UIs
// can group legs by journey.
export type FreightLegBreakdown = {
  legId: string;
  legGroupId: string;
  containerFreightPerUnit: number;
  containerFreightWithMarkupPerUnit: number;
  dutyPerUnit: number;
  dutyWithMarkupPerUnit: number;
  tariffPerUnit: number;
  tariffWithMarkupPerUnit: number;
  landedFreightBeforeMarkup: number;
  landedFreightWithMarkup: number;
  freightMarkupPct: number;
  dutyMarkupPct: number;
  tariffMarkupPct: number;
  customsEligible: boolean;
  treatment: "bundled" | "pass_through";
};

// Slice 9.3 — `sellSource` is an open enum. New override layers may
// add discriminated values in future slices (e.g., `"line_group_override"`
// for Slice 14+ per-line overrides, `"scenario_override"` for scenario-
// level overrides). UI consumers should default to "computed" treatment
// when they encounter an unrecognized source rather than throwing.
export type SellSource = "computed" | "cell_override";

export type SkuPerTierRollup = {
  tierId: string;
  packagingCostPerUnit: number;
  productionCostPerUnit: number;
  rawCostPerUnit: number; // bulk_raw_cost amortized when not customer-shipped
  factoryCostPerUnit: number;
  // Slice R6.2 — `freightLines` renamed to `freightLegs` (one entry
  // per leg, not per legacy line_group). UIs that need the per-leg
  // surface read here; cost-stack rows read the aggregate sums below.
  freightLegs: FreightLegBreakdown[];
  // Slice R6.2 — count of customs-eligible legs in the journey for
  // the per-leaf cost-stack render. Gap 16: D+T row gets a
  // "· N customs legs" mono sub-caption when N > 1.
  customsLegCount: number;
  totalLandedFreightBeforeMarkup: number;
  totalLandedFreightWithMarkup: number;
  // Slice RI.8 Option B+ — D+T (duty + tariff) is broken out from the
  // total landed freight so the cost-stack can render it as its own
  // row (Edward's locked position). Two new fields parallel the
  // existing total; `totalLandedFreightBeforeMarkup` remains the sum
  // (backwards-compat for any reader that hasn't migrated).
  totalContainerFreightBeforeMarkup: number;
  totalDutyTariffBeforeMarkup: number;
  // Slice RI.8 Option 2 — per-component MARKED-UP sums (cost × (1 +
  // markup) per line, summed). These are the first-class primitives
  // the cost-stack rows + section mini-stack + drilldown TOTAL all
  // read. Replaces the proportional-share approximation that caused
  // PM-visible mismatches across the three display surfaces.
  packagingMarkupSumPerUnit: number;
  productionMarkupSumPerUnit: number;
  rawMarkupSumPerUnit: number;
  freightContainerMarkupSumPerUnit: number;
  freightDutyTariffMarkupSumPerUnit: number;
  separateServiceFeesPerUnit: number; // when allocate_service_fees=false
  separateServicesMarkupSumPerUnit: number; // marked-up version of above
  contributionCostPerUnit: number;
  // Slice 9.3 — `requiredSellPerUnit` is the value used by all
  // downstream math (revenue, margin, partition). `computedSellPerUnit`
  // is the pre-override markup-chain × (1 + effectiveAdj) result,
  // exposed for UI tooltips ("OVR · was $X") on overridden cells.
  // When `sellSource === "computed"`, `requiredSellPerUnit ===
  // computedSellPerUnit`. When `"cell_override"`, the two diverge.
  computedSellPerUnit: number;
  requiredSellPerUnit: number;
  sellSource: SellSource;
  marginPct: number;
  // Slice 9.4a — per-(SKU, tier) verdict band, classified against the
  // SAME thresholds as the quote-level blended verdict (effectiveTarget,
  // firmSettings.floorMarginPct). Surfaces on the per-SKU summary row.
  // For assemblies this reflects the rolled-up margin (mix of children).
  marginStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  // Slice 9.4b — per-(SKU, tier) competitive verdict against PM-entered
  // client target benchmark. NULL when no `client_target_price_per_unit`
  // is set on this cell (NULL-as-empty-signal). When set, classifies
  // requiredSellPerUnit (the EFFECTIVE sell — respects per-cell override)
  // against the target. Independent of marginStatus; PMs see both axes.
  // Drives the secondary competitive indicator on the per-SKU summary row.
  competitiveStatus: "COMPETITIVE" | "OVER_CLIENT_TARGET" | null;
  revenue: number;
  cost: number;
};

export type SkuRollup = {
  skuId: string;
  skuRole: SkuRoleValue;
  parentSkuId: string | null;
  indentDepth: number;
  skuLabel: string;
  productName: string;
  qtyPerParent: number | null;
  perTier: SkuPerTierRollup[];
};

export type QuoteCostBreakdown = {
  // Pre-markup component contributions to contribution_cost. Sum
  // (packaging + production + freight + serviceFees) ≈ totalCost
  // (small floating-point drift expected). Used by QuoteSummaryCard
  // to surface "where does the cost go" per tier. raw bulk cost folds
  // into production for the breakdown (PMs treat them as one
  // production-side category; surfacing raw separately added a row
  // that was usually zero or near-zero).
  packaging: number;
  production: number;
  freight: number;
  serviceFees: number;
  // Slice RI.8 Option B+ — D+T cost-stack row (Edward locked
  // position). `freight` is now derived = freightContainer +
  // dutyAndTariff. Container row reads `freightContainer`; the new
  // D+T row reads `dutyAndTariff`. Backwards-compat: any reader of
  // `freight` continues to see the combined number.
  freightContainer: number;
  dutyAndTariff: number;
  // Slice RI.8 Option 2 — per-component marked-up sums (cost ×
  // (1 + markup) applied at the line level, summed across SKUs
  // weighted by tier qty). These are the canonical "sell
  // contribution" primitives for cost-stack rows + section
  // mini-stack + drilldown TOTAL.
  packagingMarkupSum: number;
  productionMarkupSum: number;
  rawMarkupSum: number;
  freightContainerMarkupSum: number;
  dutyAndTariffMarkupSum: number;
  separateServicesMarkupSum: number;
};

export type QuotePerTierRollup = {
  tierId: string;
  label: string;
  qty: number;
  totalRevenue: number;
  totalCost: number;
  costBreakdown: QuoteCostBreakdown;
  blendedMarginPct: number;
  blendedMarginStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  suggestedGlobalAdjPct: number | null;
};

// Slice 9.2 — quote-wide blended view (across all tiers). The IA
// spec verdict surface ("BLENDED MARGIN · ALL SKUS · ALL TIERS")
// reads from this. Distinct from per-tier QuotePerTierRollup which
// computes blended within a single tier.
//
// suggestedAdj is the canonical surface for the system-suggested
// GPA banner (UX_BACKLOG: system-suggested global price adjustment
// computation). Goal shifts by verdict state — target in
// BELOW_TARGET, floor in BELOW_FLOOR, none in GOOD. Microcopy
// always present (empty string when no banner shows). See the
// computeQuoteSuggestion helper for the degenerate-case matrix.
export type QuoteSummary = {
  blendedRevenue: number;
  blendedCost: number;
  blendedMarginPct: number;
  blendedMarginStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  effectiveTargetMarginPct: number; // quote override or firm default
  // System-suggested GPA. null in degenerate cases (already at goal,
  // overridden tiers exceed goal, all tiers overridden, out of
  // bounds). microcopy explains the null state when applicable.
  suggestedAdj: number | null;
  suggestionGoal: "target" | "floor" | null;
  suggestionMicrocopy: string;
};

export type QuoteCostingResult = {
  quote: {
    id: string;
    globalPriceAdjPct: number;
    targetMarginPct: number | null;
  };
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  tiers: Array<{ tierId: string; label: string; qty: number }>;
  skuRollups: SkuRollup[];
  quoteRollup: QuotePerTierRollup[];
  // Slice 9.2 — quote-wide blended summary across all tiers.
  quoteSummary: QuoteSummary;
  /**
   * Gate 1B — the canonical computation node graph.
   *
   * Deliberately a NEW top-level key rather than a field on `skuRollups`: the
   * S-7 preservation baseline digests six named keys, and this is not one of
   * them, so building the graph out cannot perturb the "no commercial number
   * moved" signal.
   *
   * Currently PARTIAL — packaging only. Being built incrementally with S-7
   * green after each step, so any divergence is immediately attributable to
   * one change rather than a batch. Consumers must not read it until the
   * section they need is present.
   */
  graph: CostingGraph;
};

// ---------- helpers ----------

const FALLBACK_MARKUP = 0.3;
const PRODUCTION_MARKUP_CATEGORY = "Manufacturing";
const RAW_MARKUP_CATEGORY = "Raw ingredients"; // Slice 9 will likely add this; falls back to Other today

// Phase 2 freight model cutover — diagnostic for the shadowing case.
//
// The math layer is pure: this reports, it does not mutate state and it
// does not change any returned value. It is deduped because
// computeQuoteCosting runs on every optimistic recompute and an
// un-deduped warning would be per-keystroke noise.
//
// Deliberately NOT an exception. A quote carrying both models is a
// legitimate mid-retirement state, and the worksheet result is correct.
// This exists so the discard is visible rather than silent.
const shadowedFreightReports = new Set<string>();
function reportLegacyFreightShadowed(legCount: number, breakCount: number): void {
  const key = `${legCount}:${breakCount}`;
  if (shadowedFreightReports.has(key)) return;
  shadowedFreightReports.add(key);
  console.warn(
    `[freight-model] Worksheet is authoritative (${breakCount} shipment break(s)); ` +
      `${legCount} legacy freight leg(s) present and not consulted. ` +
      `Expected during the staged legacy-model retirement.`,
  );
}

function num(v: number | null | undefined, fallback = 0): number {
  return v == null ? fallback : v;
}

/**
 * The markup resolution, reporting its PATH and not only its answer.
 *
 * Gate 1B S-1: a `resolution` node needs the losing candidates and why each
 * lost — R10 §1 is explicit that collapsing to the resolved value "re-creates
 * exactly the opacity the principle exists to remove". Showing "markup 32%"
 * answers nothing; showing "no line override · no Shrink default exists · so
 * the Other default, 32%" answers completely.
 *
 * Every input the ladder needs was already in scope at the call site. This
 * retains the comparisons it was already making rather than discarding them —
 * no new arithmetic, so it stays inside Amendment A-1.
 */
export type MarkupResolution = {
  value: number;
  candidates: MarkupCandidate[];
};
export type MarkupCandidate = {
  label: string;
  value: number | null;
  chosen: boolean;
  unavailableReason: string | null;
};

export function resolveMarkup(args: {
  defaults: Record<string, number>;
  category: string | null;
  /** Non-null when the line carries its own markup. Note NULLITY, not
   *  truthiness: a line markup of 0 is a decision and must beat the category
   *  default. */
  lineMarkupPct?: number | null;
  fallbackCategory?: string;
}): MarkupResolution {
  const { defaults, category, lineMarkupPct = null } = args;
  const fallbackCategory = args.fallbackCategory ?? "Other";
  const candidates: MarkupCandidate[] = [];

  const lineAvailable = lineMarkupPct !== null && lineMarkupPct !== undefined;
  candidates.push({
    label: "Line override",
    value: lineAvailable ? lineMarkupPct : null,
    chosen: false,
    unavailableReason: lineAvailable ? null : "no line override set",
  });

  const categoryAvailable = Boolean(category) && defaults[category!] !== undefined;
  candidates.push({
    label: category ? `${category} default` : "Category default",
    value: categoryAvailable ? defaults[category!] : null,
    chosen: false,
    unavailableReason: categoryAvailable
      ? null
      : category
        ? `no ${category} default exists`
        : "no category on this line",
  });

  const fallbackAvailable = defaults[fallbackCategory] !== undefined;
  candidates.push({
    label: `${fallbackCategory} default`,
    value: fallbackAvailable ? defaults[fallbackCategory] : null,
    chosen: false,
    unavailableReason: fallbackAvailable ? null : `no ${fallbackCategory} default exists`,
  });

  candidates.push({
    label: "Firm fallback",
    value: FALLBACK_MARKUP,
    chosen: false,
    unavailableReason: null,
  });

  const winner = candidates.find((c) => c.unavailableReason === null)!;
  winner.chosen = true;
  return { value: winner.value as number, candidates };
}

/** Thin wrapper preserving the original signature. Every existing caller keeps
 *  working and gets the identical number; only the reporting is new. */
function lookupMarkup(
  defaults: Record<string, number>,
  category: string | null,
  fallbackCategory = "Other",
): number {
  return resolveMarkup({ defaults, category, fallbackCategory }).value;
}

function computeStatus(
  margin: number,
  target: number,
  floor: number,
): "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR" {
  if (margin >= target) return "GOOD";
  if (margin >= floor) return "BELOW_TARGET";
  return "BELOW_FLOOR";
}

// Slice 9.4b — competitive verdict classification, shared by leaf and
// assembly per-tier rollups. NULL semantics: when the cell has no
// client target, competitiveStatus is null (NULL-as-empty-signal —
// secondary indicator simply doesn't render). When set, classifies
// the EFFECTIVE sell (which is the per-cell override if set, else
// the computed sell) against the target — equality counts as
// COMPETITIVE (PM lands exactly at target; not over).
function computeCompetitiveStatus(
  requiredSellPerUnit: number,
  cellTarget: number | null,
): "COMPETITIVE" | "OVER_CLIENT_TARGET" | null {
  if (cellTarget === null) return null;
  return requiredSellPerUnit <= cellTarget ? "COMPETITIVE" : "OVER_CLIENT_TARGET";
}

// Closed-form solve. See top-of-file comment for derivation.
// Returns null if margin already at/above target.
//
// PER-TIER variant — kept for backwards compatibility with the
// existing per-tier suggestedGlobalAdjPct surface. Returns null
// when the tier is fully GPA-fixed (no GPA-influencable cells in
// the tier — either tier-level override is set, or every cell in the
// tier has a per-cell override). Quote-wide canonical surface lives
// in computeQuoteSuggestion.
//
// Slice 9.3 — `tierGpaFixed` replaces the prior `tierHasOverride`
// parameter. Same boolean shape; broader semantic captures both
// override layers (per-tier and per-cell) that fix a tier's revenue
// w.r.t. global GPA. Caller computes upstream from the input shape.
function suggestedAdj(
  currentRevenue: number,
  currentCost: number,
  currentAdj: number,
  targetMargin: number,
  tierGpaFixed: boolean,
): number | null {
  if (tierGpaFixed) return null;
  if (currentRevenue <= 0) return null;
  const currentMargin = (currentRevenue - currentCost) / currentRevenue;
  if (currentMargin >= targetMargin) return null;
  if (targetMargin >= 1) return null; // would require infinite revenue
  // newRev = currentRev × k where k = (1 + adj_new) / (1 + adj_old)
  // target = 1 - cost/newRev → newRev = cost/(1-target)
  // k = cost / (currentRev × (1 - target))
  const k = currentCost / (currentRevenue * (1 - targetMargin));
  const adjNew = (1 + currentAdj) * k - 1;
  // Round to nearest 1%. Pad up so we never under-suggest.
  return Math.ceil(adjNew * 100) / 100;
}

// Slice 9.4b — reverse-solve helper: suggest the per-tier price
// adjustment needed to land a given (SKU, tier) cell exactly at its
// client target benchmark. Closed-form solve; per-cell math:
//
//   required_sell(s, t) = base(s) × (1 + tier_adj(t))
//   base(s)             = component_cost(s) × (1 + component_markup(s))
//
// Solve for tier_adj(t) such that required_sell === T:
//   tier_adj(t) = T / base(s) - 1
//
// For assemblies, base is the rolled-up children's
// (base × qtyPerParent) chain — already encoded in the assembly cell's
// `computedSellPerUnit / (1 + currentTierAdj)`. We use that derivation
// here so the helper works for both leaf and assembly cells without
// duplicating the markup chain.
//
// Output: { ok: true, suggestedTierAdj } | { ok: false, reason }.
// The suggested adj is the value to write to `quote_tiers.tier_price_adj_pct`
// for the target cell's tier. Apply path is `applyClientTargetSolveTierAdj`
// in src/app/actions/costing.ts (mirrors Slice 9.2 `applySuggestedGlobalAdj`).
//
// Per-architect guard order (Q1 sign-off):
//   1. no_target_set       — no benchmark on this cell; nothing to solve for
//   2. cell_overridden     — target cell has sell_price_override; tier_adj
//                            has zero leverage on this cell (override is
//                            terminal); solve is non-actionable
//   3. all_cells_fixed     — every leaf cell at tier t has sell_price_override;
//                            tier_adj change moves nothing; defensive (usually
//                            short-circuits at step 2 already)
//   4. cost_exceeds_target — base(s) >= T; no positive sell hits the target;
//                            math would go to ≤ -1 (sell at or below cost)
//   5. solution_out_of_range — tier_adj_solution outside ±9.99 (validatePercent
//                              caps at ±999%; numeric(5,4) at ±9.9999); also
//                              catches Infinity/NaN from zero-base degenerate
//
// Cross-cell consequence: applying the suggested adj on tier t affects
// EVERY (SKU, tier t) cell, not just the originating one. The dialog
// path renders an explicit per-cell post-apply table — caller invokes
// `computeQuoteCosting` with the suggested adj substituted into the
// tier's `tierPriceAdjPct` to produce the preview state. This helper
// returns ONLY the suggested value; the preview is two-call by design
// (per architect Q2 sign-off).
export type ReverseSolveResult =
  | { ok: true; suggestedTierAdj: number }
  | {
      ok: false;
      reason:
        | "no_target_set"
        | "cell_overridden"
        | "all_cells_fixed"
        | "cost_exceeds_target"
        | "solution_out_of_range";
    };

const REVERSE_SOLVE_MIN_ADJ = -9.99;
const REVERSE_SOLVE_MAX_ADJ = 9.99;

export function suggestTierAdjForClientTarget(
  quoteSkuId: string,
  tierId: string,
  costing: QuoteCostingResult,
  input: QuoteCostingInput,
): ReverseSolveResult {
  // Guard 1: no target set on this cell.
  const targetEntry = input.cellTargets.find(
    (t) => t.quoteSkuId === quoteSkuId && t.tierId === tierId,
  );
  if (!targetEntry) {
    return { ok: false, reason: "no_target_set" };
  }
  const T = targetEntry.clientTargetPricePerUnit;

  // Guard 2: target cell has a sell-price override; tier_adj has no
  // leverage. Override is terminal per Slice 9.3 semantics.
  const cellHasOverride = input.cellOverrides.some(
    (o) => o.quoteSkuId === quoteSkuId && o.tierId === tierId,
  );
  if (cellHasOverride) {
    return { ok: false, reason: "cell_overridden" };
  }

  // Guard 3 (defensive): every leaf cell at this tier has an override
  // → tier_adj change moves nothing. Usually short-circuits at guard
  // 2 already (the target cell is itself a fixed cell), but kept for
  // forward-compat against future state changes.
  const leavesInTier = input.skus.filter((s) => s.skuRole === "leaf");
  const allLeavesOverridden =
    leavesInTier.length > 0 &&
    leavesInTier.every((s) =>
      input.cellOverrides.some(
        (o) => o.quoteSkuId === s.id && o.tierId === tierId,
      ),
    );
  if (allLeavesOverridden) {
    return { ok: false, reason: "all_cells_fixed" };
  }

  // Resolve base(s) for the target cell. We back it out from the
  // existing rollup: requiredSellPerUnit = base × (1 + currentTierAdj).
  // currentTierAdj = tier.tierPriceAdjPct ?? globalAdj (Slice 9.2's
  // effectiveAdj rule). Use the rollup's existing values to avoid
  // duplicating the markup chain — works for both leaf and assembly.
  const skuRollup = costing.skuRollups.find((r) => r.skuId === quoteSkuId);
  if (!skuRollup) {
    // Shouldn't happen: cellTargets should only reference existing
    // SKUs. Defensive: treat as no_target_set.
    return { ok: false, reason: "no_target_set" };
  }
  const cellRollup = skuRollup.perTier.find((pt) => pt.tierId === tierId);
  if (!cellRollup) {
    return { ok: false, reason: "no_target_set" };
  }
  const tierRow = input.tiers.find((t) => t.id === tierId);
  if (!tierRow) {
    return { ok: false, reason: "no_target_set" };
  }
  const currentTierAdj =
    tierRow.tierPriceAdjPct !== null && tierRow.tierPriceAdjPct !== undefined
      ? Number(tierRow.tierPriceAdjPct)
      : input.quote.globalPriceAdjPct;
  // base = computedSellPerUnit / (1 + currentTierAdj). The
  // computedSellPerUnit field is the markup-chain × (1 + effectiveAdj)
  // result (Slice 9.3 added it for the OVR tooltip; reused here).
  // Avoid divide-by-zero when currentTierAdj === -1 (sell free).
  const denom = 1 + currentTierAdj;
  if (denom === 0) {
    return { ok: false, reason: "solution_out_of_range" };
  }
  const base = cellRollup.computedSellPerUnit / denom;

  // Guard 4: base alone meets or exceeds target → no positive sell
  // hits target → math goes to <= -1 (sell ≤ cost). PM has wiggle
  // via override path (separately) but cannot achieve via tier_adj.
  if (base >= T) {
    return { ok: false, reason: "cost_exceeds_target" };
  }

  // Solve.
  const suggestedTierAdj = T / base - 1;

  // Guard 5: solution outside schema/validation bounds (catches
  // Infinity/NaN too — comparison against finite bounds returns false
  // for non-finite, which falls into the ! Number.isFinite branch).
  if (
    !Number.isFinite(suggestedTierAdj) ||
    suggestedTierAdj < REVERSE_SOLVE_MIN_ADJ ||
    suggestedTierAdj > REVERSE_SOLVE_MAX_ADJ
  ) {
    return { ok: false, reason: "solution_out_of_range" };
  }

  return { ok: true, suggestedTierAdj };
}

// Slice 9.4b — naive tier-adj solution for the `cost_exceeds_target`
// case (base ≥ T → no positive sell can hit target → solution lands
// at or below sell-equals-cost). Per Edward's pressure-test resolution,
// the destructive case is applyable with explicit consequence framing
// — the affordance shows in amber + dialog spells out the margin drop.
// Both cell.tsx (display gating) and the action layer (apply path
// re-derivation) need the naive value; this helper centralizes the
// math + bounds check so the two call sites stay aligned.
//
// Bounds: [-0.99, 9.99] — tighter than the canonical reverse-solve
// REVERSE_SOLVE_MIN_ADJ. -0.99 caps "sell at 1% of base" (anything
// below means sell ≈ 0); the high bound is there for completeness
// (cost_exceeds_target case never produces values > 0 in practice).
// Out-of-range / non-finite → null (caller surfaces as
// solution_out_of_range refusal).
const COST_EXCEEDS_TARGET_NAIVE_MIN_ADJ = -0.99;
const COST_EXCEEDS_TARGET_NAIVE_MAX_ADJ = 9.99;

export function naiveTierAdjForCostExceedsTarget(
  base: number,
  clientTarget: number,
): number | null {
  if (!Number.isFinite(base) || base <= 0) return null;
  if (!Number.isFinite(clientTarget) || clientTarget <= 0) return null;
  const naive = clientTarget / base - 1;
  if (
    !Number.isFinite(naive) ||
    naive < COST_EXCEEDS_TARGET_NAIVE_MIN_ADJ ||
    naive > COST_EXCEEDS_TARGET_NAIVE_MAX_ADJ
  ) {
    return null;
  }
  return naive;
}

// Slice 9.2 — quote-wide suggested-GPA computation. The canonical
// surface for the system-suggested-GPA banner. Goal shifts by
// verdict state (target in BELOW_TARGET, floor in BELOW_FLOOR,
// none in GOOD). Math partitions tiers into overridden (FIXED
// revenue) vs inheriting (SOLVE FOR GPA), avoiding the "uniform
// multiplier" mistake which silently undershoots when any tier
// is overridden.
//
// Returns the full degenerate-case matrix as a single shape:
// { suggestedAdj: number | null, microcopy: string, goal }.
// microcopy is always present; empty string when no banner shows.
//
// Bounds for "achievable": SUGGESTION_MIN_PCT to SUGGESTION_MAX_PCT
// (decimals, not percent). Out-of-bounds suggestion suppressed
// because GPA alone can't realistically lift the quote that far.

const SUGGESTION_THRESHOLD_PP = 0.003; // 0.3pp gap before surfacing
const SUGGESTION_MIN_PCT = -0.5;
const SUGGESTION_MAX_PCT = 1.0;

function computeQuoteSuggestion(args: {
  blendedRevenue: number;
  blendedCost: number;
  blendedStatus: "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";
  effectiveTarget: number;
  floor: number;
  globalAdj: number;
  // Slice 9.3 — per-CELL breakdown for the partition. Each entry is a
  // (SKU, tier) cell with its revenue + cost contribution and its
  // GPA-fixed status. `gpaFixed` is the actual partition criterion:
  // true when this cell's revenue does NOT respond to global-GPA
  // changes. A cell is GPA-fixed when it has a per-cell sell-price
  // override OR sits in a tier with `tier_price_adj_pct` set (tier
  // override REPLACES global, doesn't stack — see CLAUDE.md "Slice 9
  // pricing-control columns"). Future override layers extend the
  // semantic without changing the partition shape.
  perCellBreakdown: Array<{
    revenue: number;
    cost: number;
    gpaFixed: boolean;
  }>;
}): {
  suggestedAdj: number | null;
  suggestionGoal: "target" | "floor" | null;
  suggestionMicrocopy: string;
} {
  const {
    blendedRevenue,
    blendedCost,
    blendedStatus,
    effectiveTarget,
    floor,
    globalAdj,
    perCellBreakdown,
  } = args;

  // GOOD state — no suggestion needed.
  if (blendedStatus === "GOOD") {
    return { suggestedAdj: null, suggestionGoal: null, suggestionMicrocopy: "" };
  }

  // Goal shifts by verdict state. BELOW_TARGET: solve to target.
  // BELOW_FLOOR: solve to floor (urgent — lift above hard block).
  const goal: "target" | "floor" =
    blendedStatus === "BELOW_FLOOR" ? "floor" : "target";
  const goalPct = goal === "floor" ? floor : effectiveTarget;

  if (blendedRevenue <= 0) {
    return { suggestedAdj: null, suggestionGoal: null, suggestionMicrocopy: "" };
  }

  // If blended is within threshold of goal, no banner.
  const currentMargin = (blendedRevenue - blendedCost) / blendedRevenue;
  if (Math.abs(currentMargin - goalPct) < SUGGESTION_THRESHOLD_PP) {
    return { suggestedAdj: null, suggestionGoal: null, suggestionMicrocopy: "" };
  }

  // Slice 9.3 — partition cells into GPA-fixed (FIXED) vs
  // GPA-influencable (SOLVE). Universal trigger for the all-fixed
  // microcopy: every cell across every tier must be GPA-fixed (NOT
  // a majority threshold). Wording "All cells…" matches.
  let revenueFixed = 0;
  let revenueInheritingAtZeroGPA = 0;
  let costFixed = 0;
  let costInheriting = 0;
  for (const c of perCellBreakdown) {
    if (c.gpaFixed) {
      revenueFixed += c.revenue;
      costFixed += c.cost;
    } else {
      // Strip the current GPA back to zero so we can re-solve from
      // a clean baseline. revenue = revenue_at_zero × (1 + globalAdj),
      // so revenue_at_zero = revenue / (1 + globalAdj). Cost is
      // GPA-independent so passes through.
      revenueInheritingAtZeroGPA += c.revenue / (1 + globalAdj);
      costInheriting += c.cost;
    }
  }

  // Degenerate: all cells are GPA-fixed (per-cell or per-tier
  // overrides). GPA cannot affect blended.
  if (revenueInheritingAtZeroGPA <= 0) {
    return {
      suggestedAdj: null,
      suggestionGoal: null,
      suggestionMicrocopy:
        "All cells are price-fixed (per-cell or per-tier overrides); suggested GPA cannot affect blended.",
    };
  }

  // Required blended revenue to hit goal. Cost is fixed.
  if (goalPct >= 1) {
    return { suggestedAdj: null, suggestionGoal: null, suggestionMicrocopy: "" };
  }
  const targetBlendedRevenue = (costFixed + costInheriting) / (1 - goalPct);

  // What inheriting cells must contribute to hit the target.
  const requiredInheritingRev = targetBlendedRevenue - revenueFixed;

  // Degenerate: GPA-fixed cells alone meet/exceed the goal-revenue.
  // The floor branch is reachable when blended is BELOW_FLOOR but
  // fixed cells alone produce floor-level margin against total cost;
  // the target branch (else) is mathematically unreachable given the
  // GOOD short-circuit at the top of this function (if fixed revenue
  // alone covers targetBlendedRev, then blended_margin >= effectiveTarget
  // → blendedStatus === "GOOD" → early return). Kept defensively in
  // case the GOOD short-circuit logic changes; remove only after
  // auditing the upstream guard.
  if (requiredInheritingRev <= 0) {
    return {
      suggestedAdj: null,
      suggestionGoal: null,
      suggestionMicrocopy:
        goal === "floor"
          ? "Price-fixed cells are pulling blended below floor and inheriting cells can't compensate; consider tuning overrides down."
          : "Price-fixed cells already exceed target — no GPA suggestion possible; consider tuning overrides down.",
    };
  }

  // Solve: required = sum_inheriting_at_zero × (1 + suggested_GPA)
  const adjNewRaw = requiredInheritingRev / revenueInheritingAtZeroGPA - 1;
  // Round to nearest 1%, padding up so we never under-suggest.
  const suggestedAdjPct = Math.ceil(adjNewRaw * 100) / 100;

  // Bounds check — GPA alone may not be achievable.
  if (
    suggestedAdjPct < SUGGESTION_MIN_PCT ||
    suggestedAdjPct > SUGGESTION_MAX_PCT
  ) {
    return {
      suggestedAdj: null,
      suggestionGoal: null,
      suggestionMicrocopy:
        goal === "floor"
          ? "GPA alone cannot lift blended above floor — review overrides or per-line costs."
          : "GPA alone cannot land blended at target — review overrides or per-line costs.",
    };
  }

  // Surface-able suggestion. Microcopy will be rendered in UI from
  // the goal + suggestedAdj; provide a default that the banner can
  // either use directly or template against.
  const goalPctDisplay = (goalPct * 100).toFixed(1);
  const adjPctDisplay = (suggestedAdjPct * 100).toFixed(0);
  const microcopy =
    goal === "floor"
      ? `System suggests +${adjPctDisplay}% to lift blended above floor (${goalPctDisplay}%).`
      : `System suggests +${adjPctDisplay}% to land blended at target (${goalPctDisplay}%).`;

  return {
    suggestedAdj: suggestedAdjPct,
    suggestionGoal: goal,
    suggestionMicrocopy: microcopy,
  };
}

// ---------- per-leaf, per-tier compute ----------

function computeLeafPerTier(args: {
  sku: CostingSku;
  tier: CostingTier;
  packaging: CostingPackagingInput[];
  production: CostingProductionInput | null;
  // Slice R6.2 — multi-leg freight. The leg-group/leg/leg-tier
  // arrays are passed in pre-filtered to this quote; the math layer
  // iterates legs and resolves per-tier rate rows by tierId.
  freightLegs: CostingFreightLeg[];
  freightLegTiers: CostingFreightLegTier[];
  freightComponentTierCosts: CostingFreightComponentTierCost[];
  freightShipmentBreaks: CostingFreightShipmentBreak[];
  freightMarkupPct: number;
  /**
   * The EFFECTIVE price adjustment for this cell — `tier.tierPriceAdjPct ??
   * quote.globalPriceAdjPct`, resolved by the caller (see the resolution in
   * `computeQuoteCosting`). Named for what it IS rather than where it usually
   * comes from: it was previously called `globalAdj`, which is wrong on every
   * tier carrying its own adjustment.
   *
   * The distinction matters beyond tidiness. The two candidates REPLACE rather
   * than stack, so a trace node built from this value and labelled "global
   * adjustment" would state the wrong provenance for those tiers. The losing
   * candidate is only in scope at the resolution site, so the `resolution`
   * node belongs there — not here, where only the winner arrives.
   */
  effectiveAdj: number;
  markupDefaults: Record<string, number>;
  // Slice 9.3 — per-cell sell-price override. null = no override
  // (use computed sell). When non-null, this value is TERMINAL —
  // bypasses both per-tier and global price adjustments. Cell margin
  // computes against the override; OVR badge in UI reads this state.
  cellOverride: number | null;
  // Slice 9.4a — verdict thresholds for per-(SKU, tier) margin
  // classification. effectiveTarget already accounts for per-quote
  // override (see computeQuoteCosting); floor stays firm-level.
  effectiveTarget: number;
  floor: number;
  // Slice 9.4b — per-cell client target benchmark. null = no target
  // set on this cell (NULL-as-empty-signal); competitiveStatus
  // resolves to null and the secondary indicator doesn't render.
  cellTarget: number | null;
  /**
   * Gate 1B increment 4 — resolution CANDIDATES, decided upstream.
   *
   * A resolution node must be emitted where all competing candidates are
   * simultaneously in scope. By the time execution reaches here only the
   * winner has arrived, so building the ladder locally would mean inventing
   * the rungs that lost — stating provenance that was never observed.
   *
   * So the candidates travel down as data and this function only applies the
   * cell's key. The decision is made where it is visible; the addressing is
   * done where the identity is.
   */
  adjustmentCandidates?: NodeCandidate[];
  freightMarkupCandidates?: NodeCandidate[];
  /**
   * Gate 1B — collector for the canonical node graph.
   *
   * Passed IN rather than returned so `SkuPerTierRollup` keeps its exact shape.
   * That is not cosmetic: the S-7 preservation baseline digests
   * `skuRollups` among five other named keys, so adding a field there would
   * change the digest and make every subsequent step's drift check ambiguous.
   * The graph lands on a new TOP-LEVEL key instead, which the digest does not
   * select — so "no commercial number moved" stays a clean signal while the
   * graph is built out.
   */
  graphSink?: CostingNode[];
}): SkuPerTierRollup {
  const {
    sku,
    tier,
    packaging,
    production,
    freightLegs,
    freightLegTiers,
    freightComponentTierCosts = [],
    freightShipmentBreaks = [],
    freightMarkupPct = 0.3,
    effectiveAdj,
    adjustmentCandidates,
    freightMarkupCandidates,
    markupDefaults,
    cellOverride,
    effectiveTarget,
    floor,
    cellTarget,
    graphSink,
  } = args;
  const tierQty = num(tier.qty);

  // ---------- packaging ----------
  // Each packaging line contributes (unit_cost × qty_per_sellable_unit) to
  // the per-unit cost. Markup applies per-line (line.markup_pct, falling
  // back to the line's category default, then to "Other", then to 0.30).
  // OWNERSHIP: the graph. See the derivation below the loop — these scalars
  // are projections of the packaging nodes, not a second accumulation running
  // beside them.
  const packagingLineCosts: number[] = [];
  // Gate 1B — nodes are built HERE, while the arithmetic runs, not by a second
  // traversal afterwards. A second traversal reproducing these values is
  // correct the day it is written and silently wrong after the first refactor
  // of either side.
  const packagingLineNodes: CostingNode[] = [];
  for (const p of packaging) {
    const lineCost = num(p.unitCost) * num(p.qtyPerSellableUnit, 1);
    packagingLineCosts.push(lineCost);
    const resolution = resolveMarkup({
      defaults: markupDefaults,
      category: p.category,
      lineMarkupPct: p.markupPct,
    });
    // Preserves the original expression exactly, including its NULLITY check:
    // a line markup of 0 is a decision and must beat the category default.
    const markup = p.markupPct !== null ? p.markupPct : resolution.value;
    const lineSell = lineCost * (1 + markup);

    const base = nodeKey(sku.id, tier.id, "pkg", p.lineGroupId);
    packagingLineNodes.push({
      key: base,
      kind: "markup",
      label: p.category ? `Packaging · ${p.category}` : "Packaging line",
      value: lineSell,
      unit: "usd",
      op: `$${lineCost} cost × (1 + ${markup} markup)`,
      operands: [
        {
          key: nodeKey(base, "cost"),
          kind: "origin",
          label: "Line unit cost",
          value: lineCost,
          unit: "usd",
          // A-2 remains open: actor / timestamp / document per input type is
          // not yet resolved, so provenance is declared THIN rather than
          // invented. A thin terminal states an absence; it must never be
          // rendered as sourced.
          origin: { grade: "thin", actor: null, when: null, doc: null },
        },
        {
          key: nodeKey(base, "markup"),
          kind: "resolution",
          label: "Line markup",
          value: markup,
          unit: "pct",
          op: "line ?? category default ?? Other ?? firm fallback",
          candidates: resolution.candidates.map((c) => ({
            label: c.label,
            value: c.value,
            // The chosen rung is the one the ENGINE used, which is not always
            // the resolver's winner: a line markup of 0 wins here while
            // resolveMarkup, called without it, would pick the category
            // default. Marking the resolver's winner would state the wrong
            // provenance on exactly those lines.
            chosen: p.markupPct !== null ? c.label === "Line override" : c.chosen,
            unavailableReason: c.unavailableReason,
          })),
        },
      ],
    });
  }
  const packagingNode: CostingNode = {
    key: nodeKey(sku.id, tier.id, "pkg"),
    kind: "sum",
    label: "Packaging",
    // The node's value is its operands, which is what a `sum` means. Reading a
    // separately-accumulated total here would let the node and the scalar
    // drift while each looked individually correct — the exact failure this
    // whole gate exists to remove.
    value: packagingLineNodes.reduce((acc, n) => acc + n.value, 0),
    unit: "usd",
    op: `Σ ${packagingLineNodes.length} line${packagingLineNodes.length === 1 ? "" : "s"}`,
    operands: packagingLineNodes,
  };
  const cellSections: CostingNode[] = [packagingNode];

  // ---------- OWNERSHIP TRANSITION 1 of 6 · Packaging ----------
  // The rollup scalars now READ the graph. Summation order is unchanged —
  // operands are reduced in the order they were pushed, which is the order the
  // loop accumulated in — so the float result is identical, and S-7 says so
  // rather than the comment claiming it.
  const packagingMarkupSum = packagingNode.value;
  const packagingCostSum = packagingLineCosts.reduce((acc, c) => acc + c, 0);

  // ---------- production ----------
  // Per-tier amortization: divide production lump amounts by
  // quoted tier quantity. When tier.qty is 0 the per-unit
  // amortization is undefined; treat as 0 (no contribution).
  let productionCostSum = 0;
  let separateServiceFees = 0;
  let rawCost = 0;
  // Gate 1B increment 2 — hoisted so the node emitter can read the SAME values
  // the arithmetic produced. Nothing is recomputed; these are the identical
  // expressions, lifted out of the block scope.
  let internalProductionCogsTotal = 0;
  let oneTimeServiceFeeTotal = 0;
  let internalProductionCogsPerUnit = 0;
  let allocatedServiceFeesPerUnit = 0;
  let bulkRawTotal = 0;
  // `rawCost` is 0 in two DIFFERENT situations — nothing was entered, or a
  // decision excluded what was entered. The scalar cannot tell them apart,
  // which is exactly why `flagged-out` is a kind rather than a zero.
  let rawExcludedByCustomerShipping = false;
  // The run TOTALS are formed unconditionally, because they are facts about
  // what was entered and do not depend on the tier having a quantity. Only the
  // per-unit amortization is guarded — dividing by zero units is what is
  // undefined, not the sum of the fees.
  //
  // This was a defect the graph invariants caught: with the totals computed
  // only inside the guard, a zero-quantity tier emitted a one-time-services
  // node valued 0 whose operands summed to 2000. The node contradicted its own
  // operands, which is precisely the R6 failure the reconciliation assertion
  // exists to prevent — and it is also the wrong ANSWER for an operator asking
  // why production is zero. The fees really do total 2000; the allocation
  // yields zero because there are no units to spread them over, and that is
  // the explanation worth showing.
  //
  // No commercial value moves: these totals feed only the guarded per-unit
  // divisions below.
  internalProductionCogsTotal =
    num(production?.fillingBlendingCost) + num(production?.cmAssemblyTotal);
  oneTimeServiceFeeTotal =
    num(production?.setupFeeTotal) +
    num(production?.toolingArtworkTotal) +
    num(production?.rdTotal) +
    num(production?.otherServiceTotal);
  if (production && tierQty > 0) {
    // Customer quote pricing is always based on the quoted tier quantity.
    // Actual output belongs to operational reconciliation and must not mutate
    // the pricing that becomes a sent customer snapshot.
    const denom = tierQty;
    internalProductionCogsPerUnit =
      denom > 0 ? internalProductionCogsTotal / denom : 0;
    allocatedServiceFeesPerUnit =
      production.allocateServiceFeesToCost && denom > 0
        ? oneTimeServiceFeeTotal / denom
        : 0;

    // Filling/blending and CM assembly always remain internal COGS.
    // Allocation-off one-time fees are projected exactly once by the
    // customer-view resolver, outside unit cost and unit sell.
    productionCostSum =
      internalProductionCogsPerUnit + allocatedServiceFeesPerUnit;
    separateServiceFees = 0;

    rawExcludedByCustomerShipping = production.customerShipsRaws;
    if (!production.customerShipsRaws) {
      const bulk = num(production.bulkRawCost);
      rawCost = denom > 0 ? bulk / denom : 0;
    }
  }
  // Same class of fact as the totals above, and retained for the same reason:
  // the flagged-out node states WHAT was excluded, and a reason without the
  // amount tells an operator that something was left out but not what it
  // would have cost them.
  bulkRawTotal = num(production?.bulkRawCost);
  rawExcludedByCustomerShipping = Boolean(production?.customerShipsRaws);

  const productionMarkup = lookupMarkup(
    markupDefaults,
    PRODUCTION_MARKUP_CATEGORY,
  );
  const rawMarkup = lookupMarkup(
    markupDefaults,
    RAW_MARKUP_CATEGORY,
    "Other",
  );

  // Retained under a private name: these are the values the NODES are built
  // from, and the exported scalars below are derived from the nodes rather
  // than from here. Two names for the same arithmetic would be a second
  // accumulation, which is the thing ownership is being moved away from.
  const productionMarkupSumFromInputs = productionCostSum * (1 + productionMarkup);
  const rawMarkupSumFromInputs = rawCost * (1 + rawMarkup);
  const separateServicesMarkupSum = separateServiceFees * (1 + productionMarkup);

  // ---------- production + bulk raw nodes (Gate 1B increment 2) ----------
  let productionSectionNode: CostingNode | undefined;
  let rawSectionNode: CostingNode | undefined;
  {
    const prodBase = nodeKey(sku.id, tier.id, "prod");
    const money = (v: number) => "$" + v;
    const originNode = (key: string, label: string, value: number): CostingNode => ({
      key,
      kind: "origin",
      label,
      value,
      unit: "usd",
      // A-2 still open — provenance is stated as absent rather than invented.
      origin: { grade: "thin", actor: null, when: null, doc: null },
    });

    // COGS per unit is an ALLOCATION, not a sum: its operands are run TOTALS
    // and the operation is the division. R10's map is explicit that these
    // inputs are run totals rather than per-unit, which is exactly the thing
    // an operator would otherwise assume wrongly.
    const cogsNode: CostingNode = {
      key: nodeKey(prodBase, "cogs"),
      kind: "allocation",
      label: "COGS per unit",
      value: internalProductionCogsPerUnit,
      unit: "usd",
      divisor: tierQty,
      op:
        "(" + money(num(production?.fillingBlendingCost)) + " filling + " +
        money(num(production?.cmAssemblyTotal)) + " assembly) / " + tierQty + " units",
      operands: [
        originNode(nodeKey(prodBase, "cogs", "filling"), "Filling + blending", num(production?.fillingBlendingCost)),
        originNode(nodeKey(prodBase, "cogs", "assembly"), "CM assembly", num(production?.cmAssemblyTotal)),
      ],
    };

    const oneTimeNode: CostingNode = {
      key: nodeKey(prodBase, "services", "total"),
      kind: "sum",
      label: "One-time services",
      value: oneTimeServiceFeeTotal,
      unit: "usd",
      op: "setup + tooling + R&D + other",
      operands: [
        originNode(nodeKey(prodBase, "services", "setup"), "Setup", num(production?.setupFeeTotal)),
        originNode(nodeKey(prodBase, "services", "tooling"), "Tooling + artwork", num(production?.toolingArtworkTotal)),
        originNode(nodeKey(prodBase, "services", "rd"), "R&D", num(production?.rdTotal)),
        originNode(nodeKey(prodBase, "services", "other"), "Other services", num(production?.otherServiceTotal)),
      ],
    };

    const allocateOn = Boolean(production?.allocateServiceFeesToCost);
    const allocatedNode: CostingNode = {
      key: nodeKey(prodBase, "services"),
      kind: "allocation",
      label: "Allocated services per unit",
      value: allocatedServiceFeesPerUnit,
      unit: "usd",
      divisor: tierQty,
      op: money(oneTimeServiceFeeTotal) + " one-time / " + tierQty + " units",
      operands: [oneTimeNode],
    };

    // THE SHAPE CHANGES, not only the numbers. With allocation off the
    // allocated-services operand disappears from the chain entirely and
    // production cost becomes COGS alone; one-time fees then bill as separate
    // fixed charges rather than entering the per-unit price. Rendering a zero
    // operand instead would say those fees ARE in the price, at zero — a
    // different statement, and a false one.
    const productionCostNode: CostingNode = {
      key: nodeKey(prodBase, "cost"),
      kind: "sum",
      label: "Production cost per unit",
      value: productionCostSum,
      unit: "usd",
      op: allocateOn ? "COGS/unit + allocated services/unit" : "COGS/unit",
      operands: allocateOn ? [cogsNode, allocatedNode] : [cogsNode],
      ...(allocateOn
        ? {}
        : {
            note: "One-time fees bill as separate fixed charges and are not part of the per-unit price.",
            noteLevel: "info" as const,
          }),
    };

    const prodMarkupResolution = resolveMarkup({
      defaults: markupDefaults,
      category: PRODUCTION_MARKUP_CATEGORY,
    });
    productionSectionNode = {
      key: prodBase,
      kind: "markup",
      label: "Production",
      value: productionMarkupSumFromInputs,
      unit: "usd",
      // ONE aggregate markup over the whole section. Production has no
      // per-line markup column, so none is shown — reproducing packaging's
      // per-line shape here would be a fabrication.
      op: money(productionCostSum) + " cost x (1 + " + productionMarkup + " markup)",
      operands: [
        productionCostNode,
        {
          key: nodeKey(prodBase, "markup"),
          kind: "resolution",
          label: "Manufacturing markup",
          value: productionMarkup,
          unit: "pct",
          op: "category default ?? Other ?? firm fallback",
          candidates: prodMarkupResolution.candidates,
        },
      ],
    };
    cellSections.push(productionSectionNode);

    // ---------- bulk raw ----------
    const rawBase = nodeKey(sku.id, tier.id, "raw");
    const rawMarkupResolution = resolveMarkup({
      defaults: markupDefaults,
      category: RAW_MARKUP_CATEGORY,
      fallbackCategory: "Other",
    });
    // A-7 / F8: two unconnected representations exist and the quote-level
    // ingredient tree is never passed to this engine. The node carries the
    // pricing-active value and says so, rather than implying the ingredient
    // rows are the arithmetic source of a sell price.
    const RAW_PROVISIONAL =
      "Provisional — the pricing-active bulk raw value. Quote-level ingredient rows are a separate, unconnected representation and are not the arithmetic source of this price.";

    if (rawExcludedByCustomerShipping) {
      // NOT a zero. An input that exists was excluded by a decision. A
      // zero-valued markup node and this node carry different facts, and the
      // scalar alone cannot tell them apart — which is why this is a kind.
      rawSectionNode = {
        key: rawBase,
        kind: "flagged-out",
        label: "Bulk raw",
        value: 0,
        unit: "usd",
        reason:
          "Customer ships raws — " + money(bulkRawTotal) +
          " of bulk raw cost is excluded from the quoted price.",
        note: RAW_PROVISIONAL,
        noteLevel: "warn",
      };
      cellSections.push(rawSectionNode);
    } else {
      rawSectionNode = {
        key: rawBase,
        kind: "markup",
        label: "Bulk raw",
        value: rawMarkupSumFromInputs,
        unit: "usd",
        op: money(rawCost) + " cost x (1 + " + rawMarkup + " markup)",
        note: RAW_PROVISIONAL,
        noteLevel: "warn",
        operands: [
          {
            key: nodeKey(rawBase, "cost"),
            kind: "allocation",
            label: "Bulk raw per unit",
            value: rawCost,
            unit: "usd",
            divisor: tierQty,
            op: money(bulkRawTotal) + " bulk raw / " + tierQty + " units",
            operands: [originNode(nodeKey(rawBase, "cost", "total"), "Bulk raw cost", bulkRawTotal)],
          },
          {
            key: nodeKey(rawBase, "markup"),
            kind: "resolution",
            label: "Raw markup",
            value: rawMarkup,
            unit: "pct",
            op: "category default ?? Other ?? firm fallback",
            candidates: rawMarkupResolution.candidates,
          },
        ],
      };
      cellSections.push(rawSectionNode);
    }
  }

  // ---------- OWNERSHIP TRANSITION 2 of 6 · Production + bulk raw ----------
  // The exported scalars now READ the section nodes. Note what this does NOT
  // change: `productionCostSum` still feeds factory cost below, because factory
  // cost is a COST base and the production node is a SELL value — reading the
  // node there would silently swap a pre-markup base for a post-markup one and
  // inflate every duty and tariff on the quote.
  const productionMarkupSum = productionSectionNode!.value;
  const rawMarkupSum = rawSectionNode!.value;

  // ---------- factory cost ----------
  const factoryCostPerUnit = packagingCostSum + productionCostSum + rawCost;

  // ---------- freight (Slice R6.2 multi-leg model) ----------
  // For each leg in this quote's journey(s), look up the leg's per-tier
  // rate row (`freight_leg_tiers` indexed by (legId, tierId)) and accrue
  // container + customs contribution to this leaf per unit:
  //
  //   container/unit            = leg.totalFreight / effective_units
  //   container_billable/unit   = container/unit × (1 + leg.freight_markup_pct)
  //   effective_units           = leg.unitsInShipment ?? tier.qty
  //
  // Customs eligibility per leg: crosses_international_border AND
  // incoterm = 'DDP'. Eligible legs add D+T against THIS leaf's
  // factoryCost (each leaf carries its own customs-invoice value):
  //
  //   duty/unit                 = factoryCost × leg.customs.duty_pct
  //   duty_billable/unit        = duty/unit × (1 + leg.duty_markup_pct)
  //   tariff/unit               = factoryCost × leg.customs.tariff_pct
  //   tariff_billable/unit      = tariff/unit × (1 + leg.tariff_markup_pct)
  //
  // Markup is on the AMOUNT, not the rate — Cally's tariff-anomaly
  // case requires that PMs can zero `tariff_markup_pct` independently
  // without losing margin on duty or freight.
  //
  // NULL handling: totalFreight null/0 → container = 0 (leg has no
  // rate data for this tier yet). customs JSONB missing keys → 0.
  // effective_units 0 (tier.qty unset and no override) → container = 0.
  const freightLegBreakdowns: FreightLegBreakdown[] = [];
  let totalLandedBefore = 0;
  let totalLandedWithMarkup = 0;
  let totalContainerBefore = 0;
  let totalDutyTariffBefore = 0;
  let totalContainerWithMarkup = 0;
  let totalDutyTariffWithMarkup = 0;
  let customsLegCount = 0;

  // ---------- freight model selection ----------
  // Phase 2 replaced the leg/component/tier freight model with the
  // worksheet model (subcategory -> destination candidates -> quantity
  // breaks). Both models are still resident in the schema during the
  // staged retirement; this is the single point at which one of them
  // is chosen.
  //
  // The rule: presence of ANY worksheet shipment break means the
  // worksheet is authoritative for this quote and the legacy legs are
  // not consulted at all. The two are mutually exclusive by
  // construction — never summed, never merged.
  //
  // Retirement plan: docs/AUTHORITY_TIMELINE.md Era 6.
  // Consumer inventory + removal sequence: the legacy tables are
  // scheduled for drop after V1; until then this predicate is the
  // boundary between the two models.
  const worksheetIsAuthoritative = freightShipmentBreaks.length > 0;
  const legacyLegsShadowed = worksheetIsAuthoritative && freightLegs.length > 0;
  if (legacyLegsShadowed) {
    // Both models carry data for this quote. The worksheet wins, and
    // the legacy legs contribute nothing. This is expected during the
    // retirement window for quotes that predate the cutover, but it is
    // reported because silently discarding cost data is exactly the
    // failure mode a model cutover produces.
    reportLegacyFreightShadowed(freightLegs.length, freightShipmentBreaks.length);
  }
  const activeFreightLegs = worksheetIsAuthoritative ? [] : freightLegs;

  for (const leg of activeFreightLegs) {
    const legTier = freightLegTiers.find(
      (lt) => lt.freightLegId === leg.id && lt.tierId === tier.id,
    );
    const componentCost = freightComponentTierCosts.find(
      (cost) =>
        cost.freightLegId === leg.id &&
        cost.tierId === tier.id &&
        cost.quoteLeafId === sku.canonicalQuoteLeafId,
    );
    const hasComponentMode = freightComponentTierCosts.some(
      (cost) => cost.freightLegId === leg.id && cost.tierId === tier.id,
    );
    const total = hasComponentMode
      ? num(componentCost?.actualFreightCost ?? null)
      : num(legTier?.totalFreight ?? null);
    const effectiveUnits = num(
      componentCost?.effectiveUnits ?? legTier?.unitsInShipment ?? null,
      tierQty,
    );
    const container = total > 0 && effectiveUnits > 0 ? total / effectiveUnits : 0;
    const containerWithMarkup = container * (1 + freightMarkupPct);

    const customsEligible =
      leg.crossesInternationalBorder && leg.incoterm === "DDP";
    let duty = 0;
    let tariff = 0;
    let dutyWithMarkup = 0;
    let tariffWithMarkup = 0;
    if (customsEligible) {
      customsLegCount += 1;
      const dutyPct = num(leg.customs.dutyPct ?? null);
      const tariffPct = num(leg.customs.tariffPct ?? null);
      duty = factoryCostPerUnit * dutyPct;
      tariff = factoryCostPerUnit * tariffPct;
      dutyWithMarkup = duty * (1 + leg.dutyMarkupPct);
      tariffWithMarkup = tariff * (1 + leg.tariffMarkupPct);
    }

    const landedBefore = container + duty + tariff;
    const landedWithMarkup =
      containerWithMarkup + dutyWithMarkup + tariffWithMarkup;

    freightLegBreakdowns.push({
      legId: leg.id,
      legGroupId: leg.legGroupId,
      containerFreightPerUnit: container,
      containerFreightWithMarkupPerUnit: containerWithMarkup,
      dutyPerUnit: duty,
      dutyWithMarkupPerUnit: dutyWithMarkup,
      tariffPerUnit: tariff,
      tariffWithMarkupPerUnit: tariffWithMarkup,
      landedFreightBeforeMarkup: landedBefore,
      landedFreightWithMarkup: landedWithMarkup,
      freightMarkupPct,
      dutyMarkupPct: leg.dutyMarkupPct,
      tariffMarkupPct: leg.tariffMarkupPct,
      customsEligible,
      treatment: leg.treatment,
    });

    totalLandedBefore += landedBefore;
    totalLandedWithMarkup += landedWithMarkup;
    totalContainerBefore += container;
    totalDutyTariffBefore += duty + tariff;
    totalContainerWithMarkup += containerWithMarkup;
    totalDutyTariffWithMarkup += dutyWithMarkup + tariffWithMarkup;
  }

  // Worksheet freight is shipment-centric and assembly-owned. The adapter
  // resolves one deterministic math-leaf carrier for the owning product so the
  // existing leaf-based downstream stack receives the contribution once. SKU
  // membership is intentionally absent from this input and calculation.
  for (const shipment of freightShipmentBreaks) {
    if (shipment.ownerSkuId !== sku.id || shipment.tierId !== tier.id) continue;
    const contribution = computeShipmentContribution(shipment);
    totalLandedBefore += contribution.totalCostPerUnit;
    totalLandedWithMarkup += contribution.totalBillablePerUnit;
    totalContainerBefore += contribution.freightCostPerUnit;
    totalDutyTariffBefore += contribution.dutyCostPerUnit + contribution.tariffCostPerUnit;
    totalContainerWithMarkup += contribution.freightBillablePerUnit;
    totalDutyTariffWithMarkup += contribution.dutyBillablePerUnit + contribution.tariffBillablePerUnit;
  }

  // ---------- freight nodes (Gate 1B increment 3) ----------
  // Two models are resident during the staged retirement and they have
  // genuinely different SHAPES, not just different numbers:
  //
  //   legacy legs  duty is a PERCENTAGE of factory cost      -> rate nodes
  //   worksheet    duty is an entered AMOUNT in dollars      -> allocation
  //
  // Emitting rate nodes for the worksheet would assert a percentage nobody
  // entered. The graph follows whichever model the engine actually used.
  {
    const frtBase = nodeKey(sku.id, tier.id, "frt");
    const money = (v: number) => "$" + v;
    const originUsd = (key: string, label: string, value: number): CostingNode => ({
      key, kind: "origin", label, value, unit: "usd",
      origin: { grade: "thin", actor: null, when: null, doc: null },
    });
    const originPct = (key: string, label: string, value: number): CostingNode => ({
      key, kind: "origin", label, value, unit: "pct",
      origin: { grade: "thin", actor: null, when: null, doc: null },
    });
    const FACTORY_BASIS_LABEL = "Factory cost per unit (packaging + production + bulk raw)";

    const shipmentNodes: CostingNode[] = [];

    for (const b of freightLegBreakdowns) {
      const legBase = nodeKey(frtBase, "leg", b.legId);
      const parts: CostingNode[] = [];

      parts.push({
        key: nodeKey(legBase, "container"),
        kind: "markup",
        label: "Container freight",
        value: b.containerFreightWithMarkupPerUnit,
        unit: "usd",
        op: money(b.containerFreightPerUnit) + " cost x (1 + " + b.freightMarkupPct + " markup)",
        operands: [
          originUsd(nodeKey(legBase, "container", "cost"), "Container freight per unit", b.containerFreightPerUnit),
          // The quote-level freight markup, with the ladder decided upstream
          // where the quote value and the firm default are both visible. The
          // worksheet path below keeps an origin instead, because there the
          // markup is entered per shipment and no ladder exists.
          freightMarkupCandidates
            ? {
                key: nodeKey(legBase, "container", "markup"),
                kind: "resolution" as const,
                label: "Freight markup",
                value: b.freightMarkupPct,
                unit: "pct" as const,
                op: "quote override ?? firm default",
                candidates: freightMarkupCandidates,
              }
            : originPct(nodeKey(legBase, "container", "markup"), "Freight markup", b.freightMarkupPct),
        ],
      });

      if (b.customsEligible) {
        // Duty and tariff compute on FACTORY cost, not on landed cost —
        // freight is deliberately outside the customs base. The basis is
        // stated on the node because an operator cannot otherwise tell
        // whether the right base was used.
        const dutyPct = factoryCostPerUnit !== 0 ? b.dutyPerUnit / factoryCostPerUnit : 0;
        const tariffPct = factoryCostPerUnit !== 0 ? b.tariffPerUnit / factoryCostPerUnit : 0;

        parts.push({
          key: nodeKey(legBase, "duty"),
          kind: "markup",
          label: "Duty",
          value: b.dutyWithMarkupPerUnit,
          unit: "usd",
          // The markup applies to the DOLLARS, not to the percentage. A PM
          // must be able to zero the tariff markup without losing margin on
          // duty or freight, which only works if they are separate nodes.
          op: money(b.dutyPerUnit) + " duty x (1 + " + b.dutyMarkupPct + " markup)",
          operands: [
            {
              key: nodeKey(legBase, "duty", "rate"),
              kind: "rate",
              label: "Duty on factory cost",
              value: b.dutyPerUnit,
              unit: "usd",
              op: money(factoryCostPerUnit) + " factory cost x " + dutyPct,
              basis: { label: FACTORY_BASIS_LABEL, value: factoryCostPerUnit },
              operands: [originPct(nodeKey(legBase, "duty", "pct"), "Duty rate", dutyPct)],
            },
            originPct(nodeKey(legBase, "duty", "markup"), "Duty markup", b.dutyMarkupPct),
          ],
        });

        parts.push({
          key: nodeKey(legBase, "tariff"),
          kind: "markup",
          label: "Tariff",
          value: b.tariffWithMarkupPerUnit,
          unit: "usd",
          op: money(b.tariffPerUnit) + " tariff x (1 + " + b.tariffMarkupPct + " markup)",
          operands: [
            {
              key: nodeKey(legBase, "tariff", "rate"),
              kind: "rate",
              label: "Tariff on factory cost",
              value: b.tariffPerUnit,
              unit: "usd",
              op: money(factoryCostPerUnit) + " factory cost x " + tariffPct,
              basis: { label: FACTORY_BASIS_LABEL, value: factoryCostPerUnit },
              operands: [originPct(nodeKey(legBase, "tariff", "pct"), "Tariff rate", tariffPct)],
            },
            originPct(nodeKey(legBase, "tariff", "markup"), "Tariff markup", b.tariffMarkupPct),
          ],
        });
      }

      shipmentNodes.push({
        key: legBase,
        kind: "sum",
        label: "Freight leg",
        value: b.landedFreightWithMarkup,
        unit: "usd",
        op: b.customsEligible ? "container + duty + tariff" : "container",
        operands: parts,
      });
    }

    for (const shipment of freightShipmentBreaks) {
      if (shipment.ownerSkuId !== sku.id || shipment.tierId !== tier.id) continue;
      const c = computeShipmentContribution(shipment);
      const shipBase = nodeKey(frtBase, "shipment", shipment.freightSubcategoryId);
      const units = num(shipment.tierUnits);

      // Worksheet customs are ENTERED AMOUNTS, so they allocate over units
      // like any other total. No rate node: asserting a percentage here would
      // invent a figure nobody supplied.
      const charge = (
        name: string,
        amount: number | null,
        markupPct: number,
        costPerUnit: number,
        billablePerUnit: number,
      ): CostingNode => ({
        key: nodeKey(shipBase, name),
        kind: "markup",
        label: name === "freight" ? "Freight" : name === "duty" ? "Duty" : "Tariff",
        value: billablePerUnit,
        unit: "usd",
        op: money(costPerUnit) + " cost x (1 + " + markupPct + " markup)",
        operands: [
          {
            key: nodeKey(shipBase, name, "cost"),
            kind: "allocation",
            label: "Per unit",
            value: costPerUnit,
            unit: "usd",
            divisor: units,
            op: money(num(amount)) + " / " + units + " units",
            operands: [originUsd(nodeKey(shipBase, name, "total"), "Entered amount", num(amount))],
          },
          originPct(nodeKey(shipBase, name, "markup"), "Markup", markupPct),
        ],
      });

      shipmentNodes.push({
        key: shipBase,
        kind: "sum",
        label: "Shipment",
        value: c.totalBillablePerUnit,
        unit: "usd",
        op: "freight + duty + tariff",
        operands: [
          charge("freight", shipment.freightAmount, shipment.freightMarkupPct, c.freightCostPerUnit, c.freightBillablePerUnit),
          charge("duty", shipment.dutyAmount, shipment.dutyMarkupPct, c.dutyCostPerUnit, c.dutyBillablePerUnit),
          charge("tariff", shipment.tariffAmount, shipment.tariffMarkupPct, c.tariffCostPerUnit, c.tariffBillablePerUnit),
        ],
      });
    }

    const freightSectionNode: CostingNode = {
      key: frtBase,
      kind: "sum",
      label: "Freight",
      // The node's value is its operands, as a `sum` means. The scalar below
      // then reads the node — the reverse of the arrangement this replaces.
      value: shipmentNodes.reduce((acc, n) => acc + n.value, 0),
      unit: "usd",
      op: shipmentNodes.length === 0 ? "no freight entered" : "sum of " + shipmentNodes.length + " shipment(s)",
      operands: shipmentNodes,
    };
    cellSections.push(freightSectionNode);

    // ---------- OWNERSHIP TRANSITION 3 of 6 · Freight / customs ----------
    // `totalLandedWithMarkup` is the freight scalar that feeds sell, and it now
    // reads the node. Both freight models accumulate into `shipmentNodes` in
    // the same order they accumulated into the scalar, so the float result is
    // identical — S-7 is what says so.
    //
    // The pre-markup companions (totalLandedBefore, totalContainerBefore,
    // totalDutyTariffBefore) deliberately keep accumulating. They are COST
    // bases feeding contribution cost, while every node value on this branch is
    // a post-markup SELL figure. Pointing a cost base at a sell node would
    // inflate margin everywhere and still reconcile, because each number would
    // be individually correct — the precise failure mode this gate exists to
    // remove, arrived at from the other direction.
    totalLandedWithMarkup = freightSectionNode.value;
  }

  // ---------- contribution + required sell ----------
  const contributionCostPerUnit =
    factoryCostPerUnit + totalLandedBefore + separateServiceFees;

  // Required sell stacks each component's pre-global-adj sell, then
  // multiplies by (1 + global_adj). Each component carries its own markup.
  // ---------- OWNERSHIP TRANSITION 4 of 6 · Sell before adjustment ----------
  // Built before the scalar rather than after it. The operands are the section
  // nodes in the order the previous expression added them — packaging,
  // production, bulk raw, freight — so the float result is identical.
  //
  // `separateServicesMarkupSum` contributed a hard zero to that expression and
  // contributes no operand here. Adding zero cannot move a float, and a
  // permanently-zero operand would put a line in front of operators that never
  // means anything.
  const sellBeforeNode: CostingNode = {
    key: nodeKey(sku.id, tier.id, "sell-before"),
    kind: "sum",
    label: "Sell before adjustment",
    value: cellSections.reduce((acc, n) => acc + n.value, 0),
    unit: "usd",
    op: "packaging + production + bulk raw + freight",
    operands: cellSections,
  };
  const sellBeforeAdjustment = sellBeforeNode.value;
  // Slice 9.3 — `computedSellPerUnit` is the pure markup-chain result.
  // Always exposed for UI ("was $X" tooltip on OVR badges).
  // ---------- OWNERSHIP TRANSITION 5 of 6 · Final sell / override ----------
  // The adjustment node is built here, before the scalar, and the scalar reads
  // it. Same expression, same operands, same order.
  const adjustmentNode: CostingNode = {
    key: nodeKey(sku.id, tier.id, "sell"),
    kind: "adjustment",
    label: "Computed sell",
    value: sellBeforeNode.value * (1 + effectiveAdj),
    unit: "usd",
    op: "$" + sellBeforeNode.value + " x (1 + " + effectiveAdj + " adjustment)",
    operands: [
      sellBeforeNode,
      adjustmentCandidates
        ? {
            key: nodeKey(sku.id, tier.id, "adjustment"),
            kind: "resolution",
            label: "Price adjustment",
            value: effectiveAdj,
            unit: "pct",
            // REPLACES, never stacks. Stating it as a ladder is what makes
            // that visible: a global lift does not reach a tier carrying its
            // own adjustment, and arithmetic alone could not say so.
            op: "tier adjustment ?? global adjustment",
            candidates: adjustmentCandidates,
          }
        : {
            key: nodeKey(sku.id, tier.id, "adjustment"),
            kind: "origin",
            label: "Price adjustment",
            value: effectiveAdj,
            unit: "pct",
            origin: { grade: "thin", actor: null, when: null, doc: null },
          },
    ],
  };
  const computedSellPerUnit = adjustmentNode.value;
  // Slice 9.3 — per-cell override is TERMINAL. When set, it replaces
  // computedSellPerUnit entirely; downstream margin/revenue use this
  // value. Action layer rejects override <= 0, so positive value
  // expected here. Defensive guard below handles the bypass case.
  // The ACTIVE root for this cell. When a person set the price, that node IS
  // the answer and the computed chain hangs beneath it as `superseded` —
  // visible, traversable, and demoted. `requiredSellPerUnit` then reads
  // whichever node is active, so the scalar and the graph cannot disagree
  // about which value the quote is actually using.
  const cellRootNode: CostingNode =
    cellOverride !== null
      ? {
          key: nodeKey(sku.id, tier.id, "quoted"),
          kind: "override",
          label: "Quoted sell",
          value: cellOverride,
          unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null },
          superseded: adjustmentNode,
        }
      : adjustmentNode;
  graphSink?.push(cellRootNode);
  const requiredSellPerUnit = cellRootNode.value;
  const sellSource: SellSource = cellOverride !== null ? "cell_override" : "computed";

  // Slice 9.3 belt-and-suspenders: action layer rejects override <= 0,
  // but if a bypass write ever lands a negative `sell_price_override`
  // in the DB, the formula `(neg − pos) / neg = pos` would falsely
  // report positive margin. Guard explicitly: -1 sentinel signals
  // "invalid: negative sell price" so consumers can render an error
  // pill rather than a misleading verdict. Sentinel value chosen
  // because it's outside the legitimate margin range [0, 1) and
  // distinguishes from the existing 0-on-zero-revenue branch.
  const marginPct =
    requiredSellPerUnit > 0
      ? (requiredSellPerUnit - contributionCostPerUnit) / requiredSellPerUnit
      : requiredSellPerUnit < 0
        ? -1
        : 0;
  const revenue = requiredSellPerUnit * tierQty;
  const cost = contributionCostPerUnit * tierQty;

  return {
    tierId: tier.id,
    packagingCostPerUnit: packagingCostSum,
    productionCostPerUnit: productionCostSum,
    rawCostPerUnit: rawCost,
    factoryCostPerUnit,
    freightLegs: freightLegBreakdowns,
    customsLegCount,
    totalLandedFreightBeforeMarkup: totalLandedBefore,
    totalLandedFreightWithMarkup: totalLandedWithMarkup,
    totalContainerFreightBeforeMarkup: totalContainerBefore,
    totalDutyTariffBeforeMarkup: totalDutyTariffBefore,
    // Slice RI.8 Option 2 — per-component marked-up sums.
    packagingMarkupSumPerUnit: packagingMarkupSum,
    productionMarkupSumPerUnit: productionMarkupSum,
    rawMarkupSumPerUnit: rawMarkupSum,
    freightContainerMarkupSumPerUnit: totalContainerWithMarkup,
    freightDutyTariffMarkupSumPerUnit: totalDutyTariffWithMarkup,
    separateServiceFeesPerUnit: separateServiceFees,
    separateServicesMarkupSumPerUnit: separateServicesMarkupSum,
    contributionCostPerUnit,
    computedSellPerUnit,
    requiredSellPerUnit,
    sellSource,
    marginPct,
    // Slice 9.4a — verdict band against effective target (per-quote
    // override or firm) and firm floor. Uses the same computeStatus
    // helper as quote-level blended classification for consistency.
    marginStatus: computeStatus(marginPct, effectiveTarget, floor),
    // Slice 9.4b — competitive verdict against PM-entered client target
    // benchmark. Reads from EFFECTIVE sell (respects per-cell override
    // when set). NULL when no benchmark exists on this cell.
    competitiveStatus: computeCompetitiveStatus(requiredSellPerUnit, cellTarget),
    revenue,
    cost,
  };
}

// Empty per-tier rollup for assemblies before children fold in.
function emptyAssemblyPerTier(tier: CostingTier): SkuPerTierRollup {
  return {
    tierId: tier.id,
    packagingCostPerUnit: 0,
    productionCostPerUnit: 0,
    rawCostPerUnit: 0,
    factoryCostPerUnit: 0,
    freightLegs: [],
    customsLegCount: 0,
    totalLandedFreightBeforeMarkup: 0,
    totalLandedFreightWithMarkup: 0,
    totalContainerFreightBeforeMarkup: 0,
    totalDutyTariffBeforeMarkup: 0,
    packagingMarkupSumPerUnit: 0,
    productionMarkupSumPerUnit: 0,
    rawMarkupSumPerUnit: 0,
    freightContainerMarkupSumPerUnit: 0,
    freightDutyTariffMarkupSumPerUnit: 0,
    separateServiceFeesPerUnit: 0,
    separateServicesMarkupSumPerUnit: 0,
    contributionCostPerUnit: 0,
    computedSellPerUnit: 0,
    requiredSellPerUnit: 0,
    sellSource: "computed",
    marginPct: 0,
    // Empty assembly with no children: 0% margin, classified per
    // standard thresholds. computeStatus(0, target, floor) = BELOW_FLOOR
    // when floor > 0 (the typical case). Acceptable; this row state is
    // visible for ~16ms before children fold in.
    marginStatus: "BELOW_FLOOR",
    // Slice 9.4b — assembly cells never carry a competitive verdict
    // (leaf-only invariant; see rollUpAssemblyPerTier).
    competitiveStatus: null,
    revenue: 0,
    cost: 0,
  };
}

function rollUpAssemblyPerTier(
  tier: CostingTier,
  children: Array<{ rollup: SkuPerTierRollup; qtyPerParent: number }>,
  effectiveTarget: number,
  floor: number,
): SkuPerTierRollup {
  const tierQty = num(tier.qty);
  let contribution = 0;
  let requiredSell = 0;
  // Slice 9.3 — `computedSell` rolls up children's pure-markup values
  // (ignoring any cell overrides on leaves). Used by UI tooltips that
  // want to show "what would this assembly cost if no children were
  // overridden." `requiredSell` rolls up children's effective values
  // (override-where-present, computed-elsewhere) — that's the "real"
  // assembly price the customer would pay.
  let computedSell = 0;
  // Per-component bubble-up so a top-level assembly's per-component
  // values reflect the qty_per_parent chain to every leaf below it.
  // Used by the quote-level cost breakdown in QuoteSummaryCard. Earlier
  // version returned 0 here (assemblies don't have packaging directly,
  // only via children) — the breakdown surfaced wrong totals when the
  // tree was deeper than 1 level. Slice 8 follow-up.
  let packaging = 0;
  let production = 0;
  let raw = 0;
  let landedFreight = 0;
  // Slice RI.8 Option B+ — split bubble-up for cost-stack D+T row.
  let containerFreight = 0;
  let dutyTariff = 0;
  let serviceFees = 0;
  // Slice RI.8 Option 2 — per-component marked-up sums bubble up.
  let packagingMarkup = 0;
  let productionMarkup = 0;
  let rawMarkup = 0;
  let containerFreightMarkup = 0;
  let dutyTariffMarkup = 0;
  let servicesMarkup = 0;
  for (const c of children) {
    contribution += c.rollup.contributionCostPerUnit * c.qtyPerParent;
    requiredSell += c.rollup.requiredSellPerUnit * c.qtyPerParent;
    computedSell += c.rollup.computedSellPerUnit * c.qtyPerParent;
    packaging += c.rollup.packagingCostPerUnit * c.qtyPerParent;
    production += c.rollup.productionCostPerUnit * c.qtyPerParent;
    raw += c.rollup.rawCostPerUnit * c.qtyPerParent;
    landedFreight +=
      c.rollup.totalLandedFreightBeforeMarkup * c.qtyPerParent;
    containerFreight +=
      c.rollup.totalContainerFreightBeforeMarkup * c.qtyPerParent;
    dutyTariff += c.rollup.totalDutyTariffBeforeMarkup * c.qtyPerParent;
    serviceFees += c.rollup.separateServiceFeesPerUnit * c.qtyPerParent;
    packagingMarkup +=
      c.rollup.packagingMarkupSumPerUnit * c.qtyPerParent;
    productionMarkup +=
      c.rollup.productionMarkupSumPerUnit * c.qtyPerParent;
    rawMarkup += c.rollup.rawMarkupSumPerUnit * c.qtyPerParent;
    containerFreightMarkup +=
      c.rollup.freightContainerMarkupSumPerUnit * c.qtyPerParent;
    dutyTariffMarkup +=
      c.rollup.freightDutyTariffMarkupSumPerUnit * c.qtyPerParent;
    servicesMarkup +=
      c.rollup.separateServicesMarkupSumPerUnit * c.qtyPerParent;
  }
  const marginPct =
    requiredSell > 0 ? (requiredSell - contribution) / requiredSell : 0;
  return {
    tierId: tier.id,
    packagingCostPerUnit: packaging,
    productionCostPerUnit: production,
    rawCostPerUnit: raw,
    factoryCostPerUnit: packaging + production + raw,
    freightLegs: [],
    // Assembly rollups don't carry their own customs-leg count.
    // The leaf rollup is where customsLegCount is meaningful;
    // assembly-level UI reads from leaf rows.
    customsLegCount: 0,
    totalLandedFreightBeforeMarkup: landedFreight,
    // Markup-applied freight isn't roll-up-meaningful at the assembly
    // level (markup math runs per-line on leaves); skip.
    totalLandedFreightWithMarkup: 0,
    totalContainerFreightBeforeMarkup: containerFreight,
    totalDutyTariffBeforeMarkup: dutyTariff,
    // Slice RI.8 Option 2 — per-component marked-up bubble-up.
    packagingMarkupSumPerUnit: packagingMarkup,
    productionMarkupSumPerUnit: productionMarkup,
    rawMarkupSumPerUnit: rawMarkup,
    freightContainerMarkupSumPerUnit: containerFreightMarkup,
    freightDutyTariffMarkupSumPerUnit: dutyTariffMarkup,
    separateServiceFeesPerUnit: serviceFees,
    separateServicesMarkupSumPerUnit: servicesMarkup,
    contributionCostPerUnit: contribution,
    computedSellPerUnit: computedSell,
    requiredSellPerUnit: requiredSell,
    // Slice 9.3 — `sellSource` on assembly rollups is always
    // "computed". Overrides exist only at the leaf-cell level
    // (per-cell schema is `quote_sku_tiers (quote_sku_id, tier_id)`
    // with FK to leaf SKUs). When children are mixed (some
    // overridden, some computed), the assembly's rolled-up
    // `requiredSellPerUnit` reflects that mix in the value, but the
    // tag stays "computed" because no override sits on the assembly
    // cell itself. UI: don't render OVR badge on assembly rows.
    sellSource: "computed",
    marginPct,
    // Slice 9.4a — verdict band on assembly cells classifies the
    // rolled-up margin against the same thresholds as leaf cells.
    // Reflects the blended mix of children (overridden + computed).
    marginStatus: computeStatus(marginPct, effectiveTarget, floor),
    // Slice 9.4b — assembly cells never carry a competitive verdict.
    // Client targets are leaf-only (matches Slice 9.3 sell-price-
    // override invariant); the math layer doesn't compute against
    // assembly-level targets even if input.cellTargets contained one
    // (impossible via the action layer guard, possible only via direct
    // DB write). Quote-level client targets land in Slice 9.4c.
    competitiveStatus: null,
    revenue: requiredSell * tierQty,
    cost: contribution * tierQty,
  };
}

// ---------- entry ----------

export function computeQuoteCosting(input: QuoteCostingInput): QuoteCostingResult {
  const { quote, firmSettings, markupDefaults, skus, tiers } = input;
  // Gate 1B — one collector per evaluation. Filled while the engine computes;
  // never re-traversed afterwards.
  const graphNodes: CostingNode[] = [];
  const globalAdj = num(quote.globalPriceAdjPct);
  // Slice 9.2 — verdict bands use the per-quote target override when
  // set, otherwise firm-level target. Floor stays firm-level always
  // (admin only). See top-of-file comment for the effective-value
  // pattern.
  const effectiveTarget =
    quote.targetMarginPct !== null && quote.targetMarginPct !== undefined
      ? num(quote.targetMarginPct)
      : firmSettings.targetMarginPct;

  // Build child-by-parent map for tree walking.
  const skusById = new Map(skus.map((s) => [s.id, s]));
  const childrenByParent = new Map<string | null, CostingSku[]>();
  for (const s of skus) {
    const arr = childrenByParent.get(s.parentSkuId) ?? [];
    arr.push(s);
    childrenByParent.set(s.parentSkuId, arr);
  }
  // Sort siblings by sort_order, then label.
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.skuLabel.localeCompare(b.skuLabel));
  }

  // Index inputs for fast lookup.
  const packagingBySku = new Map<string, CostingPackagingInput[]>();
  for (const p of input.packaging) {
    const arr = packagingBySku.get(p.quoteSkuId) ?? [];
    arr.push(p);
    packagingBySku.set(p.quoteSkuId, arr);
  }
  const productionBySkuTier = new Map<string, CostingProductionInput>();
  for (const p of input.production) {
    productionBySkuTier.set(`${p.quoteSkuId}::${p.tierId}`, p);
  }
  // Slice R6.2 — freight is per-quote, not per-SKU. Every leaf at a
  // given tier sees the same legs; computeLeafPerTier filters
  // freightLegTiers by tierId internally. legs are sorted by their
  // group + display_order so the per-leg breakdown surfaces in
  // journey-narrative order.
  const sortedLegs = [...input.freightLegs].sort((a, b) => {
    if (a.legGroupId !== b.legGroupId) {
      const ga = input.freightLegGroups.find((g) => g.id === a.legGroupId);
      const gb = input.freightLegGroups.find((g) => g.id === b.legGroupId);
      return (ga?.displayOrder ?? 0) - (gb?.displayOrder ?? 0);
    }
    return a.displayOrder - b.displayOrder;
  });
  // Slice 9.3 — per-cell sell-price overrides indexed by `${skuId}::${tierId}`.
  // Sparse: cells without overrides have no entry; lookup returns
  // undefined → null cellOverride → use computed sell.
  const cellOverridesBySkuTier = new Map<string, number>();
  for (const c of input.cellOverrides ?? []) {
    cellOverridesBySkuTier.set(`${c.quoteSkuId}::${c.tierId}`, c.sellPriceOverride);
  }
  // Slice 9.4b — per-cell client target benchmarks indexed by the same
  // composite key shape. Mirror sparse pattern; lookup returns undefined
  // → null cellTarget → competitiveStatus null (NULL-as-empty-signal).
  const cellTargetsBySkuTier = new Map<string, number>();
  for (const c of input.cellTargets ?? []) {
    cellTargetsBySkuTier.set(`${c.quoteSkuId}::${c.tierId}`, c.clientTargetPricePerUnit);
  }

  // DFS produces post-order traversal (children before parents) so
  // assemblies see their children's per-tier rollups when they roll up.
  const skuRollups: SkuRollup[] = [];
  const rollupBySku = new Map<string, SkuRollup>();

  function visit(sku: CostingSku, depth: number) {
    if (sku.skuRole === "leaf") {
      const perTier: SkuPerTierRollup[] = tiers.map((tier) => {
        const pkgs = (packagingBySku.get(sku.id) ?? []).filter(
          (p) => p.tierId === tier.id,
        );
        const prod = productionBySkuTier.get(`${sku.id}::${tier.id}`) ?? null;
        // Slice 9.2 — per-tier price-adjustment override REPLACES
        // global (does not stack). NULL = inherit global.
        const effectiveAdj =
          tier.tierPriceAdjPct !== null && tier.tierPriceAdjPct !== undefined
            ? num(tier.tierPriceAdjPct)
            : globalAdj;
        // Slice 9.3 — per-cell override lookup. undefined → null →
        // computeLeafPerTier uses computed sell. Map.get returning the
        // primitive number means the cell has an override.
        const cellOverrideValue = cellOverridesBySkuTier.get(
          `${sku.id}::${tier.id}`,
        );
        const cellOverride =
          cellOverrideValue !== undefined ? cellOverrideValue : null;
        // Slice 9.4b — per-cell client target lookup. Same pattern;
        // undefined → null → competitiveStatus null.
        const cellTargetValue = cellTargetsBySkuTier.get(
          `${sku.id}::${tier.id}`,
        );
        const cellTarget =
          cellTargetValue !== undefined ? cellTargetValue : null;
        // Both ladders are built HERE, and only here, because this is the
        // one place where the losing candidate is still visible. Downstream
        // only the winner arrives, and a ladder built there would have to
        // invent the rung it replaced.
        const tierAdjSet =
          tier.tierPriceAdjPct !== null && tier.tierPriceAdjPct !== undefined;
        const adjustmentCandidates: NodeCandidate[] = [
          {
            label: "Tier adjustment",
            value: tierAdjSet ? num(tier.tierPriceAdjPct) : null,
            chosen: tierAdjSet,
            unavailableReason: tierAdjSet ? null : "no tier adjustment set",
          },
          {
            label: "Global adjustment",
            value: globalAdj,
            chosen: !tierAdjSet,
            // The rule the ladder exists to make visible: these REPLACE rather
            // than stack, so a tier carrying its own adjustment is untouched by
            // a change to the global one.
            unavailableReason: tierAdjSet
              ? "replaced by the tier adjustment, which does not stack"
              : null,
          },
        ];
        const quoteFreightMarkupSet =
          input.quote.freightMarkupPct !== null &&
          input.quote.freightMarkupPct !== undefined;
        const freightMarkupCandidates: NodeCandidate[] = [
          {
            label: "Quote freight markup",
            value: quoteFreightMarkupSet ? num(input.quote.freightMarkupPct) : null,
            chosen: quoteFreightMarkupSet,
            unavailableReason: quoteFreightMarkupSet ? null : "not set on this quote",
          },
          {
            label: "Firm default",
            value: 0.3,
            chosen: !quoteFreightMarkupSet,
            unavailableReason: null,
          },
        ];
        return computeLeafPerTier({
          sku,
          tier,
          packaging: pkgs,
          production: prod,
          freightLegs: sortedLegs,
          freightLegTiers: input.freightLegTiers,
          freightComponentTierCosts: input.freightComponentTierCosts ?? [],
          freightShipmentBreaks: input.freightShipmentBreaks ?? [],
          freightMarkupPct: input.quote.freightMarkupPct ?? 0.3,
          effectiveAdj,
          adjustmentCandidates,
          freightMarkupCandidates,
          graphSink: graphNodes,
          markupDefaults,
          cellOverride,
          effectiveTarget,
          floor: firmSettings.floorMarginPct,
          cellTarget,
        });
      });
      const rollup: SkuRollup = {
        skuId: sku.id,
        skuRole: sku.skuRole,
        parentSkuId: sku.parentSkuId,
        indentDepth: depth,
        skuLabel: sku.skuLabel,
        productName: sku.productName,
        qtyPerParent: sku.qtyPerParent,
        perTier,
      };
      skuRollups.push(rollup);
      rollupBySku.set(sku.id, rollup);
      return;
    }
    // assembly: visit children first
    const kids = childrenByParent.get(sku.id) ?? [];
    for (const k of kids) visit(k, depth + 1);
    const childRollups = kids.map((k) => ({
      sku: k,
      rollup: rollupBySku.get(k.id)!,
    }));
    const perTier: SkuPerTierRollup[] = tiers.map((tier) => {
      if (childRollups.length === 0) return emptyAssemblyPerTier(tier);
      const childTierRollups = childRollups.map(({ sku: k, rollup: r }) => ({
        rollup: r.perTier.find((pt) => pt.tierId === tier.id)!,
        qtyPerParent: num(k.qtyPerParent, 1),
      }));
      // Slice 9.4b — assemblies don't read cellTargets (leaf-only
      // invariant; see rollUpAssemblyPerTier comment).
      return rollUpAssemblyPerTier(
        tier,
        childTierRollups,
        effectiveTarget,
        firmSettings.floorMarginPct,
      );
    });
    const rollup: SkuRollup = {
      skuId: sku.id,
      skuRole: sku.skuRole,
      parentSkuId: sku.parentSkuId,
      indentDepth: depth,
      skuLabel: sku.skuLabel,
      productName: sku.productName,
      qtyPerParent: sku.qtyPerParent,
      perTier,
    };
    skuRollups.push(rollup);
    rollupBySku.set(sku.id, rollup);
  }

  for (const root of childrenByParent.get(null) ?? []) visit(root, 0);

  // Sort to render order: depth-first by traversal order. We've pushed
  // children before parents (post-order), but UIs expect pre-order
  // (parent first). Re-sort by walking the tree top-down.
  const renderOrdered: SkuRollup[] = [];
  function emitTree(skuId: string) {
    const r = rollupBySku.get(skuId);
    if (!r) return;
    renderOrdered.push(r);
    const kids = childrenByParent.get(skuId) ?? [];
    for (const k of kids) emitTree(k.id);
  }
  for (const root of childrenByParent.get(null) ?? []) emitTree(root.id);

  // Quote-level rollup: sum across top-level (parent IS NULL) SKUs only.
  const topLevel = childrenByParent.get(null) ?? [];
  const quoteRollup: QuotePerTierRollup[] = tiers.map((tier) => {
    // OWNERSHIP 6 of 6 — per-product contributions are collected as node
    // operands and the totals are read from the resulting sum nodes.
    //
    // Deliberately NOT derived from the blend. Recovering a total as
    // `blend x totalWeight` re-multiplies a value that was just divided, and
    // the round trip is not bitwise identical — it would move revenue in the
    // last places for no reason anyone could later explain. The sum is the
    // primitive; the blend divides it.
    const revenueOperands: CostingNode[] = [];
    const costOperands: CostingNode[] = [];
    // Per-component breakdown: aggregate the rolled-up per-component
    // values × tier.qty across top-level SKUs. The assembly rollup
    // (rollUpAssemblyPerTier) bubbles per-component up the tree
    // respecting qty_per_parent, so summing top-level here is correct.
    const breakdown: QuoteCostBreakdown = {
      packaging: 0,
      production: 0,
      freight: 0,
      serviceFees: 0,
      freightContainer: 0,
      dutyAndTariff: 0,
      packagingMarkupSum: 0,
      productionMarkupSum: 0,
      rawMarkupSum: 0,
      freightContainerMarkupSum: 0,
      dutyAndTariffMarkupSum: 0,
      separateServicesMarkupSum: 0,
    };
    for (const top of topLevel) {
      const r = rollupBySku.get(top.id);
      if (!r) continue;
      const pt = r.perTier.find((p) => p.tierId === tier.id);
      if (!pt) continue;
      revenueOperands.push({
        key: nodeKey("quote", tier.id, "revenue", top.id),
        kind: "origin",
        label: top.skuLabel,
        value: pt.revenue,
        unit: "usd",
        origin: { grade: "thin", actor: null, when: null, doc: null },
      });
      costOperands.push({
        key: nodeKey("quote", tier.id, "cost-total", top.id),
        kind: "origin",
        label: top.skuLabel,
        value: pt.cost,
        unit: "usd",
        origin: { grade: "thin", actor: null, when: null, doc: null },
      });
      const tQty = num(tier.qty);
      breakdown.packaging += pt.packagingCostPerUnit * tQty;
      // raw bulk cost folds into "production" for breakdown purposes
      // (see QuoteCostBreakdown comment).
      breakdown.production +=
        (pt.productionCostPerUnit + pt.rawCostPerUnit) * tQty;
      breakdown.freight += pt.totalLandedFreightBeforeMarkup * tQty;
      // Slice RI.8 Option B+ — D+T cost-stack row reads dutyAndTariff;
      // FRT row reads freightContainer. `freight` stays as the
      // backwards-compat sum (= freightContainer + dutyAndTariff).
      breakdown.freightContainer +=
        pt.totalContainerFreightBeforeMarkup * tQty;
      breakdown.dutyAndTariff += pt.totalDutyTariffBeforeMarkup * tQty;
      breakdown.serviceFees += pt.separateServiceFeesPerUnit * tQty;
      // Slice RI.8 Option 2 — per-component marked-up sums.
      breakdown.packagingMarkupSum +=
        pt.packagingMarkupSumPerUnit * tQty;
      // raw markup folds into productionMarkup (mirrors cost-side
      // folding above).
      breakdown.productionMarkupSum +=
        (pt.productionMarkupSumPerUnit + pt.rawMarkupSumPerUnit) * tQty;
      breakdown.rawMarkupSum += pt.rawMarkupSumPerUnit * tQty;
      breakdown.freightContainerMarkupSum +=
        pt.freightContainerMarkupSumPerUnit * tQty;
      breakdown.dutyAndTariffMarkupSum +=
        pt.freightDutyTariffMarkupSumPerUnit * tQty;
      breakdown.separateServicesMarkupSum +=
        pt.separateServicesMarkupSumPerUnit * tQty;
    }
    const revenueNode: CostingNode = {
      key: nodeKey("quote", tier.id, "revenue"),
      kind: "sum",
      label: "Total revenue",
      value: revenueOperands.reduce((acc, n) => acc + n.value, 0),
      unit: "usd",
      op: "sum of " + revenueOperands.length + " product(s)",
      operands: revenueOperands,
    };
    const costNode: CostingNode = {
      key: nodeKey("quote", tier.id, "cost-total"),
      kind: "sum",
      label: "Total cost",
      value: costOperands.reduce((acc, n) => acc + n.value, 0),
      unit: "usd",
      op: "sum of " + costOperands.length + " product(s)",
      operands: costOperands,
    };
    graphNodes.push(revenueNode, costNode);
    const revenue = revenueNode.value;
    const cost = costNode.value;

    const marginPct = revenue > 0 ? (revenue - cost) / revenue : 0;
    const status = computeStatus(
      marginPct,
      effectiveTarget,
      firmSettings.floorMarginPct,
    );
    // Slice 9.3 — per-tier suggested-adj suppresses when the tier has
    // no GPA-influencable cells. Tier is fully GPA-fixed when:
    //   (a) tier-level price-adj override is set, OR
    //   (b) every leaf SKU in this tier has a per-cell override
    // (a) = "tier override REPLACES global"; (b) = "every cell value
    // is terminal." Either way, GPA changes can't move the tier.
    const tierHasTierAdj =
      tier.tierPriceAdjPct !== null && tier.tierPriceAdjPct !== undefined;
    const leavesInTier = skus.filter((s) => s.skuRole === "leaf");
    const tierAllLeavesOverridden =
      leavesInTier.length > 0 &&
      leavesInTier.every((s) =>
        cellOverridesBySkuTier.has(`${s.id}::${tier.id}`),
      );
    const tierGpaFixed = tierHasTierAdj || tierAllLeavesOverridden;
    const suggested = suggestedAdj(
      revenue,
      cost,
      globalAdj,
      effectiveTarget,
      tierGpaFixed,
    );
    return {
      tierId: tier.id,
      label: tier.label,
      qty: num(tier.qty),
      totalRevenue: revenue,
      totalCost: cost,
      costBreakdown: breakdown,
      blendedMarginPct: marginPct,
      blendedMarginStatus: status,
      suggestedGlobalAdjPct: suggested,
    };
  });

  // Slice 9.3 — quote-wide blended verdict + system-suggested GPA.
  // Sums across all top-level SKUs/tiers, then partitions cells into
  // GPA-fixed (FIXED) vs GPA-influencable (SOLVE) for the closed-form
  // reverse-solve. Cells walked here are TOP-LEVEL (parent IS NULL)
  // SKU × tier pairs — same units as quoteRollup totals so the partition
  // sums match blended totals exactly.
  //
  // Cell `gpaFixed` true when:
  //   - tier has tier_price_adj_pct set (tier override REPLACES global), OR
  //   - top-level SKU is a leaf with a per-cell sell_price_override at this
  //     tier (cell override is terminal — bypasses both layers above), OR
  //   - top-level SKU is an assembly AND every leaf descendant in this
  //     tier has a per-cell override (every contributing cell is terminal)
  //
  // See computeQuoteSuggestion for the full degenerate-case matrix.
  let blendedRevenue = 0;
  let blendedCost = 0;
  const perCellForSuggestion: Array<{
    revenue: number;
    cost: number;
    gpaFixed: boolean;
  }> = [];

  // Recursive helper: every leaf descendant of `skuId` has a cell
  // override at `tierId`. Used to classify top-level assemblies as
  // GPA-fixed when their entire leaf-cell footprint is overridden.
  function allLeafDescendantsOverridden(skuId: string, tierId: string): boolean {
    const sku = skusById.get(skuId);
    if (!sku) return false;
    if (sku.skuRole === "leaf") {
      return cellOverridesBySkuTier.has(`${skuId}::${tierId}`);
    }
    const kids = childrenByParent.get(skuId) ?? [];
    if (kids.length === 0) return false;
    return kids.every((k) => allLeafDescendantsOverridden(k.id, tierId));
  }

  const topLevelSkus = childrenByParent.get(null) ?? [];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const qr = quoteRollup[i];
    blendedRevenue += qr.totalRevenue;
    blendedCost += qr.totalCost;
    const tierHasAdj =
      t.tierPriceAdjPct !== null && t.tierPriceAdjPct !== undefined;
    for (const top of topLevelSkus) {
      const r = rollupBySku.get(top.id);
      if (!r) continue;
      const pt = r.perTier.find((p) => p.tierId === t.id);
      if (!pt) continue;
      let gpaFixed = false;
      if (tierHasAdj) {
        gpaFixed = true;
      } else if (top.skuRole === "leaf") {
        gpaFixed = cellOverridesBySkuTier.has(`${top.id}::${t.id}`);
      } else {
        // Top-level assembly: GPA-fixed only when EVERY leaf descendant
        // in this tier has an override. Approximation note for v1:
        // partial-override assemblies (some leaves overridden, others
        // not) are classified as GPA-influencable here. The closed-form
        // solve then treats the assembly's entire rolled-up revenue as
        // GPA-influencable, which slightly overestimates how much GPA
        // can move it (the override portion is actually terminal). At
        // typical Nexus quote shapes (few assemblies, mostly flat top-
        // level leaves), the error is bounded and acceptable. If PMs
        // report mis-suggestion on assembly-heavy quotes, refactor the
        // partition to walk leaves with their qty_per_parent chain.
        gpaFixed = allLeafDescendantsOverridden(top.id, t.id);
      }
      perCellForSuggestion.push({
        revenue: pt.revenue,
        cost: pt.cost,
        gpaFixed,
      });
    }
  }
  const blendedMarginPct =
    blendedRevenue > 0 ? (blendedRevenue - blendedCost) / blendedRevenue : 0;
  const blendedStatus = computeStatus(
    blendedMarginPct,
    effectiveTarget,
    firmSettings.floorMarginPct,
  );
  const {
    suggestedAdj: quoteSuggestedAdj,
    suggestionGoal,
    suggestionMicrocopy,
  } = computeQuoteSuggestion({
    blendedRevenue,
    blendedCost,
    blendedStatus,
    effectiveTarget,
    floor: firmSettings.floorMarginPct,
    globalAdj,
    perCellBreakdown: perCellForSuggestion,
  });
  // ---------- quote-level blend nodes (Gate 1B increment 5) ----------
  //
  // The engine blends by WEIGHTING EACH CONTRIBUTOR BY ITS UNITS at the tier:
  // Sigma(value x units) / Sigma(units). Per-SKU revenue is
  // requiredSellPerUnit x tier.qty, so the weights are the tier quantities and
  // the blend is revenue-weighted by construction.
  //
  // The weights are emitted even though every top-level contributor currently
  // carries the same tier quantity, which makes the mean arithmetically equal
  // to a simple average today. Emitting them as equal-by-observation rather
  // than assuming equality is the difference between a node that proves its
  // result and one that happens to agree with it — and the moment per-SKU
  // quantities diverge, an unweighted mean would be silently wrong.
  for (const tier of tiers) {
    const tierQty = num(tier.qty);
    const contributors: { sku: (typeof topLevel)[number]; pt: SkuPerTierRollup }[] = [];
    const absent: string[] = [];
    for (const top of topLevel) {
      const r = rollupBySku.get(top.id);
      const pt = r?.perTier.find((p) => p.tierId === tier.id);
      if (!pt) {
        // ABSENT is not zero-valued. A product with no rollup at this tier is
        // not in the blend at all; recording it as a zero contributor would
        // drag the mean down by a value nobody entered.
        absent.push(top.id);
        continue;
      }
      contributors.push({ sku: top, pt });
    }

    const blendBase = nodeKey("quote", tier.id);
    const weights = contributors.map(() => tierQty);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const absentNote =
      absent.length > 0
        ? absent.length + " product(s) have no rollup at this tier and are not contributors"
        : undefined;
    const zeroWeightNote =
      totalWeight === 0
        ? "Tier quantity is zero, so there is nothing to weight by; contributors are listed unblended."
        : undefined;

    const blend = (
      name: string,
      label: string,
      pick: (pt: SkuPerTierRollup) => number,
    ): CostingNode => {
      const operands = contributors.map((c) => ({
        key: nodeKey(blendBase, name, c.sku.id),
        kind: "origin" as const,
        label: c.sku.skuLabel,
        value: pick(c.pt),
        unit: "usd" as const,
        origin: { grade: "thin" as const, actor: null, when: null, doc: null },
      }));
      const value =
        totalWeight > 0
          ? operands.reduce((acc, o, i) => acc + o.value * weights[i], 0) / totalWeight
          : 0;
      return {
        key: nodeKey(blendBase, name),
        kind: "blend",
        label,
        value,
        unit: "usd",
        op: "Sigma(value x units) / Sigma(units), across " + operands.length + " product(s)",
        weights,
        operands,
        ...(absentNote || zeroWeightNote
          ? {
              note: [zeroWeightNote, absentNote].filter(Boolean).join(" "),
              noteLevel: "info" as const,
            }
          : {}),
      };
    };

    graphNodes.push({
      key: blendBase,
      kind: "sum",
      label: "Quote blend · " + tier.label,
      // A container for the two blends, not an arithmetic claim of its own —
      // sell and cost do not add to anything meaningful. Value is the sum of
      // its operands so the node reconciles honestly rather than asserting a
      // figure with no interpretation.
      value:
        (totalWeight > 0
          ? contributors.reduce((a, c) => a + c.pt.requiredSellPerUnit * tierQty, 0) / totalWeight
          : 0) +
        (totalWeight > 0
          ? contributors.reduce((a, c) => a + c.pt.contributionCostPerUnit * tierQty, 0) / totalWeight
          : 0),
      unit: "usd",
      op: "blended sell + blended cost",
      operands: [
        blend("sell", "Blended sell per unit", (pt) => pt.requiredSellPerUnit),
        blend("cost", "Blended cost per unit", (pt) => pt.contributionCostPerUnit),
      ],
    });
  }

  const quoteSummary: QuoteSummary = {
    blendedRevenue,
    blendedCost,
    blendedMarginPct,
    blendedMarginStatus: blendedStatus,
    effectiveTargetMarginPct: effectiveTarget,
    suggestedAdj: quoteSuggestedAdj,
    suggestionGoal,
    suggestionMicrocopy,
  };

  return {
    quote: {
      id: quote.id,
      globalPriceAdjPct: globalAdj,
      targetMarginPct:
        quote.targetMarginPct !== null && quote.targetMarginPct !== undefined
          ? num(quote.targetMarginPct)
          : null,
    },
    firmSettings: {
      targetMarginPct: firmSettings.targetMarginPct,
      floorMarginPct: firmSettings.floorMarginPct,
    },
    tiers: tiers.map((t) => ({ tierId: t.id, label: t.label, qty: num(t.qty) })),
    skuRollups: renderOrdered,
    quoteRollup,
    quoteSummary,
    graph: {
      version: GRAPH_VERSION,
      nodes: graphNodes,
      // Derived from what was actually emitted, never from having reached a
      // planned increment. A flag that outruns the graph is worse than a
      // false one: a consumer told the graph is complete stops checking
      // whether the section it needs is there.
      complete: graphIsComplete(graphNodes),
    },
  };
}
