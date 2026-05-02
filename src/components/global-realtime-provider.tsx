"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// Slice 8.5 #47 — global reference-data realtime subscription.
//
// Scope: firm_settings + markup_defaults. These are admin-managed
// tables read by every CostingStoreProvider via getCostingBundle.
// When admin edits one of them, every open quote tab needs to know
// so its costing rollup refreshes against the new firm policy /
// markup defaults.
//
// Mounted ONCE per session in src/app/layout.tsx (app-root level).
// Subscribing per-quote-provider would multiply identical channels
// across every open tab — wasteful and the docstring contract for
// "global = once per session" framed by the Slice 8.5 spec.
//
// Signaling: dispatches a `nexus:global-ref-changed` CustomEvent on
// `window` when an event arrives. CostingStoreProvider listens for
// that event in its existing reconcile pipeline (#49 wires it
// through the same 250ms coalesce + 800ms wait-for-quiet path the
// per-quote subscription uses). DOM event chosen over React context
// to avoid forcing the layout tree into a Provider; the signal is
// coarse ("something globally relevant changed") and consumers
// decide what to refetch.
//
// No payload: consumers re-fetch their full bundle anyway. Adding
// `{ table, eventType }` detail would tempt a future contributor to
// branch on it; resist that — the contract is "trigger reconcile,
// don't try to be smart."
//
// RLS-off assumption (CLAUDE.md "Single Supabase project" +
// "Access model"): browser anon-key client sees these events
// without authentication. If RLS is ever turned on for either
// table, this provider stops receiving events until the Clerk-
// Supabase JWT bridge lands.

const SIGNAL_EVENT = "nexus:global-ref-changed";
const CHANNEL_NAME = "nexus:global-ref";

export function GlobalRealtimeProvider() {
  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "firm_settings" },
        () => window.dispatchEvent(new CustomEvent(SIGNAL_EVENT)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "markup_defaults" },
        () => window.dispatchEvent(new CustomEvent(SIGNAL_EVENT)),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  // Effect-only component; renders nothing.
  return null;
}
