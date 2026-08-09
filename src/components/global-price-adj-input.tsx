"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  applySuggestedGlobalAdj,
  updateQuoteGlobalPriceAdj,
} from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectQuoteSummary,
  selectUpdateGlobalAdj,
} from "@/lib/costing-store";
import { validatePercentDecimal } from "@/lib/percent-validation";

const DEBOUNCE_MS = 500;

// Display convention (per CLAUDE.md percent rule): UI shows percent values
// (e.g. "5" for 5%); the action layer divides by 100 to store as decimal
// ("0.0500"). Symmetric on read.
function decimalToPercentDisplay(d: number): string {
  if (!Number.isFinite(d)) return "";
  const n = d * 100;
  return Number(n.toFixed(4)).toString();
}

// Controlled percent input with debounced save. Slice 9.2 — adds the
// quote-wide system-suggested-GPA banner directly underneath the
// slider (per IA-spec: banner lives WITH the slider, not in the
// verdict pill area). Banner reads from the partition-aware quote
// summary (computeQuoteSuggestion) — overridden tiers are FIXED, GPA
// solves only for inheriting tiers, goal shifts target↔floor on the
// BELOW_FLOOR boundary. Apply uses the dedicated server action so
// audits carry `source: "system_suggestion"`.
//
// `suggestedDecimal` prop kept for backwards-compat (callers still
// pass the lead-tier suggestion from selectSuggestedAdj), but the
// banner inside this component now overrides it with the quote-wide
// summary read straight from the store.
//
// Re-hydrates from canonical server response after each save.
export function GlobalPriceAdjInput({
  quoteId,
  initialDecimal,
  suggestedDecimal: _suggestedDecimalLegacy,
  disabled = false,
}: {
  quoteId: string;
  initialDecimal: number;
  suggestedDecimal: number | null;
  disabled?: boolean;
}) {
  // Quote-wide partition-aware suggestion + microcopy + goal.
  const quoteSummary = useCostingStore(selectQuoteSummary);
  const bannerSuggested = quoteSummary.suggestedAdj;
  const bannerMicrocopy = quoteSummary.suggestionMicrocopy;
  const bannerGoal = quoteSummary.suggestionGoal;
  const blendedStatus = quoteSummary.blendedMarginStatus;
  const [value, setValue] = useState(decimalToPercentDisplay(initialDecimal));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slice 8 sub-step 5: optimistic store push on every onChange. The
  // store recompute fans out into every subscribed margin display
  // (QuoteSummaryCard's per-tier rows update <50ms). Server reconciles
  // ~700ms later via setValue from canonical response.
  const updateGlobalAdj = useCostingStore(selectUpdateGlobalAdj);

  // Validate, push optimistically, and schedule save. Empty → 0%.
  // Returns true on success, false on validation failure (caller
  // bails on save scheduling).
  function pushAndScheduleSave(percentDisplay: string): boolean {
    if (percentDisplay === "") {
      setValidationError(null);
      updateGlobalAdj(0);
      scheduleSave(percentDisplay);
      return true;
    }
    const decimal = Number(percentDisplay) / 100;
    const r = validatePercentDecimal(decimal, "adj");
    if (!r.valid) {
      setValidationError(r.message);
      return false;
    }
    setValidationError(null);
    updateGlobalAdj(r.normalized);
    scheduleSave(percentDisplay);
    return true;
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function fireSave(percentDisplay: string) {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("globalPriceAdjPct", percentDisplay);
    startTransition(async () => {
      const r = await updateQuoteGlobalPriceAdj(fd);
      if (!r.ok) setError(r.error.message);
      else {
        setError(null);
        // Re-hydrate from canonical server snapshot.
        const stored = r.data.globalPriceAdjPct;
        if (stored !== null) {
          setValue(decimalToPercentDisplay(Number(stored)));
        }
      }
    });
  }

  function scheduleSave(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(v), DEBOUNCE_MS);
  }

  // Slice 9.2 — apply the quote-wide system suggestion via the
  // dedicated server action so audit_log captures the
  // `source: "system_suggestion"` flag (distinguishes coaching-banner
  // applies from PM-typed GPA edits in audit timelines).
  function applySuggested() {
    if (bannerSuggested === null || disabled || pending) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const display = decimalToPercentDisplay(bannerSuggested);
    setValue(display);
    updateGlobalAdj(bannerSuggested);

    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("suggestedAdj", display);
    startTransition(async () => {
      const r = await applySuggestedGlobalAdj(fd);
      if (!r.ok) setError(r.error.message);
      else {
        setError(null);
        const stored = r.data.globalPriceAdjPct;
        if (stored !== null) {
          setValue(decimalToPercentDisplay(Number(stored)));
        }
      }
    });
  }

  // Banner color follows verdict severity: BELOW_FLOOR = red (urgent
  // lift above hard block); BELOW_TARGET = amber (coaching toward
  // target). Microcopy is generated by computeQuoteSuggestion and
  // already encodes the goal phrasing, so we only choose visual treatment.
  const bannerStyle =
    blendedStatus === "BELOW_FLOOR"
      ? {
          wrapper: "border-red-300 bg-red-50 text-red-900",
          button:
            "border-red-300 bg-white text-red-900 hover:bg-red-100",
        }
      : {
          wrapper: "border-amber-300 bg-amber-50 text-amber-900",
          button:
            "border-amber-300 bg-white text-amber-900 hover:bg-amber-100",
        };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-700">Global price adjustment</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={value}
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setValue(v);
                pushAndScheduleSave(v);
              }}
              placeholder="0"
              className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-right text-sm focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          {pending && <span className="text-xs text-gray-400">saving…</span>}
        </label>
        {validationError && (
          <span className="text-xs text-red-700" role="alert">
            {validationError}
          </span>
        )}
        {error && !validationError && (
          <span className="text-xs text-red-700" role="alert">
            {error}
          </span>
        )}
      </div>

      {/* Slice 9.2 — quote-wide system-suggested-GPA coaching banner.
          Lives WITH the slider (per IA-spec § GPA-slider-and-suggestion-
          cluster), not in the verdict pill area. Microcopy is generated
          by computeQuoteSuggestion and varies by goal (target vs floor)
          and degenerate cases (overridden tiers exceed goal, all tiers
          overridden, out-of-bounds). When suggestedAdj is null the
          microcopy may still be present — render the explanation but
          not the apply button. */}
      {blendedStatus !== "UNAVAILABLE" &&
        (bannerSuggested !== null || bannerMicrocopy !== "") && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${bannerStyle.wrapper}`}
        >
          <span className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wide">
              {/* Badge tracks VERDICT, not suggestion-goal. In
                  degenerate cases (all tiers overridden, overridden
                  exceeds goal, out-of-bounds) bannerGoal is null but
                  blendedStatus still reflects the actual verdict. Using
                  bannerGoal here would mislabel "Below floor" as "Below
                  target" whenever the closed-form solve was suppressed. */}
              {blendedStatus === "BELOW_FLOOR" ? "Below floor" : "Below target"}
            </span>
            <span>{bannerMicrocopy || "Suggested GPA unavailable."}</span>
          </span>
          {bannerSuggested !== null && (
            <button
              type="button"
              onClick={applySuggested}
              disabled={disabled || pending}
              className={`rounded-md border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${bannerStyle.button}`}
            >
              Apply {decimalToPercentDisplay(bannerSuggested)}%
            </button>
            )}
          </div>
        )}
    </div>
  );
}
