"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateSellPriceOverride } from "@/app/actions/costing";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectCellOverride,
  selectPerTierForSku,
  selectUpdateCellOverride,
} from "@/lib/costing-store";

// Slice 9.3 — per-cell sell-price override editor. Renders the
// Required Sell value in the per-SKU breakdown (leaf rows only —
// assembly cells stay read-only because overrides apply only to leaf
// SKUs per the action-layer invariant).
//
// UX commitments (per Slice 9.3 brief + Edward's confirmation):
//   - Click-to-edit: anywhere on the cell except the ↺ button opens
//     the inline editor.
//   - Auto-focus + select-all on edit open. Standard spreadsheet flow.
//   - Commit on Enter or blur. Cancel on Escape.
//   - No-op short-circuit when value unchanged (no DB write, no audit).
//   - Empty input is BLOCKED with inline error — empty != clear.
//     Explicit ↺ revert is the only path to clear an override.
//   - Box continuity: input dimensions match text-display dimensions
//     (no row reflow between display and edit modes).
//   - Focus returns to cell on commit/cancel; cell is Tab-navigable.
//   - OVR badge (visual-only) appears when sellSource === "cell_override".
//   - ↺ revert is a separate adjacent icon button, not a hover tooltip.
//   - Hover tooltip on OVR badge surfaces the pre-override computed
//     value ("was $X.XXXX") for "what was this before?" debugging.
//
// Disabled state (editable=false): cell renders the value (with OVR
// badge if overridden) but is not clickable. ↺ button is hidden.
// Server-side rejection via quoteForSku draft guard provides defense
// in depth (see updateSellPriceOverride action).

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function RequiredSellCell({
  quoteSkuId,
  tierId,
  editable,
}: {
  quoteSkuId: string;
  tierId: string;
  editable: boolean;
}) {
  // Curried subscriptions: this cell only re-renders when ITS rollup
  // or override changes — not when other cells in the table change.
  const cellRollup = useCostingStore(selectPerTierForSku(quoteSkuId, tierId));
  // selectCellOverride is read for symmetry; the rollup's sellSource
  // already encodes whether an override is active. But subscribing
  // here ensures we re-render on optimistic clear/set even before the
  // rollup recomputes (which it does immediately, but the subscription
  // is harmless and explicit).
  useCostingStore(selectCellOverride(quoteSkuId, tierId));
  const updateLocal = useCostingStore(selectUpdateCellOverride);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const cellButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus + select-all on edit mode entry. Single-frame delay via
  // useEffect ensures the input is mounted before focus is requested.
  useEffect(() => {
    if (editMode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editMode]);

  if (!cellRollup) {
    return <span className="text-gray-400">—</span>;
  }

  const isOverride = cellRollup.sellSource === "cell_override";
  const displayValue = cellRollup.requiredSellPerUnit;
  const computedValue = cellRollup.computedSellPerUnit;

  function openEditor() {
    if (!editable || pending) return;
    // Prefill with current displayed value (override or computed) so PM
    // edits from the existing value, not from blank. 4-decimal precision
    // matches the display format.
    setDraft(displayValue.toFixed(4));
    setError(null);
    setEditMode(true);
  }

  function commit(value: string) {
    setError(null);
    const trimmed = value.trim();
    if (trimmed === "") {
      // Empty input: block. Don't let empty = clear; preserve the
      // explicit revert path via the ↺ button.
      setError("Enter a value or click ↺ to revert.");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setError("Enter a numeric value.");
      return;
    }
    if (n <= 0) {
      // Mirrors action-layer rejection. Surfaced inline so PM doesn't
      // need to round-trip the server to learn the rule.
      setError("Sell price must be greater than zero. Use ↺ to revert.");
      return;
    }
    // No-op short-circuit: only when the cell is ALREADY overridden
    // AND the new value matches the existing override (within display
    // precision: 4 decimals → 0.00005 tolerance). Mirrors action-
    // layer's numericEquals short-circuit so we don't write empty
    // audit rows on no-change blurs.
    //
    // CRITICAL: do NOT short-circuit when cell is computed-only and
    // the typed value happens to match the computed value. Per Slice
    // 9.2's keep-literal semantic, matching values are still
    // meaningful overrides — the override persists when the underlying
    // computed value later changes (GPA moves, costs shift, etc.).
    // PM typing the displayed-computed-value into a non-overridden
    // cell IS a deliberate set-to-literal action.
    if (isOverride && Math.abs(n - displayValue) < 0.00005) {
      setEditMode(false);
      cellButtonRef.current?.focus();
      return;
    }
    // Optimistic store push + server save. The store updates first so
    // the cell re-renders <50ms; server reconcile follows ~700ms later.
    updateLocal(quoteSkuId, tierId, n);
    setEditMode(false);
    cellButtonRef.current?.focus();

    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("tierId", tierId);
    fd.set("sellPriceOverride", n.toString());
    startTransition(async () => {
      const r = await updateSellPriceOverride(fd);
      if (!r.ok) {
        // Surface the error; don't roll back optimistic update — the
        // next snapshot reconcile will restore truth, and the user
        // sees what they tried to do (so they can correct it).
        setError(r.error.message);
      }
    });
  }

  function cancel() {
    setError(null);
    setEditMode(false);
    cellButtonRef.current?.focus();
  }

  function revert() {
    if (!editable || pending || !isOverride) return;
    setError(null);
    // Optimistic clear (DELETEs the row server-side). Empty form
    // value triggers the action's null branch.
    updateLocal(quoteSkuId, tierId, null);
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("tierId", tierId);
    fd.set("sellPriceOverride", "");
    startTransition(async () => {
      const r = await updateSellPriceOverride(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  // ---- Edit mode render ----
  // Input box continuity: same right-alignment + tabular-nums as the
  // display mode. width matches the typical $X.XXXX width so the row
  // doesn't reflow when entering/leaving edit mode. Error renders as
  // an absolutely-positioned tooltip below the cell so it doesn't
  // expand the row's vertical space (which would shift the table).
  if (editMode) {
    return (
      <span className="relative inline-flex items-center justify-end gap-0.5">
        <span className="text-[10px] text-gray-400">$</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={pending}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => commit(draft)}
          className="w-20 rounded border border-blue-400 bg-white px-1 py-0 text-right text-xs tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        />
        {error && (
          <span
            role="alert"
            className="absolute right-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[10px] leading-none text-red-800 shadow-sm"
          >
            {error}
          </span>
        )}
      </span>
    );
  }

  // ---- Display mode render ----
  // Inline (no flex-col) so the cell stays in the table row's normal
  // flow without expanding vertical space. Error tooltip absolutely
  // positioned (rare path; only after a server rejection).
  return (
    <span className="relative inline-flex items-center justify-end gap-1 tabular-nums">
      <button
        ref={cellButtonRef}
        type="button"
        disabled={!editable}
        onClick={openEditor}
        title={
          editable
            ? isOverride
              ? `Click to edit override · was ${fmtCurr4(computedValue)}`
              : "Click to override sell price"
            : undefined
        }
        className={`rounded px-1 py-0 text-right tabular-nums ${
          editable
            ? "cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
            : "cursor-default"
        } ${isOverride ? "font-semibold text-indigo-900" : ""}`}
      >
        {fmtCurr4(displayValue)}
      </button>
      {isOverride && (
        <>
          <span
            title={`Override active · was ${fmtCurr4(computedValue)} computed`}
            className="rounded bg-indigo-100 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-indigo-800"
          >
            OVR
          </span>
          {editable && (
            <button
              type="button"
              onClick={revert}
              disabled={pending}
              title="Revert to computed sell"
              aria-label="Revert override"
              className="rounded border border-gray-200 px-1 py-0 text-[10px] leading-none text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              ↺
            </button>
          )}
        </>
      )}
      {error && (
        <span
          role="alert"
          className="absolute right-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[10px] leading-none text-red-800 shadow-sm"
        >
          {error}
        </span>
      )}
    </span>
  );
}
