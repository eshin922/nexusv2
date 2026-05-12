"use client";

import Link from "next/link";
import {
  selectFirmSettings,
  selectGlobalAdj,
  selectProjectId,
  selectQuoteId,
  selectQuoteRollup,
  selectSuggestedAdj,
  selectTargetMargin,
} from "@/lib/costing-store";
import type { QuoteCostBreakdown } from "@/lib/costing";
import { useCostingStore } from "./costing-store-provider";
import { MarginVerdictPill } from "./pricing/margin-verdict-pill";
import { GlobalPriceAdjInput } from "./global-price-adj-input";
import { QuoteTargetMarginPopover } from "./quote-target-margin-popover";
import { TierPriceAdjInput } from "./tier-price-adj-input";

// Page-context accent: when the card is rendered on /packaging, the
// Packaging row gets a left-border accent + bold weight to signal "the
// inputs you're editing on this page contribute this slice." On the
// costing sheet and quote builder, no accent (no current-page context).
export type CostingPage = "packaging" | "production" | "freight";

// Per-tier rollup card. Slice 8 sub-step 4: converted from server to
// client component. Subscribes to the costing store via typed selectors;
// the provider must wrap the consumer page.
//
// Fallback semantics (per Edward's refinement): the store is the single
// source of truth at runtime. The provider hydrates it synchronously
// from the server's HydrateSnapshot on mount, so there's no "store not
// hydrated yet" path. If the hook is called outside a provider (a
// programming error), it throws — fail loudly rather than silently
// falling back to stale cached client state.
//
// Two display variants:
//   - `compact`: cost-input pages (small header, "Open Pricing →" link)
//   - `full`:    costing sheet (larger header, no self-link)

function fmtCurr(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function QuoteSummaryCard({
  variant = "compact",
  editable,
  currentPage,
}: {
  variant?: "compact" | "full";
  editable: boolean;
  currentPage?: CostingPage;
}) {
  // Each subscription is its own selector — components only re-render
  // when their slice changes. See costing-store.ts "selector strategy"
  // architectural rule.
  const quoteId = useCostingStore(selectQuoteId);
  const projectId = useCostingStore(selectProjectId);
  const firmSettings = useCostingStore(selectFirmSettings);
  const globalAdj = useCostingStore(selectGlobalAdj);
  const quoteRollup = useCostingStore(selectQuoteRollup);
  const suggestedAdj = useCostingStore(selectSuggestedAdj);
  // Slice 9.2 — per-quote target-margin override drives the displayed
  // effective target. NULL = inherit firm; value = override.
  const targetMarginOverride = useCostingStore(selectTargetMargin);
  const effectiveTarget =
    targetMarginOverride ?? firmSettings.targetMarginPct;
  const targetIsOverridden = targetMarginOverride !== null;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className={
            variant === "full"
              ? "text-lg font-semibold text-gray-900"
              : "text-sm font-semibold text-gray-900"
          }
        >
          Pricing control summary
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center">
            Target {fmtPct(effectiveTarget)}
            {targetIsOverridden && (
              <span className="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-indigo-800">
                Overridden
              </span>
            )}
            <QuoteTargetMarginPopover disabled={!editable} />
            <span className="ml-2">/ Floor {fmtPct(firmSettings.floorMarginPct)}</span>
          </span>
          <Link
            href="/admin/firm-settings"
            className="text-blue-700 underline hover:text-blue-900"
          >
            edit firm
          </Link>
          {variant === "compact" && (
            <Link
              href={`/projects/${projectId}/quotes/${quoteId}/pricing`}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-gray-50"
            >
              Open Pricing →
            </Link>
          )}
        </div>
      </div>

      <div className="mb-4">
        <GlobalPriceAdjInput
          quoteId={quoteId}
          initialDecimal={globalAdj}
          suggestedDecimal={suggestedAdj}
          disabled={!editable}
        />
      </div>

      {quoteRollup.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">
          Add at least one tier to see costing rollup.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">Margin</th>
                  <th className="px-3 py-2 text-right">Status</th>
                  {/* Slice 9.2 — per-tier price-adjustment override */}
                  <th className="px-3 py-2 text-right">Tier adj.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {quoteRollup.map((t) => {
                  return (
                    <tr key={t.tierId}>
                      <td className="px-3 py-2 font-medium">
                        {t.label}
                        <span className="ml-1 text-xs text-gray-500">
                          ({t.qty.toLocaleString()})
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtCurr(t.totalRevenue)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtCurr(t.totalCost)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtPct(t.blendedMarginPct)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <MarginVerdictPill status={t.blendedMarginStatus} size="md" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end">
                          <TierPriceAdjInput
                            tierId={t.tierId}
                            disabled={!editable}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3">
            {quoteRollup.map((t) => (
              <CostBreakdown
                key={t.tierId}
                tierLabel={t.label}
                tierQty={t.qty}
                breakdown={t.costBreakdown}
                totalCost={t.totalCost}
                currentPage={currentPage}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Per-tier cost breakdown: lists each component with $ and % share of
// totalCost. Hides zero-value components (don't render "Production: $0
// (0%)"). Highlights the row matching `currentPage` with a left border
// + bold weight + tinted background — the operator-on-this-page sees
// "this is your slice."
function CostBreakdown({
  tierLabel,
  tierQty,
  breakdown,
  totalCost,
  currentPage,
}: {
  tierLabel: string;
  tierQty: number;
  breakdown: QuoteCostBreakdown;
  totalCost: number;
  currentPage?: CostingPage;
}) {
  type Row = { label: string; value: number; page?: CostingPage };
  const rows: Row[] = [
    { label: "Packaging", value: breakdown.packaging, page: "packaging" },
    { label: "Production", value: breakdown.production, page: "production" },
    {
      label: "Freight (landed)",
      value: breakdown.freight,
      page: "freight",
    },
    { label: "Service fees", value: breakdown.serviceFees },
  ];
  const visible = rows.filter((r) => r.value > 0.005); // hide effectively-zero
  if (visible.length === 0) return null;

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50/40 p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-gray-500">
        <span>
          {tierLabel} cost breakdown
          <span className="ml-1 normal-case text-gray-400">
            ({tierQty.toLocaleString()} units)
          </span>
        </span>
        <span className="text-[10px] text-gray-400">% of cost</span>
      </div>
      <div className="grid gap-1 text-sm">
        {visible.map((r) => {
          const pct = totalCost > 0 ? (r.value / totalCost) * 100 : 0;
          const isActive = currentPage && r.page === currentPage;
          return (
            <div
              key={r.label}
              className={`flex items-baseline justify-between rounded px-2 py-1 ${
                isActive
                  ? "border-l-2 border-blue-500 bg-blue-50 font-semibold text-gray-900"
                  : "text-gray-700"
              }`}
            >
              <span>{r.label}</span>
              <span className="flex items-baseline gap-3 tabular-nums">
                <span>{fmtCurr(r.value)}</span>
                <span className="w-10 text-right text-xs text-gray-500">
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
