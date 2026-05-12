"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectActiveTierId,
  selectSetActiveTier,
  selectTiers,
} from "@/lib/costing-store";

// Slice 9.4a — URL ↔ store sync for the active-tier selection.
// Headless component (returns null); mounted inside CostingStoreProvider
// so it has access to the store.
//
// Single source of truth: URL `?tier=<tier_id>`. Store mirrors the URL
// for sub-50ms subscriber re-renders without router round-trips. The
// URL is canonical for shareability — copy-paste preserves PM context.
//
// Sync directions:
//   - URL → store: this component. On mount and on every URL change
//     (browser back/forward, shared link, manual edit, programmatic
//     replace), the effect reads `?tier=`, validates against the store's
//     tier list, and calls setActiveTier.
//   - Store → URL: the active-tier selector UI's click handler (Task 5)
//     writes both store AND URL. Click handler updates store directly
//     to eliminate one-render-cycle lag; the URL effect then sees the
//     value already matches and short-circuits.
//
// Edge cases:
//   - URL `?tier=` absent or invalid (tier doesn't exist on this quote):
//     fall back to first tier in sort_order; canonicalize URL via
//     router.replace so the URL becomes shareable. Realtime-driven
//     fallback (admin deletes the active tier mid-session) is silent —
//     no toast, no banner; PM sees the active-tier highlight shift.
//   - Tiers list empty (zero-tier quote): early-return; store stays
//     null. Selector + per-SKU rows render empty-state in Task 7.
//   - Loop prevention: every state mutation guarded by no-change
//     short-circuits. Verified at smoke; reasoning: if URL and store
//     already match, neither setActiveTier nor router.replace fire,
//     so the effect's deps don't change again.

const URL_PARAM = "tier";

export function ActiveTierUrlSync() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tiers = useCostingStore(selectTiers);
  const activeTierId = useCostingStore(selectActiveTierId);
  const setActiveTier = useCostingStore(selectSetActiveTier);

  useEffect(() => {
    // Wait until tiers hydrate. Empty tier list = zero-tier quote;
    // store activeTierId stays null, downstream UI handles empty state.
    if (tiers.length === 0) return;

    const urlTierId = searchParams.get(URL_PARAM);
    const urlTierValid =
      urlTierId !== null && tiers.some((t) => t.tierId === urlTierId);

    if (urlTierValid) {
      // Valid URL value. Sync to store if differs (cycle break).
      if (urlTierId !== activeTierId) {
        setActiveTier(urlTierId);
      }
      return;
    }

    // URL absent or invalid → default to first tier in sort_order
    // (selectTiers returns s.costing.tiers which preserves the input
    // sort_order from server hydration). Update store + canonicalize
    // URL. Note: selectTiers returns output shape with `tierId` field
    // (not `id`); see costing.ts QuoteCostingResult.tiers.
    const defaultTierId = tiers[0].tierId;

    if (defaultTierId !== activeTierId) {
      setActiveTier(defaultTierId);
    }

    // Canonicalize URL only if the URL value differs from default —
    // belt-and-suspenders against the canonical-replace effect loop
    // (the no-change short-circuit on activeTierId already handles it
    // upstream, but checking here too prevents the router.replace
    // call from firing redundantly on the second pass through this
    // effect after the URL change settles).
    if (urlTierId !== defaultTierId) {
      const next = new URLSearchParams(searchParams);
      next.set(URL_PARAM, defaultTierId);
      router.replace(`?${next.toString()}`, { scroll: false });
    }
  }, [searchParams, tiers, activeTierId, setActiveTier, router]);

  return null;
}
