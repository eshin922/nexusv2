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
// 1. **The SKU population is the canonical attachment set.** Per
//    OD-014 the governed commercial SKU for Pricing aggregation is
//    `quote_leaves.id`, so the adapter enumerates canonical
//    attachments; assemblies become math-assemblies and each
//    attachment becomes a math-leaf.
//
//    This previously enumerated `assembly_leaves`, which made the
//    presence of an assembly a precondition for being a SKU at all
//    and silently excluded a leaf attached directly to the quote
//    (`quote_leaves.assembly_id IS NULL`). That form is indexed for
//    in the schema and validated by the identity module, and it is
//    the shape ASY-optional quote authoring produces.
//
//    The math-leaf is still KEYED by `assembly_leaf.id` wherever one
//    exists, because the cost-input tables are. Population and
//    keying are separate questions: OD-014 settles the first, the
//    compatibility window governs the second, and the canonical id
//    rides along on every SKU as `canonicalQuoteLeafId`.
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

import {
  indexClientTargets,
  resolveClientTarget,
} from "./client-target";
import type { ChargeElection } from "./commercial-recovery/resolve";
import type {
  ComponentChargeInput,
  CostingCellOverride,
  CostingCellTarget,
  CostingLift,
  CostingFreightLeg,
  CostingFreightLegGroup,
  CostingFreightLegTier,
  CostingPackagingInput,
  CostingAssemblyProductionInput,
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

// One canonical commercial attachment — a `quote_leaves` row joined to the
// library `leaves` row it points at, plus its legacy compatibility row where
// one exists. The library leaf's name + sku flow into the math-leaf's
// productName + skuLabel.
//
// `assemblyLeafId` is the LEGACY identity, retained only because the cost-input
// tables still key on it. Its nullability is load-bearing rather than
// defensive: `quote_leaves.assembly_id` is nullable, so a leaf may attach
// directly to the quote with no assembly and therefore no legacy row.
//
// `leafId` is deliberately NOT an identity. The same library leaf attaches up
// to three times within a single quote in production, so it does not
// distinguish commercial lines. Phase 3 forbids resolving through it.
export type AdapterQuoteLeafAttachmentRow = {
  quoteLeafId: string;
  /** Legacy grouped-membership id. NULL for a direct canonical attachment. */
  assemblyLeafId: string | null;
  /** NULL when the leaf attaches directly to the quote. */
  assemblyId: string | null;
  leafId: string;
  quantity: string | number; // numeric column — Drizzle returns string
  position: number;
  // From the joined leaves row:
  leafName: string;
  leafSku: string;
  /** From the joined library leaf. NULL for a product. */
  serviceIdentity?: string | null;
};

/**
 * The id the math layer keys a leaf by: the canonical `quote_leaf_id`, always.
 *
 * OD-017 removed the previous `assemblyLeafId ?? quoteLeafId` fallback. That
 * fallback existed because the cost-input tables keyed on the legacy junction,
 * which a Direct Component has no row in — so a direct attachment was
 * representable but not priceable. Migration 0066 re-keyed those tables onto
 * `quote_leaf_id`, so there is now exactly one identity and nothing to fall
 * back to.
 *
 * The fallback was REMOVED rather than generalised on purpose. Two
 * interchangeable identifiers surviving into steady state is precisely the
 * ambiguity this slice exists to end: a single domain makes an ASY-backed leaf
 * and a Direct Component unable to collide, rather than unlikely to.
 */
function mathSkuId(row: AdapterQuoteLeafAttachmentRow): string {
  return row.quoteLeafId;
}

// Minimum columns from `assembly_leaf_inputs`. Direct passthrough
// to CostingPackagingInput.
export type AdapterAssemblyLeafInputRow = {
  quoteLeafId: string;
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
  // Stage 3 A · exactly one owner. `assemblyId` for an Item Group, or
  // `quoteLeafId` for a top-level Direct Service. The database enforces the
  // XOR and restricts the leaf branch to service-classified leaves; this type
  // reflects that rather than re-asserting it.
  assemblyId: string | null;
  quoteLeafId: string | null;
  tierId: string;
  allocateServiceFeesToCost: boolean;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  setupFeeTotal: string | null;
  toolingArtworkTotal: string | null;
  toolingTotal: string | null;
  artworkTotal: string | null;
  rdTotal: string | null;
  testingMicrosTotal: string | null;
  otherServiceTotal: string | null;
  bulkRawCost: string | null;
  actualUnitsProduced: number | null;
};

// Minimum columns from `assembly_leaf_overrides`. Sparse — only
// rows where a PM has set an override exist.
export type AdapterAssemblyLeafOverrideRow = {
  quoteLeafId: string;
  tierId: string;
  sellPriceOverride: string;
};

// Minimum columns from `assembly_leaf_targets`. Sparse mirror.
/** One `quote_client_targets` row. Exactly one id column is set; `tierId`
 *  NULL is the common target for every tier. */
export type AdapterClientTargetRow = {
  assemblyId: string | null;
  quoteLeafId: string | null;
  tierId: string | null;
  clientTargetPricePerUnit: string;
};

// Minimum columns from `quote_leaf_lifts` (Phase 3 · Package 1).
//
// The one sparse cost-side table keyed CANONICALLY rather than on the legacy
// junction, so this is the only adapter row type that maps to its engine
// counterpart without a translation step — `CostingLift.quoteLeafId` is the
// same identity `quote_leaf_lifts.quote_leaf_id` stores.
export type AdapterQuoteLeafLiftRow = {
  quoteLeafId: string;
  tierId: string;
  liftPct: string;
};

// Slice 11.5 adapter input — all NEW-model rows + freight (already
// model-agnostic per scoping inventory §1) + firm settings +
// markup defaults bundled together.
export type BuildQuoteCostingInputFromNewModelArgs = {
  /**
   * The quote's recovery elections.
   *
   * REQUIRED, not optional, and that is the point. The adapter builds the whole
   * `QuoteCostingInput`, so a field it does not carry is a field the engine
   * never sees — and `chargeElections` being optional on the input type meant
   * an omission here read as "no elections" rather than as a mistake.
   *
   * That is exactly what happened: elections were loaded onto the bundle,
   * threaded through the snapshot, and dropped HERE. The election persisted,
   * the workspace reported it as elected, and the placement did not move. The
   * unit tests passed because they call `computeQuoteCosting` directly.
   *
   * Required means every call site has to answer the question.
   */
  chargeElections: readonly ChargeElection[];
  /**
   * Component-owned charge economics, per (instance, tier) — OD-032 phase 2.
   *
   * REQUIRED for the same reason `chargeElections` above is required, and the
   * defect that comment describes is the one this is guarding against: a value
   * that reaches the bundle, reaches the snapshot, and is dropped here reads as
   * "there were none" at every layer that could have noticed.
   *
   * Empty is the ordinary case and means no component caused a one-time charge.
   */
  componentCharges: readonly ComponentChargeInput[];
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
  /**
   * The governed SKU population (OD-014): canonical `quote_leaves` attachments,
   * NOT `assembly_leaves`. Discovering the population from the legacy table
   * made assembly presence a precondition for being a SKU — see C-2 in
   * `docs/gate-1b-od-014-sku-identity.md`.
   */
  quoteLeafAttachments: AdapterQuoteLeafAttachmentRow[];
  assemblyLeafInputs: AdapterAssemblyLeafInputRow[];
  assemblyProductionInputs: AdapterAssemblyProductionInputRow[];
  assemblyLeafOverrides: AdapterAssemblyLeafOverrideRow[];
  clientTargets: AdapterClientTargetRow[];
  /**
   * Applied surgical lifts already in effect on the quote.
   *
   * REQUIRED rather than optional, and every caller with no lift concept passes
   * `[]` explicitly. Optionality is what made the freight-worksheet fields
   * disappear from a client-side reconstruction without a single type error —
   * an absent optional field and a deliberately empty one are indistinguishable
   * to the compiler and produce different prices. Here the compiler asks.
   */
  lifts: AdapterQuoteLeafLiftRow[];
  freightLegGroups: CostingFreightLegGroup[];
  freightLegs: CostingFreightLeg[];
  freightLegTiers: CostingFreightLegTier[];
  freightComponentTierCosts: QuoteCostingInput["freightComponentTierCosts"];
  freightShipmentBreaks?: QuoteCostingInput["freightShipmentBreaks"];
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
  for (const al of args.quoteLeafAttachments) {
    skus.push({
      id: mathSkuId(al),
      canonicalQuoteLeafId: al.quoteLeafId,
      parentSkuId: al.assemblyId,
      qtyPerParent: num(al.quantity),
      skuRole: "leaf",
      skuLabel: al.leafSku,
      productName: al.leafName,
      sortOrder: al.position,
      serviceIdentity: al.serviceIdentity ?? null,
      retailBenchmark: null,
    });
  }

  // ---- packaging[] : assembly_leaf_inputs direct passthrough ----
  //
  // assembly_leaf_inputs is per-(quote_leaf, line_group, tier) after OD-017.
  // Math layer keys CostingPackagingInput by quoteSkuId which — post-adapter —
  // is the quote_leaves.id, the same identity `mathSkuId` assigns the leaf. A
  // Direct Component's cells therefore land on its leaf with no special case.
  const packaging: CostingPackagingInput[] = args.assemblyLeafInputs.map(
    (ali) => ({
      quoteSkuId: ali.quoteLeafId,
      tierId: ali.tierId,
      lineGroupId: ali.lineGroupId,
      unitCost: numOrNull(ali.unitCost),
      qtyPerSellableUnit: numOrNull(ali.qtyPerSellableUnit),
      category: ali.category,
      markupPct: numOrNull(ali.markupPct),
    }),
  );

  // ---- production[] : LEAF-OWNED ONLY.  assemblyProduction[] : the rest ----
  //
  // OD-028 DELETED THE ANCHOR.
  //
  // This block used to pick the lowest-`position` member of each assembly and
  // emit the Item Group's entire production onto that member's math id. The
  // sort had no tiebreak, so with members tied at the same position the anchor
  // was whichever row the database happened to return first - and moving the
  // members moved Tier 3 of a production quote by $168, because a manual all-in
  // override on one member stops its sell tracking its cost.
  //
  // No member is chosen now. Nothing is distributed across members. Item-Group
  // production goes out at the grain BV-012 says it belongs to, and the math
  // layer folds it in above the member cells where no per-cell lever reaches
  // it.
  //
  // A Direct Service is unaffected and always was: it IS a top-level quote
  // leaf, so its production maps straight onto its own math id with no
  // mismatch to bridge. That branch keeps `production[]`.
  const directLeafIds = new Set(
    args.quoteLeafAttachments.map((al) => mathSkuId(al)),
  );

  const production: CostingProductionInput[] = [];
  const assemblyProduction: CostingAssemblyProductionInput[] = [];
  for (const api of args.assemblyProductionInputs) {
    const columns = {
      allocateServiceFeesToCost: api.allocateServiceFeesToCost,
      fillingBlendingCost: numOrNull(api.fillingBlendingCost),
      cmAssemblyTotal: numOrNull(api.cmAssemblyTotal),
      setupFeeTotal: numOrNull(api.setupFeeTotal),
      toolingArtworkTotal: numOrNull(api.toolingArtworkTotal),
      toolingTotal: numOrNull(api.toolingTotal),
      artworkTotal: numOrNull(api.artworkTotal),
      rdTotal: numOrNull(api.rdTotal),
      testingMicrosTotal: numOrNull(api.testingMicrosTotal),
      otherServiceTotal: numOrNull(api.otherServiceTotal),
      bulkRawCost: numOrNull(api.bulkRawCost),
      actualUnitsProduced: api.actualUnitsProduced,
    };

    if (api.quoteLeafId) {
      // Owned by a Direct Service. Present in the attachment set unless the
      // leaf was removed in the same read window; skipping is correct then.
      if (!directLeafIds.has(api.quoteLeafId)) continue;
      production.push({
        quoteSkuId: api.quoteLeafId,
        tierId: api.tierId,
        // The XOR, carried rather than re-derived. Only the service branch can
        // reach this now, so the value is no longer a discriminator between two
        // shapes arriving here - it is a fact about the one shape that does.
        ownerKind: "direct_service",
        ...columns,
      });
      continue;
    }

    if (!api.assemblyId) continue;
    assemblyProduction.push({
      assemblyId: api.assemblyId,
      tierId: api.tierId,
      ...columns,
    });
  }

  // ---- cellOverrides[] : assembly_leaf_overrides direct passthrough ----
  const cellOverrides: CostingCellOverride[] = args.assemblyLeafOverrides.map(
    (alo) => ({
      quoteSkuId: alo.quoteLeafId,
      tierId: alo.tierId,
      sellPriceOverride: num(alo.sellPriceOverride),
    }),
  );

  // ---- cellTargets[] : RESOLVED per sellable unit × tier ----
  //
  // Not a passthrough, and deliberately not one. The rows are sparse in two
  // dimensions — a unit may carry a common target, per-tier targets, or both —
  // so the effective target for a given tier is `tier ?? common`, and that
  // resolution happens ONCE, here, through the shared rule.
  //
  // The identity lines up without translation: the engine keys `cellTargets`
  // by `quoteSkuId`, which for a top-level unit is `assemblies.id` for an Item
  // Group and `quote_leaves.id` for a Direct Product — the same two ids the
  // target rows carry. Nothing is mapped onto a member leaf, because nothing
  // should be: the client named a price for the finished product.
  //
  // A unit with no target at any tier emits no rows at all, so "no target"
  // stays absent rather than becoming zero.
  const targetsByUnit = indexClientTargets(
    args.clientTargets.map((r) => ({
      assemblyId: r.assemblyId,
      quoteLeafId: r.quoteLeafId,
      tierId: r.tierId,
      clientTargetPricePerUnit: num(r.clientTargetPricePerUnit) ?? 0,
    })),
  );
  const cellTargets: CostingCellTarget[] = [];
  for (const [unitId, unitTargets] of targetsByUnit) {
    for (const tier of args.tiers) {
      const { value } = resolveClientTarget(unitTargets, tier.id);
      if (value === null) continue;
      cellTargets.push({
        quoteSkuId: unitId,
        tierId: tier.id,
        clientTargetPricePerUnit: value,
      });
    }
  }

  // ---- lifts[] : quote_leaf_lifts direct passthrough ----
  //
  // No id translation, uniquely among the sparse tables. The stored row and
  // `CostingLift` name the same identity, which is why this table was keyed
  // canonically: the persisted row IS the in-effect engine lift, reconstructible
  // without consulting the staging layer or anything else the UI holds.
  const lifts: CostingLift[] = args.lifts.map((l) => ({
    quoteLeafId: l.quoteLeafId,
    tierId: l.tierId,
    liftPct: num(l.liftPct),
  }));

  return {
    quote: args.quote,
    firmSettings: args.firmSettings,
    markupDefaults: args.markupDefaults,
    chargeElections: args.chargeElections,
    componentCharges: args.componentCharges,
    skus,
    tiers: args.tiers,
    packaging,
    production,
    assemblyProduction,
    freightLegGroups: args.freightLegGroups,
    freightLegs: args.freightLegs,
    freightLegTiers: args.freightLegTiers,
    freightComponentTierCosts: args.freightComponentTierCosts,
    freightShipmentBreaks: args.freightShipmentBreaks ?? [],
    cellOverrides,
    cellTargets,
    lifts,
  };
}
