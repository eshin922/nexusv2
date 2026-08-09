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
import { isBelowTarget } from "@/lib/pricing-predicates";
import {
  quoteScopeKey,
  readEffectiveTargetMargin,
  readNodeValue,
} from "@/lib/costing-nodes";
import { buildCostingInput } from "@/lib/costing-store";
import { composePricingAdjustment } from "@/lib/pricing-adjustment";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
} from "@/lib/costing";
import {
  selectFirmSettings,
  selectGraph,
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
  const graph = useCostingStore(selectGraph);
  const globalAdj = useCostingStore(selectGlobalAdj);
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const skuRollups = useCostingStore(selectSkuRollups);
  const quoteSummary = useCostingStore(selectQuoteSummary);

  // Direct store API for one-shot per-cell client-target reads
  // inside the adapter (cellTargets selector is curried per-cell;
  // adapter iterates over all cells).
  const storeApi = useCostingStoreApi();

  // The effective target, read from the one resolution the engine publishes.
  //
  // THERE IS NO FALLBACK, deliberately. An earlier revision kept
  // `?? firmSettings.targetMarginPct` as a broken-graph guard, which is still a
  // second authority path: it would let this surface answer a commercial
  // question the graph declined to answer, and answer it plausibly enough that
  // nobody would notice. The node is emitted unconditionally on every compute,
  // so a null here is a graph-integrity failure, not a missing option.
  //
  // Classification cannot proceed without it — every verdict is a comparison
  // against this number — so the provider stops and the surface renders an
  // explicit unavailable state below. Rendering nothing at all would read as a
  // loading state; manufacturing a target would read as an answer. Neither is
  // what has happened.
  const targetRead = readEffectiveTargetMargin(graph);

  // Build QuoteInput + QuotePolicyInput (memoised).
  const { quoteInput, policyInput, idMap } = useMemo(
    () =>
      buildClassifierInputs({
        tiersForReframe,
        firmSettings,
        policy,
        quoteRollup,
        quoteSummary,
        skuRollups,
        globalAdj,
        // Never reached when null — the guard below returns first. Zero is a
        // placeholder for the type, not a default.
        effectiveTarget: targetRead?.value ?? 0,
        cellTargetLookup: (skuId, tierId) =>
          selectCellTarget(skuId, tierId)(storeApi.getState()),
        previewTierMarginAt: (tierId, applyDelta) =>
          previewTierMargin(storeApi.getState(), tierId, applyDelta),
        previewBlendedAt: (applyDelta) =>
          previewBlendedMargin(storeApi.getState(), applyDelta),
      }),
    [
      targetRead,
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

  if (targetRead === null) {
    // Explicit, and named as an integrity failure rather than a data gap: no
    // operator action fixes this, so the copy must not invite one.
    return (
      <div
        role="alert"
        style={{
          margin: "16px 0",
          padding: "14px 16px",
          border: "1px solid var(--rule)",
          borderRadius: "8px",
          background: "var(--paper-2)",
          fontSize: "13px",
          color: "var(--ink-2)",
        }}
      >
        <strong style={{ display: "block", marginBottom: 4 }}>
          Pricing verdicts are unavailable.
        </strong>
        The quote&rsquo;s effective target margin could not be read from the
        computation graph, and every margin verdict is a comparison against it.
        Nothing here is wrong — it is withheld. This is an integrity fault
        rather than missing input, so re-entering data will not clear it.
      </div>
    );
  }

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


// ──────────────────────────────────────────────────────────────────
// Preview evaluations
// ──────────────────────────────────────────────────────────────────
//
// One field changes. Everything else — costs, structure, tiers, overrides —
// is the committed input, because a preview that differed in any other respect
// would answer a question nobody asked.

type StoreState = Parameters<typeof buildCostingInput>[0];

/** Margin for ONE tier after a surgical lift, as the engine computes it. */
function previewTierMargin(
  state: StoreState,
  tierId: string,
  applyDelta: number,
): number | null {
  const committed = buildCostingInput(state);
  const preview: QuoteCostingInput = {
    ...committed,
    // A new array with a new object for the one tier touched. The committed
    // input's own objects are never written to.
    tiers: committed.tiers.map((t) =>
      t.id === tierId
        ? {
            ...t,
            tierPriceAdjPct: composePricingAdjustment(
              t.tierPriceAdjPct ?? committed.quote.globalPriceAdjPct,
              applyDelta,
            ),
          }
        : t,
    ),
  };
  const result = computeQuoteCosting(preview, "preview");
  const value = readNodeValue(
    result.graph,
    quoteScopeKey(tierId, "margin"),
    "preview",
  );
  if (value !== null) return value;
  // The margin is not yet a node. Until it is, take the engine's own scalar
  // from the PREVIEW result — still the engine's arithmetic, still not this
  // file's. Reading the committed rollup here instead would silently answer
  // the wrong question.
  const row = result.quoteRollup.find((q) => q.tierId === tierId);
  return row ? row.blendedMarginPct : null;
}

/** Blended margin across the quote after a global lift. */
function previewBlendedMargin(
  state: StoreState,
  applyDelta: number,
): number | null {
  const committed = buildCostingInput(state);
  const preview: QuoteCostingInput = {
    ...committed,
    quote: {
      ...committed.quote,
      globalPriceAdjPct: composePricingAdjustment(
        committed.quote.globalPriceAdjPct,
        applyDelta,
      ),
    },
  };
  const result = computeQuoteCosting(preview, "preview");
  // The engine's own quote-wide scalar, taken off the PREVIEW result. This
  // used to re-sum the rollup and divide here, which agreed with the engine
  // only for as long as both sides kept computing the same thing — and did
  // not: at zero revenue the local form returned null while the engine
  // returned a fabricated 0. Null now means undefined on both sides because
  // there is only one side.
  return result.quoteSummary.blendedMarginPct;
}

interface AdapterInputs {
  tiersForReframe: ReadonlyArray<{
    id: string;
    label: string;
    recommended: boolean;
  }>;
  firmSettings: { targetMarginPct: number; floorMarginPct: number };
  policy: { allow_override: boolean; allow_accept_risk: boolean };
  quoteRollup: ReturnType<typeof selectQuoteRollup>;
  /** The engine's quote-wide summary. Source of the blended margin below. */
  quoteSummary: ReturnType<typeof selectQuoteSummary>;
  skuRollups: ReturnType<typeof selectSkuRollups>;
  globalAdj: number;
  effectiveTarget: number;
  cellTargetLookup: (skuId: string, tierId: string) => number | null;
  /** Preview outcomes, supplied by the provider so the adapter stays free of
   *  store access — same shape as `cellTargetLookup`. */
  previewTierMarginAt: (tierId: string, applyDelta: number) => number | null;
  previewBlendedAt: (applyDelta: number) => number | null;
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
  quoteSummary,
  skuRollups,
  globalAdj,
  effectiveTarget,
  cellTargetLookup,
  previewTierMarginAt,
  previewBlendedAt,
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
        no_margin_reason: "unpriced" | "cost_without_revenue" | null;
        competitive_status: "COMPETITIVE" | "OVER_CLIENT_TARGET" | null;
        cost_stack: {
          pkg: number;
          prod: number;
          frt: number;
          dt: number;
        } | null;
      }> = {};
      let clientTargetUnit: number | null = null;
      for (const pt of sr.perTier) {
        const numericTierId = uuidToNumeric.get(pt.tierId);
        if (numericTierId == null) continue;
        // The engine's verdict, read — not reconstructed.
        //
        // This used to carry a local heuristic: `requiredSellPerUnit === 0 &&
        // contributionCostPerUnit === 0`, with a comment explaining the
        // disambiguation ("only 'no data entered yet' produces both = 0").
        // The reasoning was right and the heuristic agreed with the engine on
        // all 143 zero-revenue cells in production. It was still a second
        // authority deciding what "no data" means, in a file whose entire
        // purpose is that there is only one.
        //
        // The engine now says it directly, and says MORE than the heuristic
        // could: zero cost is UNAVAILABLE, cost without revenue is a loss.
        // A heuristic keyed on both being zero cannot express the second.
        const isMissing = pt.marginPct === null;
        cells[numericTierId] = {
          margin_pct: pt.marginPct,
          // The engine distinguishes the two no-margin states; the adapter
          // forwards that rather than re-deciding it. Mapped, not inferred —
          // the mapping is a rename between two vocabularies, and the compiler
          // holds it exhaustive.
          no_margin_reason:
            pt.marginStatus === "COST_WITHOUT_REVENUE"
              ? "cost_without_revenue"
              : pt.marginStatus === "UNAVAILABLE"
                ? "unpriced"
                : null,
          sell_unit: isMissing ? null : pt.requiredSellPerUnit,
          cost_unit: isMissing ? null : pt.contributionCostPerUnit,
          override_applied: pt.sellSource === "cell_override",
          // The engine's competitive verdict, forwarded rather than re-derived.
          competitive_status: pt.competitiveStatus,
          // P0 A1 fix (2026-06-25) — populate cost_stack from the
          // math layer's per-unit marked-up sums. DetailCostStack
          // filters cells where cost_stack is truthy; without
          // this, every cell rendered "—" in the per-tier table
          // ("Show pricing detail" expansion). Pre-existing bug
          // since Slice RI.8 (the inline-rollup fallback comment
          // at DetailCostStack:302-308 was incorrect — the
          // fallback never runs because the filter rejects all
          // null-cost_stack cells).
          cost_stack: isMissing
            ? null
            : {
                pkg: pt.packagingMarkupSumPerUnit,
                prod: pt.productionMarkupSumPerUnit,
                frt: pt.freightContainerMarkupSumPerUnit,
                dt: pt.freightDutyTariffMarkupSumPerUnit,
              },
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

  // Quote-wide blended margin, read from the engine.
  //
  // This was a local re-sum of the rollup followed by `1 − cost / revenue`.
  // The population and the formula were both right, which is precisely why it
  // survived: it agreed with the engine on every revenue-bearing quote to
  // within 1e-12, so nothing ever pointed at it. A second implementation of a
  // commercial quantity does not announce itself while it agrees.
  //
  // Where the two DID differ was the case neither surface displayed loudly:
  // at zero revenue this returned null while the engine returned a fabricated
  // 0. The consumer was more correct than its authority — which is not a
  // reason to keep the consumer, it is a reason to fix the authority. Now
  // corrected, there is one answer and this reads it.
  const blendedMarginPct = quoteSummary.blendedMarginPct;

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

  // P0 A2 fix (2026-06-25) — cell-vs-rollup semantic asymmetry.
  // The pricing CLASSIFIER's mode is CELL-driven (worst-case across
  // SKUs in a tier — pricing-classifier.ts:302-307). The suggestion
  // ENGINE works on tier-ROLLUP blended margins
  // (pricing-suggestions.ts:350-355). When ONE SKU's cell margin is
  // below target but the tier BLENDED margin is above target,
  // classifier emits `suggestion_led` mode but engine returns null.
  //
  // False-infeasibility fix (2026-07-15, Option B) — REFINEMENT of
  // the P0 A2 disposition. Prior fix flipped
  // `suggestionInfeasible=true` on the asymmetry corner, which
  // shipped misleading "math infeasible" copy for a state that has
  // real recovery paths (cost input adjustment, per-cell override,
  // admin override). Refinement: distinguish the asymmetry corner
  // from the genuine-structural-failure corner via `anyTierBelowTarget`,
  // and route the asymmetry to the new `suggestion_manual_only`
  // action kind (guidance-only) instead of `suggestion_infeasible`.
  let anyCellBelowTarget = false;
  for (const sku of skus) {
    for (const cell of Object.values(sku.cells)) {
      const m = cell?.margin_pct;
      if (m != null && m < effectiveTarget) {
        anyCellBelowTarget = true;
        break;
      }
    }
    if (anyCellBelowTarget) break;
  }
  // A tier with no margin is not below target. This feeds the Pattern 50
  // intersection gate (`suggestion_manual_only`), where a wrong answer would
  // route the surface to the wrong explanation — so the exclusion is explicit
  // rather than left to a predicate absorbing null.
  const anyTierBelowTarget = quoteRollup.some(
    (r) =>
      r.blendedMarginPct !== null &&
      isBelowTarget(r.blendedMarginPct, effectiveTarget),
  );

  // Asymmetry-corner details: worst below-target cell across all
  // (leaf) SKUs, and the tier LABELS (from quoteRollup) it drags.
  // Only computed when the asymmetry gate fires; null otherwise.
  let manualOnlyDetails: NonNullable<
    QuoteInput["suggestion_manual_only"]
  > | null = null;
  if (
    !engineCallReturnedOptions &&
    anyCellBelowTarget &&
    !anyTierBelowTarget
  ) {
    let worstMargin = Infinity;
    let worstSkuId: string | null = null;
    let worstSkuName: string | null = null;
    const affectedTierNumericIds = new Set<number>();
    for (const sku of skus) {
      for (const [tierIdKey, cell] of Object.entries(sku.cells)) {
        const m = cell?.margin_pct;
        if (m == null) continue;
        if (!isBelowTarget(m, effectiveTarget)) continue;
        if (m < worstMargin) {
          worstMargin = m;
          worstSkuId = sku.id;
          worstSkuName = sku.name;
        }
        const numericId = Number(tierIdKey);
        if (Number.isFinite(numericId)) affectedTierNumericIds.add(numericId);
      }
    }
    if (worstSkuId && worstSkuName) {
      // Map numeric tier ids → tier labels via numericToUuid +
      // quoteRollup. Preserve numeric-order for stable copy.
      const affectedTierLabels: string[] = [];
      const sortedNumericIds = [...affectedTierNumericIds].sort(
        (a, b) => a - b,
      );
      for (const nid of sortedNumericIds) {
        const uuid = numericToUuid.get(nid);
        if (!uuid) continue;
        const rollupRow = quoteRollup.find((r) => r.tierId === uuid);
        const rowLabel = rollupRow?.label ?? null;
        const trimmed = rowLabel != null ? rowLabel.trim() : null;
        const label = trimmed && trimmed.length > 0 ? trimmed : `Tier ${nid}`;
        affectedTierLabels.push(label);
      }
      manualOnlyDetails = {
        worst_sku_id: worstSkuId,
        worst_sku_name: worstSkuName,
        affected_tier_labels: affectedTierLabels,
        worst_margin_pct: worstMargin,
      };
    }
  }

  // suggestion_infeasible now reserved for the GENUINE structural-
  // failure cases only:
  //   (a) engine returned options but all disabled (±999% overflow
  //       or bounds violation) — currently unreachable from this
  //       caller because we don't pass currentAdjByTier;
  //   (b) engine returned null AND at least one tier IS below
  //       target — this shouldn't naturally occur (engine would
  //       have proposed a lift), but if it does (e.g., zero
  //       revenue on the tier), that's a genuine structural failure.
  //
  // The asymmetry corner (engine null + no tier below + cell below)
  // falls through to the manual_only path above.
  const suggestionInfeasible =
    (engineCallReturnedOptions && !usableSurgical && !usableGlobal) ||
    (!engineCallReturnedOptions &&
      anyCellBelowTarget &&
      anyTierBelowTarget);

  // ── Preview outcomes come from the engine, not from here ─────────────────
  //
  // These two numbers answer "what will my margin be if I apply this?", and
  // they used to be computed on the spot as
  // `1 - cost / (revenue x (1 + delta))`. The state genuinely does not exist
  // yet, so the intent was always legitimate — the MECHANISM was not. A
  // second, simpler formula standing in for the engine will agree with it
  // right up until the engine's own arithmetic gains anything the formula does
  // not model, and then it will disagree quietly.
  //
  // The division of labour is now explicit:
  //
  //     the solver proposes an action  -> applyDelta
  //     the engine states its outcome  -> a preview run at that adjustment
  //
  // A preview clones the committed input, changes ONE field, and runs the same
  // pure `computeQuoteCosting`. Nothing is persisted and nothing is mutated:
  // the clone replaces only the objects on the path being changed, and a
  // permanent test asserts the committed input and graph are untouched.
  //
  // The result is labelled `evaluation: "preview"`, so its values can only be
  // read by naming preview authority — the committed readers refuse it.
  //
  // `applyDelta` COMPOSES with the adjustment already in force rather than
  // replacing it: the old formula lifted revenue that already carried the
  // current adjustment. `composePricingAdjustment` is the sanctioned composer
  // for exactly this, classified as input composition rather than derivation.
  const suggestions: QuoteInput["suggestions"] = {};
  if (usableSurgical && surgical && surgical.applyTo[0]) {
    const tierId = surgical.applyTo[0];
    const tierNumeric = uuidToNumeric.get(tierId);
    if (tierNumeric != null) {
      suggestions.surgical = {
        tier_id: tierNumeric,
        lift_pct: surgical.applyDelta,
        new_margin: previewTierMarginAt(tierId, surgical.applyDelta),
      };
    }
  }
  if (usableGlobal && global_) {
    suggestions.global = {
      lift_pct: global_.applyDelta,
      new_blended: previewBlendedAt(global_.applyDelta),
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
    suggestion_manual_only: manualOnlyDetails,
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
