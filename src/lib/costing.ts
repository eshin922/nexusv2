// Slice 8 — Pricing rollup. Pure TypeScript, no Drizzle imports,
// no server-only. Takes plain data structures (caller assembles from DB),
// returns plain data structures. Unit-testable via a fixture script.
// Same pattern as src/lib/sku-tree.ts — client-safe in principle; the
// server-only concern lives at the data-fetching wrapping action layer.
//
// Math reference (canonical formulas; mirror docs/CLAUDE.md
// "Customs / landed-cost data"):
//
//   factoryCost/unit  = packagingCost/unit
//                       + productionCost/unit (when allocate_service_fees=true)
//                       + rawCost/unit (when not customer_ships_raws)
//
//   Two-step container freight formula (split for unambiguous algebra
//   — earlier "÷ effective_units" wording invited misreading):
//
//   container_freight_per_sku  = (freight.sku_total_cbm / total_shipment_cbm)
//                                × line.total_freight
//   container_freight_per_unit = container_freight_per_sku / effective_units
//
//     where total_shipment_cbm = sum across SKUs in the same freight line
//     × tier of sku_total_cbm; in v1 each freight line is per-SKU so
//     total_cbm = this row's sku_total_cbm and the per-SKU share is the
//     full line.total_freight; per_unit = line.total_freight / effective_units.
//
//     effective_units = freight_inputs.units_in_shipment ?? tier.qty.
//
// Per-SKU CI value semantics (duty/tariff):
//
//   duty_per_unit/tariff_per_unit are computed as factory_cost_per_unit
//   × pct, which is algebraically equivalent to
//   (factory_cost × tier.qty × pct) / tier.qty, where the numerator
//   (factory_cost × tier.qty) is this SKU's CI value (Customs Invoice)
//   at that tier. Per-SKU duty_pct + tariff_pct live on quote_skus and
//   apply at whatever SKU level the actual customs declaration is filed
//   — the PM's call. Roman gummies pattern: jars + caps shipped together,
//   each declared separately, each carries its own duty/tariff against
//   its own CI. Fully-assembled finished goods declared as one HS code
//   put duty/tariff on the assembly SKU instead, and the leaves under
//   that assembly should NOT also carry customs (would double-count).
//   v1 schema permits both shapes; data integrity is the PM's
//   responsibility (UI surfaces customs on every SKU; rollup math
//   applies at whichever level it's set).
//
//   duty/unit         = factoryCost/unit × sku.duty_pct
//   tariff/unit       = factoryCost/unit × sku.tariff_pct
//   landed_before     = container + duty + tariff
//   landed_with_markup = landed_before × (1 + freight.markup_pct)
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
  parentSkuId: string | null;
  qtyPerParent: number | null;
  skuRole: SkuRoleValue;
  skuLabel: string;
  productName: string;
  sortOrder: number;
  // Slice 8 schema correction: cbm_per_unit moved to freight_inputs.sku_total_cbm.
  // duty_pct + tariff_pct stay per-SKU (don't change with shipment/tier).
  dutyPct: number | null;
  tariffPct: number | null;
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

export type CostingFreightInput = {
  quoteSkuId: string;
  tierId: string;
  lineGroupId: string;
  totalFreight: number | null;
  unitsInShipment: number | null;
  // Slice 8 — total CBM this SKU occupies in this shipment at this tier.
  // Per-(SKU, line, tier). PMs derive from pallet inspection. NULL = no
  // CBM data → no container freight contribution (treated as 0; rest of
  // landed-freight components, duty + tariff, still apply).
  skuTotalCbm: number | null;
  markupPct: number | null;
  freightTreatment: "bundled" | "pass_through";
};

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
  freight: CostingFreightInput[];
  // Slice 9.3 — sparse per-cell sell-price overrides. Empty array =
  // no overrides anywhere. Order doesn't matter; computeQuoteCosting
  // builds a `${skuId}::${tierId}` lookup map internally.
  cellOverrides: CostingCellOverride[];
  // Slice 9.4b — sparse per-cell client target benchmarks. Mirror
  // shape to cellOverrides; lazy rows on `quote_sku_tier_targets`.
  cellTargets: CostingCellTarget[];
};

export type FreightLineBreakdown = {
  lineGroupId: string;
  containerFreightPerUnit: number;
  dutyPerUnit: number;
  tariffPerUnit: number;
  landedFreightBeforeMarkup: number;
  landedFreightWithMarkup: number;
  freightMarkupPct: number;
  freightTreatment: "bundled" | "pass_through";
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
  freightLines: FreightLineBreakdown[];
  totalLandedFreightBeforeMarkup: number;
  totalLandedFreightWithMarkup: number;
  separateServiceFeesPerUnit: number; // when allocate_service_fees=false
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
};

// ---------- helpers ----------

const FALLBACK_MARKUP = 0.3;
const PRODUCTION_MARKUP_CATEGORY = "Manufacturing";
const RAW_MARKUP_CATEGORY = "Raw ingredients"; // Slice 9 will likely add this; falls back to Other today

function num(v: number | null | undefined, fallback = 0): number {
  return v == null ? fallback : v;
}

function lookupMarkup(
  defaults: Record<string, number>,
  category: string | null,
  fallbackCategory = "Other",
): number {
  if (category && defaults[category] !== undefined) return defaults[category];
  if (defaults[fallbackCategory] !== undefined)
    return defaults[fallbackCategory];
  return FALLBACK_MARKUP;
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
  freight: CostingFreightInput[];
  globalAdj: number;
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
}): SkuPerTierRollup {
  const {
    sku,
    tier,
    packaging,
    production,
    freight,
    globalAdj,
    markupDefaults,
    cellOverride,
    effectiveTarget,
    floor,
    cellTarget,
  } = args;
  const tierQty = num(tier.qty);

  // ---------- packaging ----------
  // Each packaging line contributes (unit_cost × qty_per_sellable_unit) to
  // the per-unit cost. Markup applies per-line (line.markup_pct, falling
  // back to the line's category default, then to "Other", then to 0.30).
  let packagingCostSum = 0;
  let packagingMarkupSum = 0;
  for (const p of packaging) {
    const lineCost = num(p.unitCost) * num(p.qtyPerSellableUnit, 1);
    packagingCostSum += lineCost;
    const markup =
      p.markupPct !== null
        ? p.markupPct
        : lookupMarkup(markupDefaults, p.category);
    packagingMarkupSum += lineCost * (1 + markup);
  }

  // ---------- production ----------
  // Per-tier amortization: divide production lump amounts by
  // (actual_units_produced ?? tier.qty). When tier.qty is 0 the per-unit
  // amortization is undefined; treat as 0 (no contribution).
  let productionCostSum = 0;
  let separateServiceFees = 0;
  let rawCost = 0;
  if (production && tierQty > 0) {
    const denom = num(production.actualUnitsProduced, tierQty);
    const services =
      num(production.fillingBlendingCost) +
      num(production.cmAssemblyTotal) +
      num(production.setupFeeTotal) +
      num(production.toolingArtworkTotal) +
      num(production.rdTotal) +
      num(production.otherServiceTotal);
    const servicesPerUnit = denom > 0 ? services / denom : 0;

    if (production.allocateServiceFeesToCost) {
      productionCostSum = servicesPerUnit;
    } else {
      separateServiceFees = servicesPerUnit;
    }

    if (!production.customerShipsRaws) {
      const bulk = num(production.bulkRawCost);
      rawCost = denom > 0 ? bulk / denom : 0;
    }
  }

  const productionMarkup = lookupMarkup(
    markupDefaults,
    PRODUCTION_MARKUP_CATEGORY,
  );
  const rawMarkup = lookupMarkup(
    markupDefaults,
    RAW_MARKUP_CATEGORY,
    "Other",
  );

  const productionMarkupSum = productionCostSum * (1 + productionMarkup);
  const rawMarkupSum = rawCost * (1 + rawMarkup);
  const separateServicesMarkupSum = separateServiceFees * (1 + productionMarkup);

  // ---------- factory cost ----------
  const factoryCostPerUnit = packagingCostSum + productionCostSum + rawCost;

  // ---------- freight ----------
  // For each freight line on this leaf in this tier:
  //   effective_units    = freight_inputs.units_in_shipment ?? tier.qty
  //   total_shipment_cbm = sum across SKUs in same line_group_id × tier
  //                        of sku_total_cbm. In v1 each freight line is
  //                        per-SKU (single quote_sku_id) so this
  //                        simplifies to just this row's sku_total_cbm.
  //   this_sku_freight_$  = (sku_total_cbm / total_shipment_cbm)
  //                         × line.total_freight
  //   container/unit      = this_sku_freight_$ / effective_units
  //   duty/unit           = factoryCostPerUnit × sku.duty_pct
  //   tariff/unit         = factoryCostPerUnit × sku.tariff_pct
  //   landed_before       = container + duty + tariff
  //   landed_with_markup  = landed_before × (1 + freight.markup_pct)
  //
  // NULL handling:
  //   sku_total_cbm null → container freight = 0 (cost rollup proceeds
  //     with duty + tariff only; UI surfaces "incomplete landed cost")
  //   total_shipment_cbm = 0 (all rows null or genuinely zero) →
  //     container = 0; division-by-zero is guarded.
  //   total_freight null/0 → entire freight line contributes 0.
  const freightLines: FreightLineBreakdown[] = [];
  let totalLandedBefore = 0;
  let totalLandedWithMarkup = 0;
  for (const f of freight) {
    const total = num(f.totalFreight);
    if (total <= 0) {
      // Empty freight line — record breakdown but no contribution.
      freightLines.push({
        lineGroupId: f.lineGroupId,
        containerFreightPerUnit: 0,
        dutyPerUnit: 0,
        tariffPerUnit: 0,
        landedFreightBeforeMarkup: 0,
        landedFreightWithMarkup: 0,
        freightMarkupPct: num(f.markupPct, FALLBACK_MARKUP),
        freightTreatment: f.freightTreatment,
      });
      continue;
    }
    const effectiveUnits = num(f.unitsInShipment, tierQty);
    const skuTotalCbm = num(f.skuTotalCbm);
    // v1 simplification: each line is per-SKU, so total_shipment_cbm
    // for this (line, tier) is just this row's sku_total_cbm. When v1.5
    // adds shared shipments, the caller will pre-compute the sum across
    // sibling rows and pass it via a future field on CostingFreightInput.
    const totalShipmentCbm = skuTotalCbm;
    const thisSkuShare =
      totalShipmentCbm > 0 ? (skuTotalCbm / totalShipmentCbm) * total : 0;
    const container = effectiveUnits > 0 ? thisSkuShare / effectiveUnits : 0;
    const duty = factoryCostPerUnit * num(sku.dutyPct);
    const tariff = factoryCostPerUnit * num(sku.tariffPct);
    const landedBefore = container + duty + tariff;
    const freightMarkup = num(f.markupPct, FALLBACK_MARKUP);
    const landedWithMarkup = landedBefore * (1 + freightMarkup);
    freightLines.push({
      lineGroupId: f.lineGroupId,
      containerFreightPerUnit: container,
      dutyPerUnit: duty,
      tariffPerUnit: tariff,
      landedFreightBeforeMarkup: landedBefore,
      landedFreightWithMarkup: landedWithMarkup,
      freightMarkupPct: freightMarkup,
      freightTreatment: f.freightTreatment,
    });
    totalLandedBefore += landedBefore;
    totalLandedWithMarkup += landedWithMarkup;
  }

  // ---------- contribution + required sell ----------
  const contributionCostPerUnit =
    factoryCostPerUnit + totalLandedBefore + separateServiceFees;

  // Required sell stacks each component's pre-global-adj sell, then
  // multiplies by (1 + global_adj). Each component carries its own markup.
  const sellWithoutGlobalAdj =
    packagingMarkupSum +
    productionMarkupSum +
    rawMarkupSum +
    separateServicesMarkupSum +
    totalLandedWithMarkup;
  // Slice 9.3 — `computedSellPerUnit` is the pure markup-chain result.
  // Always exposed for UI ("was $X" tooltip on OVR badges).
  const computedSellPerUnit = sellWithoutGlobalAdj * (1 + globalAdj);
  // Slice 9.3 — per-cell override is TERMINAL. When set, it replaces
  // computedSellPerUnit entirely; downstream margin/revenue use this
  // value. Action layer rejects override <= 0, so positive value
  // expected here. Defensive guard below handles the bypass case.
  const requiredSellPerUnit = cellOverride ?? computedSellPerUnit;
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
    freightLines,
    totalLandedFreightBeforeMarkup: totalLandedBefore,
    totalLandedFreightWithMarkup: totalLandedWithMarkup,
    separateServiceFeesPerUnit: separateServiceFees,
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
    freightLines: [],
    totalLandedFreightBeforeMarkup: 0,
    totalLandedFreightWithMarkup: 0,
    separateServiceFeesPerUnit: 0,
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
  let serviceFees = 0;
  for (const c of children) {
    contribution += c.rollup.contributionCostPerUnit * c.qtyPerParent;
    requiredSell += c.rollup.requiredSellPerUnit * c.qtyPerParent;
    computedSell += c.rollup.computedSellPerUnit * c.qtyPerParent;
    packaging += c.rollup.packagingCostPerUnit * c.qtyPerParent;
    production += c.rollup.productionCostPerUnit * c.qtyPerParent;
    raw += c.rollup.rawCostPerUnit * c.qtyPerParent;
    landedFreight +=
      c.rollup.totalLandedFreightBeforeMarkup * c.qtyPerParent;
    serviceFees += c.rollup.separateServiceFeesPerUnit * c.qtyPerParent;
  }
  const marginPct =
    requiredSell > 0 ? (requiredSell - contribution) / requiredSell : 0;
  return {
    tierId: tier.id,
    packagingCostPerUnit: packaging,
    productionCostPerUnit: production,
    rawCostPerUnit: raw,
    factoryCostPerUnit: packaging + production + raw,
    freightLines: [],
    totalLandedFreightBeforeMarkup: landedFreight,
    // Markup-applied freight isn't roll-up-meaningful at the assembly
    // level (markup math runs per-line on leaves); skip.
    totalLandedFreightWithMarkup: 0,
    separateServiceFeesPerUnit: serviceFees,
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
  const freightBySkuTier = new Map<string, CostingFreightInput[]>();
  for (const f of input.freight) {
    const k = `${f.quoteSkuId}::${f.tierId}`;
    const arr = freightBySkuTier.get(k) ?? [];
    arr.push(f);
    freightBySkuTier.set(k, arr);
  }
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
        const frt = freightBySkuTier.get(`${sku.id}::${tier.id}`) ?? [];
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
        return computeLeafPerTier({
          sku,
          tier,
          packaging: pkgs,
          production: prod,
          freight: frt,
          globalAdj: effectiveAdj,
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
    let revenue = 0;
    let cost = 0;
    // Per-component breakdown: aggregate the rolled-up per-component
    // values × tier.qty across top-level SKUs. The assembly rollup
    // (rollUpAssemblyPerTier) bubbles per-component up the tree
    // respecting qty_per_parent, so summing top-level here is correct.
    const breakdown: QuoteCostBreakdown = {
      packaging: 0,
      production: 0,
      freight: 0,
      serviceFees: 0,
    };
    for (const top of topLevel) {
      const r = rollupBySku.get(top.id);
      if (!r) continue;
      const pt = r.perTier.find((p) => p.tierId === tier.id);
      if (!pt) continue;
      revenue += pt.revenue;
      cost += pt.cost;
      const tQty = num(tier.qty);
      breakdown.packaging += pt.packagingCostPerUnit * tQty;
      // raw bulk cost folds into "production" for breakdown purposes
      // (see QuoteCostBreakdown comment).
      breakdown.production +=
        (pt.productionCostPerUnit + pt.rawCostPerUnit) * tQty;
      breakdown.freight += pt.totalLandedFreightBeforeMarkup * tQty;
      breakdown.serviceFees += pt.separateServiceFeesPerUnit * tQty;
    }
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
  };
}
