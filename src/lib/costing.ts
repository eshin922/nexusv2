// Slice 8 — Costing Sheet rollup. Pure TypeScript, no Drizzle imports,
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
};

export type CostingTier = {
  id: string;
  label: string;
  qty: number | null; // null treated as 0 in revenue, but indicates "not yet specified"
  sortOrder: number;
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

export type QuoteCostingInput = {
  quote: { id: string; globalPriceAdjPct: number };
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
  requiredSellPerUnit: number;
  marginPct: number;
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

export type QuoteCostingResult = {
  quote: { id: string; globalPriceAdjPct: number };
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  tiers: Array<{ tierId: string; label: string; qty: number }>;
  skuRollups: SkuRollup[];
  quoteRollup: QuotePerTierRollup[];
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

// Closed-form solve. See top-of-file comment for derivation.
// Returns null if margin already at/above target.
function suggestedAdj(
  currentRevenue: number,
  currentCost: number,
  currentAdj: number,
  targetMargin: number,
): number | null {
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

// ---------- per-leaf, per-tier compute ----------

function computeLeafPerTier(args: {
  sku: CostingSku;
  tier: CostingTier;
  packaging: CostingPackagingInput[];
  production: CostingProductionInput | null;
  freight: CostingFreightInput[];
  globalAdj: number;
  markupDefaults: Record<string, number>;
}): SkuPerTierRollup {
  const { sku, tier, packaging, production, freight, globalAdj, markupDefaults } =
    args;
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
  const requiredSellPerUnit = sellWithoutGlobalAdj * (1 + globalAdj);

  const marginPct =
    requiredSellPerUnit > 0
      ? (requiredSellPerUnit - contributionCostPerUnit) / requiredSellPerUnit
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
    requiredSellPerUnit,
    marginPct,
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
    requiredSellPerUnit: 0,
    marginPct: 0,
    revenue: 0,
    cost: 0,
  };
}

function rollUpAssemblyPerTier(
  tier: CostingTier,
  children: Array<{ rollup: SkuPerTierRollup; qtyPerParent: number }>,
): SkuPerTierRollup {
  const tierQty = num(tier.qty);
  let contribution = 0;
  let requiredSell = 0;
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
    requiredSellPerUnit: requiredSell,
    marginPct,
    revenue: requiredSell * tierQty,
    cost: contribution * tierQty,
  };
}

// ---------- entry ----------

export function computeQuoteCosting(input: QuoteCostingInput): QuoteCostingResult {
  const { quote, firmSettings, markupDefaults, skus, tiers } = input;
  const globalAdj = num(quote.globalPriceAdjPct);

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
        return computeLeafPerTier({
          sku,
          tier,
          packaging: pkgs,
          production: prod,
          freight: frt,
          globalAdj,
          markupDefaults,
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
      return rollUpAssemblyPerTier(tier, childTierRollups);
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
      firmSettings.targetMarginPct,
      firmSettings.floorMarginPct,
    );
    const suggested =
      status === "GOOD"
        ? null
        : suggestedAdj(revenue, cost, globalAdj, firmSettings.targetMarginPct);
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

  return {
    quote: { id: quote.id, globalPriceAdjPct: globalAdj },
    firmSettings: {
      targetMarginPct: firmSettings.targetMarginPct,
      floorMarginPct: firmSettings.floorMarginPct,
    },
    tiers: tiers.map((t) => ({ tierId: t.id, label: t.label, qty: num(t.qty) })),
    skuRollups: renderOrdered,
    quoteRollup,
  };
}
