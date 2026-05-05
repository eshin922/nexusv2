import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// In dev, prefer DIRECT_URL (session-mode pooler at :5432) over
// DATABASE_URL (transaction-mode pooler at :6543). Transaction-mode
// pgbouncer chokes under multi-worker-process load — Webpack/Turbopack
// dev mode spawns ~7 workers, each with its own postgres-js pool;
// pgbouncer's transaction-mode multiplexing layer becomes a bottleneck
// faster than the connection-recycling settings can drain it
// (observed: GET /cost-build → statement_timeout, Slice RI.4
// infrastructure thread May 2026). Session mode binds a backend per
// client connection — slower max throughput on paper but no
// transaction-mode contention; works reliably in practice.
//
// Production runs on DATABASE_URL (Vercel functions are short-lived;
// transaction-mode is the right fit there).
const url =
  process.env.NODE_ENV !== "production" && process.env.DIRECT_URL
    ? process.env.DIRECT_URL
    : process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// HMR-safe singleton: in dev, pin the postgres client to globalThis so
// hot reloads reuse the same pool. Without this pin, every code change
// that touches a module importing @/db re-evaluates db/index.ts and
// creates a NEW pool; the old pool's connections never close (no
// .end() registered) and accumulate against Supabase's 200-connection
// limit. ~20 HMR cycles is enough to hit EMAXCONN. See CLAUDE.md
// "Database client singleton" for the full convention.
//
// Production cold-starts skip the pin — each Vercel function instance
// gets a fresh client, which is the correct behavior.
const globalForDb = globalThis as unknown as {
  __dbClient?: ReturnType<typeof postgres>;
  __dbClientPid?: number;
};

// Diagnostic log (Slice RI.4 dev-server productivity investigation per
// Edward + CA recommendation): observe whether the singleton actually
// pins across HMR cycles. If we see "[db] CREATE pool" multiple times
// in rapid succession during dev edits, the globalThis pin isn't
// surviving HMR — and pool exhaustion is inevitable. If we only see
// "[db] REUSE pool" after the first CREATE, the singleton is working.
if (process.env.NODE_ENV !== "production") {
  if (globalForDb.__dbClient) {
    console.log(
      `[db] REUSE pool · pid=${globalForDb.__dbClientPid ?? "?"} · process.pid=${process.pid}`,
    );
  } else {
    console.log(
      `[db] CREATE pool · process.pid=${process.pid} · ${new Date().toISOString()}`,
    );
  }
}

// Slice RI.4 dev-server productivity investigation (Edward + CA, May 2026):
// Pool max=5 sized for cost-build's actual peak demand of 8 parallel
// queries (after sequencing getCostingBundle separately — see page.tsx
// comment). max=5 means 3 queries queue per request; each query is
// ~80ms so total wait is ~240ms — acceptable.
//
// Smaller per-process pool matters because Next.js dev (both Webpack
// and Turbopack) spawns N worker processes; globalThis is per-process
// so each worker holds its own pool against Supabase's pgbouncer.
// max=10 × 7 workers = 70 client connections; max=5 × 7 = 35.
//
// prepare: false required for transaction-mode pooler (port 6543).
// idle_timeout: 10s aggressively recycles idle connections back to
// pgbouncer between query bursts. Avoid max_lifetime — force-closing
// active connections surfaces as statement_timeout (PG 57014).
const client =
  globalForDb.__dbClient ??
  postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbClient = client;
  globalForDb.__dbClientPid = process.pid;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
