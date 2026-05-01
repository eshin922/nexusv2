"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateQuoteGlobalPriceAdj } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import { selectUpdateGlobalAdj } from "@/lib/costing-store";
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

// Controlled percent input with debounced save + a one-click "Apply
// suggested" button when a non-null suggestion is provided.
//
// Re-hydrates from canonical server response after each save.
export function GlobalPriceAdjInput({
  quoteId,
  initialDecimal,
  suggestedDecimal,
  disabled = false,
}: {
  quoteId: string;
  initialDecimal: number;
  suggestedDecimal: number | null;
  disabled?: boolean;
}) {
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

  function applySuggested() {
    if (suggestedDecimal === null || disabled || pending) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const display = decimalToPercentDisplay(suggestedDecimal);
    setValue(display);
    updateGlobalAdj(suggestedDecimal);
    fireSave(display);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-700">Global price adjustment</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            disabled={disabled || pending}
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
      {suggestedDecimal !== null && (
        <button
          type="button"
          onClick={applySuggested}
          disabled={disabled || pending}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply suggested {decimalToPercentDisplay(suggestedDecimal)}% to hit
          target
        </button>
      )}
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
  );
}
