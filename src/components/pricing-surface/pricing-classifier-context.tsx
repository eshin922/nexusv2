"use client";

// slice-pricing-surface-redesign · CB Step 9 re-walk Patch round 2
// (2026-06-16) — single-source-of-truth classifier provider.
//
// **Rationale.** Patch round 1 (commit 761f5bf) attempted to fix
// BUG-2 by giving `pricing-page-head.tsx` a parallel predicate chain
// (`isBelowFloor`/`isBelowTarget` against per-leaf-per-tier
// marginStatus). That satisfied "same predicates → same mode" on
// happy-path quotes but didn't survive the zero-SKU / zero-cost-data
// sendable edge case — `summary.blendedMarginPct === null` fell
// through the belt-and-suspenders fallback and the head rendered
// the BLOCKED register while the classifier emitted SENDABLE.
//
// **Diagnosis (Pattern 22 catch #10).** The head's parallel chain
// was a re-derivation surface — exactly the failure mode the brief's
// §3 source-of-truth rule was written to prevent. Re-derivation
// surfaces drift; the only structurally durable fix is to eliminate
// the parallel chain entirely.
//
// **Fix shape (CA path c).** Lift the classifier call to a
// page-level context provider. Both `<PricingPageHead>` and
// `<PricingSurfaceShell>` consume `state.mode` directly via
// `usePricingClassifier()`. There IS no parallel derivation to
// maintain — the brief's §3 invariant is now structurally enforced
// at the type system (head can only access mode via the hook).
//
// Architectural side-benefit: classifier runs ONCE per render
// (was: twice — once in PricingSurfaceShell, would have been
// once more in head). Adapter is colocated with the provider, so
// boundary translation (store shape → classifier shape) lives
// behind a single interface.
//
// **Apply paths.** PricingSurfaceShell's surgical/global apply
// handlers previously called `rankPricingSuggestions` a second time
// just to read `applyDelta` + `applyTo`. With the adapter now
// inside the provider, the suggestions block on `state.quote`
// already carries `lift_pct` (= applyDelta) per the original Step 7
// design. For `applyTo` on global lifts: `buildGlobal` returns
// `rollup.map(t => t.tierId)` (all tiers) — composer iterates
// `idMap.numericToUuid.values()` instead of re-calling the engine.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  classify,
  type QuoteInput,
  type QuotePolicyInput,
  type QuoteSkuInput,
  type QuoteState,
  type QuoteTierInput,
} from "@/lib/pricing-classifier";
import { rankPricingSuggestions } from "@/lib/pricing-suggestions";
import {
  selectFirmSettings,
  selectGlobalAdj,
  selectQuoteRollup,
  selectSkuRollups,
  selectQuoteSummary,
  selectCellTarget,
} from "@/lib/costing-store";
import {
  useCostingStore,
  useCostingStoreApi,
} from "@/components/costing-store-provider";

// ──────────────────────────────────────────────────────────────────
// Context shape
// ──────────────────────────────────────────────────────────────────

export interface PricingClassifierValue {
  state: QuoteState;
  // Numeric ↔ UUID tier id remap. Lives alongside QuoteState because
  // apply paths need it to resolve classifier's numeric tier ids back
  // to store UUIDs for server-action FormData.
  idMap: {
    numericToUuid: Map<number, string>;
    uuidToNumeric: Map<string, number>;
  };
}

const PricingClassifierContext =
  createContext<PricingClassifierValue | null>(null);

export function usePricingClassifier(): PricingClassifierValue {
  const ctx = useContext(PricingClassifierContext);
  if (!ctx) {
    throw new Error(
      "usePricingClassifier must be used inside <PricingClassifierProvider>",
    );
  }
  return ctx;
}

// ──────────────────────────────────────────────────────────────────
// Provider
// ──────────────────────────────────────────────────────────────────

export interface PricingClassifierProviderProps {
  // Per-tier id list with the ★ recommended flag. Sourced from the
  // server-side quote_tiers query in pricing/page.tsx (CostingStore's
  // CostingTier shape doesn't carry `recommended`).
  tiersForReframe: ReadonlyArray<{
    id: string;
    label: string;
    recommended: boolean;
  }>;
  // Firm policy gates from the current firm_settings row (Step 2
  // columns). Server-fetched alongside tier list. Not costing-math
  // inputs; they're classifier policy bands.
  policy: {
    allow_override: boolean;
    allow_accept_risk: boolean;
  };
  children: ReactNode;
}

export function PricingClassifierProvider({
  tiersForReframe,
  policy,
  children,
}: PricingClassifierProviderProps) {
  // Subscribe to store slices that feed the classifier. Granular
  // selectors → provider re-renders only when one of these slices
  // changes. Recompute pipeline upstream (CostingStoreProvider's
  // wait-for-quiet) handles debounce; subscribers fire on commit.
  const firmSettings = useCostingStore(selectFirmSettings);
  const globalAdj = useCostingStore(selectGlobalAdj);
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const skuRollups = useCostingStore(selectSkuRollups);
  const quoteSummary = useCostingStore(selectQuoteSummary);

  // Direct store API for one-shot per-cell client-target reads
  // inside the adapter (cellTargets selector is curried per-cell;
  // adapter iterates over all cells).
  const storeApi = useCostingStoreApi();

  // Build QuoteInput + QuotePolicyInput (memoised).
  const { quoteInput, policyInput, idMap } = useMemo(
    () =>
      buildClassifierInputs({
        tiersForReframe,
        firmSettings,
        policy,
        quoteRollup,
        skuRollups,
        globalAdj,
        effectiveTarget:
          quoteSummary?.effectiveTargetMarginPct ??
          firmSettings.targetMarginPct,
        cellTargetLookup: (skuId, tierId) =>
          selectCellTarget(skuId, tierId)(storeApi.getState()),
      }),
    [
      tiersForReframe,
      firmSettings,
      policy,
      quoteRollup,
      skuRollups,
      globalAdj,
      quoteSummary,
      storeApi,
    ],
  );

  // Pure classify() call — single source of truth, runs once per
  // render at this provider scope.
  const state = useMemo(
    () => classify(quoteInput, policyInput),
    [quoteInput, policyInput],
  );

  const value = useMemo<PricingClassifierValue>(
    () => ({ state, idMap }),
    [state, idMap],
  );

  return (
    <PricingClassifierContext.Provider value={value}>
      {children}
    </PricingClassifierContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────────────
// Store → classifier input adapter
// ──────────────────────────────────────────────────────────────────
//
// Moved from pricing-surface-shell.tsx (was a private adapter in the
// composer). Now colocated with the provider since the provider
// owns the boundary translation.
//
// Two boundary translations:
//
//  1. **Tier id remap** — store keys tiers by UUID; CD classifier
//     uses 1..N numeric ids matching prototype "Tier 1..N" surface.
//     idMap retains both directions; apply-path handlers resolve
//     numeric → UUID when invoking server actions.
//
//  2. **Per-cell margin** — flattened from skuRollups[].perTier[];
//     classifier consumes per-(sku, tier) cells map.
//
// Q6 disposition: cost_stack passes through verbatim (classifier
// header). v1 supplies `null` per cell.cost_stack until the costing
// math layer surfaces the rolled-up shape; DetailCostStack handles
// the null case with an inline rollup fallback.

interface AdapterInputs {
  tiersForReframe: ReadonlyArray<{
    id: string;
    label: string;
    recommended: boolean;
  }>;
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  policy: { allow_override: boolean; allow_accept_risk: boolean };
  quoteRollup: ReturnType<typeof selectQuoteRollup>;
  skuRollups: ReturnType<typeof selectSkuRollups>;
  globalAdj: number;
  effectiveTarget: number;
  cellTargetLookup: (skuId: string, tierId: string) => number | null;
}

interface AdapterResult {
  quoteInput: QuoteInput;
  policyInput: QuotePolicyInput;
  idMap: PricingClassifierValue["idMap"];
}

function buildClassifierInputs({
  tiersForReframe,
  firmSettings,
  policy,
  quoteRollup,
  skuRollups,
  globalAdj,
  effectiveTarget,
  cellTargetLookup,
}: AdapterInputs): AdapterResult {
  // Numeric tier ids: 1..N in the same order as tiersForReframe
  // (page.tsx already ordered by sort_order + created_at). Stable
  // across renders so React keys stay valid.
  const numericToUuid = new Map<number, string>();
  const uuidToNumeric = new Map<string, number>();
  const tiers: QuoteTierInput[] = tiersForReframe.map((t, idx) => {
    const numeric = idx + 1;
    numericToUuid.set(numeric, t.id);
    uuidToNumeric.set(t.id, numeric);
    const rollup = quoteRollup.find((q) => q.tierId === t.id);
    return { id: numeric, qty: rollup?.qty ?? 0 };
  });

  // Leaf-only SKUs feed the classifier (Slice 9.3 leaf-only invariant
  // for sell-price overrides + Slice 9.4b client-target benchmark).
  const skus: QuoteSkuInput[] = skuRollups
    .filter((sr) => sr.skuRole === "leaf")
    .map((sr) => {
      const cells: Record<number, {
        margin_pct: number | null;
        sell_unit: number | null;
        cost_unit: number | null;
        override_applied: boolean;
      }> = {};
      let clientTargetUnit: number | null = null;
      for (const pt of sr.perTier) {
        const numericTierId = uuidToNumeric.get(pt.tierId);
        if (numericTierId == null) continue;
        // CB Patch round 3 BUG-E disposition (2026-06-16): treat
        // cells with zero revenue AND zero contribution cost as
        // **missing** rather than computed-zero (which would
        // classify as below_floor). The store's math layer always
        // returns a number (0 when no inputs); the classifier needs
        // explicit null margin to surface the provisional state.
        // The disambiguation: a legitimately zero-margin cell
        // (cost == revenue) has nonzero cost; only "no data entered
        // yet" produces both = 0.
        const isMissing =
          pt.requiredSellPerUnit === 0 && pt.contributionCostPerUnit === 0;
        cells[numericTierId] = {
          margin_pct: isMissing ? null : pt.marginPct,
          sell_unit: isMissing ? null : pt.requiredSellPerUnit,
          cost_unit: isMissing ? null : pt.contributionCostPerUnit,
          override_applied: pt.sellSource === "cell_override",
        };
        if (clientTargetUnit == null) {
          const tgt = cellTargetLookup(sr.skuId, pt.tierId);
          if (tgt != null) clientTargetUnit = tgt;
        }
      }
      return {
        id: sr.skuId,
        name: sr.productName,
        client_target_unit: clientTargetUnit,
        cells,
      };
    });

  // Blended margin across all tiers — sum-revenue / sum-cost when
  // available; falls back to null. Avoids quoteSummary subscription
  // for this derivation (adapter stays in-bounds).
  let totalRevenue = 0;
  let totalCost = 0;
  for (const r of quoteRollup) {
    totalRevenue += r.totalRevenue;
    totalCost += r.totalCost;
  }
  const blendedMarginPct =
    totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : null;

  // Suggestions via rankPricingSuggestions (Slice 9.4b helper).
  // CB Step 9 re-walk BUG-1 — track `suggestion_infeasible` when
  // engine returns null OR options carry disabledReason (overflow
  // bound).
  const ranked = rankPricingSuggestions({
    rollup: quoteRollup,
    target: effectiveTarget,
    floor: firmSettings.floorMarginPct,
    recommendedTierId:
      tiersForReframe.find((t) => t.recommended)?.id ?? null,
  });

  const surgical = ranked?.options.find((o) => o.id === "surgical") ?? null;
  const global_ = ranked?.options.find((o) => o.id === "global") ?? null;

  const engineCallReturnedOptions = ranked !== null;
  const usableSurgical =
    surgical &&
    surgical.disabledReason === null &&
    surgical.applyTo.length > 0;
  const usableGlobal = global_ && global_.disabledReason === null;
  const suggestionInfeasible =
    engineCallReturnedOptions && !usableSurgical && !usableGlobal;

  const suggestions: QuoteInput["suggestions"] = {};
  if (usableSurgical && surgical && surgical.applyTo[0]) {
    const tierNumeric = uuidToNumeric.get(surgical.applyTo[0]);
    if (tierNumeric != null) {
      const tierRow = quoteRollup.find(
        (q) => q.tierId === surgical.applyTo[0],
      );
      const newMargin =
        tierRow && tierRow.totalRevenue > 0
          ? 1 -
            tierRow.totalCost /
              (tierRow.totalRevenue * (1 + surgical.applyDelta))
          : null;
      suggestions.surgical = {
        tier_id: tierNumeric,
        lift_pct: surgical.applyDelta,
        new_margin: newMargin,
      };
    }
  }
  if (usableGlobal && global_) {
    const newBlended =
      totalRevenue > 0
        ? 1 -
          totalCost / (totalRevenue * (1 + global_.applyDelta))
        : null;
    suggestions.global = {
      lift_pct: global_.applyDelta,
      new_blended: newBlended,
    };
  }

  const recommendedNumericId =
    uuidToNumeric.get(
      tiersForReframe.find((t) => t.recommended)?.id ?? "",
    ) ?? null;

  const quoteInput: QuoteInput = {
    skus,
    tiers,
    blended_margin_pct: blendedMarginPct,
    recommended_tier_id: recommendedNumericId,
    suggestions:
      Object.keys(suggestions).length > 0 ? suggestions : undefined,
    suggestion_infeasible: suggestionInfeasible,
  };

  // DetailGlobalAdjust reads global_price_adj_pct off `state.quote`
  // via opaque pass-through (typed as a record-keyed access). Adapter
  // writes it; consumer reads it. (Composer's apply paths separately
  // consume the suggestions' `lift_pct` field for surgical applyDelta.)
  (quoteInput as QuoteInput & { global_price_adj_pct: number }).global_price_adj_pct =
    globalAdj;

  const policyInput: QuotePolicyInput = {
    target_margin_pct: effectiveTarget,
    floor_margin_pct: firmSettings.floorMarginPct,
    allow_override: policy.allow_override,
    allow_accept_risk: policy.allow_accept_risk,
  };

  return {
    quoteInput,
    policyInput,
    idMap: { numericToUuid, uuidToNumeric },
  };
}
