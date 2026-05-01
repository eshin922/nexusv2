"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import {
  makeCostingStore,
  type CostingStore,
  type CostingStoreState,
  type HydrateSnapshot,
} from "@/lib/costing-store";

// Slice 8 sub-step 3 + 6 — context + provider + hook for the per-quote
// costing store.
//
// Usage:
//   <CostingStoreProvider snapshot={bundle}>
//     <PageContents />
//   </CostingStoreProvider>
//
//   // inside any descendant client component:
//   import { useCostingStore } from "@/components/costing-store-provider";
//   import { selectQuoteRollup } from "@/lib/costing-store";
//
//   const rollup = useCostingStore(selectQuoteRollup);
//
// The provider creates one store per mount via makeCostingStore (per-quote
// instance — two providers on two quotes don't share state).
//
// Reconcile flow on prop changes (after a server action triggers
// revalidation and the page re-renders with a fresh snapshot):
//
//   1. 100ms initial debounce — coalesces bursts of rapid revalidations.
//   2. Wait-for-quiet check (sub-step 6) — defers reconcile if the user
//      has typed within QUIET_PERIOD_MS. Polls every 200ms until the
//      user pauses, then reconciles with the most recent snapshot.
//
// Why wait-for-quiet: server saves take ~700ms round-trip. If a user
// types, save fires, types again, then save returns — the snapshot
// reflects the FIRST type, not the second. Reconciling immediately
// would clobber the second edit. Waiting until the user pauses (i.e.,
// no edits in the last QUIET_PERIOD_MS) ensures all in-flight saves
// have settled before we let the server snapshot win.
//
// Initial mount: immediate hydration (the store is already populated by
// makeCostingStore from the first snapshot — no extra reconcile call).
// User edits via store actions: immediate optimistic store update.
// Server-settle reconciles: debounced 100ms + wait-for-quiet.

const StoreContext = createContext<CostingStore | null>(null);

// QUIET_PERIOD_MS must be ≥ typical save round-trip (~700ms) so a user
// who types-saves-types-then-stops doesn't have their second edit
// clobbered by the first save's snapshot. 800ms is round-trip + small
// buffer. Increasing this delays reconciles further (margin display
// stays optimistic longer); decreasing it reintroduces the race.
const QUIET_PERIOD_MS = 800;
// Polling interval while waiting for user to pause typing. 200ms feels
// responsive without being chatty.
const RETRY_INTERVAL_MS = 200;

export function CostingStoreProvider({
  snapshot,
  children,
}: {
  snapshot: HydrateSnapshot;
  children: ReactNode;
}) {
  // Stable store reference across re-renders. useRef + lazy init pattern:
  // makeCostingStore is only called once per provider instance.
  const storeRef = useRef<CostingStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeCostingStore(snapshot);
  }

  // Track whether we're past the initial mount.
  //
  // **Why this ref exists (don't remove as "redundant"):**
  // The store is hydrated synchronously by makeCostingStore() above, but
  // useEffect runs AFTER hydration, on mount and on every dep change.
  // The first useEffect run is redundant — initial state is already in
  // the store. Worse: between makeCostingStore() and the first effect
  // run, React has hydrated client components and the user could have
  // optimistically edited a cell (sub-step 5+ wiring will push to store
  // on every onChange, including pre-effect-run keystrokes). If we let
  // the first useEffect call reconcile(snapshot), it would clobber
  // those edits with the same data they were edited from — resulting in
  // a visible "edit then snap back" flicker.
  //
  // The ref distinguishes "first effect post-mount, skip" from
  // "subsequent run after a real prop change, do the debounced reconcile."
  const initialMountRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Wait-for-quiet reconcile: poll until the user has been quiet for
    // QUIET_PERIOD_MS, then apply the (latest) snapshot. Each new
    // snapshot replaces this loop via the cleanup + new effect run, so
    // the most recent snapshot always wins. Read state directly via
    // getState() — no subscription, no re-render churn from this loop.
    const tryReconcile = () => {
      const lastEdit = storeRef.current?.getState().lastUserEditAt ?? 0;
      const sinceEdit = Date.now() - lastEdit;
      if (sinceEdit < QUIET_PERIOD_MS) {
        debounceRef.current = setTimeout(tryReconcile, RETRY_INTERVAL_MS);
        return;
      }
      storeRef.current?.getState().reconcile(snapshot);
    };
    debounceRef.current = setTimeout(tryReconcile, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [snapshot]);

  return (
    <StoreContext.Provider value={storeRef.current}>
      {children}
    </StoreContext.Provider>
  );
}

// Hook for consumer components. Pass a typed selector helper from
// costing-store.ts (e.g., selectQuoteRollup); avoid inline selectors —
// see the architectural rule documented in costing-store.ts.
export function useCostingStore<T>(
  selector: (state: CostingStoreState) => T,
): T {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error(
      "useCostingStore must be used inside <CostingStoreProvider>",
    );
  }
  return useStore(store, selector);
}
