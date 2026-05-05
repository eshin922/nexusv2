"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { applyClientTargetSolveTierAdj } from "@/app/actions/costing";
import { useCostingStoreApi } from "@/components/costing-store-provider";
import {
  computeQuoteCosting,
  type QuoteCostingInput,
  type QuoteCostingResult,
} from "@/lib/costing";

// Slice 9.4b — cross-cell consequence dialog for the "Apply suggested
// adj to match client target" reverse-solve affordance.
//
// Renders an explicit per-cell post-apply table showing every
// (SKU, tier T) cell's predicted required_sell + verdicts AFTER the
// suggested tier_adj is applied. Per Edward's pressure-test A
// resolution: rich consequence visibility, not text summary — applying
// a tier_adj affects the whole tier, and PMs need to see what the
// trade-off costs at other cells before committing.
//
// Two-call preview pattern (per architect Q2 sign-off): the suggest
// helper returns ONLY the suggested adj. This dialog snapshots the
// store, substitutes the adj into the relevant tier's
// `tierPriceAdjPct`, and re-runs `computeQuoteCosting` to produce the
// preview. <16ms recompute per CLAUDE.md; reuses canonical math
// without duplicating logic. Every override layer (cell, tier, global)
// is respected automatically because we delegate to the same code
// path that production reads use.
//
// Architect-flagged honesty: assembly cells with overridden leaf
// descendants surface in the preview table with a small
// "N descendants overridden" count. Per architect's unprompted
// observation — the apply still moves the unoverridden portion of
// the assembly's blended sell, so the preview shows the partial
// movement; the descendants count signals what stays put.

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtCurr4(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function buildPreviewInput(
  current: QuoteCostingInput,
  affectedTierId: string,
  suggestedTierAdj: number,
): QuoteCostingInput {
  return {
    ...current,
    tiers: current.tiers.map((t) =>
      t.id === affectedTierId
        ? { ...t, tierPriceAdjPct: suggestedTierAdj }
        : t,
    ),
  };
}

type PreviewRow = {
  skuId: string;
  skuLabel: string;
  productName: string;
  isAssembly: boolean;
  // Number of overridden leaf descendants under this assembly at the
  // affected tier (0 for leaves; positive for assemblies with
  // overridden children). Surfaces in UI as "N descendants overridden"
  // — honest signal that the apply won't move those portions.
  overriddenDescendantsCount: number;
  currentSell: number;
  postApplySell: number;
  // Margin verdict before/after — typically degrades when reverse-solve
  // pulls sell down to client target (PM accepts margin compression to
  // win the deal); shown so the trade-off is explicit.
  currentMarginPct: number;
  postApplyMarginPct: number;
};

function buildPreviewRows(
  currentCosting: QuoteCostingResult,
  previewCosting: QuoteCostingResult,
  affectedTierId: string,
  cellOverrides: { quoteSkuId: string; tierId: string }[],
  childrenByParent: Map<string | null, string[]>,
): PreviewRow[] {
  // Helper: count overridden leaf descendants of a SKU at the affected
  // tier. Recursive. For leaves: 1 if overridden, 0 otherwise. For
  // assemblies: sum across children.
  function countOverriddenLeaves(skuId: string): number {
    const kids = childrenByParent.get(skuId) ?? [];
    if (kids.length === 0) {
      // Leaf: 1 if overridden at this tier, else 0.
      const isOverridden = cellOverrides.some(
        (o) => o.quoteSkuId === skuId && o.tierId === affectedTierId,
      );
      return isOverridden ? 1 : 0;
    }
    return kids.reduce((sum, k) => sum + countOverriddenLeaves(k), 0);
  }

  const rows: PreviewRow[] = [];
  for (const skuRollup of currentCosting.skuRollups) {
    const currentCell = skuRollup.perTier.find((p) => p.tierId === affectedTierId);
    if (!currentCell) continue;
    const previewSku = previewCosting.skuRollups.find((r) => r.skuId === skuRollup.skuId);
    const previewCell = previewSku?.perTier.find((p) => p.tierId === affectedTierId);
    if (!previewCell) continue;
    const isAssembly = skuRollup.skuRole === "assembly";
    rows.push({
      skuId: skuRollup.skuId,
      skuLabel: skuRollup.skuLabel,
      productName: skuRollup.productName,
      isAssembly,
      overriddenDescendantsCount: isAssembly
        ? countOverriddenLeaves(skuRollup.skuId)
        : currentCell.sellSource === "cell_override"
          ? 1
          : 0,
      currentSell: currentCell.requiredSellPerUnit,
      postApplySell: previewCell.requiredSellPerUnit,
      currentMarginPct: currentCell.marginPct,
      postApplyMarginPct: previewCell.marginPct,
    });
  }
  return rows;
}

export function ReverseSolveDialog({
  open,
  onClose,
  originSkuId,
  originSkuLabel,
  affectedTierId,
  affectedTierLabel,
  affectedTierQty,
  clientTarget,
  suggestedTierAdj,
  consequenceCostExceedsTarget,
  quoteId,
}: {
  open: boolean;
  onClose: () => void;
  originSkuId: string;
  originSkuLabel: string;
  affectedTierId: string;
  affectedTierLabel: string;
  affectedTierQty: number;
  clientTarget: number;
  suggestedTierAdj: number;
  // Flag for cost_exceeds_target case (negative tier_adj, sell ≤ cost).
  // Per Edward's resolution: affordance is shown for this case but the
  // dialog must surface the consequence prominently.
  consequenceCostExceedsTarget: boolean;
  quoteId: string;
}) {
  const storeApi = useCostingStoreApi();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Portal target: only render after mount (createPortal needs DOM).
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC closes dialog (matches HelpTooltip + popover patterns).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // Snapshot store ONCE per dialog open. Compute preview by
  // substituting the suggested adj into the relevant tier's
  // tierPriceAdjPct, then re-running computeQuoteCosting. The preview
  // table renders both before/after columns from this snapshot.
  const state = storeApi.getState();
  const currentInput: QuoteCostingInput = {
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
  const previewInput = buildPreviewInput(currentInput, affectedTierId, suggestedTierAdj);
  const previewCosting = computeQuoteCosting(previewInput);

  // Build child lookup map for assembly descendant-count helper.
  const childrenByParent = new Map<string | null, string[]>();
  for (const s of state.skus) {
    const arr = childrenByParent.get(s.parentSkuId) ?? [];
    arr.push(s.id);
    childrenByParent.set(s.parentSkuId, arr);
  }

  const previewRows = buildPreviewRows(
    state.costing,
    previewCosting,
    affectedTierId,
    state.cellOverrides,
    childrenByParent,
  );

  // Slice 9.4b — count overridden cells in the affected tier for the
  // chip banner. Counts ONLY leaf-level overrides (assembly rows in
  // previewRows aggregate descendant counts; using cellOverrides
  // directly avoids double-counting the assembly + its descendants).
  const totalOverriddenCellsInTier = state.cellOverrides.filter(
    (o) => o.tierId === affectedTierId,
  ).length;

  function applyAndClose() {
    setError(null);
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("tierId", affectedTierId);
    fd.set("suggestedSkuId", originSkuId);
    fd.set("suggestedAdj", suggestedTierAdj.toString());
    startTransition(async () => {
      const r = await applyClientTargetSolveTierAdj(fd);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      onClose();
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Apply suggested tier adjustment"
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/20 p-4"
      onClick={(e) => {
        // Click on backdrop closes; click inside dialog body doesn't.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-xl">
        {/* Header — split into one-line headline + one-line subhead.
            Headline: "what's about to happen + origin SKU."
            Subhead: "how others move."
            Chip banner (conditional): N descendants overridden. */}
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            Apply{" "}
            <span className="tabular-nums">
              {suggestedTierAdj >= 0 ? "+" : ""}
              {fmtPct(suggestedTierAdj)}
            </span>{" "}
            to {affectedTierLabel} — lands{" "}
            <span className="font-semibold">{originSkuLabel}</span> at{" "}
            <span className="tabular-nums">{fmtCurr4(clientTarget)}</span>
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Other {affectedTierLabel} cells move proportionally.
          </p>
          {totalOverriddenCellsInTier > 0 && (
            <span className="mt-2 inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
              {totalOverriddenCellsInTier}{" "}
              {totalOverriddenCellsInTier === 1 ? "cell is" : "cells are"}{" "}
              price-fixed and won't move
            </span>
          )}
          {consequenceCostExceedsTarget && (
            <p
              role="alert"
              className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              <span className="font-semibold">Consequence:</span> the suggested
              adjustment is negative — it will price{" "}
              <span className="font-semibold">{originSkuLabel}</span> below
              the cost base required to hit the client target. Other cells
              in this tier may drop below floor margin. Apply only if
              intentional.
            </p>
          )}
        </div>

        {/* Per-cell preview table */}
        <div className="overflow-x-auto p-5">
          <table className="min-w-full text-xs">
            <thead className="border-b border-gray-200 text-left uppercase tracking-wide text-[10px] text-gray-500">
              <tr>
                <th className="py-1.5 pr-3">SKU</th>
                <th className="py-1.5 pr-3 text-right">Current sell</th>
                <th className="py-1.5 pr-3 text-right">Post-apply sell</th>
                <th className="py-1.5 pr-3 text-right">Current margin</th>
                <th className="py-1.5 pr-3 text-right">Post-apply margin</th>
                <th className="py-1.5 pr-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {previewRows.map((r) => {
                const sellChanged = Math.abs(r.postApplySell - r.currentSell) > 0.0001;
                const marginDropped = r.postApplyMarginPct < r.currentMarginPct - 0.0001;
                return (
                  <tr
                    key={r.skuId}
                    className={r.skuId === originSkuId ? "bg-blue-50/40" : ""}
                  >
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1.5">
                        {r.isAssembly && (
                          <span className="rounded bg-blue-100 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-blue-800">
                            Asm
                          </span>
                        )}
                        <span className="font-medium text-gray-900">
                          {r.skuLabel}
                        </span>
                        <span className="truncate text-gray-500">
                          {r.productName}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {fmtCurr4(r.currentSell)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        sellChanged
                          ? "font-semibold text-gray-900"
                          : "text-gray-400"
                      }`}
                    >
                      {fmtCurr4(r.postApplySell)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {fmtPct(r.currentMarginPct)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        marginDropped
                          ? "font-semibold text-amber-700"
                          : "text-gray-700"
                      }`}
                    >
                      {fmtPct(r.postApplyMarginPct)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[10px] text-gray-500">
                      {/* Honest signal for assembly cells with
                          overridden leaf descendants — surfaces what
                          stays put per architect's unprompted
                          observation + Edward's resolution. */}
                      {r.overriddenDescendantsCount > 0 && (
                        <span title="These descendants are price-fixed and won't move with this adjustment">
                          {r.overriddenDescendantsCount}{" "}
                          {r.isAssembly ? "descendant" : "cell"}
                          {r.overriddenDescendantsCount !== 1 ? "s" : ""}{" "}
                          overridden
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-gray-500">
            <span className="font-medium">{fmtCurr2(0)}</span> values stay
            unchanged. Bold values indicate cells that move with this
            adjustment.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mx-5 mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={applyAndClose}
            disabled={pending}
            className="rounded border border-blue-700 bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? "Applying…" : `Apply ${suggestedTierAdj >= 0 ? "+" : ""}${fmtPct(suggestedTierAdj)} to ${affectedTierLabel}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
