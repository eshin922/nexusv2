import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// In dev, prefer DIRECT_URL over DATABASE_URL. Both URLs should
// point at Supabase's session-mode pooler (port `:5432`).
// Transaction-mode pooler (`:6543`) is UNSAFE for this codebase's
// workload shape and should NOT be used in either environment.
//
// Dev failure mode (Slice RI.4 infrastructure thread, May 2026):
// Webpack/Turbopack spawns ~7 workers, each with its own postgres-js
// pool. Transaction-mode pgbouncer multiplexing layer becomes a
// bottleneck faster than connection-recycling can drain it.
// Symptom: GET /costs → statement_timeout (PG 57014).
//
// Prod failure mode (cell_ovr postmortem, 2026-06-17): same
// underlying postgres-js + pgbouncer transaction-mode race, different
// trigger. Vercel function instances each create a pool. Concurrent
// quote-page requests stress the SAME multiplexing layer. One query
// out of N in `getCostingBundle`'s 8-wide `Promise.all` never
// resolves; the specific query varies per run; Vercel function
// hangs until timeout. PG shows `Client/ClientRead` wait state on
// the orphan backend. See CLAUDE.md "Prod uses session-mode pooler
// (:5432), not transaction-mode (:6543)" for full failure-mode
// signature + diagnostic ladder.
//
// Session mode binds a backend per client connection — slower max
// throughput on paper but no multiplexing-correlation race; works
// reliably for the 8-wide `Promise.all` patterns in this codebase.
//
// Operational requirement: production `DATABASE_URL` (Vercel env
// var) must point at `aws-1-us-west-2.pooler.supabase.com:5432/...`
// (port `:5432`). If a future env-var rotation accidentally
// switches it back to `:6543`, the cell_ovr-style hang will
// re-emerge. Verify port at deploy time per UX_BACKLOG readiness
// item.
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

// Session-mode pooler (DATABASE_URL :5432) constraints:
// - Supabase session-mode pool_size: 40 (Pro+Small, post 2026-06-18
//   Path A adjustment from default 15)
// - PG max_connections: 60 (Pro+Small)
// - postgres-js max per instance: 3 (this value; reduced 2026-06-18
//   from 5 via Path B — defense in depth against future load spikes)
// - Safe warm-instance ceiling: 13 (13 × 3 = 39, under 40 pool_size
//   with 1 slot headroom). Comfortable target ~10 instances (30/40
//   = 75% utilization with 10 connection headroom for spikes).
//
// Realistic v1 scale: 12 internal users; peak concurrent ~5-8 warm
// instances during PM coordinated workflows; ~3-5 typical. 40-slot
// budget with max:3 is comfortable for v1; revisit if growth pushes
// warm-instance count past 13.
//
// If EMAXCONNSESSION errors return:
// - First check Supabase pooler pool_size config (may have changed)
// - Then check Vercel warm-instance count (may have scaled past 13)
// - Consider Path C escape hatch: direct PG connection (bypasses
//   pooler entirely, gated only by PG max_connections=60)
//
// **EMAXCONNSESSION incident (2026-06-18) — Path A + Path B fix.**
//
// Supabase session-mode pooler has a pool_size constraint (15
// default on Pro+Small) that's INDEPENDENT of PG max_connections
// (60). Connection budget verification at the time of the
// 2026-06-17 transaction→session switch only measured PG max
// (60 backend pool slots, plenty of headroom against
// instances × max:5). pool_size was missed.
//
// Result: under any meaningful concurrency, the dual-budget
// constraint (pool_size:15) caps total connections at 15. With
// 4+ warm Vercel instances × max:5 = 20+ demand, pool_size
// exhausts → EMAXCONNSESSION errors fire on every query
// attempting to acquire a connection. recordProjectVisit was
// the canary; cascade affects all downstream queries on the
// page render.
//
// Remediation 2026-06-18:
//   Path A (Edward): Supabase Dashboard → session-mode
//     pool_size bumped 15 → 40
//   Path B (this change): postgres-js max reduced 5 → 3
//   Combined ceiling: 13 instances × max:3 = 39 (under 40
//     pool_size with 1 slot headroom). v1 realistic peak ~10
//     instances → comfortable 25% utilization headroom.
//
// See CLAUDE.md "Supabase pooler dual-budget gotcha" for the
// pre-flight check that should have caught this at the
// 2026-06-17 cutover. §0.5 catch #69 across 15 slices.
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
// Also: prepare: false required for transaction-mode pooler (now
// historical — session mode active). idle_timeout: 10s aggressively
// recycles idle connections back to pgbouncer between query bursts.
// Avoid max_lifetime — force-closing active connections surfaces as
// statement_timeout (PG 57014).
//
// See CLAUDE.md "Transaction-mode pgbouncer queueing hides in front
// of pg_stat_activity" for the diagnostic pattern from the prior
// incident; the Path A+B fix above replaces the connection-budget
// math noted in the cell_ovr postmortem with the dual-budget shape.
const client =
  globalForDb.__dbClient ??
  postgres(url, {
    prepare: false,
    max: 3,
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
