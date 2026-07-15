"use client";

// slice-pricing-surface-redesign Step 7 — page composer + recompute
// pipeline + mode-transition flash + 30s persistent hint.
//
// **Patch round 2 (CB Step 9 re-walk, 2026-06-16):** classifier was
// lifted to the page-level `<PricingClassifierProvider>` so both
// the head and the composer consume the SAME classifier output.
// What used to live here (adapter + classify call + store
// subscriptions) now lives in `pricing-classifier-context.tsx`.
// Composer is now a thin consumer of `usePricingClassifier()`.
//
// What this composer still owns:
//   - STATE / ACTION / DETAIL zone mount predicates per state.mode
//     (CD designer notes §2.1 single-responsibility — composer
//     decides what mounts; zone components don't gate on mode)
//   - Mode-transition flash via `previousModeRef` + 30s timer
//     (rendering chrome, not classifier responsibility)
//   - Apply-path handlers wiring to Slice 9.4b server actions
//     (applySurgicalAdj, applyGlobalAdj) and Slice 9.2 manual
//     GPA path (updateQuoteGlobalPriceAdj from DetailGlobalAdjust)
//   - Local UI state: applyError, justUpdatedAt
//
// Apply-delta + apply-to resolution: the classifier QuoteState's
// `state.quote.suggestions.surgical.lift_pct` IS the applyDelta
// from rankPricingSuggestions (set by the adapter inside the
// provider). For global lifts, `buildGlobal`'s applyTo is always
// the full tier set per the engine implementation
// (`rollup.map(t => t.tierId)`), so the composer derives applyTo
// from `idMap.numericToUuid.values()` rather than re-invoking the
// engine. One classify, one engine call per render.

import { useEffect, useRef, useState } from "react";
import type { Mode } from "@/lib/pricing-classifier";
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
import { usePricingClassifier } from "./pricing-classifier-context";

// 30s persistent "↻ just updated" hint after a mode transition. CD
// §4.6 / §9.2 pushback 2. Restart on each subsequent transition.
const JUST_UPDATED_MS = 30_000;

export interface PricingSurfaceShellProps {
  projectId: string;
  quoteId: string;
}

export function PricingSurfaceShell({
  projectId: _projectId,
  quoteId,
}: PricingSurfaceShellProps) {
  // Single source of truth — `state` is the classifier output,
  // identical to what `<PricingPageHead>` consumes.
  const { state, idMap } = usePricingClassifier();

  // Mode-transition flash + 30s persistent hint ─────────────────
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
      // if another transition fires within the 30s window
      // (most-recent transition's hint is the visible one).
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
      setJustUpdatedAt(Date.now());
      justUpdatedTimerRef.current = setTimeout(() => {
        setJustUpdatedAt(null);
        justUpdatedTimerRef.current = null;
      }, JUST_UPDATED_MS);
    }
  }, [state.mode]);

  useEffect(() => {
    return () => {
      if (justUpdatedTimerRef.current) {
        clearTimeout(justUpdatedTimerRef.current);
      }
    };
  }, []);

  const justUpdated = justUpdatedAt !== null;

  // Apply-path handlers ─────────────────────────────────────────
  const [applyError, setApplyError] = useState<string | null>(null);

  async function onApply(kind: "apply_surgical" | "apply_global") {
    setApplyError(null);
    const sugg = state.quote.suggestions ?? {};

    if (kind === "apply_surgical" && sugg.surgical) {
      // Resolve numeric tier id → store UUID.
      const targetTierUuid = idMap.numericToUuid.get(sugg.surgical.tier_id);
      if (!targetTierUuid) {
        setApplyError("Surgical lift target tier not found");
        return;
      }
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("tierId", targetTierUuid);
      fd.set("applyDelta", String(sugg.surgical.lift_pct));
      fd.set("optionRecommended", "true");
      const r = await applySurgicalAdj(fd);
      if (!r.ok) setApplyError(r.error.message);
      return;
    }

    if (kind === "apply_global" && sugg.global) {
      // `buildGlobal` always returns `applyTo: rollup.map(t => t.tierId)`
      // (all tiers in the rollup). Derive from the idMap to avoid
      // re-invoking the suggestion engine.
      const allTierUuids = Array.from(idMap.numericToUuid.values());
      const fd = new FormData();
      fd.set("quoteId", quoteId);
      fd.set("applyTo", allTierUuids.join(","));
      fd.set("applyDelta", String(sugg.global.lift_pct));
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
    // preview_pdf ActionCard was removed from the shell render per
    // Edward's disposition (redundant with the YourNextMoveBanner
    // that already surfaces "Preview quote PDF →" in sendable
    // mode). The kind is retained in the enum for banner lookup
    // (recommendedOrPrimary in pricing-page-head.tsx picks
    // preview_pdf as primary → banner label) but never reaches
    // this handler because the shell filter drops it.
    // request_override · tighten_to_target — v1 ships as no-op
    // placeholders. Admin-override workflow + tighten-to-target
    // automation banked v1.1+. override_unavailable +
    // calculating_suggestion + suggestion_infeasible are inert
    // kinds (ActionCard renders no CTA button for them; this branch
    // is unreachable but kept for closed-enum exhaustiveness).
  }

  // CB Patch round 3 BUG-B disposition (2026-06-16) — re-instated.
  // DetailGlobalAdjust "Preview →" button is the only commit
  // affordance on PSR for the global price adj; it writes
  // quote.global_price_adj_pct via Slice 9.2's
  // updateQuoteGlobalPriceAdj action and lets the reconcile pipe
  // trigger classifier re-run + mode-transition flash. (Naming
  // mismatch with semantics — the button reads "Preview →" per CD
  // prototype copy; PSR-13 smoke walk and CD §6 docs use "Preview"
  // to mean "commit + show projected." Future v1.1+ work may
  // separate preview-only from commit-and-show; banked.)
  async function onPreviewGlobalAdjust(liftPct: number) {
    setApplyError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("globalPriceAdjPct", String(liftPct));
    const r = await updateQuoteGlobalPriceAdj(fd);
    if (!r.ok) setApplyError(r.error.message);
  }

  // Per-mode mount — single-responsibility zones; composer decides
  // what's visible per state.mode (CD §2.1).
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

      {/* ACTION — ranked actions per mode.
          CB Patch round 3 BUG-C disposition: in suggestion_led mode
          SuggestionCard IS the recommended-action presentation
          surface. ActionCard list filters out the recommended
          action so PMs see ONE ★ marker per render (the
          SuggestionCard's). Other modes pass through unfiltered.
          CB Patch round 3 BUG-D — `id` on the action zone container
          + suggestion-card wrapper anchors the YOUR NEXT MOVE
          banner's in-page navigation. */}
      {/* ActionCard render — filters:
          - `preview_pdf` kind is EXCLUDED everywhere; the top
            YourNextMoveBanner already surfaces "Preview quote PDF →"
            as its CTA in sendable mode (via classifier's primary
            action lookup). Duplicating it as a middle-page action
            card was confusing PMs. Kind stays in the classifier +
            enum for banner label wiring.
          - In `suggestion_led` mode, also drop the recommended
            action because SuggestionCard IS the recommended-action
            presentation surface (single ★ marker per render). */}
      <div id="psr-actions" className="psr-actions">
        {state.actions
          .filter((a) => a.kind !== "preview_pdf")
          .filter(
            (a) => state.mode !== "suggestion_led" || !a.recommended,
          )
          .map((action) => (
            <ActionCard
              key={action.kind}
              action={action}
              onActivate={onActivate}
            />
          ))}
      </div>

      {state.mode === "suggestion_led" && (
        <div id="psr-suggestion-card">
          <SuggestionCard state={state} onApply={onApply} />
        </div>
      )}

      {state.flags.accept_risk_unavailable && <AcceptRiskBanner />}

      {/* DETAIL — always available; session-persisted open state.
          onPreviewGlobalAdjust forwards via DetailZone →
          DetailGlobalAdjust (CB Patch round 3 BUG-B wire). */}
      <DetailZone
        state={state}
        quoteId={quoteId}
        onPreviewGlobalAdjust={onPreviewGlobalAdjust}
      />
    </section>
  );
}
