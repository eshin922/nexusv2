"use client";

import {
  createContext,
  useCallback,
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
import { getCostingBundle } from "@/app/actions/costing";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// Slice 8 sub-step 3 + 6 + Slice 8.5 #48-#50 — context + provider +
// hook for the per-quote costing store.
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
// Three reconcile triggers, all routing through the same wait-for-quiet
// scheduler:
//   1. Snapshot prop change (server revalidation after this user's save).
//   2. Realtime postgres_changes event from the per-quote channel
//      (Slice 8.5 — another tab/user edited this quote).
//   3. Global ref-changed CustomEvent dispatched by GlobalRealtimeProvider
//      (Slice 8.5 — admin edited firm_settings or markup_defaults).
//
// All three call scheduleReconcile(snap) which does:
//   a. 100ms initial debounce — coalesces bursts of rapid triggers.
//   b. Wait-for-quiet poll — defers reconcile if the user has typed
//      within QUIET_PERIOD_MS. Polls every 200ms until the user pauses.
//   c. Apply the snapshot via store.reconcile().
//
// Realtime triggers add a 250ms COALESCE_MS layer BEFORE scheduleReconcile,
// so a remote burst of 5 input writes in 1s collapses into one
// getCostingBundle re-fetch + one reconcile attempt.
//
// Why wait-for-quiet: server saves take ~700ms round-trip. If a user
// types, save fires, types again, then save returns (or a remote event
// arrives) — the incoming snapshot reflects state before the second
// edit. Reconciling immediately would clobber it. Waiting until the
// user pauses ensures all in-flight saves have settled before we let
// any external snapshot win.
//
// Initial mount: immediate hydration (the store is already populated by
// makeCostingStore from the first snapshot — no extra reconcile call).
// User edits via store actions: immediate optimistic store update.
// All external triggers: scheduleReconcile (with COALESCE_MS prefix
// for realtime).

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
// Realtime event coalesce window. Multiple postgres_changes events
// within this window collapse into one re-fetch + reconcile attempt.
// 250ms is large enough to absorb a remote user filling several cells
// rapidly, small enough to feel near-real-time.
const COALESCE_MS = 250;
// Global custom-event signal name (matches GlobalRealtimeProvider's
// dispatch). Constant in two places — kept in sync by hand. If
// changed, both ends must update.
const GLOBAL_REF_EVENT = "nexus:global-ref-changed";

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
  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether SUBSCRIBED has fired before. The first SUBSCRIBED is
  // the initial subscribe; subsequent ones are reconnect-after-disconnect
  // and warrant a catch-up reconcile. (#50)
  const hasSubscribedRef = useRef(false);

  // Shared wait-for-quiet reconcile scheduler. Both the snapshot-prop
  // useEffect and the realtime handler call this. Cancels any in-flight
  // timer first, then polls until the user has been idle ≥ QUIET_PERIOD_MS,
  // then applies the snapshot. Read state directly via getState() — no
  // subscription, no re-render churn from the polling loop.
  //
  // useCallback with empty deps because the function only references refs
  // (storeRef, debounceRef) — both stable across renders. The captured
  // `snap` parameter is fresh per call.
  const scheduleReconcile = useCallback((snap: HydrateSnapshot) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const tryReconcile = () => {
      const lastEdit = storeRef.current?.getState().lastUserEditAt ?? 0;
      const sinceEdit = Date.now() - lastEdit;
      if (sinceEdit < QUIET_PERIOD_MS) {
        debounceRef.current = setTimeout(tryReconcile, RETRY_INTERVAL_MS);
        return;
      }
      storeRef.current?.getState().reconcile(snap);
    };
    debounceRef.current = setTimeout(tryReconcile, 100);
  }, []);

  // Effect 1: snapshot prop change → schedule reconcile with that snapshot.
  // Same path as before Slice 8.5; just routes through the shared
  // scheduleReconcile now.
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    scheduleReconcile(snapshot);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [snapshot, scheduleReconcile]);

  // Effect 2: realtime subscription. Fires on mount, unsubscribes on
  // unmount. Captures quoteId from the snapshot prop, so navigation
  // between quotes naturally tears down + sets up a fresh subscription
  // (the provider remounts when its key/quote changes upstream).
  const quoteId = snapshot.quoteId;
  useEffect(() => {
    if (!quoteId) return;

    const supabase = getSupabaseBrowser();

    // Coalesce: bursts of 5 remote writes in 1s become one reconcile
    // attempt. Any incoming event resets the timer; when it fires,
    // re-fetch the bundle and route through scheduleReconcile (which
    // adds the wait-for-quiet layer on top).
    const triggerCoalescedReconcile = () => {
      if (coalesceRef.current) clearTimeout(coalesceRef.current);
      coalesceRef.current = setTimeout(async () => {
        const result = await getCostingBundle(quoteId);
        if (result.ok) {
          scheduleReconcile(result.data);
        }
        // result.ok=false: ignore. The user's local store state is still
        // valid; the next event (or manual reload) will get them current.
      }, COALESCE_MS);
    };

    // Per-input-table filter: these tables don't have a `quote_id`
    // column (only `quote_sku_id`), so we can't filter at the DB
    // subscription level. Subscribe broadly, check membership in the
    // local store's known SKU set client-side. quote_skus ADD events
    // trigger reconcile, which pulls new SKUs into the store, which
    // makes subsequent input events on those SKU IDs pass this filter.
    //
    // Performance: at solo-dev / 12-user scale, we get every input
    // edit anywhere in the system as an event on every open tab. The
    // filter discards the irrelevant ones in O(n) over the local SKU
    // count (~5-30). Cheap. See UX_BACKLOG entry "Subscription scope
    // per page" v2 optimization candidates if scale ever grows.
    const isInputForThisQuote = (
      newRow: Record<string, unknown> | null | undefined,
      oldRow: Record<string, unknown> | null | undefined,
    ): boolean => {
      const skuId =
        (newRow?.quote_sku_id as string | undefined) ??
        (oldRow?.quote_sku_id as string | undefined);
      if (!skuId) return false;
      const skus = storeRef.current?.getState().skus ?? [];
      return skus.some((s) => s.id === skuId);
    };

    const channel = supabase
      .channel(`quote:${quoteId}`)
      // Quote-scoped tables: filter by quote_id at the DB layer.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quotes",
          filter: `id=eq.${quoteId}`,
        },
        triggerCoalescedReconcile,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quote_skus",
          filter: `quote_id=eq.${quoteId}`,
        },
        triggerCoalescedReconcile,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "quote_tiers",
          filter: `quote_id=eq.${quoteId}`,
        },
        triggerCoalescedReconcile,
      )
      // Per-input tables: broad subscribe + client-side filter.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packaging_inputs" },
        (payload) => {
          if (isInputForThisQuote(payload.new, payload.old)) {
            triggerCoalescedReconcile();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "production_inputs" },
        (payload) => {
          if (isInputForThisQuote(payload.new, payload.old)) {
            triggerCoalescedReconcile();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "freight_inputs" },
        (payload) => {
          if (isInputForThisQuote(payload.new, payload.old)) {
            triggerCoalescedReconcile();
          }
        },
      )
      .subscribe((status) => {
        // Status callback fires for SUBSCRIBED, CLOSED, CHANNEL_ERROR,
        // TIMED_OUT. The first SUBSCRIBED is initial setup (no catch-up
        // needed; we just hydrated from snapshot). Subsequent SUBSCRIBED
        // means resubscribed-after-disconnect — fire one catch-up
        // reconcile to pull any events missed during the disconnect.
        // (#50 disconnect/reconnect handling)
        if (status === "SUBSCRIBED") {
          if (hasSubscribedRef.current) {
            triggerCoalescedReconcile();
          } else {
            hasSubscribedRef.current = true;
          }
        }
        // CHANNEL_ERROR / TIMED_OUT: Supabase's built-in retry handles
        // transient cases. On persistent failure the channel stays
        // closed; user's local state is still valid, they just stop
        // seeing remote changes until reload. No toast spam.
      });

    // Global ref-changed listener: GlobalRealtimeProvider dispatches
    // this when admin edits firm_settings or markup_defaults. Routes
    // through the same coalesce + scheduleReconcile pipe.
    const onGlobalRefChanged = () => triggerCoalescedReconcile();
    window.addEventListener(GLOBAL_REF_EVENT, onGlobalRefChanged);

    return () => {
      if (coalesceRef.current) clearTimeout(coalesceRef.current);
      void supabase.removeChannel(channel);
      window.removeEventListener(GLOBAL_REF_EVENT, onGlobalRefChanged);
      hasSubscribedRef.current = false;
    };
  }, [quoteId, scheduleReconcile]);

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

// Slice 9.4b — direct store access for snapshot reads (e.g., the
// reverse-solve dialog snapshots full state once on open to compute
// the cross-cell consequence preview without subscribing to every
// slice that could affect the solve). Use sparingly — selectors via
// `useCostingStore` are still the default; this is for one-shot
// snapshot needs that don't warrant per-slice subscriptions.
export function useCostingStoreApi(): CostingStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error(
      "useCostingStoreApi must be used inside <CostingStoreProvider>",
    );
  }
  return store;
}
