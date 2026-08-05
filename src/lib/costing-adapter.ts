// ---------- Slice 11.5 — NEW-model → math-layer adapter ----------
//
// Pure function. Maps NEW-model rows (assemblies +
// assembly_leaves + leaves library + assembly_leaf_inputs +
// assembly_production_inputs + assembly_leaf_overrides +
// assembly_leaf_targets) into the `QuoteCostingInput` shape the
// math layer consumes.
//
// **Architectural commitment** (Slice 11.5 brief §3): the math
// layer (`computeQuoteCosting`) consumes `QuoteCostingInput` as
// **data**, not table references. This adapter rebuilds the input
// shape from NEW-model sources WITHOUT touching the math. Future
// schema migrations of the underlying cost data do not require
// math changes — only adapter changes.
//
// Pattern 22-style insulation. Math layer is the load-bearing
// surface; this slice swaps the data source feeding it without
// changing the surface. Future cost-data migrations follow the
// same discipline.
//
// Pure function semantics:
//   - No DB access (caller loads rows + passes them in)
//   - No side effects
//   - Returns a fully-typed `QuoteCostingInput`
//   - Trivially unit-testable; identical input → identical output
//
// Three semantic-mapping decisions worth calling out:
//
// 1. **Assemblies become math-assemblies; assembly_leaves become
//    math-leaves.** The NEW-model tree (assembly → leaves library
//    via assembly_leaves junction) maps to the math layer's two-
//    level SKU tree (parent assembly with leaf children). Each
//    assembly_leaf gets its own math-leaf entry keyed by
//    `assembly_leaf.id` (the cost-bearing junction PK).
//
// 2. **Packaging is per-cell (assembly_leaf × tier).** Direct
//    passthrough — `assembly_leaf_inputs` rows map to
//    `CostingPackagingInput` with `quoteSkuId = assembly_leaf.id`.
//
// 3. **Production is per-assembly in NEW model; math expects per-
//    leaf.** The adapter emits production[] rows on the FIRST
//    assembly_leaf under each assembly (the "anchor leaf" — lowest
//    `position`). Siblings get no production[] entries.
//
//    Why anchor-leaf, not fan-out + divide-by-N:
//      - The math layer rolls up children additively to the
//        assembly. Single anchor: anchor.cost = packaging +
//        production; siblings = packaging only; assembly = sum.
//        Math total correct.
//      - Fan-out + divide: each leaf gets production/N. Math total
//        correct but per-leaf representation is fractional + the
//        N-division is arbitrary.
//      - Anchor-only is auditable: one assembly_production_inputs
//        row ↔ one production[] entry. Trace from math input to
//        DB row is 1:1.
//
//    v1.1+ revisit: if PMs find the anchor-leaf representation
//    confusing in the Production drilldown UI, extend the math
//    layer to consume production keyed by assembly_id directly
//    (or add a per-assembly production slot to QuoteCostingInput).
//    Both require math-layer changes (Pattern 22 §3 commitment)
//    so they belong in a later slice, not Slice 11.5.

import type {
  CostingCellOverride,
  CostingCellTarget,
  CostingFreightLeg,
  CostingFreightLegGroup,
  CostingFreightLegTier,
  CostingPackagingInput,
  CostingProductionInput,
  CostingSku,
  CostingTier,
  QuoteCostingInput,
} from "@/lib/costing";

// ---------- Input shapes (loader hands these in) ----------

// Minimum columns from `assemblies` the adapter needs. Caller may
// pass the full `typeof assemblies.$inferSelect` (extra fields are
// ignored at runtime; structural-typing satisfies TS).
export type AdapterAssemblyRow = {
  id: string;
  sku: string;
  name: string;
  position: number;
};

// Minimum columns from `assembly_leaves` joined with `leaves` lib.
// The library leaf's name + sku flow into the math-leaf's
// productName + skuLabel.
export type AdapterAssemblyLeafRow = {
  id: string;
  quoteLeafId: string;
  assemblyId: string;
  leafId: string;
  quantity: string | number; // numeric column — Drizzle returns string
  position: number;
  // From the joined leaves row:
  leafName: string;
  leafSku: string;
};

// Minimum columns from `assembly_leaf_inputs`. Direct passthrough
// to CostingPackagingInput.
export type AdapterAssemblyLeafInputRow = {
  assemblyLeafId: string;
  tierId: string;
  lineGroupId: string;
  pricingVendorHubspotCompanyId: string | null;
  pricingVendorNameSnapshot: string | null;
  unitCost: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
};

// Minimum columns from `assembly_production_inputs`. Production
// policy + per-tier service-fee inputs at assembly level.
export type AdapterAssemblyProductionInputRow = {
  assemblyId: string;
  tierId: string;
  customerShipsRaws: boolean;
  allocateServiceFeesToCost: boolean;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  setupFeeTotal: string | null;
  toolingArtworkTotal: string | null;
  rdTotal: string | null;
  otherServiceTotal: string | null;
  bulkRawCost: string | null;
  actualUnitsProduced: number | null;
};

// Minimum columns from `assembly_leaf_overrides`. Sparse — only
// rows where a PM has set an override exist.
export type AdapterAssemblyLeafOverrideRow = {
  assemblyLeafId: string;
  tierId: string;
  sellPriceOverride: string;
};

// Minimum columns from `assembly_leaf_targets`. Sparse mirror.
export type AdapterAssemblyLeafTargetRow = {
  assemblyLeafId: string;
  tierId: string;
  clientTargetPricePerUnit: string;
};

// Slice 11.5 adapter input — all NEW-model rows + freight (already
// model-agnostic per scoping inventory §1) + firm settings +
// markup defaults bundled together.
export type BuildQuoteCostingInputFromNewModelArgs = {
  quote: {
    id: string;
    globalPriceAdjPct: number;
    targetMarginPct: number | null;
    freightMarkupPct: number;
  };
  firmSettings: {
    targetMarginPct: number;
    floorMarginPct: number;
  };
  markupDefaults: Record<string, number>;
  tiers: CostingTier[];
  assemblies: AdapterAssemblyRow[];
  assemblyLeaves: AdapterAssemblyLeafRow[];
  assemblyLeafInputs: AdapterAssemblyLeafInputRow[];
  assemblyProductionInputs: AdapterAssemblyProductionInputRow[];
  assemblyLeafOverrides: AdapterAssemblyLeafOverrideRow[];
  assemblyLeafTargets: AdapterAssemblyLeafTargetRow[];
  freightLegGroups: CostingFreightLegGroup[];
  freightLegs: CostingFreightLeg[];
  freightLegTiers: CostingFreightLegTier[];
  freightComponentTierCosts: QuoteCostingInput["freightComponentTierCosts"];
};

// ---------- Adapter implementation ----------

const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
};

const numOrNull = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildQuoteCostingInputFromNewModel(
  args: BuildQuoteCostingInputFromNewModelArgs,
): QuoteCostingInput {
  // ---- skus[] : assemblies + assembly_leaves flatten ----
  //
  // Assemblies emit first (skuRole='assembly', parentSkuId=null).
  // Assembly_leaves emit second (skuRole='leaf',
  // parentSkuId=assembly.id, qtyPerParent=assembly_leaves.quantity).
  // The math layer's DFS traversal sees assemblies as roots and
  // visits children in (sortOrder, createdAt) order — matches the
  // OLD-model quote_skus tree shape.
  //
  // retailBenchmark defaults to null on every row (per brief §8 +
  // Pattern 45 cross-reference: deferred to v1.1+ unless Slice 11
  // PDF audit pulls it forward; absent → renders as empty per
  // graceful-degradation pattern in customer-facing tree).
  const skus: CostingSku[] = [];
  for (const a of args.assemblies) {
    skus.push({
      id: a.id,
      canonicalQuoteLeafId: null,
      parentSkuId: null,
      qtyPerParent: null,
      skuRole: "assembly",
      skuLabel: a.sku,
      productName: a.name,
      sortOrder: a.position,
      retailBenchmark: null,
    });
  }
  for (const al of args.assemblyLeaves) {
    skus.push({
      id: al.id,
      canonicalQuoteLeafId: al.quoteLeafId,
      parentSkuId: al.assemblyId,
      qtyPerParent: num(al.quantity),
      skuRole: "leaf",
      skuLabel: al.leafSku,
      productName: al.leafName,
      sortOrder: al.position,
      retailBenchmark: null,
    });
  }

  // ---- packaging[] : assembly_leaf_inputs direct passthrough ----
  //
  // assembly_leaf_inputs is per-(assembly_leaf, line_group, tier).
  // Math layer keys CostingPackagingInput by quoteSkuId which —
  // post-adapter — is the assembly_leaf.id (the math-leaf identity
  // for NEW-model packaging cells).
  const packaging: CostingPackagingInput[] = args.assemblyLeafInputs.map(
    (ali) => ({
      quoteSkuId: ali.assemblyLeafId,
      tierId: ali.tierId,
      lineGroupId: ali.lineGroupId,
      unitCost: numOrNull(ali.unitCost),
      qtyPerSellableUnit: numOrNull(ali.qtyPerSellableUnit),
      category: ali.category,
      markupPct: numOrNull(ali.markupPct),
    }),
  );

  // ---- production[] : anchor-leaf-only fan-out ----
  //
  // assembly_production_inputs is per-(assembly, tier). Math layer
  // expects production keyed by leaf id. Adapter picks the "anchor
  // leaf" (lowest `position`) per assembly and emits production[]
  // rows only on that leaf.
  //
  // See header comment for the rationale on anchor-leaf vs
  // fan-out + divide. Trace: one assembly_production_inputs row ↔
  // one production[] entry; full values intact; math sum matches
  // the source row's totals.
  const anchorLeafByAssembly = new Map<string, string>();
  // Iterate in (assemblyId, position) order so we deterministically
  // pick the lowest-position leaf as the anchor. The input array
  // order isn't guaranteed, so build the index ourselves.
  const leavesByAssembly = new Map<string, AdapterAssemblyLeafRow[]>();
  for (const al of args.assemblyLeaves) {
    const arr = leavesByAssembly.get(al.assemblyId) ?? [];
    arr.push(al);
    leavesByAssembly.set(al.assemblyId, arr);
  }
  for (const [assemblyId, leaves] of leavesByAssembly) {
    const sorted = [...leaves].sort((a, b) => a.position - b.position);
    if (sorted.length > 0) {
      anchorLeafByAssembly.set(assemblyId, sorted[0].id);
    }
  }

  const production: CostingProductionInput[] = [];
  for (const api of args.assemblyProductionInputs) {
    const anchorLeafId = anchorLeafByAssembly.get(api.assemblyId);
    if (!anchorLeafId) {
      // Assembly has no leaves — production row has nowhere to
      // attach. Skip silently; this is a degenerate state (no
      // components to produce) and the cost contribution would be
      // 0 anyway. Future v1.1+ may surface this as a quote warning.
      continue;
    }
    production.push({
      quoteSkuId: anchorLeafId,
      tierId: api.tierId,
      customerShipsRaws: api.customerShipsRaws,
      allocateServiceFeesToCost: api.allocateServiceFeesToCost,
      fillingBlendingCost: numOrNull(api.fillingBlendingCost),
      cmAssemblyTotal: numOrNull(api.cmAssemblyTotal),
      setupFeeTotal: numOrNull(api.setupFeeTotal),
      toolingArtworkTotal: numOrNull(api.toolingArtworkTotal),
      rdTotal: numOrNull(api.rdTotal),
      otherServiceTotal: numOrNull(api.otherServiceTotal),
      bulkRawCost: numOrNull(api.bulkRawCost),
      actualUnitsProduced: api.actualUnitsProduced,
    });
  }

  // ---- cellOverrides[] : assembly_leaf_overrides direct passthrough ----
  const cellOverrides: CostingCellOverride[] = args.assemblyLeafOverrides.map(
    (alo) => ({
      quoteSkuId: alo.assemblyLeafId,
      tierId: alo.tierId,
      sellPriceOverride: num(alo.sellPriceOverride),
    }),
  );

  // ---- cellTargets[] : assembly_leaf_targets direct passthrough ----
  const cellTargets: CostingCellTarget[] = args.assemblyLeafTargets.map(
    (alt) => ({
      quoteSkuId: alt.assemblyLeafId,
      tierId: alt.tierId,
      clientTargetPricePerUnit: num(alt.clientTargetPricePerUnit),
    }),
  );

  return {
    quote: args.quote,
    firmSettings: args.firmSettings,
    markupDefaults: args.markupDefaults,
    skus,
    tiers: args.tiers,
    packaging,
    production,
    freightLegGroups: args.freightLegGroups,
    freightLegs: args.freightLegs,
    freightLegTiers: args.freightLegTiers,
    freightComponentTierCosts: args.freightComponentTierCosts,
    cellOverrides,
    cellTargets,
  };
}
