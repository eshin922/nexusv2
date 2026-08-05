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
  // PR-F: `quote_skus`, `packaging_inputs`, and `production_inputs` were
  // listed here until this pass. Slice 11.5.1 DROPPED all three (drizzle
  // `0035`), so the script reported them as missing from the publication
  // on every run — three standing false positives that a real missing
  // table could hide behind. Removed so the output is trustworthy.
  //
  // Known remaining gap, NOT closed here to keep PR-F's boundary narrow:
  // the Slice 11.5.1 NEW-model tables (assemblies, assembly_leaves,
  // quote_leaves, assembly_leaf_inputs, assembly_production_inputs,
  // assembly_leaf_overrides, assembly_leaf_targets) are in the
  // publication via `drizzle/manual/0018` but were never added to this
  // list, so they go unverified. Tracked separately.
  "quote_tiers",
  // Slice R6.2 — multi-leg freight tables added to the publication
  // via drizzle/manual/0002_supabase_realtime_r6_2_freight.sql.
  // Legacy `freight_inputs` retired commit 3 (drop SQL
  // drizzle/manual/0003_supabase_realtime_drop_freight_inputs.sql
  // + drizzle migration 0027); table no longer exists.
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
  // PR-F — Phase 2 worksheet Freight authority. Added to the
  // publication via
  // `drizzle/manual/0036_realtime_publication_phase_2_worksheet_freight.sql`
  // and subscribed on the third channel (`quote:<id>:freight-worksheet`).
  //
  // `quote_snapshot_freight_workbooks` is deliberately absent: it is
  // written once at send and frozen thereafter (Pattern 52 draft-lock),
  // so it has no live state to propagate.
  "freight_subcategories",
  "freight_subcategory_items",
  "freight_destinations",
  "freight_destination_breaks",
  "freight_customs_entries",
  "freight_customs_breaks",
  "freight_destination_tracking",
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
