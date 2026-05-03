"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  selectActiveTierId,
  selectSetActiveTier,
  selectTiers,
} from "@/lib/costing-store";
import { useCostingStore } from "@/components/costing-store-provider";

// Slice 9.4a — page-level active-tier selector. The single source of
// truth for "which tier is the per-SKU summary table currently showing"
// — the page-level placement signals this is a viewport selection, not
// a per-SKU concern. Per-row indicators are intentionally absent.
//
// Treatment:
//   - Tabs when tiers.length ≤ 4 (compact, always-visible)
//   - Dropdown when tiers.length ≥ 5 (scales without consuming row space)
//
// Click handler updates BOTH store AND URL:
//   - setActiveTier(tierId) — eliminates the one-render-cycle lag
//     between click and store update (rows re-render immediately).
//   - router.replace(`?tier=${tierId}`) — URL is canonical for
//     shareability; URL change goes through ActiveTierUrlSync's
//     effect which short-circuits because store already matches.
//
// Tier label format: "Tier N · qty" (e.g., "Tier 1 · 10,000"). Tier
// labels in the store are PM-authored and may not be "Tier N" — we
// use the label literally and append qty for context.

const TABS_THRESHOLD = 4;
const URL_PARAM = "tier";

function fmtQty(n: number): string {
  return n.toLocaleString("en-US");
}

export function ActiveTierSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tiers = useCostingStore(selectTiers);
  const activeTierId = useCostingStore(selectActiveTierId);
  const setActiveTier = useCostingStore(selectSetActiveTier);

  if (tiers.length === 0) {
    // Zero-tier quote: hide selector entirely. The summary row list
    // renders its own empty-state ("Add a tier to see required sell").
    return null;
  }

  function selectTier(tierId: string) {
    // Update store + URL together. ActiveTierUrlSync's effect sees
    // store already matches when URL change settles → short-circuits.
    setActiveTier(tierId);
    const next = new URLSearchParams(searchParams);
    next.set(URL_PARAM, tierId);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  if (tiers.length <= TABS_THRESHOLD) {
    return (
      <div
        role="tablist"
        aria-label="Active tier"
        className="inline-flex rounded-md border border-gray-200 bg-white p-0.5"
      >
        {tiers.map((t) => {
          const isActive = t.tierId === activeTierId;
          return (
            <button
              key={t.tierId}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTier(t.tierId)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {t.label}
              <span
                className={`ml-1 text-[10px] tabular-nums ${
                  isActive ? "text-blue-100" : "text-gray-400"
                }`}
              >
                · {fmtQty(t.qty)}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Dropdown variant for ≥ 5 tiers.
  return (
    <label className="inline-flex items-center gap-2 text-xs text-gray-700">
      <span>Active tier</span>
      <select
        value={activeTierId ?? ""}
        onChange={(e) => selectTier(e.target.value)}
        aria-label="Active tier"
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
      >
        {tiers.map((t) => (
          <option key={t.tierId} value={t.tierId}>
            {t.label} · {fmtQty(t.qty)}
          </option>
        ))}
      </select>
    </label>
  );
}
