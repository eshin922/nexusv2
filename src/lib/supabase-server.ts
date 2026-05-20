import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// canonical-scenario-create-flow — server-side Supabase client for
// Storage operations (quote_attachments bucket).
//
// Why a separate client from src/db (Drizzle) and src/lib/supabase-
// browser (anon-key Realtime singleton):
//   - src/db handles PostgreSQL via Drizzle ORM; no Storage capability
//   - src/lib/supabase-browser uses the anon key + persists no session;
//     Storage RLS policies (auth.role() = 'authenticated') would reject
//     uploads from anon-key callers
//   - This client uses the SERVICE_ROLE_KEY, which bypasses RLS. Safe
//     because:
//     (a) it lives in "server-only" code (the action layer); Next.js +
//         the import "server-only" guard prevent leaking it to client
//         bundles
//     (b) the action layer does its own permission checks via Clerk
//         ensureUser before invoking Storage operations
//     (c) Storage RLS policies stay in place as defense-in-depth
//         against any non-action callers (anon client, future code)
//
// Auth posture: service-role key. Bypasses RLS. NEVER instantiate this
// client outside server-only code.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const globalForSupabase = globalThis as unknown as {
  __supabaseServer?: SupabaseClient;
};

function makeClient(): SupabaseClient {
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set");
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must be set for server-side Storage operations",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      // No session persistence on the server-side client.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getSupabaseServer(): SupabaseClient {
  if (!globalForSupabase.__supabaseServer) {
    globalForSupabase.__supabaseServer = makeClient();
  }
  return globalForSupabase.__supabaseServer;
}

// Bucket convention — canonical-scenario-create-flow.
export const QUOTE_ATTACHMENTS_BUCKET = "quote-attachments";

// File path convention: {quoteId}/{uuid}-{filename}
export function buildAttachmentStoragePath(
  quoteId: string,
  uuid: string,
  filename: string,
): string {
  // Sanitize filename — strip path separators + control chars.
  const safe = filename.replace(/[/\\\x00-\x1F\x7F]/g, "_");
  return `${quoteId}/${uuid}-${safe}`;
}
