"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateTierPriceAdj } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectGlobalAdj,
  selectTierPriceAdj,
  selectUpdateTierPriceAdj,
} from "@/lib/costing-store";
import { validatePercentDecimal } from "@/lib/percent-validation";

const DEBOUNCE_MS = 500;

// Per-tier price-adjustment override (Slice 9.2). NULL = inherit
// global; value = REPLACE global for this tier (does not stack — see
// CLAUDE.md "Slice 9 pricing-control columns" + costing.ts effective-
// value pattern).
//
// Affordance pair (per IA-spec § Per-tier price adjustment surface):
//   - Number input: writes a literal override (write-on-change w/
//     debounced save). Same value as global is allowed and STORED as
//     an override (per "keep literal" decision — sticks to the value
//     even if global later moves).
//   - "↺ inherit global" button: writes NULL, clearing the override.
//     This is the ONLY path to clear; the input itself never writes
//     NULL on its own (a value of 0% is a valid override, not a
//     clear).
//
// Indicator: shows "OVERRIDE" pill when override is set, plus a
// subtle "matches global" hint when the override value equals the
// current global GPA (so PMs notice when an override is no-op-y at
// this exact moment).
function decimalToPercentDisplay(d: number): string {
  if (!Number.isFinite(d)) return "";
  const n = d * 100;
  return Number(n.toFixed(4)).toString();
}

export function TierPriceAdjInput({
  tierId,
  disabled = false,
}: {
  tierId: string;
  disabled?: boolean;
}) {
  const tierAdj = useCostingStore(selectTierPriceAdj(tierId));
  const globalAdj = useCostingStore(selectGlobalAdj);
  const updateLocal = useCostingStore(selectUpdateTierPriceAdj);

  const isOverride = tierAdj !== null;
  // Display: when overridden, show the literal value; when inheriting,
  // leave the input empty so the placeholder hints at the inherited
  // global. Re-sync local state on canonical store changes.
  const [value, setValue] = useState<string>(
    isOverride ? decimalToPercentDisplay(tierAdj as number) : "",
  );
  useEffect(() => {
    setValue(isOverride ? decimalToPercentDisplay(tierAdj as number) : "");
  }, [tierAdj, isOverride]);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function fireSave(percentDisplay: string | null) {
    const fd = new FormData();
    fd.set("tierId", tierId);
    // Empty string clears the override on the server side; the action
    // converts "" → null and writes NULL to the column.
    fd.set("tierPriceAdjPct", percentDisplay ?? "");
    startTransition(async () => {
      const r = await updateTierPriceAdj(fd);
      if (!r.ok) setError(r.error.message);
      else setError(null);
    });
  }

  function scheduleSave(percentDisplay: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(percentDisplay), DEBOUNCE_MS);
  }

  // Number input change: write-on-change to the optimistic store + a
  // debounced server save. Empty string is treated as "0% override"
  // (NOT a clear — clear is the dedicated button).
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    const decimal = v === "" ? 0 : Number(v) / 100;
    const r = validatePercentDecimal(decimal, "adj");
    if (!r.valid) {
      setValidationError(r.message);
      return;
    }
    setValidationError(null);
    updateLocal(tierId, r.normalized);
    scheduleSave(v === "" ? "0" : v);
  }

  function clearOverride() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValidationError(null);
    setValue("");
    updateLocal(tierId, null);
    fireSave(null);
  }

  // "Matches global" polish: when the literal override equals current
  // global, surface a subtle hint so PMs know a slider drag landed at
  // the inherited value (and that the override is still active).
  const matchesGlobal =
    isOverride &&
    typeof tierAdj === "number" &&
    Math.abs((tierAdj as number) - globalAdj) < 1e-9;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={onChange}
          placeholder={decimalToPercentDisplay(globalAdj)}
          aria-label="Per-tier price adjustment override"
          className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-right tabular-nums focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
        <span className="text-gray-400">%</span>
      </div>
      {isOverride ? (
        <>
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-800">
            Override
          </span>
          {matchesGlobal && (
            <span className="text-[10px] text-gray-400">
              matches global
            </span>
          )}
          <button
            type="button"
            onClick={clearOverride}
            disabled={disabled || pending}
            title="Revert to global price adjustment"
            className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            ↺ inherit global
          </button>
        </>
      ) : (
        <span className="text-[10px] text-gray-400">inheriting global</span>
      )}
      {pending && <span className="text-[10px] text-gray-400">saving…</span>}
      {validationError && (
        <span className="text-[10px] text-red-700" role="alert">
          {validationError}
        </span>
      )}
      {error && !validationError && (
        <span className="text-[10px] text-red-700" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
