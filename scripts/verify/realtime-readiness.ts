// Slice 8.5 #45 diligence — verifies Supabase Realtime project setup
// for the 8 tables we want to subscribe to.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/realtime-readiness.ts
//
// (Or with prod DATABASE_URL once dev passes, to confirm prod parity.)
//
// Reports per table:
//   - Replication: is the table in supabase_realtime publication?
//     (Without this, postgres_changes events never fire.)
//   - RLS state: is row-level security enabled?
//     (If on, the browser anon-key client won't see events without
//     RLS policies — would need the Clerk-Supabase JWT bridge.)
//
// Surfaces "intent" prompt at the end: if RLS is ON, the human (Edward)
// has to confirm whether it's intentional or accidental — the script
// can only report state.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const hostMatch = url.match(/@([^/?]+)/);
console.log(`Checking: ${hostMatch?.[1] ?? "(unknown host)"}\n`);

const sql = postgres(url, { prepare: false, max: 2 });

const TABLES = [
  "quote_skus",
  "quote_tiers",
  "packaging_inputs",
  "production_inputs",
  // `freight_inputs` retained in the check list until the cleanup
  // migration drops the table. Slice R6.2 commit 2 stops reading it
  // but the row stays in the realtime publication so legacy listeners
  // (if any) don't silently break.
  "freight_inputs",
  // Slice R6.2 — multi-leg freight tables added to the publication
  // via drizzle/manual/0002_supabase_realtime_r6_2_freight.sql.
  "freight_leg_groups",
  "freight_legs",
  "freight_leg_tiers",
  "freight_customer_arranges_meta",
  "quotes",
  "firm_settings",
  "markup_defaults",
  // Slice 9.5 — quote_warnings extends the realtime rope so warning
  // lifecycle changes (accepted by one PM, auto_resolved by another's
  // input change) propagate cross-PM via the same coalesce + reconcile
  // pipe. RLS-off matching the others.
  "quote_warnings",
] as const;

// --- 1. Replication membership in supabase_realtime publication ---
console.log("=== 1. supabase_realtime publication membership ===");
const pubRows = (await sql<{ tablename: string }[]>`
  SELECT tablename
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = ANY(${[...TABLES] as unknown as string[]})
`) as unknown as { tablename: string }[];
const inPublication = new Set(pubRows.map((r) => r.tablename));
let pubMissing = 0;
for (const t of TABLES) {
  if (inPublication.has(t)) {
    console.log(`  PASS  ${t} — in publication`);
  } else {
    pubMissing += 1;
    console.log(`  FAIL  ${t} — NOT in publication (events won't fire)`);
  }
}

// --- 2. RLS state per table ---
console.log("\n=== 2. Row-level security state ===");
const rlsRows = (await sql<{ tablename: string; rls: boolean }[]>`
  SELECT c.relname AS tablename, c.relrowsecurity AS rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY(${[...TABLES] as unknown as string[]})
`) as unknown as { tablename: string; rls: boolean }[];
const rlsByTable = new Map(rlsRows.map((r) => [r.tablename, r.rls]));
let rlsOn = 0;
for (const t of TABLES) {
  const rls = rlsByTable.get(t);
  if (rls === undefined) {
    console.log(`  ?     ${t} — table not found`);
  } else if (rls) {
    rlsOn += 1;
    console.log(`  RLS   ${t} — RLS ENABLED`);
  } else {
    console.log(`  ok    ${t} — RLS off`);
  }
}

// --- 3. RLS policies count (only meaningful if RLS is on) ---
if (rlsOn > 0) {
  console.log("\n=== 3. RLS policies on RLS-enabled tables ===");
  const policyRows = (await sql<{ tablename: string; n: string }[]>`
    SELECT tablename, COUNT(*)::text AS n
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${[...TABLES] as unknown as string[]})
    GROUP BY tablename
  `) as unknown as { tablename: string; n: string }[];
  const policyByTable = new Map(policyRows.map((r) => [r.tablename, Number(r.n)]));
  for (const t of TABLES) {
    const rls = rlsByTable.get(t);
    if (rls) {
      const n = policyByTable.get(t) ?? 0;
      console.log(`  ${t}: ${n} polic${n === 1 ? "y" : "ies"}`);
    }
  }
}

// --- Summary ---
console.log("\n=== Summary ===");
console.log(`  Replication: ${TABLES.length - pubMissing} / ${TABLES.length} tables in supabase_realtime publication`);
console.log(`  RLS:         ${rlsOn} / ${TABLES.length} tables have RLS enabled`);

console.log("\n=== Decision branch ===");
if (rlsOn === 0 && pubMissing === 0) {
  console.log(`  ✓ RLS off across all ${TABLES.length} tables, all in publication.`);
  console.log("    Proceed with anon-key browser client (#46+).");
  console.log("    CLAUDE.md (#56) must document the RLS-off assumption");
  console.log("    as a latent dependency: if RLS is ever turned on, the");
  console.log("    realtime path needs a Clerk-Supabase JWT bridge.");
} else if (rlsOn > 0) {
  console.log(`  ⚠ RLS is ON for ${rlsOn} table(s).`);
  console.log("    PAUSE before #46. Confirm with Edward: was RLS turned on");
  console.log("    intentionally (security posture decision) or accidentally");
  console.log("    (Supabase default, exploration toggle)?");
  console.log("    - If intentional → propose Clerk-Supabase JWT bridge as a");
  console.log("      separate sequenced task before #46.");
  console.log("    - If accidental → turn RLS off, document the access-control");
  console.log("      posture in CLAUDE.md (Clerk + page/action layer).");
} else if (pubMissing > 0) {
  console.log(`  ⚠ ${pubMissing} table(s) missing from publication.`);
  console.log("    Add via Supabase dashboard → Database → Replication,");
  console.log("    or:  ALTER PUBLICATION supabase_realtime ADD TABLE <name>;");
}

await sql.end();
process.exit(rlsOn > 0 || pubMissing > 0 ? 1 : 0);
