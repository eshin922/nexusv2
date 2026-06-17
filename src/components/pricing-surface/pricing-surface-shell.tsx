"use client";

// slice-pricing-surface-redesign Step 7 — page composer + recompute
// pipeline + mode-transition flash + persistent hint.
//
// This is the host that composes the redesigned Pricing surface from
// the three zones built in Steps 4–6:
//
//   STATE zone   — StateLine (always) · StateCallout (suggestion_led)
//                  · StateCard (blocked) · SendableSummary (sendable)
//   ACTION zone  — ActionCard list (ranked) · SuggestionCard
//                  (suggestion_led) · AcceptRiskBanner
//                  (state.flags.accept_risk_unavailable)
//   DETAIL zone  — DetailZone (always; session-persisted open state)
//
// Per CD designer notes §2.1, each zone is **single-responsibility**:
// the zone component renders state-driven primitives but does not
// gate on mode. The page composer (this file) decides what mounts
// per mode. That keeps zone components dumb consumers of QuoteState
// and concentrates mount logic in one auditable place.
//
// ──────────────────────────────────────────────────────────────────
// Recompute pipeline
// ──────────────────────────────────────────────────────────────────
//
// The CostingStore already debounces server saves (300–500ms) +
// wait-for-quiet reconcile (800ms) — established Slice 8.5 pattern.
// The Pricing surface classifier is PURE (`classify(quote, policy)
// → QuoteState`) and runs every render. Zustand handles the
// debounce upstream: store mutations from a typing burst fire the
// classifier once per store-state revision; subscribers re-render
// on the next React commit. No additional debounce wrapper here —
// duplicating the upstream debounce would only add latency without
// behavioural change.
//
// (If profile data ever shows classifier >10ms per render, memoize
// via useMemo on the store hash inputs. Untouched until measurable.)
//
// ──────────────────────────────────────────────────────────────────
// Mode-transition flash + 30s persistent hint
// ──────────────────────────────────────────────────────────────────
//
// Per CD designer notes §4.6 + §9.2 pushback 2:
//   - Render in place — never navigate, never auto-scroll.
//   - DETAIL state preserved across mode transitions; no auto-expand
//     on escalation. (DetailZone owns its session-storage persistence;
//     composer doesn't touch.)
//   - 30s persistent "↻ just updated" hint after a mode transition
//     so PMs returning to the tab can see something changed.
//
// previousModeRef tracks the prior render's mode. On transition we
// stamp `justUpdatedAt = Date.now()` and start a 30s timer that
// clears the timestamp; StateLine reads `justUpdated` and shows the
// chrome accordingly. One-shot timer per transition (subsequent
// transitions during the 30s window restart it; the most-recent
// transition's hint is the one visible).
//
// ──────────────────────────────────────────────────────────────────
// Apply paths
// ──────────────────────────────────────────────────────────────────
//
// onActivate / onApply / onPreview handlers route to the existing
// pricing-apply server actions (built for Slice 9.4b suggestion
// engine; reused here verbatim per Pattern 28 scope discipline):
//
//   - apply_global    → applyGlobalAdj (cascade audit; writes per-
//                       tier tier_price_adj_pct)
//   - apply_surgical  → applySurgicalAdj (single tier; source =
//                       'pricing_suggestion_surgical')
//   - request_override → no-op placeholder; banked v1.1+ (admin
//                       override request workflow doesn't exist yet)
//   - preview_pdf     → no-op placeholder; v1 lands Slice 11 Preview
//                       Quote sub-tab
//   - tighten_to_target → no-op placeholder; soft affordance; banked
//                       v1.1+ (no automation, PM manually adjusts)
//   - DetailGlobalAdjust onPreview → updateQuoteGlobalPriceAdj
//                       (manual GPA slider write path)
//
// Audit logging is handled inside each server action (Slice 9.2/9.4b
// audit-source convention); the composer doesn't add a parallel
// audit-log call.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  classify,
  type Mode,
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
  selectQuoteId,
  selectQuoteRollup,
  selectQuoteSummary,
  selectSkuRollups,
  selectCellTarget,
} from "@/lib/costing-store";
import { useCostingStore, useCostingStoreApi } from "@/components/costing-store-provider";
import {
  applyGlobalAdj,
  applySurgicalAdj,
} from "@/app/actions/pricing-apply";
import { updateQuoteGlobalPriceAdj } from "@/app/actions/costing";
import {
  ActionCard,
  AcceptRiskBanner,
  SendableSummary,
  SuggestionCard,
} from "./action-zone";
import { StateCallout, StateCard, StateLine } from "./state-zone";
import { DetailZone } from "./detail-zone";

// 30s persistent "↻ just updated" hint after a mode transition. CD
// §4.6 / §9.2 pushback 2. Restart on each subsequent transition.
const JUST_UPDATED_MS = 30_000;

export interface PricingSurfaceShellProps {
  projectId: string;
  quoteId: string;
  // Per-tier id list with the ★ recommended flag. Sourced from the
  // server-side quote_tiers query in pricing/page.tsx (the store's
  // CostingTier shape doesn't carry `recommended`). Used by:
  //  - classifier input.recommended_tier_id (numeric index)
  //  - apply paths (UUID lookup when invoking server actions)
  tiersForReframe: ReadonlyArray<{
    id: string;
    label: string;
    recommended: boolean;
  }>;
  // Firm policy gates from the current firm_settings row. Surfaced
  // from server-side fetch (the store carries margin policy but not
  // the policy gates — Step 2 columns are firm-policy bands set in
  // admin, not classifier inputs that participate in costing recompute).
  policy: {
    allow_override: boolean;
    allow_accept_risk: boolean;
  };
}

export function PricingSurfaceShell({
  projectId,
  quoteId,
  tiersForReframe,
  policy,
}: PricingSurfaceShellProps) {
  // ── 1. Subscribe to store slices that feed the classifier ───────
  // Each selector is granular: composer re-renders only when one of
  // these slices changes. The costing store's recompute is the
  // upstream debounce; subscribers fire on commit.
  const storeQuoteId = useCostingStore(selectQuoteId);
  const firmSettings = useCostingStore(selectFirmSettings);
  const globalAdj = useCostingStore(selectGlobalAdj);
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const skuRollups = useCostingStore(selectSkuRollups);
  const quoteSummary = useCostingStore(selectQuoteSummary);

  // Direct store API for one-shot reads inside event handlers
  // (apply paths need the current effective-adj-by-tier map).
  const storeApi = useCostingStoreApi();

  // ── 2. Build QuoteInput + QuotePolicyInput (memoised) ───────────
  const { quoteInput, policyInput, idMap } = useMemo(
    () =>
      buildClassifierInputs({
        tiersForReframe,
        firmSettings,
        policy,
        quoteRollup,
        skuRollups,
        globalAdj,
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
      storeApi,
    ],
  );

  // ── 3. Classify — single source of truth, pure ──────────────────
  const state = useMemo(
    () => classify(quoteInput, policyInput),
    [quoteInput, policyInput],
  );

  // ── 4. Mode-transition flash + 30s persistent hint ──────────────
  const previousModeRef = useRef<Mode | null>(null);
  const justUpdatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [justUpdatedAt, setJustUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const prev = previousModeRef.current;
    previousModeRef.current = state.mode;
    if (prev !== null && prev !== state.mode) {
      // Mode transition — fire the persistent hint. Restart timer
      // if another transition fires within the 30s window (most-
      // recent transition's hint is the visible one).
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
      setJustUpdatedAt(Date.now());
      justUpdatedTimerRef.current = setTimeout(() => {
        setJustUpdatedAt(null);
        justUpdatedTimerRef.current = null;
      }, JUST_UPDATED_MS);
    }
    return () => {
      // No-op on unmount of the effect; the timer is cleared by the
      // unmount handler below to avoid leaks across composer unmount.
    };
  }, [state.mode]);

  useEffect(() => {
    return () => {
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
    };
  }, []);

  const justUpdated = justUpdatedAt !== null;

  // ── 5. Apply-path handlers ──────────────────────────────────────
  // Per CD §6: render in place. Server actions handle audit logging
  // + revalidation; the store's reconcile pipe pulls the post-write
  // snapshot back through the wait-for-quiet path.
  const [applyError, setApplyError] = useState<string | null>(null);

  async function onApply(kind: "apply_surgical" | "apply_global") {
    setApplyError(null);
    const sugg = quoteInput.suggestions ?? {};

    if (kind === "apply_surgical" && sugg.surgical) {
      // Resolve numeric tier id → store UUID
      const targetTierUuid = idMap.numericToUuid.get(sugg.surgical.tier_id);
      if (!targetTierUuid) {
        setApplyError("Surgical lift target tier not found");
        return;
      }
      // applyDelta is the closed-form multiplicative revenue lift.
      // Sourced from rankPricingSuggestions (Slice 9.4b helper).
      const sug = ranked.options.find((o) => o.id === "surgical");
      if (!sug) {
        setApplyError("Surgical option missing from suggestion engine");
        return;
      }
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("tierId", targetTierUuid);
      fd.set("applyDelta", String(sug.applyDelta));
      fd.set("optionRecommended", "true");
      const r = await applySurgicalAdj(fd);
      if (!r.ok) setApplyError(r.error.message);
      return;
    }

    if (kind === "apply_global" && sugg.global) {
      const sug = ranked.options.find((o) => o.id === "global");
      if (!sug) {
        setApplyError("Global option missing from suggestion engine");
        return;
      }
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("applyTo", sug.applyTo.join(","));
      fd.set("applyDelta", String(sug.applyDelta));
      fd.set("optionRecommended", "true");
      const r = await applyGlobalAdj(fd);
      if (!r.ok) setApplyError(r.error.message);
      return;
    }
  }

  function onActivate(
    kind:
      | "preview_pdf"
      | "apply_surgical"
      | "apply_global"
      | "request_override"
      | "override_unavailable"
      | "tighten_to_target"
      | "calculating_suggestion"
      | "suggestion_infeasible",
  ) {
    if (kind === "apply_surgical" || kind === "apply_global") {
      void onApply(kind);
      return;
    }
    // preview_pdf · request_override · tighten_to_target — v1 ships
    // as a no-op placeholder. Slice 11 (Preview Quote sub-tab)
    // wires preview_pdf; admin-override workflow + tighten-to-target
    // automation are banked v1.1+. override_unavailable +
    // calculating_suggestion + suggestion_infeasible are inert kinds
    // (ActionCard renders no CTA button for them; this branch is
    // unreachable but kept for closed-enum exhaustiveness).
  }

  async function onPreviewGlobalAdjust(liftPct: number) {
    // DetailGlobalAdjust integer % → updateQuoteGlobalPriceAdj
    // (action layer divides by 100 internally; UI sends the integer
    // percent display value).
    setApplyError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("globalPriceAdjPct", String(liftPct));
    const r = await updateQuoteGlobalPriceAdj(fd);
    if (!r.ok) setApplyError(r.error.message);
  }

  // ── 6. Rank suggestions (used by apply-path handler for the
  //    applyDelta value; SuggestionCard reads classifier projections,
  //    not raw ranked.options) ───────────────────────────────────
  const effectiveTarget =
    quoteSummary?.effectiveTargetMarginPct ?? firmSettings.targetMarginPct;
  const ranked =
    rankPricingSuggestions({
      rollup: quoteRollup,
      target: effectiveTarget,
      floor: firmSettings.floorMarginPct,
      recommendedTierId:
        tiersForReframe.find((t) => t.recommended)?.id ?? null,
    }) ?? { options: [], ranking: "surgical_first" as const, acceptRiskGating: { available: true, reason: null } };

  // ── 7. Defensive: store/page-quoteId mismatch ───────────────────
  // The composer is mounted inside CostingStoreProvider so the store
  // always matches the page. Cheap belt-and-suspenders guard avoids
  // surfacing stale state if a future refactor moves the provider.
  if (storeQuoteId && storeQuoteId !== quoteId) {
    return null;
  }

  // ── 8. Per-mode mount ──────────────────────────────────────────
  // Single-responsibility zones; the composer decides what's
  // visible per state.mode (CD §2.1).
  return (
    <section className="psr-section">
      {applyError && (
        <div
          role="alert"
          style={{
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            background: "var(--bad-soft)",
            border: "1px solid var(--bad)",
            color: "var(--bad)",
            fontSize: 12,
          }}
        >
          {applyError}
        </div>
      )}

      {/* STATE — always visible. justUpdated chrome on mode transition. */}
      <StateLine state={state} justUpdated={justUpdated} />

      {state.mode === "suggestion_led" && <StateCallout state={state} />}
      {state.mode === "blocked" && <StateCard state={state} />}
      {state.mode === "sendable" && <SendableSummary state={state} />}

      {/* ACTION — ranked actions per mode. */}
      <div className="psr-actions">
        {state.actions.map((action) => (
          <ActionCard
            key={action.kind}
            action={action}
            onActivate={onActivate}
          />
        ))}
      </div>

      {state.mode === "suggestion_led" && (
        <SuggestionCard state={state} onApply={onApply} />
      )}

      {state.flags.accept_risk_unavailable && <AcceptRiskBanner />}

      {/* DETAIL — always available; session-persisted open state. */}
      <DetailZone state={state} quoteId={quoteId} />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// Store → classifier input adapter
// ──────────────────────────────────────────────────────────────────
//
// Two boundary translations:
//
//  1. **Tier id remap** — store keys tiers by UUID; the CD classifier
//     uses numeric ids (per-render index 1..N matching prototype
//     numeric "Tier 1..N" surface). idMap retains both directions so
//     apply paths can resolve numeric → UUID when invoking server
//     actions, and SuggestionCard reads numeric ids straight from
//     classifier projections.
//
//  2. **Margin per cell** — store's QuotePerTierRollup exposes
//     blendedMarginPct for the whole tier (across SKUs); per-cell
//     margin comes from skuRollups[].perTier[].marginPct. We flatten
//     the skuRollups output into the classifier's per-(sku, tier)
//     cells map.
//
// Q6 disposition: cost_stack passes through verbatim (classifier
// header). Production-side cost-stack rollup is owned by the costing
// math layer; v1 supplies `null` for every cell.cost_stack until the
// rollup lands. DetailCostStack handles the null case (computed
// inline from quoteRollup costBreakdown per its TODO).

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
  cellTargetLookup: (skuId: string, tierId: string) => number | null;
}

interface AdapterResult {
  quoteInput: QuoteInput;
  policyInput: QuotePolicyInput;
  idMap: {
    numericToUuid: Map<number, string>;
    uuidToNumeric: Map<string, number>;
  };
}

function buildClassifierInputs({
  tiersForReframe,
  firmSettings,
  policy,
  quoteRollup,
  skuRollups,
  globalAdj,
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
  // Assemblies roll up from children in skuRollups but the classifier
  // surfaces leaves at the cell-grid layer; per-SKU view groups by
  // SKU regardless of role.
  const skus: QuoteSkuInput[] = skuRollups
    .filter((sr) => sr.skuRole === "leaf")
    .map((sr) => {
      const cells: Record<number, {
        margin_pct: number | null;
        sell_unit: number | null;
        cost_unit: number | null;
        override_applied: boolean;
      }> = {};
      // Client target stored per (sku, tier); since the same target
      // applies to all tiers? — NO: Slice 9.4b stores per-cell
      // (sku, tier). For the classifier's SKU-level shape, we surface
      // the first non-null target as `client_target_unit`. Cell-level
      // overrides still surface per-tier via cells map.
      let clientTargetUnit: number | null = null;
      for (const pt of sr.perTier) {
        const numericTierId = uuidToNumeric.get(pt.tierId);
        if (numericTierId == null) continue;
        cells[numericTierId] = {
          margin_pct: pt.marginPct,
          sell_unit: pt.requiredSellPerUnit,
          cost_unit: pt.contributionCostPerUnit,
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

  // Per-quote blended margin (across all tiers).
  const effectiveTarget =
    quoteRollup.length > 0
      ? // every tier rollup carries the same effectiveTarget; use the
        // firmSettings default if no rollup rows (zero-tier quote)
        firmSettings.targetMarginPct
      : firmSettings.targetMarginPct;

  // Blended margin across all tiers — use sum-of-revenue / sum-of-cost
  // when available; falls back to null. quoteSummary.blendedMarginPct
  // is the canonical value but we recompute from rollup here so the
  // adapter stays pure of quoteSummary subscription (classifier
  // shouldn't reach into the store).
  let totalRevenue = 0;
  let totalCost = 0;
  for (const r of quoteRollup) {
    totalRevenue += r.totalRevenue;
    totalCost += r.totalCost;
  }
  const blendedMarginPct =
    totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : null;

  // Suggestions — assemble surgical + global previews from
  // rankPricingSuggestions. Adapter doesn't compute the math; the
  // existing pricing-suggestions helper is the source.
  const ranked = rankPricingSuggestions({
    rollup: quoteRollup,
    target: effectiveTarget,
    floor: firmSettings.floorMarginPct,
    recommendedTierId:
      tiersForReframe.find((t) => t.recommended)?.id ?? null,
  });

  const surgical = ranked?.options.find((o) => o.id === "surgical") ?? null;
  const global_ = ranked?.options.find((o) => o.id === "global") ?? null;

  // CB Step 9 re-walk BUG-1: track whether the engine returned a
  // usable suggestion. `ranked === null` happens when no tier is
  // below target/floor (sendable case — no suggestion needed).
  // `ranked !== null` but both `surgical` and `global_` absent
  // happens when below-target/floor tiers exist but the math
  // helpers (buildSurgical/buildGlobal) returned null due to:
  //   - zero-revenue tiers (no sell prices computed yet)
  //   - numeric(5,4) field bound overflow on composed new_adj
  //   - degenerate target (≤0 or ≥1, won't happen with firm-policy
  //     bounds)
  // In that case the classifier emits `suggestion_infeasible` so
  // PMs see a real explainer instead of stuck "Calculating…".
  const engineCallReturnedOptions = ranked !== null;
  const usableSurgical =
    surgical &&
    surgical.disabledReason === null &&
    surgical.applyTo.length > 0;
  const usableGlobal = global_ && global_.disabledReason === null;
  const suggestionInfeasible =
    engineCallReturnedOptions && !usableSurgical && !usableGlobal;

  const suggestions: QuoteInput["suggestions"] = {};
  if (surgical && surgical.applyTo[0]) {
    const tierNumeric = uuidToNumeric.get(surgical.applyTo[0]);
    if (tierNumeric != null) {
      // applyDelta is a multiplicative revenue lift; new_margin for
      // the target tier comes from the closed-form: solve for the
      // tier's revenue at (1+applyDelta)×current.
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
  if (global_) {
    // Global lift applied to every tier proportionally — closed-form
    // blended computed from sum-revenue × (1+delta) ÷ (sum-revenue ×
    // (1+delta) - sum-cost).
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

  // DetailGlobalAdjust reads global_price_adj_pct off `state.quote`;
  // not a typed field on QuoteInput, but the type system surfaces it
  // as a string-keyed pass-through. (DetailGlobalAdjust reads via
  // (state.quote as { global_price_adj_pct?: number }).)
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

// QuoteState re-export for the page-level wrapper if it ever needs
// the type without importing pricing-classifier directly.
export type { QuoteState };
