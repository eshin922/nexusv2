"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Slice 8.5 — browser-side Supabase client for Realtime subscriptions.
//
// Why a separate client from src/db/index.ts:
//   - src/db is the server-side Drizzle/postgres-js client (privileged
//     pooled connection, used in server actions and RSC).
//   - This is the browser-side @supabase/supabase-js client (anon key,
//     Realtime channels). They cannot be the same object.
//
// HMR-safe singleton: in dev, the same module gets re-evaluated on
// every code change touching downstream consumers. Without this pin,
// every re-eval creates a new SupabaseClient → opens a new WebSocket
// to Supabase Realtime → leaks the prior socket and re-establishes
// every channel. Mirrors the server-side db/index.ts pattern. Same
// `globalThis` stash, scoped to a different key.
//
// In production each browser session creates the client exactly once
// at module load, so the dev-only pin is a no-op there.
//
// Auth posture: anon key only. Read-only event stream. RLS is OFF
// across the 8 subscribed tables (see CLAUDE.md "Single Supabase
// project" + "Access model"); access control happens at Clerk + the
// server action layer, never at the DB row level. If RLS ever gets
// turned on, this client needs a Clerk-Supabase JWT bridge added
// before subscriptions will see events.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const globalForSupabase = globalThis as unknown as {
  __supabaseBrowser?: SupabaseClient;
};

function makeClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: {
      // No browser session persistence — Clerk owns auth, this client is
      // event-stream-only. Avoids polluting localStorage with a Supabase
      // session that would never be used.
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      // Default heartbeat is 30s; default reconnect uses exponential
      // backoff. Adequate for v1; revisit if connection-stability
      // issues surface in multi-user smoke testing (#51).
      params: { eventsPerSecond: 10 },
    },
  });
}

export function getSupabaseBrowser(): SupabaseClient {
  if (!globalForSupabase.__supabaseBrowser) {
    globalForSupabase.__supabaseBrowser = makeClient();
  }
  return globalForSupabase.__supabaseBrowser;
}
