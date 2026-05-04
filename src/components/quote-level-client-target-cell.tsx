"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateQuoteLevelClientTarget } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectQuoteLevelClientTarget,
  selectStatusForTier,
  selectUpdateQuoteLevelClientTarget,
} from "@/lib/costing-store";

// Slice 9.4c — quote-level (per-tier) client target cell for the new
// "Client target" column on QuoteSummaryCard's per-tier rollup table.
//
// Composes four affordances on a single horizontal line per CR-12:
//   1. Number input ($ tier target placeholder when NULL)
//   2. Competitive verdict chip (when set + status non-null)
//      — extends <CompetitiveIndicator> styling at 2-decimal precision
//        for tier totals (vs 4-decimal for per-cell per-unit)
//   3. Reconciliation warning icon (when status is mismatched_high/_low)
//      — outlined warning triangle, 10px, CR-11 review-severity glyph
//   4. ↺ Clear button (when set) — mirrors <TierPriceAdjInput> posture
//      (NOT empty-input-on-blur, per CR-12 §6 — single-line row with
//      multiple occupants makes blur-to-clear ambiguous)
//
// NULL-as-empty-signal: input always present; verdict + warning + clear
// conditional on target being set.
//
// Composite state: additive, no suppression. When BOTH verdict AND
// warning fire on the same tier, both render side-by-side in
// left-to-right reading order: input → verdict → warning → clear.

const DEBOUNCE_MS = 500;

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Verdict chip — direction-prefixed magnitude per Slice 9.4b
// verdict-surfacing convention. Same outline-only chip styling as
// <CompetitiveIndicator> at 9px text + 2-decimal currency (tier
// totals don't need 4-decimal precision).
function CompetitiveChip({
  status,
  totalRevenue,
  clientTarget,
}: {
  status: "COMPETITIVE" | "OVER_CLIENT_TARGET";
  totalRevenue: number;
  clientTarget: number;
}) {
  const directionLabel =
    status === "COMPETITIVE" ? "under target by" : "over target by";
  const cls =
    status === "COMPETITIVE"
      ? "border-emerald-300 text-emerald-800"
      : "border-amber-300 text-amber-800";
  // Magnitude (always positive; direction encoded in label)
  const gap =
    status === "COMPETITIVE"
      ? clientTarget - totalRevenue
      : totalRevenue - clientTarget;
  // Tooltip: raw values, 2-decimal (tier totals)
  const tooltip = `Tier revenue: ${fmtCurr2(totalRevenue)} / Client tier target: ${fmtCurr2(clientTarget)}`;
  return (
    <span
      title={tooltip}
      className={`inline-block whitespace-nowrap rounded border bg-white px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide ${cls}`}
    >
      {directionLabel} {fmtCurr2(gap)}
    </span>
  );
}

// Reconciliation warning icon — 10px outlined warning triangle, CR-11
// review-severity glyph, currentColor → text-amber-600 pre-RI.
function ReconciliationWarningIcon({
  message,
}: {
  message: string;
}) {
  return (
    <span
      title={message}
      className="inline-flex items-center text-amber-600"
      aria-label="Reconciliation mismatch"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 1 L9 8.5 L1 8.5 Z" />
        <path d="M5 4 V6.2" strokeLinecap="round" />
        <path d="M5 7.4 V7.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function QuoteLevelClientTargetCell({
  tierId,
  disabled = false,
}: {
  tierId: string;
  disabled?: boolean;
}) {
  const target = useCostingStore(selectQuoteLevelClientTarget(tierId));
  const tierRollup = useCostingStore(selectStatusForTier(tierId));
  const updateLocal = useCostingStore(selectUpdateQuoteLevelClientTarget);

  const isSet = target !== null;
  const [value, setValue] = useState<string>(isSet ? String(target) : "");
  // Re-sync local state on canonical store changes (e.g., realtime
  // event reconciles a snapshot in mid-edit).
  useEffect(() => {
    setValue(target !== null ? String(target) : "");
  }, [target]);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function fireSave(dollarStr: string) {
    const fd = new FormData();
    fd.set("tierId", tierId);
    fd.set("clientTargetPriceTotal", dollarStr);
    startTransition(async () => {
      const r = await updateQuoteLevelClientTarget(fd);
      if (!r.ok) setError(r.error.message);
      else setError(null);
    });
  }

  function scheduleSave(dollarStr: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fireSave(dollarStr), DEBOUNCE_MS);
  }

  // Number input change: optimistic update + debounced save. Empty
  // string is NOT treated as clear (the dedicated ↺ button is the only
  // clear path, per CR-12 §6 — mirrors TierPriceAdjInput posture).
  // Empty input = "no change" until user either types a value OR
  // clicks ↺.
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    setError(null);
    if (v === "") {
      // No optimistic write; the user may be mid-typing or about to
      // click ↺. Don't fire save until they commit a value.
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      setError("Enter a numeric value.");
      return;
    }
    if (n <= 0) {
      setError("Target must be greater than zero.");
      return;
    }
    updateLocal(tierId, n);
    scheduleSave(v);
  }

  function clearTarget() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setError(null);
    setValue("");
    updateLocal(tierId, null);
    fireSave("");
  }

  // Pull the verdict + reconciliation derived states from the rollup.
  const competitiveStatus = tierRollup?.competitiveStatusQuoteLevel ?? null;
  const reconciliationStatus =
    tierRollup?.targetReconciliationStatus ?? "not_applicable";
  const reconciliationMismatch =
    reconciliationStatus === "mismatched_high" ||
    reconciliationStatus === "mismatched_low";

  // Reconciliation warning message — same copy the validation engine
  // produces on the persisted warning row (validation.ts §
  // checkQuoteLevelReconciliation), so the inline tooltip + the
  // summary panel + audit trail all read the same.
  const reconciliationMessage =
    tierRollup && reconciliationMismatch && tierRollup.clientTargetPriceTotal !== null
      ? `Sum of cell targets (${fmtCurr2(tierRollup.sumOfCellTargetsAtTier)}) ${
          reconciliationStatus === "mismatched_high" ? "exceeds" : "is below"
        } the quote-level target (${fmtCurr2(tierRollup.clientTargetPriceTotal)}) by ${fmtCurr2(Math.abs(tierRollup.sumOfCellTargetsAtTier - tierRollup.clientTargetPriceTotal))}.`
      : "";

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs">
      <div className="flex items-center gap-0.5">
        <span className="text-gray-400">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          disabled={disabled || pending}
          onChange={onChange}
          placeholder="tier target"
          aria-label="Quote-level client target for tier"
          className="w-24 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-right tabular-nums focus:border-gray-400 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
      </div>
      {isSet && competitiveStatus !== null && tierRollup && (
        <CompetitiveChip
          status={competitiveStatus}
          totalRevenue={tierRollup.totalRevenue}
          clientTarget={tierRollup.clientTargetPriceTotal as number}
        />
      )}
      {isSet && reconciliationMismatch && (
        <ReconciliationWarningIcon message={reconciliationMessage} />
      )}
      {isSet && (
        <button
          type="button"
          onClick={clearTarget}
          disabled={disabled || pending}
          title="Clear quote-level client target"
          aria-label="Clear quote-level client target"
          className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          ↺
        </button>
      )}
      {pending && <span className="text-[10px] text-gray-400">saving…</span>}
      {error && (
        <span className="text-[10px] text-red-700" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
