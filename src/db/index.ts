import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// In dev, prefer DIRECT_URL (session-mode pooler at :5432) over
// DATABASE_URL (transaction-mode pooler at :6543). Transaction-mode
// pgbouncer chokes under multi-worker-process load — Webpack/Turbopack
// dev mode spawns ~7 workers, each with its own postgres-js pool;
// pgbouncer's transaction-mode multiplexing layer becomes a bottleneck
// faster than the connection-recycling settings can drain it
// (observed: GET /costs → statement_timeout, Slice RI.4
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
//
// **Prod-hang hotfix (2026-06-17) — connect_timeout + statement_timeout.**
//
// Production was observed hanging on /costs RSC fetches: Vercel
// function spins, never returns, eventually killed at the function
// timeout. Diagnosis: transaction-mode pgbouncer (:6543) queue
// saturates under multiple warm Vercel function instances ×
// 8-wide Promise.all bursts (getCostingBundle internal + outer
// page-level queries). Without `connect_timeout`, postgres-js
// waits INDEFINITELY for pgbouncer to hand it a backend slot.
// `pg_stat_activity` looks healthy because pgbouncer queues
// requests BEFORE pairing them with a PG backend — the choke
// point is invisible from a PG-side window.
//
//   - connect_timeout: 10 (seconds) — surface pgbouncer queue
//     saturation as a clear `CONNECTION_ENDED` / `connect_timeout`
//     error after 10s instead of silent hang. PMs see an error +
//     retry CTA instead of a spinner-forever.
//
//   - connection.statement_timeout: 8000 (ms) — PG-side guard.
//     Caps any single query at 8s. Postgres-side timeout fires
//     as PG 57014 (statement_timeout) which Drizzle surfaces as
//     a query error. Sits under Vercel's default 10s function
//     timeout so the function never gets killed mid-query.
//
// This is a SURFACE-THE-FAILURE patch, not a structural fix.
// Hangs become errors. Followup-(c) — switching production to
// session-mode pooler (:5432) — is the structural fix; tracked
// separately. See CLAUDE.md "Transaction-mode pgbouncer queueing
// hides in front of pg_stat_activity" for the diagnostic pattern.
const client =
  globalForDb.__dbClient ??
  postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 10,
    connect_timeout: 10,
    connection: {
      statement_timeout: 8000,
    },
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbClient = client;
  globalForDb.__dbClientPid = process.pid;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
