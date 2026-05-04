"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateClientTarget } from "@/app/actions/costing";
import {
  useCostingStore,
  useCostingStoreApi,
} from "@/components/costing-store-provider";
import {
  selectCellTarget,
  selectPerTierForSku,
  selectQuoteId,
  selectTiers,
  selectUpdateCellTarget,
} from "@/lib/costing-store";
import {
  naiveTierAdjForCostExceedsTarget,
  suggestTierAdjForClientTarget,
  type QuoteCostingInput,
} from "@/lib/costing";
import { ReverseSolveDialog } from "@/components/costing/reverse-solve-dialog";

// Slice 9.4b — per-(SKU, tier) client target benchmark cell. Renders
// the Client target value on the per-SKU summary row's new column.
// Mirrors Slice 9.3 RequiredSellCell pattern with three deliberate
// divergences:
//
//   1. NULL-as-empty-signal: empty cells render as empty space (no
//      placeholder text, no "—", no input outline). Cell area is
//      always click-target — invisible button covers the area, cursor
//      changes on hover, click opens editor (per Edward's pressure-
//      test C resolution).
//
//   2. Empty input on commit CLEARS (different from RequiredSellCell
//      which blocks empty). For client target, empty IS the natural
//      "no benchmark" state, so empty input → null → DELETE row.
//      No separate ↺ button; clearing is a deliberate empty-input
//      commit.
//
//   3. Reverse-solve "Apply suggested adj" affordance appears
//      adjacent to the value when the cell has a target AND the solve
//      is actionable. Per Edward's resolution: HIDDEN for non-
//      actionable failure modes (cell_overridden, all_cells_fixed,
//      solution_out_of_range, no_target_set — the last one is implicit
//      since affordance only appears when target is set). SHOWN-
//      enabled with consequence flag for cost_exceeds_target.
//      Hidden-vs-disabled call: hidden, because showing disabled UI
//      for fundamentally non-actionable affordances creates phantom
//      interactivity.
//
// Edit modes mirror RequiredSellCell:
//   - Click (cell or empty area) → editor opens with prefilled value
//     (or empty for unset cells), auto-focus + select-all
//   - Enter / blur → commit (empty → clear; non-empty → upsert)
//   - Esc → cancel
//   - No-op short-circuit when value matches current target (within
//     0.00005 precision tolerance)
//
// Disabled state (editable=false): cell renders the value but isn't
// clickable; reverse-solve affordance is hidden.

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function ClientTargetCell({
  quoteSkuId,
  skuLabel,
  tierId,
  editable,
}: {
  quoteSkuId: string;
  skuLabel: string;
  tierId: string;
  editable: boolean;
}) {
  const cellTarget = useCostingStore(selectCellTarget(quoteSkuId, tierId));
  const cellRollup = useCostingStore(selectPerTierForSku(quoteSkuId, tierId));
  const updateLocal = useCostingStore(selectUpdateCellTarget);
  const tiers = useCostingStore(selectTiers);
  const quoteId = useCostingStore(selectQuoteId);
  const storeApi = useCostingStoreApi();

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editMode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editMode]);

  // Derive reverse-solve actionability for affordance visibility. Runs
  // every render; cheap (closed-form solve, no DB roundtrip). When
  // cellTarget is null we short-circuit (no affordance anyway). When
  // set, we snapshot the store and run the solve to decide. Hidden
  // for non-actionable failure modes per Edward's resolution.
  let solveActionable = false;
  let solveSuggestedAdj = 0;
  let solveConsequenceCostExceedsTarget = false;
  if (cellTarget !== null && cellRollup) {
    const state = storeApi.getState();
    const input: QuoteCostingInput = {
      quote: {
        id: state.quoteId,
        globalPriceAdjPct: state.globalPriceAdjPct,
        targetMarginPct: state.targetMarginPct,
      },
      firmSettings: state.firmSettings,
      markupDefaults: state.markupDefaults,
      skus: state.skus,
      tiers: state.tiers,
      packaging: state.packaging,
      production: state.production,
      freight: state.freight,
      cellOverrides: state.cellOverrides,
      cellTargets: state.cellTargets,
    };
    // Use the freshly-derived costing from store (state.costing) — it
    // already reflects all current overrides + tier adjustments.
    const result = suggestTierAdjForClientTarget(
      quoteSkuId,
      tierId,
      state.costing,
      input,
    );
    if (result.ok) {
      solveActionable = true;
      solveSuggestedAdj = result.suggestedTierAdj;
    } else if (result.reason === "cost_exceeds_target") {
      // Per Edward's pressure-test resolution: cost_exceeds_target is
      // applyable with explicit consequence framing on the dialog.
      // The math layer's `suggestTierAdjForClientTarget` short-circuits
      // at the guard (base >= T → no positive sell hits target → naive
      // tier_adj <= 0); the naive helper does the rest. Returns null
      // when the naive value is out of bounds — surfaces as
      // affordance-hidden (UX equivalent of solution_out_of_range).
      // Action layer's apply path mirrors this same helper for server
      // re-derivation; both call sites stay aligned.
      const skuRollup = state.costing.skuRollups.find((r) => r.skuId === quoteSkuId);
      const cell = skuRollup?.perTier.find((p) => p.tierId === tierId);
      const tierRow = state.tiers.find((t) => t.id === tierId);
      if (cell && tierRow) {
        const currentTierAdj =
          tierRow.tierPriceAdjPct ?? state.globalPriceAdjPct;
        const denom = 1 + currentTierAdj;
        if (denom !== 0) {
          const base = cell.computedSellPerUnit / denom;
          const naive = naiveTierAdjForCostExceedsTarget(base, cellTarget);
          if (naive !== null) {
            solveActionable = true;
            solveSuggestedAdj = naive;
            solveConsequenceCostExceedsTarget = true;
          }
        }
      }
    }
    // All other failure modes (cell_overridden, all_cells_fixed,
    // solution_out_of_range, no_target_set) → leave solveActionable
    // false, affordance hidden.
  }

  if (!cellRollup) {
    // Defensive — empty placeholder.
    return <span className="text-gray-400">&nbsp;</span>;
  }

  function openEditor() {
    if (!editable || pending) return;
    setDraft(cellTarget !== null ? cellTarget.toFixed(4) : "");
    setError(null);
    setEditMode(true);
  }

  function commit(value: string) {
    setError(null);
    const trimmed = value.trim();
    if (trimmed === "") {
      // Empty input → clear (different from RequiredSellCell). For
      // client target, empty IS the natural unset state.
      // No-op short-circuit: cell already has no target.
      if (cellTarget === null) {
        setEditMode(false);
        cellButtonRef.current?.focus();
        return;
      }
      updateLocal(quoteSkuId, tierId, null);
      setEditMode(false);
      cellButtonRef.current?.focus();
      const fd = new FormData();
      fd.set("quoteSkuId", quoteSkuId);
      fd.set("tierId", tierId);
      fd.set("clientTargetPricePerUnit", "");
      startTransition(async () => {
        const r = await updateClientTarget(fd);
        if (!r.ok) setError(r.error.message);
      });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      setError("Enter a numeric value.");
      return;
    }
    if (n <= 0) {
      setError(
        "Client target must be greater than zero. Clear the field to remove a benchmark.",
      );
      return;
    }
    // No-op short-circuit when value matches current target (within
    // display precision). Mirrors action-layer's numericEquals guard.
    if (cellTarget !== null && Math.abs(n - cellTarget) < 0.00005) {
      setEditMode(false);
      cellButtonRef.current?.focus();
      return;
    }
    updateLocal(quoteSkuId, tierId, n);
    setEditMode(false);
    cellButtonRef.current?.focus();
    const fd = new FormData();
    fd.set("quoteSkuId", quoteSkuId);
    fd.set("tierId", tierId);
    fd.set("clientTargetPricePerUnit", n.toString());
    startTransition(async () => {
      const r = await updateClientTarget(fd);
      if (!r.ok) setError(r.error.message);
    });
  }

  function cancel() {
    setError(null);
    setEditMode(false);
    cellButtonRef.current?.focus();
  }

  // Tier metadata for the dialog (label + qty for header copy).
  const tierMeta = tiers.find((t) => t.tierId === tierId);

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
          placeholder="(empty = clear)"
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

  // Display mode. NULL-as-empty-signal: empty cell renders as a
  // minimal-width invisible click target (no value text, no
  // placeholder). Set cell renders the value with subtle italic
  // treatment (lighter than required sell, which is the canonical
  // value column).
  return (
    <>
      <span className="relative inline-flex items-center justify-end gap-1 tabular-nums">
        <button
          ref={cellButtonRef}
          type="button"
          disabled={!editable}
          onClick={openEditor}
          title={
            editable
              ? cellTarget !== null
                ? "Click to edit client target"
                : "Click to set client target"
              : undefined
          }
          className={`min-w-[3rem] rounded px-1 py-0 text-right tabular-nums ${
            editable
              ? "cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              : "cursor-default"
          } ${cellTarget !== null ? "font-normal text-gray-600" : "text-transparent"}`}
        >
          {cellTarget !== null ? fmtCurr4(cellTarget) : "—"}
        </button>
        {/* Reverse-solve affordance — hidden by default, shown when
            solve is actionable (or cost_exceeds_target with consequence
            flag). Per Edward's resolution: hidden-not-disabled for
            non-actionable cases (no phantom interactivity). */}
        {editable && solveActionable && tierMeta && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={pending}
            title={
              solveConsequenceCostExceedsTarget
                ? "Apply suggested tier adjustment to match client target — would price below cost (consequence)"
                : "Apply suggested tier adjustment to match client target"
            }
            aria-label="Apply suggested tier adjustment"
            className={`rounded border px-1.5 py-0 text-[10px] leading-none disabled:opacity-50 ${
              solveConsequenceCostExceedsTarget
                ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"
            }`}
          >
            {solveConsequenceCostExceedsTarget
              ? "⚠ apply (drops margin)"
              : "→ apply suggested adj"}
          </button>
        )}
        {error && !editMode && (
          <span
            role="alert"
            className="absolute right-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[10px] leading-none text-red-800 shadow-sm"
          >
            {error}
          </span>
        )}
      </span>
      {/* Reverse-solve dialog — local state in this cell; portals to
          document.body to escape table overflow. Renders only when
          dialogOpen=true; lazy snapshot of store state inside dialog. */}
      {dialogOpen && tierMeta && cellTarget !== null && (
        <ReverseSolveDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          originSkuId={quoteSkuId}
          originSkuLabel={skuLabel}
          affectedTierId={tierId}
          affectedTierLabel={tierMeta.label}
          affectedTierQty={tierMeta.qty}
          clientTarget={cellTarget}
          suggestedTierAdj={solveSuggestedAdj}
          consequenceCostExceedsTarget={solveConsequenceCostExceedsTarget}
          quoteId={quoteId}
        />
      )}
    </>
  );
}
