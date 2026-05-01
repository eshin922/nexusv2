import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
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
};
const client =
  globalForDb.__dbClient ?? postgres(url, { prepare: false, max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbClient = client;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
