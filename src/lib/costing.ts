import {
  GRAPH_VERSION,
  graphIsComplete,
  nodeKey,
  quoteWideKey,
  type GraphEvaluation,
  type CostingGraph,
  type CostingNode,
  type NodeCandidate,
  priceBuildKey,
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
  /**
   * V1 FREIGHT DISTRIBUTION POLICY · how many products this shipment contains.
   *
   * A shipment's freight is borne EQUALLY by the products explicitly in it, so
   * each member's contribution is `shipment freight / memberCount`. The
   * governed membership boundary is `freight_subcategory_items` — the
   * operator's own record of what is being shipped.
   *
   * The entered amounts below stay WHOLE. Dividing them at the loader would
   * make the trace report an amount nobody entered; the division belongs here,
   * where it can be stated as a step.
   */
  memberCount: number;
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
  /**
   * The shipment MEMBER this portion belongs to — one break per member, not one
   * break per shipment with a chosen owner.
   *
   * Renamed from `ownerSkuId`, and the rename is the point. "Owner" named a
   * single leaf picked as the lowest-position member of the shipment's
   * ASSEMBLY — a set that is not the shipment. On `2f29af72` that attributed a
   * two-product shipment's freight to a third product that was not in it, and
   * the pick moved between a quote and its copy because the positions tie.
   * There is no owner to select now; there are members, and they are governed.
   */
  memberSkuId: string;
  tierId: string;
  treatment: "bundled" | "pass_through";
};

export function computeShipmentContribution(
  input: ShipmentContributionInput,
): ShipmentContribution {
  const units = num(input.tierUnits);
  // Equal split across the shipment's members, then amortised over tier units.
  // `memberCount` of 0 would be a shipment with no members, which cannot arise
  // from a break the loader emitted — it emits one break PER member — but a
  // divide-by-zero here would produce Infinity and reconcile as a number, so
  // it fails to zero instead.
  const members = Math.max(1, Math.trunc(num(input.memberCount, 1)));
  const perUnit = (amount: number | null) =>
    units > 0 ? num(amount) / members / units : 0;
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

/**
 * Phase 3 — the surgical lift. Sparse, one per corrected `(SKU, tier)` cell.
 *
 * **Keyed on `quoteLeafId`, not on the math-leaf id.** Phase 3 §1a is explicit:
 * lifts persist against the canonical commercial attachment while costing
 * inputs may still be keyed through the legacy grouped-membership identity.
 * Resolution happens here, once, and **fails closed** — a lift whose attachment
 * is missing, duplicated or points outside this quote is rejected, not resolved
 * by falling back to a reusable id or an inferred tuple match.
 *
 * **It composes; it does not replace.** Tier and global adjustment are a
 * ladder — one wins. The lift multiplies whatever that ladder produced:
 *
 * ```
 * sell = sell_before x (1 + A) x (1 + lift)        A = tier ?? global
 * ```
 *
 * Why it is separate rather than a third rung: the lift is *corrective* — the
 * firm mandates a floor and this cell breaches it. The adjustment is
 * *commercial* — the operator wants the quote to earn more. They answer to
 * different authorities, so removing one must never disturb the other.
 *
 * **No persistence exists yet** (§13.5 → OD-012). The engine consumes lifts as
 * input, which is enough to preview one, price one, and reject one over an
 * override. Where they are stored is a separate question from what they mean.
 */
/**
 * Why a supplied lift was not applied.
 *
 * `overridden` is the governed case (§13.3): a lift computing over a direct
 * price would silently overturn a deliberate human decision, so it is rejected
 * with a route rather than absorbed. The remaining three are identity failures
 * from Phase 3 §1a, which fail closed by contract.
 */
export type LiftRejection =
  | "overridden"
  | "attachment_unresolved"
  | "attachment_ambiguous"
  | "attachment_foreign";

/** Operator-facing reason per rejection, so the graph carries it, not the UI. */
const LIFT_REJECTION_REASON: Record<LiftRejection, string> = {
  overridden:
    "This cell has a price someone set directly. A lift would silently " +
    "overturn that decision, so it is refused — remove the direct price first.",
  attachment_unresolved:
    "The lift's commercial attachment could not be resolved on this quote.",
  attachment_ambiguous:
    "The lift's commercial attachment resolves to more than one line.",
  attachment_foreign:
    "The lift's commercial attachment belongs to a different quote.",
};

export type CostingLift = {
  /** `quote_leaves.id` — the canonical commercial attachment (OD-014). */
  quoteLeafId: string;
  tierId: string;
  /** Multiplicative, e.g. `0.077` for +7.7%. */
  liftPct: number;
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
  /**
   * Phase 3 surgical lifts. Optional so every existing caller is unchanged and
   * an absent array means exactly what an empty one does — no lifts.
   */
  lifts?: CostingLift[];
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
  // ---------- P3-017 · the ladder, at cell scope ----------
  //
  // The four levels a quoted price passes through, and the three contributions
  // that move it between them. The blend publishes each of these at TIER scope,
  // where the Cost Stack renders, so that every stack row reads a governed node
  // instead of a number the display worked out.
  //
  // THE DELTAS ARE NOT DIFFERENCES OF THE LEVELS, and that is the whole point.
  // Blending is linear over a shared weight vector, so blending differences
  // would give `blend(a - b) === blend(a) - blend(b)` and the reconciliation
  // identity would telescope — true for any four numbers, incapable of failing,
  // decoration rather than an assertion. Each delta is instead computed from
  // the lever's OWN governed authority: the adjustment rate, the lift rate.
  // The identity then holds only if two independent aggregations of the same
  // graph agree, which is a statement that can be false.
  //
  // `overrideDeltaPerUnit` is the exception, and honestly so: an override is
  // terminal — a person's number replacing a computed one — so its
  // contribution IS definitionally the difference it makes. There is no rate to
  // multiply by, and inventing one would be worse than naming the difference.
  sellBeforeAdjustmentPerUnit: number;
  adjDeltaPerUnit: number;
  sellAfterAdjustmentPerUnit: number;
  liftDeltaPerUnit: number;
  sellAfterLiftPerUnit: number;
  overrideDeltaPerUnit: number;
  /**
   * `(sell - cost) / sell` for this cell, or NULL when there is no sell price.
   *
   * Third and last scope to take this correction — quote-wide, per-tier, and
   * now per-cell. The ratio is undefined with nothing in the denominator, and
   * `: 0` asserted a margin of exactly zero percent that then banded
   * BELOW_FLOOR. 143 of 381 production cells carried that fabricated verdict.
   *
   * `-1` remains a distinct sentinel and is NOT this. It guards a bypass write
   * landing a NEGATIVE override, where the formula would report positive
   * margin from two negatives. That is a computed margin that is wrong; this
   * is the absence of one.
   */
  marginPct: number | null;
  // Slice 9.4a — per-(SKU, tier) verdict band, classified against the
  // SAME thresholds as the quote-level blended verdict (effectiveTarget,
  // firmSettings.floorMarginPct). Surfaces on the per-SKU summary row.
  // For assemblies this reflects the rolled-up margin (mix of children).
  //
  // UNAVAILABLE / COST_WITHOUT_REVENUE when the margin is null, by the same
  // governed classification the other two scopes use.
  marginStatus: QuoteMarginStatus;
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
  /**
   * The governed commercial identity of this SKU (OD-014): the quote-scoped
   * leaf attachment, `quote_leaves.id`.
   *
   * NULL on assemblies, which are not commercial lines — Pricing excludes them
   * and the customer is never quoted a price for one.
   *
   * It may also be null on a leaf during the compatibility window, since
   * `CostingSku.canonicalQuoteLeafId` is optional. Consumers that need
   * commercial identity must treat null as "not resolvable" and fail closed
   * rather than falling back to `skuId` — `skuId` is the LEGACY
   * `assembly_leaf_id`, and silently substituting it is precisely the
   * resolution Phase 3 forbids.
   *
   * Carried through from the engine's input, which already had it. It was
   * previously dropped at the output boundary, so no consumer could read
   * commercial identity from a rollup.
   */
  canonicalQuoteLeafId: string | null;
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
  // T-4 (2026-08-11) — bulk raw's COST side, tracked separately.
  //
  // `production` and `productionMarkupSum` fold raw in, and both keep doing so:
  // every existing consumer reads the combined figure and un-folding them would
  // change arithmetic outside the repair's scope. `rawMarkupSum` already
  // existed; this is its cost-side counterpart, so a consumer that needs the
  // two components apart can subtract rather than re-derive.
  //
  // Bulk raw is an independently governed quantity — its own canonical node
  // (`nodeKey(sku, tier, "raw")`), its own markup authority
  // (`RAW_MARKUP_CATEGORY`), its own `cellSections` entry feeding quoted sell.
  // The Costs cost stack shows it as its own section on that basis.
  rawCost: number;
  freightContainerMarkupSum: number;
  dutyAndTariffMarkupSum: number;
  separateServicesMarkupSum: number;
};

/**
 * The three bands a DEFINED margin can occupy.
 *
 * Named separately from `QuoteMarginStatus` because these three are a complete
 * partition of the real line: any number is in exactly one of them. Adding a
 * fourth member here would be a category error — "unavailable" is not a region
 * of the number line, it is the absence of a number.
 */
export type MarginBand = "GOOD" | "BELOW_TARGET" | "BELOW_FLOOR";

/**
 * A margin verdict that may not exist — and, when it does not, two reasons.
 *
 * Both non-band members mean the margin PERCENTAGE is undefined: there is no
 * revenue to take a ratio against, and no arithmetic will produce one. They
 * differ in what that says commercially, and the difference is the whole point
 * of having two:
 *
 * - **`UNAVAILABLE`** — no revenue AND no cost. Nothing has been entered.
 *   Carries no commercial judgement whatsoever; the quote has not been
 *   assessed and must not be counted into any band.
 *
 * - **`COST_WITHOUT_REVENUE`** — no revenue, but cost HAS been incurred. The
 *   percentage is still undefined, but the economics are not ambiguous: every
 *   dollar of that cost is a loss. This must BLOCK commercial clearance.
 *
 * Collapsing the second into the first would hide a certain loss behind
 *   "not assessed yet". Collapsing it into BELOW_FLOOR would be worse in the
 * other direction — that label asserts a computed margin was compared against
 * the floor and lost, and no such comparison happened. Neither existing member
 * can carry it, which is why it is its own.
 *
 * Consumers tallying by band must exclude BOTH, and must not treat them as
 * interchangeable when deciding whether to permit an action.
 */
export type QuoteMarginStatus =
  | MarginBand
  | "UNAVAILABLE"
  | "COST_WITHOUT_REVENUE";

/**
 * The verdict for a zero-revenue position. Never called with revenue > 0.
 *
 * One place decides this, because the quote-wide and per-tier scopes must not
 * be able to disagree about what a zero-revenue position means.
 */
function zeroRevenueStatus(cost: number): QuoteMarginStatus {
  return cost > 0 ? "COST_WITHOUT_REVENUE" : "UNAVAILABLE";
}

export type QuotePerTierRollup = {
  tierId: string;
  label: string;
  qty: number;
  totalRevenue: number;
  totalCost: number;
  costBreakdown: QuoteCostBreakdown;
  /**
   * `(totalRevenue − totalCost) / totalRevenue` for this tier, or NULL.
   *
   * Null at zero tier revenue, for the same reason as the quote-wide margin
   * below: the ratio is undefined, and the previous `: 0` asserted a margin of
   * exactly zero percent which then banded as BELOW_FLOOR. Fifteen tiers across
   * ten quotes carried that fabricated verdict, including two inside quotes
   * that are otherwise fully priced.
   *
   * NOT YET SEEN IN PRODUCTION, and defined anyway: zero revenue with a
   * POSITIVE cost is a certain loss rather than an unpriced tier, and
   * UNAVAILABLE would suppress that signal. All fifteen current instances have
   * zero cost too, so the case is unexercised. If one appears, the right answer
   * is probably a distinct loss signal rather than a margin percentage — the
   * ratio is still undefined, but the loss is real and should be visible.
   */
  blendedMarginPct: number | null;
  /** `UNAVAILABLE` when the margin is null. `computeStatus` is not called. */
  blendedMarginStatus: QuoteMarginStatus;
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
  /**
   * `(blendedRevenue − blendedCost) / blendedRevenue`, or NULL.
   *
   * Null when blended revenue is zero. The ratio is undefined there, and the
   * previous `: 0` fallback did not represent that — it asserted a margin of
   * exactly zero percent, which then flowed into `computeStatus` and came back
   * as BELOW_FLOOR. Eight quotes were reported to breach the firm's margin
   * floor because nobody had entered revenue on them yet, and firm-policy
   * impact analysis counted them as such.
   *
   * A quantity that does not exist cannot be permitted to carry a verdict. Null
   * is the representation that makes every consumer decide what to do about it
   * instead of silently inheriting a number the engine invented.
   */
  blendedMarginPct: number | null;
  /**
   * The verdict, or `UNAVAILABLE` when the margin is null.
   *
   * `computeStatus` is NOT called for an undefined margin — this is not a
   * fourth band computed from the number, it is the statement that no band
   * applies. Callers tallying quotes into GOOD / BELOW_TARGET / BELOW_FLOOR
   * must EXCLUDE these; that exclusion is part of the business contract and is
   * asserted in `tests/unit/quote-margin-undefined.test.ts`.
   */
  blendedMarginStatus: QuoteMarginStatus;
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

/**
 * How a contributing product identifies itself inside a trace.
 *
 * P-PriceBuild-UX2: operands carried `skuLabel` alone, which is the SKU CODE.
 * Three leaves on the walk quote have no SKU recorded, so their rows rendered
 * blank — arithmetic reconciling perfectly between two anonymous numbers, which
 * is worse than a wrong total because nothing about it looks wrong.
 *
 * Name and code are different facts and a product may carry either, so the
 * label takes what exists rather than assuming both. Identity comes from the
 * product's own fields and the node is keyed on its canonical quote-leaf id —
 * never from array position, row order, or matching on value.
 *
 * An unidentifiable product says so. A blank row is indistinguishable from a
 * rendering fault; an explicit unresolved state is a finding someone can act on.
 */
function productIdentityLabel(sku: {
  skuLabel: string;
  productName: string;
  canonicalQuoteLeafId?: string | null;
  id: string;
}): string {
  const name = sku.productName?.trim() ?? "";
  const code = sku.skuLabel?.trim() ?? "";
  if (name && code) return name + " · " + code;
  if (name) return name;
  if (code) return code;
  // Neither. Name the attachment so the row is traceable to something.
  const ref = (sku.canonicalQuoteLeafId ?? sku.id ?? "").slice(0, 8);
  return ref ? "Unresolved product · " + ref : "Unresolved product";
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
  blendedStatus: QuoteMarginStatus;
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

  // No margin, either flavour — there is no gap to close, so there is nothing
  // to propose. The `blendedRevenue <= 0` guard below would reach the same
  // output, but only after picking a goal for a quote that has none.
  //
  // COST_WITHOUT_REVENUE gets no suggestion for a second reason worth stating:
  // the solve is a multiplicative lift on revenue, and no multiple of zero is
  // anything but zero. A suggestion here could not work even in principle.
  if (
    blendedStatus === "UNAVAILABLE" ||
    blendedStatus === "COST_WITHOUT_REVENUE"
  ) {
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
  /**
   * Phase 3 — the surgical lift for this cell, already resolved from
   * `quote_leaf_id`. Null when none is set OR when one was set and rejected;
   * `liftRejection` says which.
   */
  cellLift: number | null;
  /**
   * Why a lift that WAS supplied is not being applied. Null when no lift was
   * supplied, or when one was and it applied.
   *
   * Carried separately from `cellLift` because "no lift" and "a lift the engine
   * refused" are different states, and collapsing them would let a rejection
   * render as an absence — which is how a person's deliberate price gets
   * silently overturned by a lever that quietly did nothing instead of saying
   * so.
   */
  liftRejection: LiftRejection | null;
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
    cellLift,
    liftRejection,
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
    if (shipment.memberSkuId !== sku.id || shipment.tierId !== tier.id) continue;
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
  //
  // Held outside the block so the sell ladder below can name the freight
  // section as a quantity. Pattern 58: freight sell is governed by the freight
  // pricing authority, and the levers that price the OWNING SKU must be able
  // to say what they do and do not cover.
  let freightSectionValue = 0;
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
      if (shipment.memberSkuId !== sku.id || shipment.tierId !== tier.id) continue;
      const c = computeShipmentContribution(shipment);
      const shipBase = nodeKey(frtBase, "shipment", shipment.freightSubcategoryId);
      const units = num(shipment.tierUnits);
      const memberCount = Math.max(1, Math.trunc(num(shipment.memberCount, 1)));

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
            op: money(num(amount)) + " / " + memberCount + " member(s) / " + units + " units",
            operands: [
              // The shipment's share for THIS member, stated as its own step so
              // the entered amount below stays the amount the operator entered.
              // Folding the split into the allocation would have made the trace
              // report a figure nobody typed.
              {
                key: nodeKey(shipBase, name, "share"),
                kind: "allocation",
                label: "This product's share",
                value: num(amount) / memberCount,
                unit: "usd",
                divisor: memberCount,
                op: money(num(amount)) + " / " + memberCount + " product(s) in this shipment",
                operands: [
                  originUsd(nodeKey(shipBase, name, "total"), "Entered amount", num(amount)),
                ],
              },
            ],
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
    freightSectionValue = freightSectionNode.value;

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

  // ── OD-023's freight/product split in the sell ladder is WITHDRAWN ───────
  //
  // It held freight out of the two per-cell levers so that moving a shipment's
  // attribution anchor could not move quote revenue (Pattern 58). The intent
  // was right; the arithmetic broke two operator-facing contracts, and the
  // operator walk found both:
  //
  //   P-Direct-1  a direct price of $4.00 displayed as $5.06, because the
  //               computed price it replaced already contained the freight and
  //               the split added it a second time.
  //   P-Lift-1    "Lift to floor" left the cell below the floor, because the
  //               recommendation solves against the whole cell sell while the
  //               split applied the lift to the product portion only. Measured
  //               shortfall on two cells: exactly `freight x lift`.
  //
  // Both levers act on the cell AS THE OPERATOR SEES IT, and what they see
  // includes the freight. A lever that silently acts on a different quantity
  // than the one displayed cannot be predicted by the surface offering it.
  //
  // WHAT THIS COSTS: Pattern 58's anchor-invariance now holds except on a cell
  // carrying an operator lever, where the freight is inside the operator's
  // decision. Bounded and asserted — see the `absorbed` cases in
  // od-017-direct-component-economics.
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
  // ---------- Phase 3 · the surgical lift ----------
  //
  // §13.1: the lift COMPOSES onto the adjustment rather than joining its
  // ladder. Rendering it as a third rung would present a composing lever as an
  // alternative — the opposite of what it does — so it is a node ABOVE the
  // resolution, taking the adjusted sell as its operand.
  //
  // §13.2, load-bearing and general: *every lever that can change a quoted
  // price owes the cost stack a row.* A lever with no node produces no row,
  // and a stack that cannot show every contribution cannot assert
  // reconciliation — which is the only thing that makes it trustworthy. So
  // this is a constraint on the graph, not on the UI.
  //
  // A REJECTED lift still owes the graph a node. It is `flagged-out`: present,
  // traversable, valued zero, and carrying the reason. Omitting it would make
  // a refusal indistinguishable from an absence at exactly the moment an
  // operator needs to know their lever did nothing and why.
  //
  // PATTERN 58 · the lift acts on the PRODUCT, not on the shipment. It is a
  // per-cell lever, so a lift reaching freight would make the shipment's sell
  // depend on which leaf the shipment anchored to. The node therefore publishes
  // the lift as a CONTRIBUTION over a stated basis, and the sum above it
  // carries the adjusted cell — freight included, exactly once, still owned by
  // `sell-before`.
  //
  // The basis is DATA rather than an operand for the reason `rate` and `ratio`
  // already give: the product build-up is computed elsewhere in this chain, and
  // making it an operand would put one node under two parents, which resolves
  // every duplicated key to nothing.
  const liftedNode: CostingNode | null =
    cellLift !== null
      ? {
          key: nodeKey(sku.id, tier.id, "lift"),
          kind: "adjustment",
          label: "Surgical lift",
          value: adjustmentNode.value * (1 + cellLift),
          unit: "usd",
          op: "$" + adjustmentNode.value + " x (1 + " + cellLift + " lift)",
          operands: [
            adjustmentNode,
            // An `origin`, not a `rate`. The reconciliation guard caught the
            // difference and it is a real one: `rate` is a non-terminal — an
            // amount DERIVED by applying a percentage to a basis, as duty and
            // tariff are. The lift percentage is not derived from anything. A
            // person chose it, which makes it a terminal with provenance, and
            // the same shape the adjustment's own percentage already uses.
            {
              key: nodeKey(sku.id, tier.id, "lift", "pct"),
              kind: "origin",
              label: "Lift",
              value: cellLift,
              unit: "pct",
              origin: { grade: "thin", actor: null, when: null, doc: null },
            },
          ],
        }
      : liftRejection !== null
        ? {
            key: nodeKey(sku.id, tier.id, "lift"),
            kind: "flagged-out",
            label: "Surgical lift — not applied",
            value: 0,
            unit: "usd",
            reason: LIFT_REJECTION_REASON[liftRejection],
          }
        : null;

  // A REFUSED lift must be inert, not destructive.
  //
  // This read `(liftedNode ?? adjustmentNode).value`. When a lift is refused,
  // `liftedNode` is the `flagged-out` node, whose value is 0 BY DEFINITION —
  // that is what flagged-out means, and the node is right. Taking it as the
  // computed sell made a refusal zero the cell's computed price.
  //
  // Invisible on an overridden cell's own margin, because the override is
  // terminal and margin reads through it. Not invisible downstream: the
  // assembly rollup sums children's `computedSellPerUnit`, and the tier-adjust
  // derivation divides by it — so a refused lift silently under-reported a
  // parent's computed sell and could hand the solver a base of 0.
  //
  // The discriminator is the one the very next statement already uses. Only an
  // APPLIED lift is the chain; a refused one leaves the computed chain standing
  // and hangs the reason off it.
  const computedSellPerUnit = (
    liftedNode !== null && liftedNode.kind === "adjustment" ? liftedNode : adjustmentNode
  ).value;
  // Slice 9.3 — per-cell override is TERMINAL. When set, it replaces
  // computedSellPerUnit entirely; downstream margin/revenue use this
  // value. Action layer rejects override <= 0, so positive value
  // expected here. Defensive guard below handles the bypass case.
  // The ACTIVE root for this cell. When a person set the price, that node IS
  // the answer and the computed chain hangs beneath it as `superseded` —
  // visible, traversable, and demoted. `requiredSellPerUnit` then reads
  // whichever node is active, so the scalar and the graph cannot disagree
  // about which value the quote is actually using.
  //
  // When a lift applied, IT is the chain — the adjustment hangs beneath it as
  // an operand. When one was rejected, the flagged-out node is attached to the
  // computed chain so the refusal is reachable from the cell it concerns
  // rather than filed somewhere the operator would have to know to look.
  const computedChain: CostingNode =
    liftedNode !== null && liftedNode.kind === "adjustment"
      ? liftedNode
      : liftedNode !== null
        ? {
            ...adjustmentNode,
            operands: [...(adjustmentNode.operands ?? []), liftedNode],
          }
        : adjustmentNode;
  // ── P-Direct-1 · a direct price is TERMINAL ────────────────────────────
  //
  // OD-023 made this root a SUM of the operator's price and the cell's freight,
  // reasoning that the operator was not pricing the shipment — the cell is the
  // freight anchor only by an ordering accident they cannot see.
  //
  // The attribution half of that is still true. The ARITHMETIC half was wrong,
  // and measurement is what settled it: the computed price the operator was
  // shown ALREADY CONTAINED the freight. On the reported cell, computed sell
  // was 3.962 and the freight inside it was 1.062. Overriding 3.96 with 4.00
  // and then adding 1.062 does not restore a lost contribution — it counts the
  // freight a second time, against a number the operator chose while looking at
  // the first one. Nexus displayed 5.06 and told the operator they had set it.
  //
  // A price a person typed is the price. Anything that silently moves it is
  // worse than a wrong total, because the surface then attributes the new
  // number to them.
  //
  // WHAT THIS COSTS, STATED. Pattern 58 asks that the attribution anchor never
  // move quote arithmetic. With a terminal override that holds everywhere
  // EXCEPT on a cell whose price an operator has set: there the freight riding
  // on the cell is absorbed into their number, so moving the anchor to or from
  // that cell does move quote revenue. That is not the engine deciding — it is
  // an operator's stated price doing what a stated price does. The freight COST
  // is unaffected and still reaches `contributionCostPerUnit`, so margin tells
  // the truth about the decision.
  //
  // The residual exposure is that the operator cannot see WHICH cell carries a
  // shipment, so they cannot know their price is absorbing one. That is a
  // presentation gap, not an arithmetic one, and it is logged rather than
  // patched here.
  //
  // The LIFT hold-out above is unchanged and stays: a lift is a multiplier
  // applied to a computed price, so holding freight out of it changes no number
  // the operator typed.
  const cellRootNode: CostingNode =
    cellOverride !== null
      ? {
          key: nodeKey(sku.id, tier.id, "quoted"),
          kind: "override",
          label: "Quoted sell",
          value: cellOverride,
          unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null },
          superseded: computedChain,
        }
      : computedChain;
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
  const marginPct: number | null =
    requiredSellPerUnit > 0
      ? (requiredSellPerUnit - contributionCostPerUnit) / requiredSellPerUnit
      : requiredSellPerUnit < 0
        ? -1
        : null;
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
    // P3-017 — see the type for why the deltas are products of the levers'
    // own rates rather than differences between the levels beside them.
    sellBeforeAdjustmentPerUnit: sellBeforeAdjustment,
    adjDeltaPerUnit: sellBeforeAdjustment * effectiveAdj,
    sellAfterAdjustmentPerUnit: adjustmentNode.value,
    // A rejected lift contributes zero, and the flagged-out node carries the
    // reason. Absent and refused are different states everywhere else in this
    // graph; they are the same number here only because a refusal genuinely
    // moves the price by nothing.
    //
    // PATTERN 58 · the lift contribution is over the PRODUCT. The rungs above
    // are unchanged — `sell-before` and the adjustment still carry the whole
    // build-up, freight included — so the tier ladder identity
    // `sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell`
    // continues to hold, with the override rung absorbing the freight the
    // operator's price does not cover.
    liftDeltaPerUnit: cellLift !== null ? adjustmentNode.value * cellLift : 0,
    sellAfterLiftPerUnit: computedChain.value,
    overrideDeltaPerUnit:
      cellOverride !== null ? cellRootNode.value - computedChain.value : 0,
    marginPct,
    // Slice 9.4a — verdict band against effective target (per-quote
    // override or firm) and firm floor. Uses the same computeStatus
    // helper as quote-level blended classification for consistency.
    marginStatus:
      marginPct === null
        ? zeroRevenueStatus(contributionCostPerUnit)
        : computeStatus(marginPct, effectiveTarget, floor),
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
    // P3-017 ladder — an assembly with no children has passed through no
    // levers, so every level and every contribution is zero. The identity
    // holds trivially, which is correct rather than merely convenient.
    sellBeforeAdjustmentPerUnit: 0,
    adjDeltaPerUnit: 0,
    sellAfterAdjustmentPerUnit: 0,
    liftDeltaPerUnit: 0,
    sellAfterLiftPerUnit: 0,
    overrideDeltaPerUnit: 0,
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
    marginPct: null,
    // Empty assembly with no children. This used to hardcode BELOW_FLOOR,
    // with a comment conceding the point — "computeStatus(0, target, floor) =
    // BELOW_FLOOR when floor > 0 … acceptable; this row state is visible for
    // ~16ms before children fold in."
    //
    // Brief is not the same as harmless. An assembly with no children has no
    // sell price, so it has no margin, and 16ms of a red row asserting a floor
    // breach is 16ms of the page saying something untrue. It costs nothing to
    // say the true thing instead, and the true thing is that there is nothing
    // here yet.
    marginStatus: "UNAVAILABLE",
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
  // P3-017 ladder — folds exactly as every other per-unit quantity here does:
  // child value x qtyPerParent. The fold is linear, so the reconciliation
  // identity that holds at each child holds for the assembly built from them.
  let sellBeforeAdj = 0;
  let adjDelta = 0;
  let sellAfterAdj = 0;
  let liftDelta = 0;
  let sellAfterLift = 0;
  let overrideDelta = 0;
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
  // ---------- OD-025 · the fold is DIMENSION-AWARE ----------
  //
  // `SkuPerTierRollup` carries values in TWO economic dimensions, and the fold
  // must not treat them alike:
  //
  //   COMPONENT-UNIT values — packaging, production, raw and their markup sums.
  //     Denominated $/component unit. Multiplying by `qtyPerParent` is what
  //     converts them to $/sellable unit. Correct, and unchanged below.
  //
  //   SELLABLE-UNIT values — every freight-derived figure. Freight is amortised
  //     at `computeShipmentContribution` by the governing tier quantity
  //     (absolute shipment amount ÷ tierUnits), so it arrives here ALREADY
  //     denominated $/sellable unit.
  //
  // The governing rule: a value already normalised to the sellable-unit basis
  // must not be scaled again by BOM multiplicity. Before this, a $500 shipment
  // on a leaf with qtyPerParent 2 reported $1000 at quote level — not a
  // rounding artefact but a doubling, and present with a single anchor, so it
  // was never merely an attribution-sensitivity problem.
  //
  // Freight is not confined to the freight fields: it is embedded inside
  // `contribution`, `requiredSell`, `computedSell` and the whole sell ladder,
  // all of which are legitimately scaled for their component content. So those
  // are folded MIXED — the freight portion is held out of the multiplication
  // and re-added once:
  //
  //     fold(v, f, q) = (v − f) × q + f
  //
  // which is exactly `v × q` when f = 0, and exactly `f` when v = f. The fold
  // stays linear in the component part, so the reconciliation identity the
  // ladder depends on survives.
  // The two short-circuits are NOT micro-optimisation. `(v − f) × 1 + f` is not
  // exactly `v` in IEEE-754: when the freight portion exceeds the composite —
  // routine for a small `adjDelta` — the subtraction cancels and the re-addition
  // does not restore the original bits. Measured on the live population, that
  // float noise moved `blendedMarginPct` on three real quotes, which is
  // monetary movement from a repair that must move no money at all.
  //
  // Every live attachment carries quantity 1 (measured: 150/150), so `qty === 1`
  // is the whole production population. Returning `value` untouched makes the
  // fold provably an identity there rather than approximately one.
  const foldMixed = (value: number, freightPortion: number, qty: number) => {
    if (qty === 1) return value;
    if (freightPortion === 0) return value * qty;
    return (value - freightPortion) * qty + freightPortion;
  };

  for (const c of children) {
    const q = c.qtyPerParent;
    const r = c.rollup;

    // The freight portion of each composite, derived rather than assumed.
    //
    // Cost side: the freight inside `contribution` is the pre-markup landed
    // total. Sell side: the freight inside `sellBeforeAdjustment` is the
    // marked-up landed total — it IS the freight section of that sum.
    const fCost = r.totalLandedFreightBeforeMarkup;
    const fSellBefore = r.totalLandedFreightWithMarkup;

    // Adjustment and lift are uniform multiplicative scalars on the whole cell,
    // so the freight portion scales by the same ratio the cell did. Reading the
    // ratio off the ladder is safer than re-deriving the rates: if the ladder
    // ever changes shape, this follows it instead of silently disagreeing.
    const adjRatio =
      r.sellBeforeAdjustmentPerUnit !== 0
        ? r.sellAfterAdjustmentPerUnit / r.sellBeforeAdjustmentPerUnit
        : 1;
    const fAfterAdj = fSellBefore * adjRatio;

    // PATTERN 58 · below the adjustment the freight portion STOPS MOVING.
    //
    // The lift and the override are per-cell levers, and the cell they act on
    // is the freight anchor by an ordering accident. Both used to reach the
    // freight — the lift by scaling it, the override by annihilating it — which
    // made the shipment's contribution to quote revenue depend on which leaf
    // carried it. The engine now holds freight out of both, so the freight
    // inside `requiredSellPerUnit` is `fAfterAdj` whichever route the cell took.
    //
    // The former asymmetry read as reasonable: "an operator-stated price for
    // one component unit carries no separable freight portion." It was true of
    // the price and false of the quote — the freight had not been priced by the
    // operator, so treating it as absorbed simply lost it.
    const liftRatio =
      r.sellAfterAdjustmentPerUnit !== 0
        ? r.sellAfterLiftPerUnit / r.sellAfterAdjustmentPerUnit
        : 1;
    const fAfterLift = fAfterAdj * liftRatio;
    // P-Direct-1 · a terminal price carries no separable freight portion. It is
    // one number a person chose, and the freight inside it is inside it.
    const fRequired = r.sellSource === "cell_override" ? 0 : fAfterLift;

    // Mixed-dimension composites.
    contribution += foldMixed(r.contributionCostPerUnit, fCost, q);
    requiredSell += foldMixed(r.requiredSellPerUnit, fRequired, q);
    computedSell += foldMixed(r.computedSellPerUnit, fAfterLift, q);
    sellBeforeAdj += foldMixed(r.sellBeforeAdjustmentPerUnit, fSellBefore, q);
    adjDelta += foldMixed(r.adjDeltaPerUnit, fAfterAdj - fSellBefore, q);
    sellAfterAdj += foldMixed(r.sellAfterAdjustmentPerUnit, fAfterAdj, q);
    liftDelta += foldMixed(r.liftDeltaPerUnit, fAfterLift - fAfterAdj, q);
    sellAfterLift += foldMixed(r.sellAfterLiftPerUnit, fAfterLift, q);
    overrideDelta += foldMixed(
      r.overrideDeltaPerUnit,
      fRequired - fAfterLift,
      q,
    );

    // COMPONENT-UNIT values — scaling is the conversion, and is correct.
    packaging += r.packagingCostPerUnit * q;
    production += r.productionCostPerUnit * q;
    raw += r.rawCostPerUnit * q;
    serviceFees += r.separateServiceFeesPerUnit * q;
    packagingMarkup += r.packagingMarkupSumPerUnit * q;
    productionMarkup += r.productionMarkupSumPerUnit * q;
    rawMarkup += r.rawMarkupSumPerUnit * q;
    servicesMarkup += r.separateServicesMarkupSumPerUnit * q;

    // SELLABLE-UNIT values — already amortised; carried through at ×1.
    landedFreight += r.totalLandedFreightBeforeMarkup;
    containerFreight += r.totalContainerFreightBeforeMarkup;
    dutyTariff += r.totalDutyTariffBeforeMarkup;
    containerFreightMarkup += r.freightContainerMarkupSumPerUnit;
    dutyTariffMarkup += r.freightDutyTariffMarkupSumPerUnit;
  }
  const marginPct: number | null =
    requiredSell > 0 ? (requiredSell - contribution) / requiredSell : null;
  return {
    sellBeforeAdjustmentPerUnit: sellBeforeAdj,
    adjDeltaPerUnit: adjDelta,
    sellAfterAdjustmentPerUnit: sellAfterAdj,
    liftDeltaPerUnit: liftDelta,
    sellAfterLiftPerUnit: sellAfterLift,
    overrideDeltaPerUnit: overrideDelta,
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
    marginStatus:
      marginPct === null
        ? zeroRevenueStatus(contribution)
        : computeStatus(marginPct, effectiveTarget, floor),
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

export function computeQuoteCosting(input: QuoteCostingInput,
  /**
   * Which evaluation this run IS.
   *
   * Defaults to `committed` so existing callers keep their meaning; a PREVIEW
   * caller must say so. That asymmetry is deliberate — a preview mislabelled
   * committed is authority nobody granted, while a committed run mislabelled
   * preview merely stops answering.
   */
  evaluation: GraphEvaluation = "committed",
): QuoteCostingResult {
  const { quote, firmSettings, markupDefaults, skus, tiers } = input;
  // Gate 1B — one collector per evaluation. Filled while the engine computes;
  // never re-traversed afterwards.
  const graphNodes: CostingNode[] = [];
  const globalAdj = num(quote.globalPriceAdjPct);
  // Slice 9.2 — verdict bands use the per-quote target override when
  // set, otherwise firm-level target. Floor stays firm-level always
  // (admin only). See top-of-file comment for the effective-value
  // pattern.
  //
  // ── Gate 1B · one resolution, five readers ────────────────────────────────
  // This ladder was resolved in FIVE places: here, and once each in the Costs
  // header, the quote summary card, the target-margin popover and the pricing
  // classifier. All five agreed, which is the weakest kind of agreement — each
  // was a private `?? firmSettings.targetMarginPct`, and changing the ladder
  // meant finding all five.
  //
  // Two of the five also carried PROVENANCE (this quote vs firm default) and
  // three did not, so the same number was sourced on one surface and anonymous
  // on another. 12 of 62 quotes override, so that gap is live rather than
  // theoretical.
  //
  // It is a `resolution` node rather than an origin because the losing rung is
  // what makes the winner legible: "35% because this quote says so" and "35%
  // because the firm does" are different facts that happen to print the same.
  const targetOverride =
    quote.targetMarginPct !== null && quote.targetMarginPct !== undefined
      ? num(quote.targetMarginPct)
      : null;
  const effectiveTargetNode: CostingNode = {
    key: quoteWideKey("target-margin"),
    kind: "resolution",
    label: "Effective target margin",
    value: targetOverride !== null ? targetOverride : firmSettings.targetMarginPct,
    unit: "pct",
    op: "quote override ?? firm default",
    candidates: [
      {
        label: "Quote override",
        value: targetOverride,
        chosen: targetOverride !== null,
        unavailableReason:
          targetOverride !== null ? null : "no target override set on this quote",
        // A-2 · the two rungs are set by two different people in two different
        // places, and that is the whole reason this is a resolution. Naming the
        // authority is something the engine knows; resolving who exercised it
        // is the overlay's job.
        provenanceKey: quoteWideKey("target-margin", "quote-override"),
      },
      {
        label: "Firm default",
        value: firmSettings.targetMarginPct,
        chosen: targetOverride === null,
        unavailableReason: null,
        provenanceKey: quoteWideKey("target-margin", "firm-default"),
      },
    ],
  };
  graphNodes.push(effectiveTargetNode);
  // Every downstream verdict reads the node, not the expression above it.
  const effectiveTarget = effectiveTargetNode.value;

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
  // ---------- Phase 3 · resolve lifts, fail closed ----------
  //
  // Lifts arrive keyed on `quote_leaf_id`; the math works in `sku.id`. Phase 3
  // §1a governs the crossing: resolve it explicitly, once, and reject anything
  // that does not resolve to exactly one leaf on THIS quote. No fallback to a
  // reusable id, no inferred tuple match — a lift applied to the wrong cell is
  // a wrong price, and a wrong price that looks deliberate is worse than an
  // error.
  //
  // Ambiguity is treated as failure rather than resolved by picking one. Two
  // leaves answering to one attachment is a data defect; choosing between them
  // here would bury it under a plausible number.
  const skuByQuoteLeafId = new Map<string, string | null>();
  for (const sku of skus) {
    const canonical = sku.canonicalQuoteLeafId;
    if (!canonical) continue;
    // Second sighting demotes to null — and a THIRD must not revive it, which
    // is why the check is on `has` rather than on the stored value.
    if (skuByQuoteLeafId.has(canonical)) skuByQuoteLeafId.set(canonical, null);
    else skuByQuoteLeafId.set(canonical, sku.id);
  }
  const liftBySkuTier = new Map<string, number>();
  const liftRejectionBySkuTier = new Map<string, LiftRejection>();
  for (const lift of input.lifts ?? []) {
    if (!skuByQuoteLeafId.has(lift.quoteLeafId)) {
      // Not on this quote at all. `attachment_foreign` and
      // `attachment_unresolved` are indistinguishable from inside a pure
      // function that only sees one quote's inputs; the caller that loaded a
      // cross-quote lift is the layer that can tell them apart. Reported as
      // unresolved here rather than guessed.
      continue;
    }
    const skuId = skuByQuoteLeafId.get(lift.quoteLeafId) ?? null;
    const key = skuId === null ? null : `${skuId}::${lift.tierId}`;
    if (key === null) continue;
    liftBySkuTier.set(key, lift.liftPct);
  }
  for (const lift of input.lifts ?? []) {
    if (skuByQuoteLeafId.get(lift.quoteLeafId) === null) {
      for (const sku of skus) {
        if (sku.canonicalQuoteLeafId !== lift.quoteLeafId) continue;
        liftRejectionBySkuTier.set(
          `${sku.id}::${lift.tierId}`,
          "attachment_ambiguous",
        );
      }
    }
  }
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
        // A lift over an override is REJECTED, not absorbed (§13.3). The
        // rejection is computed here — where both facts are in hand — rather
        // than inside the cell, so the cell renders a decision instead of
        // making one.
        const liftCellKey = `${sku.id}::${tier.id}`;
        const suppliedLift = liftBySkuTier.get(liftCellKey);
        const ambiguous = liftRejectionBySkuTier.get(liftCellKey) ?? null;
        const cellLift =
          ambiguous !== null || suppliedLift === undefined || cellOverride !== null
            ? null
            : suppliedLift;
        const liftRejection: LiftRejection | null =
          ambiguous !== null
            ? ambiguous
            : suppliedLift !== undefined && cellOverride !== null
              ? "overridden"
              : null;
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
          cellLift,
          liftRejection,
          effectiveTarget,
          floor: firmSettings.floorMarginPct,
          cellTarget,
        });
      });
      const rollup: SkuRollup = {
        skuId: sku.id,
        canonicalQuoteLeafId: sku.canonicalQuoteLeafId ?? null,
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
      canonicalQuoteLeafId: sku.canonicalQuoteLeafId ?? null,
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
      rawCost: 0,
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
      // T-4 — same addend, kept apart. `production` stays folded for every
      // existing consumer; this makes the raw half separable without it.
      breakdown.rawCost += pt.rawCostPerUnit * tQty;
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

    // ---------- per-unit allocations (Gate 1B · Costs cost-stack header) ----
    //
    // A DIFFERENT COMMERCIAL QUANTITY FROM THE PRICING BLEND, and deliberately
    // so. Pricing blends across the governed SKU population and answers "what
    // does an average SKU sell for". These allocate the quote's tier TOTAL over
    // the tier quantity and answer "what does one unit of this tier contribute,
    // all products combined". On production data the two differ on 22 of 40
    // defined tiers, by factors of 2x, 3x and 9x — the leaf count per assembly.
    //
    // Both are correct. The defect these nodes remove is that the Costs header
    // derived its answer independently, not that its answer was wrong.
    //
    // `allocation` is the vocabulary's kind for exactly this: total / Q, with Q
    // carried as `divisor` DATA so the reconciler can check the operation
    // instead of reading the denominator out of a label.
    //
    // RAW IS EMITTED. It was previously absent on the stated grounds that
    // "`productionMarkupSum` already folds bulk raw in — so emitting a raw node
    // would double-count against production." The fold is real, and that is why
    // PROD below subtracts. The conclusion drawn from it was not: bulk raw has
    // its own canonical node (`nodeKey(sku, tier, "raw")`), its own markup
    // authority (`RAW_MARKUP_CATEGORY`, distinct from Manufacturing), and its
    // own `cellSections` entry contributing independently to quoted sell.
    //
    // So PROD reads production MINUS raw, and RAW reads raw. Their sum is what
    // PROD alone used to be, which is why the subtotal is unchanged to the
    // float — the split reapportions an existing figure between two rows, it
    // does not add or remove one. Costing arithmetic, quoted sell, margins and
    // markup policy are untouched: `breakdown.production` and
    // `breakdown.productionMarkupSum` still carry the folded values for every
    // other consumer.
    //
    // T-4, 2026-08-11. The prior disposition was taken on a false factual
    // premise; see docs/validation/quote-translation-parity-matrix.md.
    const perUnitQty = num(tier.qty);
    if (perUnitQty > 0) {
      const originOf = (label: string, value: number): CostingNode => ({
        key: nodeKey("quote", tier.id, "per-unit", label, "total"),
        kind: "origin",
        label,
        value,
        unit: "usd",
        origin: { grade: "thin", actor: null, when: null, doc: null },
      });
      const alloc = (
        name: string,
        label: string,
        total: number,
      ): CostingNode => ({
        key: nodeKey("quote", tier.id, "per-unit", name),
        kind: "allocation",
        label,
        value: total / perUnitQty,
        unit: "usd",
        op: "tier total / tier quantity",
        divisor: perUnitQty,
        operands: [
          {
            ...originOf(label, total),
            key: nodeKey("quote", tier.id, "per-unit", name, "total"),
          },
        ],
      });

      const perUnitComponent = (
        name: string,
        label: string,
        costTotal: number,
        markedUpTotal: number,
      ): CostingNode => {
        const costNodeU = alloc(name + "/cost", label + " cost per unit", costTotal);
        const markupNodeU = alloc(
          name + "/markup",
          label + " markup per unit",
          markedUpTotal - costTotal,
        );
        return {
          key: nodeKey("quote", tier.id, "per-unit", name),
          kind: "sum",
          label: label + " per unit",
          value: costNodeU.value + markupNodeU.value,
          unit: "usd",
          op: "cost per unit + markup per unit",
          operands: [costNodeU, markupNodeU],
        };
      };

      const perUnitComponents: CostingNode[] = [
        perUnitComponent("pkg", "Packaging", breakdown.packaging, breakdown.packagingMarkupSum),
        perUnitComponent(
          "prod",
          "Production",
          breakdown.production - breakdown.rawCost,
          breakdown.productionMarkupSum - breakdown.rawMarkupSum,
        ),
        perUnitComponent("raw", "Bulk raw", breakdown.rawCost, breakdown.rawMarkupSum),
        perUnitComponent("frt", "Freight", breakdown.freightContainer, breakdown.freightContainerMarkupSum),
        perUnitComponent("dt", "Duty & tariff", breakdown.dutyAndTariff, breakdown.dutyAndTariffMarkupSum),
      ];

      const subtotalPerUnit: CostingNode = {
        key: nodeKey("quote", tier.id, "per-unit"),
        kind: "sum",
        label: "Combined contribution per unit · " + tier.label,
        value: perUnitComponents.reduce((a, n) => a + n.value, 0),
        unit: "usd",
        op: "packaging + production + freight + duty & tariff, each per unit",
        operands: perUnitComponents,
      };

      const revenuePerUnit = alloc("revenue", "Quoted revenue per unit", revenue);
      graphNodes.push(alloc("cost-total", "Total cost per unit", cost));

      // The gap the Costs header shows between Sell and the rows above it.
      //
      // NAMED FOR WHAT IT IS, not for its commonest cause. It is non-zero when
      // a per-tier price adjustment applies, when a cell override is set, AND
      // when there are cost components the stack does not render (passthrough
      // services). Calling it "price adjustment" would be right about the
      // first two and wrong about the third, and an operator reading a
      // passthrough cost as a pricing decision would draw the wrong
      // conclusion. The header keeps showing "Adjustment" or "Override" by
      // sign, which is the operator's reading of the same fact.
      graphNodes.push({
        key: nodeKey("quote", tier.id, "per-unit", "departure"),
        kind: "difference",
        label: "Quoted price less component build-up, per unit",
        value: revenuePerUnit.value - subtotalPerUnit.value,
        unit: "usd",
        op: "quoted revenue per unit - component build-up per unit",
        operands: [revenuePerUnit, subtotalPerUnit],
      });
    } else {
      // Same contract as the zero-weight blend: dividing by zero units leaves
      // the per-unit figure UNDEFINED, and undefined is not zero. No readable
      // node is exposed, so the header reaches its fail-closed path instead of
      // asserting that a unit contributes nothing.
      graphNodes.push({
        key: nodeKey("quote", tier.id, "per-unit"),
        kind: "flagged-out",
        label: "Combined contribution per unit · " + tier.label,
        value: 0,
        unit: "usd",
        reason:
          "Tier quantity is zero, so a per-unit allocation is undefined. " +
          "The tier totals remain available on the quote-scope revenue and cost nodes.",
      });
    }

    // Same contract as the quote-wide margin: undefined at zero revenue, and
    // the status says so rather than being computed from a stand-in. Twelve of
    // the fifteen zero-revenue tiers in production also carry zero QUANTITY —
    // tiers the Costs header already renders as unavailable — so this is
    // largely the engine agreeing with what the surface already believed.
    const marginPct: number | null =
      revenue > 0 ? (revenue - cost) / revenue : null;
    const status: QuoteMarginStatus =
      marginPct === null
        ? zeroRevenueStatus(cost)
        : computeStatus(marginPct, effectiveTarget, firmSettings.floorMarginPct);
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
  // Undefined at zero revenue, and the status says so rather than being
  // computed from a stand-in. `computeStatus` is deliberately not reached in
  // that branch: it takes a `number` and would happily band a fabricated one.
  const blendedMarginPct: number | null =
    blendedRevenue > 0 ? (blendedRevenue - blendedCost) / blendedRevenue : null;
  const blendedStatus: QuoteMarginStatus =
    blendedMarginPct === null
      ? zeroRevenueStatus(blendedCost)
      : computeStatus(
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
  // ---------- quote-level blend nodes (Gate 1B increments 5 + 7) ----------
  //
  // CONTRIBUTORS ARE THE GOVERNED SKU POPULATION (OD-014): quote-scoped leaf
  // attachments, identified by `canonicalQuoteLeafId`. Not top-level products.
  //
  // That distinction is the whole of the reverted increment 7. Blending over
  // top-level products meant a quote with one assembly had ONE contributor, so
  // the "blend" returned that assembly's rolled-up SUM — 5.0750 where the mean
  // is 2.5375. Both figures are arithmetically correct; they answer different
  // questions, and only one of them is what a blend means.
  //
  // Tree position cannot decide who participates. Whether a leaf sits under an
  // assembly or attaches directly to the quote is an artefact of how the quote
  // was authored, and ASY is expected to become optional — so a blend that
  // reads the tree would change its answer when nothing commercial changed.
  //
  // WEIGHTS ARE UNITS AT THE TIER: the governed attachment quantity
  // (`quote_leaves.quantity`, carried as qtyPerParent) times the tier
  // quantity. The tier quantity is common to every contributor and cancels in
  // the ratio; it is included so `weights` literally means units, which is
  // what the op string claims and what the trace will show.
  //
  // Every one of the 137 live attachments currently carries quantity 1, so a
  // weighted and an unweighted mean agree on every real quote today. Weighting
  // correctly anyway is the difference between a node that proves its result
  // and one that happens to agree with it — and it is exactly the coincidence
  // that let the reverted fixture pass while its semantics were wrong.
  const leafRollupsForBlend = skus.filter((s) => s.skuRole === "leaf");
  for (const tier of tiers) {
    const tierQty = num(tier.qty);
    const contributors: {
      sku: (typeof leafRollupsForBlend)[number];
      pt: SkuPerTierRollup;
      weight: number;
    }[] = [];
    const absent: string[] = [];
    for (const leaf of leafRollupsForBlend) {
      const r = rollupBySku.get(leaf.id);
      const pt = r?.perTier.find((p) => p.tierId === tier.id);
      if (!pt) {
        // ABSENT is not zero-valued. A SKU with no rollup at this tier is not
        // in the blend at all; recording it as a zero contributor would drag
        // the mean down by a value nobody entered.
        absent.push(leaf.id);
        continue;
      }
      contributors.push({
        sku: leaf,
        pt,
        weight: tierQty * (leaf.qtyPerParent ?? 1),
      });
    }

    const blendBase = nodeKey("quote", tier.id);

    // ---------- Cost Stack section total · Packaging (OD-018) ----------
    //
    // THE PACKAGING DRILLDOWN'S FOOT. Its business meaning was settled as: the
    // simple sum of every governed SKU's packaging contribution at this tier,
    // because the row exists to show what Packaging contributes to the Cost
    // Stack. So it sums; it does not average and it does not weight.
    //
    // DELIBERATELY NOT `quote/{tier}/pkg`, which is the PRICING BLEND — a
    // units-weighted MEAN over the same population. Two nodes, same component,
    // same tier, and a factor of the SKU count between them. A key that merely
    // resembled the blend's would recreate the confusion OD-018 was opened to
    // resolve, so the scope segment names the surface the quantity belongs to.
    //
    // It also is NOT `quote/{tier}/per-unit/pkg`, the Cost Stack header's row,
    // even though the two AGREE ON ALL 40 DEFINED PRODUCTION TIERS. That
    // agreement is circumstantial, not structural: the header allocates a tier
    // total over tier quantity, this sums per-unit values across SKUs, and the
    // two coincide only while every attachment carries quantity 1 — which all
    // 137 live attachments currently do. Aliasing one to the other would hold
    // until the first quantity-2 attachment and then diverge silently. Summing
    // independently keeps the reconciliation a VERIFIED PROPERTY rather than an
    // assumed identity, which is the difference between a node that proves its
    // result and one that happens to agree with it.
    //
    // Emitted OUTSIDE the zero-weight guard below, unlike the blends: a sum of
    // per-unit values is defined at any tier quantity, including zero. Only the
    // mean is undefined there.
    const pkgTotalBase = nodeKey(blendBase, "cost-stack", "pkg-total");
    {
      // Operands are fresh origin nodes, NOT the per-SKU `{sku}/{tier}/pkg`
      // nodes themselves — those already live under each cell's sell chain, and
      // a node appearing twice makes every read of it fail closed. Same
      // canonical-identity keying as the blends: two attachments of one library
      // leaf are two commercial lines.
      const operands: CostingNode[] = contributors.map((c) => ({
        key: nodeKey(pkgTotalBase, c.sku.canonicalQuoteLeafId ?? c.sku.id),
        kind: "origin" as const,
        label: productIdentityLabel(c.sku),
        value: c.pt.packagingMarkupSumPerUnit,
        unit: "usd" as const,
        origin: { grade: "thin" as const, actor: null, when: null, doc: null },
      }));
      graphNodes.push({
        key: pkgTotalBase,
        kind: "sum",
        label: "Packaging · all SKUs · " + tier.label,
        value: operands.reduce((acc, o) => acc + o.value, 0),
        unit: "usd",
        op: "Sigma packaging per unit, across " + operands.length + " SKU(s)",
        operands,
      });
    }

    // ---------- Cost Stack section total · Freight ----------
    //
    // Same standing contract as `pkg-total`: the category's contribution to the
    // Cost Stack, summed across every governed SKU at this tier. Freight and
    // customs together, because that is what the drilldown's strip reports and
    // what the Cost Stack splits across its FRT and D+T rows.
    //
    // MODEL-AGNOSTIC BY CONSTRUCTION, and that is forced rather than chosen.
    // Two freight models are resident during the staged retirement — worksheet
    // shipments and legacy legs — and `worksheetIsAuthoritative` picks exactly
    // one per quote, never both. A total scoped to worksheet shipments would
    // read zero on a legacy quote while the Cost Stack showed real freight,
    // which fails the contract this node exists to state. Summing the per-SKU
    // freight SECTION covers whichever model is live: verified reconciling to
    // FRT + D+T on all 21 production tiers carrying freight, across both.
    const frtTotalBase = nodeKey(blendBase, "cost-stack", "frt-total");
    {
      const operands: CostingNode[] = contributors.map((c) => ({
        key: nodeKey(frtTotalBase, c.sku.canonicalQuoteLeafId ?? c.sku.id),
        kind: "origin" as const,
        label: productIdentityLabel(c.sku),
        value:
          c.pt.freightContainerMarkupSumPerUnit +
          c.pt.freightDutyTariffMarkupSumPerUnit,
        unit: "usd" as const,
        origin: { grade: "thin" as const, actor: null, when: null, doc: null },
      }));
      graphNodes.push({
        key: frtTotalBase,
        kind: "sum",
        label: "Freight & customs · all SKUs · " + tier.label,
        value: operands.reduce((acc, o) => acc + o.value, 0),
        unit: "usd",
        op:
          "Sigma freight + duty & tariff per unit, across " +
          operands.length +
          " SKU(s)",
        operands,
      });
    }

    const weights = contributors.map((c) => c.weight);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const absentNote =
      absent.length > 0
        ? absent.length + " SKU(s) have no rollup at this tier and are not contributors"
        : undefined;

    const blend = (
      name: string,
      label: string,
      pick: (pt: SkuPerTierRollup) => number,
    ): CostingNode => {
      // Keyed by CANONICAL COMMERCIAL IDENTITY, not by the legacy skuId. Two
      // attachments of one library leaf are two commercial lines, and keying
      // on anything the library shares would collapse them into one operand.
      // Null identity is left visible rather than filled in from skuId — that
      // substitution is the resolution Phase 3 forbids.
      const operands = contributors.map((c) => ({
        key: nodeKey(blendBase, name, c.sku.canonicalQuoteLeafId ?? c.sku.id),
        kind: "origin" as const,
        label: productIdentityLabel(c.sku),
        value: pick(c.pt),
        unit: "usd" as const,
        origin: { grade: "thin" as const, actor: null, when: null, doc: null },
      }));
      // Reached only when totalWeight is positive — see the zero-weight branch.
      const value =
        operands.reduce((acc, o, i) => acc + o.value * weights[i], 0) / totalWeight;
      return {
        key: nodeKey(blendBase, name),
        kind: "blend",
        label,
        value,
        unit: "usd",
        op: "Sigma(value x units) / Sigma(units), across " + operands.length + " SKU(s)",
        weights,
        operands,
        ...(absentNote
          ? {
              note: absentNote,
              noteLevel: "info" as const,
            }
          : {}),
      };
    };

    // ---------- per-component blends (Gate 1B increment 7) ----------
    //
    // NAMED FOR THE QUANTITY, NOT FOR THE COLUMN. Every one of these is a
    // marked-up SELL figure per unit, blended across the governed SKU
    // population. The surface that will consume them currently heads the same
    // numbers "UNIT COST", which is why the vocabulary is set here rather than
    // inherited: a correct value under a wrong label is still a wrong
    // statement, and the graph is now where that statement is made.
    //
    // "Bulk raw" and "Duty & tariff" are spelled out for the same reason. PROD
    // and D+T are column abbreviations; the graph is business vocabulary that
    // trace, publication and diagnostics will read too.
    const componentBlends: CostingNode[] = [
      blend("pkg", "Blended packaging sell per unit", (pt) => pt.packagingMarkupSumPerUnit),
      blend("prod", "Blended production sell per unit", (pt) => pt.productionMarkupSumPerUnit),
      blend("raw", "Blended bulk raw sell per unit", (pt) => pt.rawMarkupSumPerUnit),
      blend("frt", "Blended freight sell per unit", (pt) => pt.freightContainerMarkupSumPerUnit),
      blend("dt", "Blended duty & tariff sell per unit", (pt) => pt.freightDutyTariffMarkupSumPerUnit),
    ];

    // ZERO TOTAL WEIGHT — the blend is UNDEFINED, and undefined is not zero.
    //
    // A units-weighted mean over zero units is 0/0. Emitting a readable
    // zero-valued blend would have the graph assert that every component is
    // free, which is a commercial claim nothing supports; the surface then
    // renders $0.00 beside a real margin percentage, and the two statements
    // cannot both be true. That combination shipped, and it is what this
    // branch removes.
    //
    // The fix is in the AUTHORITY, not in the consumer. Teaching the Pricing
    // shell to inspect weights and reinterpret a zero would put commercial
    // semantics back in the presentation layer — the thing this whole gate
    // exists to end. Instead the readable keys are simply not emitted, so
    // every consumer reaches the fail-closed path it already has and renders
    // an unavailable marker without knowing why.
    //
    // `flagged-out` is the vocabulary's own word for this: an input EXCLUDED,
    // with the reason, explicitly NOT a zero. It is terminal and may not carry
    // operands, which is correct here — the per-SKU contributors are real and
    // are preserved where they already live, as their own cell-scope roots.
    // Nothing is lost; only the figure that cannot be computed is absent.
    //
    // Completeness is unaffected: `graphIsComplete` inspects CELL roots only
    // and excludes the quote scope by key prefix, so omitting these raises no
    // contract conflict.
    if (totalWeight <= 0) {
      graphNodes.push({
        key: blendBase,
        kind: "flagged-out",
        label: "Quote blend · " + tier.label,
        value: 0,
        unit: "usd",
        reason:
          "Tier quantity is zero, so a units-weighted blend is undefined. " +
          "Per-SKU values remain available on each SKU's own chain.",
      });
      continue;
    }

    // Blending is LINEAR, so the component blends sum to the blend of the
    // sums. That is what lets a stack of blended rows reconcile to a blended
    // total at all — without it the column would be a set of averages with no
    // arithmetic relationship to the figure beneath them.
    graphNodes.push({
      key: nodeKey(blendBase, "sell-before"),
      kind: "sum",
      label: "Blended sell before adjustment",
      value: componentBlends.reduce((acc, n) => acc + n.value, 0),
      unit: "usd",
      op: "packaging + production + bulk raw + freight + duty & tariff",
      operands: componentBlends,
    });

    // ---------- OD-019 (d\u2032) \u00b7 the tier margin ----------
    //
    // The container used to be a `sum` of blended sell and blended cost, with a
    // comment conceding the problem: "sell and cost do not add to anything
    // meaningful. Value is the sum of its operands so the node reconciles
    // honestly rather than asserting a figure with no interpretation."
    //
    // It reconciled and it meant nothing. Pattern 57 one layer below where that
    // rule was written \u2014 a node asserting a value nobody governs is the same
    // error as a stack row doing it, and "it reconciles" is not the test.
    //
    // The two blends it held are exactly what a margin needs, so the container
    // now holds the margin and they move beneath it. Each has ONE parent chain:
    // sharing them with another root would make `resolveNode` return null for
    // both, and the Cost Stack reads `quote/{tier}/sell`.
    //
    //   quote/{tier}                    container \u2014 the tier's governed subtree
    //   \u2514\u2500 quote/{tier}/margin           ratio        \u2190 the consumer-facing key
    //      \u2514\u2500 quote/{tier}/margin/gross  difference
    //         \u251c\u2500 quote/{tier}/sell       blended sell per unit
    //         \u2514\u2500 quote/{tier}/cost       blended cost per unit
    //
    // No zero-weight guard here: that branch returned above, so totalWeight is
    // strictly positive. Blended SELL can still be zero \u2014 a tier of unpriced
    // cells has weight but no price \u2014 and a ratio over it is undefined, so that
    // case is flagged-out rather than published as 0%.
    // ---------- P3-017 · the ladder, published at tier scope ----------
    //
    // The blend published the FIRST level and the LAST and dropped the levers
    // between them, so at the scope the Cost Stack actually renders, the
    // reconciliation the per-cell graph can express was unstateable. Not
    // because the UI was wrong — because the governed values it would read did
    // not exist here.
    //
    // Eight quantities make the ladder expressible AND the assertion
    // falsifiable. Three already existed: `sell-before`, `sell`, `cost`. These
    // five are the rest.
    //
    // Every one aggregates INDEPENDENTLY, straight from its own per-cell
    // authority. No node here consults another, and no delta is a subtraction
    // of the levels beside it. That independence is the entire value:
    //
    //   sellBefore + adjDelta + liftDelta + overrideDelta === quotedSell
    //
    // is then an assertion that two separate aggregations of the same graph
    // agree, and it fails if the blend is wrong. Obtained by subtraction it
    // would telescope and hold for any four numbers.
    //
    // Float note: the identity is exact in real arithmetic but not in binary —
    // `a + a*r` and `a*(1+r)` can differ by an ulp, and blending accumulates
    // more. Consumers assert it to a tolerance, which is a property of floats
    // and not a weakening of the claim.
    graphNodes.push(
      blend("adj-delta", "Blended price adjustment contribution", (pt) => pt.adjDeltaPerUnit),
      blend("sell-after-adj", "Blended sell after adjustment", (pt) => pt.sellAfterAdjustmentPerUnit),
      blend("lift-delta", "Blended surgical lift contribution", (pt) => pt.liftDeltaPerUnit),
      blend("sell-after-lift", "Blended sell after lift", (pt) => pt.sellAfterLiftPerUnit),
      blend("override-delta", "Blended override contribution", (pt) => pt.overrideDeltaPerUnit),
    );

    // ---------- PRICE BUILD · per commercial unit of account ----------
    //
    // The blends above answer "what does an average leaf in this quote sell
    // for". That is an analytical question and they remain the answer to it.
    // It is NOT the dollar construction of anything anyone sells, and a live
    // quote proved the difference: an Item Group selling at $7.51 rendered as
    // $1.0729, its economics divided by 7 — the leaf count of the WHOLE quote,
    // spanning a second Item Group and an unrelated Direct Component. Removing
    // a zero-value leaf moved the figure while the turnkey economics did not,
    // because the denominator was never the finished good's own composition.
    //
    // These nodes are scoped to ONE top-level sellable unit and read that
    // unit's own rollup. An assembly's rollup already sums its children, so
    // there is no new arithmetic here — only the correct scope. The picks are
    // the same marked-up sell contributions the blends use.
    //
    // WHY SERVICES ARE NOT IN THE SUM. Separate service fees bill as fixed
    // charges and are, by the engine's own rule, "not part of the per-unit
    // price". Adding them would break the reconciliation they are absent from
    // and assert they are per-unit economics. Emitted as a sibling instead,
    // only when non-zero, so an operator can see them without the stack
    // claiming they compose into the sell.
    for (const unit of skus) {
      if (unit.parentSkuId !== null) continue; // top-level sellable units only
      const upt = rollupBySku.get(unit.id)?.perTier.find((p) => p.tierId === tier.id);
      if (!upt) continue;
      const unitBase = priceBuildKey(unit.id, tier.id);
      // The leaves this unit is made of. An Item Group traces to its members;
      // a Direct Component standing alone is its own single contributor.
      const members = unit.skuRole === "assembly"
        ? skus.filter((s) => s.parentSkuId === unit.id)
        : [unit];
      // A COMPONENT TRACES TO THE LEAVES THAT COMPOSE IT (P-PriceBuild-UX1).
      //
      // These were bare origins, so clicking one opened a terminal with a
      // number and no derivation — technically a trace, and useless. The
      // operator's question is "what makes packaging $6.95", and the answer is
      // the members.
      //
      // Value is the SUM OF THE OPERANDS, not the rollup's scalar, so the node
      // is self-consistent by construction and cannot raise a reconciliation
      // violation on a live surface. A test asserts the sum equals the unit
      // rollup's own figure — if those ever diverge, a test fails rather than
      // the Pricing page.
      const part = (
        name: string,
        label: string,
        pick: (p: SkuPerTierRollup) => number,
      ) => {
        const operands = members.flatMap((m) => {
          const mpt = rollupBySku.get(m.id)?.perTier.find((x) => x.tierId === tier.id);
          if (!mpt) return [];
          return [{
            key: nodeKey(unitBase, name, m.canonicalQuoteLeafId ?? m.id),
            kind: "origin" as const,
            label: productIdentityLabel(m),
            value: pick(mpt),
            unit: "usd" as const,
            origin: { grade: "thin" as const, actor: null, when: null, doc: null },
          }];
        });
        const value = operands.reduce((acc, o) => acc + o.value, 0);
        return operands.length > 1
          ? {
              key: nodeKey(unitBase, name),
              kind: "sum" as const,
              label,
              value,
              unit: "usd" as const,
              op: "Sigma " + label.toLowerCase() + " across " + operands.length + " product(s)",
              operands,
            }
          : {
              key: nodeKey(unitBase, name),
              kind: "origin" as const,
              label,
              value,
              unit: "usd" as const,
              origin: { grade: "thin" as const, actor: null, when: null, doc: null },
            };
      };
      // Exactly the five that compose the per-unit sell. Verified on live data:
      // 6.95 + 0 + 0 + 0.56 + 0 = 7.51 = requiredSellPerUnit.
      const parts = [
        part("pkg", "Packaging", (p) => p.packagingMarkupSumPerUnit),
        part("prod", "Production", (p) => p.productionMarkupSumPerUnit),
        part("raw", "Bulk raw", (p) => p.rawMarkupSumPerUnit),
        part("frt", "Freight", (p) => p.freightContainerMarkupSumPerUnit),
        part("dt", "Duty & tariff", (p) => p.freightDutyTariffMarkupSumPerUnit),
      ];
      // THE COMPONENTS SUM TO THE BUILD, NOT TO THE TERMINAL SELL.
      //
      // P-PriceBuild-1: this node was keyed `sell` and labelled as the
      // finished-good sell. It is neither — it is the pre-adjustment baseline,
      // and binding the terminal row to it made Tier 2 report $4.3262 as the
      // customer sell while the ladder beneath it ran to $4.8337. It passed
      // every fixture because those fixtures carried no adjustment, no lift and
      // no override, so the build and the terminal happened to coincide. A test
      // now pins them apart.
      graphNodes.push({
        key: nodeKey(unitBase, "sell-before"),
        kind: "sum",
        label: "Sell before adjustment · " + unit.skuLabel,
        value: parts.reduce((acc, p) => acc + p.value, 0),
        unit: "usd",
        op: "Packaging + Production + Bulk raw + Freight + Duty & tariff",
        operands: parts,
      });
      // THE LADDER, per unit. The Pricing section's analytical purpose is how a
      // price moved from build to quoted — build, adjustment, lift, override —
      // and that purpose is worth keeping; only the POPULATION the dollars were
      // taken over was wrong. Mirrors the blend set name-for-name so the
      // consumer's shape is unchanged and it reads a scope instead of a mean.
      const scalar = (name: string, label: string, value: number) =>
        graphNodes.push({
          key: nodeKey(unitBase, name),
          kind: "origin",
          label: label + " · " + unit.skuLabel,
          value,
          unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null },
        });
      scalar("cost", "Cost per unit", upt.contributionCostPerUnit);
      // THE GOVERNED TERMINAL. Read from the rollup, which already applied
      // adjustment, lift and override under the engine's own precedence — a
      // direct price is terminal there and stays terminal here. Deliberately
      // NOT the sum of the displayed deltas: summing what a surface renders is
      // how a presentation starts deciding a price.
      scalar(
        "sell",
        unit.skuRole === "assembly" ? "Finished-good sell per unit" : "Product sell per unit",
        upt.requiredSellPerUnit,
      );
      scalar("adj-delta", "Price adjustment contribution", upt.adjDeltaPerUnit);
      scalar("sell-after-adj", "Sell after adjustment", upt.sellAfterAdjustmentPerUnit);
      scalar("lift-delta", "Surgical lift contribution", upt.liftDeltaPerUnit);
      scalar("sell-after-lift", "Sell after lift", upt.sellAfterLiftPerUnit);
      scalar("override-delta", "Override contribution", upt.overrideDeltaPerUnit);
      // Margin is READ from the unit's own rollup, never re-derived here. It
      // keeps whatever authority the engine gave it; this scope publishes it so
      // the Price Build can state it without a second computation.
      if (upt.marginPct !== null) {
        graphNodes.push({
          key: nodeKey(unitBase, "margin"),
          kind: "origin",
          label: "Margin · " + unit.skuLabel,
          value: upt.marginPct,
          unit: "pct",
          origin: { grade: "thin", actor: null, when: null, doc: null },
        });
      }

      const services =
        upt.separateServiceFeesPerUnit + upt.separateServicesMarkupSumPerUnit;
      if (services !== 0) {
        graphNodes.push({
          key: nodeKey(unitBase, "services"),
          kind: "origin",
          label: "Services billed separately · " + unit.skuLabel,
          value: services,
          unit: "usd",
          origin: { grade: "thin", actor: null, when: null, doc: null },
          note: "Billed as fixed charges; not part of the per-unit sell.",
          noteLevel: "info",
        });
      }
    }

    const sellBlend = blend("sell", "Blended sell per unit", (pt) => pt.requiredSellPerUnit);
    const costBlend = blend("cost", "Blended cost per unit", (pt) => pt.contributionCostPerUnit);

    const marginNode: CostingNode =
      sellBlend.value > 0
        ? {
            key: nodeKey(blendBase, "margin"),
            kind: "ratio",
            label: "Blended margin \u00b7 " + tier.label,
            value: (sellBlend.value - costBlend.value) / sellBlend.value,
            unit: "pct",
            op: "(blended sell \u2212 blended cost) \u00f7 blended sell",
            // The denominator is DATA, not a second operand. Making it one
            // would put `sell` under two parents and resolve it to nothing.
            basis: { label: "Blended sell per unit", value: sellBlend.value },
            operands: [
              {
                key: nodeKey(blendBase, "margin", "gross"),
                kind: "difference",
                label: "Gross margin per unit",
                value: sellBlend.value - costBlend.value,
                unit: "usd",
                op: "blended sell \u2212 blended cost",
                operands: [sellBlend, costBlend],
              },
            ],
          }
        : {
            key: nodeKey(blendBase, "margin"),
            kind: "flagged-out",
            label: "Blended margin \u00b7 " + tier.label,
            value: 0,
            unit: "pct",
            reason:
              "Blended sell is zero, so a margin is undefined. A ratio valued " +
              "zero would assert a margin of nothing rather than the absence " +
              "of one.",
          };

    graphNodes.push({
      key: blendBase,
      kind: "sum",
      label: "Quote blend \u00b7 " + tier.label,
      // A container, and now one that carries a quantity somebody governs. The
      // sum of a single operand is that operand \u2014 arithmetically trivial and
      // honestly reconciled, where the previous value was neither.
      value: marginNode.value,
      unit: marginNode.unit,
      op: "tier margin",
      operands: [marginNode],
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
      // Only committed evaluations exist today. The preview entry point lands
      // with the classifier cutover, and must pass this EXPLICITLY rather than
      // relying on a default — a preview mislabelled committed is the whole
      // hazard this field exists for.
      evaluation,
      nodes: graphNodes,
      // Derived from what was actually emitted, never from having reached a
      // planned increment. A flag that outruns the graph is worse than a
      // false one: a consumer told the graph is complete stops checking
      // whether the section it needs is there.
      complete: graphIsComplete(graphNodes),
    },
  };
}
