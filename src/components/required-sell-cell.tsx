"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateAssemblyLeafOverride } from "@/app/actions/costing";
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
// in depth (see updateAssemblyLeafOverride action).

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

// R2 fidelity: 2 decimals on display, 4 decimals on edit. Per Edward
// + Designer call (RI.5 Room 3 audit Finding #15). Visual cleanliness
// on display; precision retained in edit mode.
function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
      const r = await updateAssemblyLeafOverride(fd);
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
      const r = await updateAssemblyLeafOverride(fd);
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
  // R2 register per `costing.jsx:408-421`: dashed --rule-2 border by
  // default (signals editability at-a-glance); solid --accent border +
  // --accent-soft fill + --accent-ink text on override; OVR chip
  // inline INSIDE the button (single click target). Mono 13px display
  // value at 2 decimals (R2 fidelity per Finding #15). ↺ revert stays
  // adjacent for now (Finding #14 deferred to polish pass).
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 4,
      }}
    >
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
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 4,
          fontFamily: "var(--mono)",
          fontSize: 13,
          fontWeight: 500,
          color: isOverride ? "var(--accent-ink)" : "var(--ink)",
          background: isOverride ? "var(--accent-soft)" : "transparent",
          padding: "1px 6px",
          borderRadius: 4,
          border: isOverride
            ? "1px solid var(--accent)"
            : "1px dashed var(--rule-2)",
          cursor: editable ? "pointer" : "default",
        }}
      >
        {fmtCurr2(displayValue)}
        {isOverride && (
          <span
            style={{
              marginLeft: 4,
              fontSize: 9,
              letterSpacing: "0.05em",
              fontWeight: 500,
            }}
          >
            OVR
          </span>
        )}
      </button>
      {isOverride && editable && (
        <button
          type="button"
          onClick={revert}
          disabled={pending}
          title="Revert to computed sell"
          aria-label="Revert override"
          style={{
            border: "1px solid var(--rule-2)",
            background: "transparent",
            padding: "1px 6px",
            fontSize: 10,
            color: "var(--ink-3)",
            borderRadius: 4,
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          ↺
        </button>
      )}
      {error && (
        <span
          role="alert"
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            zIndex: 10,
            marginTop: 2,
            whiteSpace: "nowrap",
            background: "var(--bad-soft)",
            color: "var(--bad)",
            padding: "2px 6px",
            fontSize: 10,
            lineHeight: 1,
            borderRadius: 4,
            border: "1px solid var(--bad)",
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
