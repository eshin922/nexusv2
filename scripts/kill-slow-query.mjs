// Terminate the runaway cell_ovr query identified in
// pool-diagnostic-urgent.mjs (pid 155789 at the time of discovery).
// Then check indexes on quote_sku_tiers + run ANALYZE.

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  // Re-check current long-running queries first (pid may have changed
  // since the diagnostic ran).
  console.log("\n=== Long-running queries right now ===\n");
  const long = await sql`
    SELECT pid, application_name,
           (NOW() - query_start)::text AS age,
           LEFT(query, 200) AS query
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'active'
       AND NOW() - query_start > INTERVAL '5 seconds'
       AND application_name NOT LIKE 'realtime_%'
     ORDER BY query_start ASC;
  `;
  for (const r of long) {
    console.log(`  pid=${r.pid} age=${r.age} app=${r.application_name}`);
    console.log(`    query: ${r.query?.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }

  // Terminate any non-realtime backend running > 30s on quote_sku_tiers
  // / quote_skus queries. Conservative target — only kills app queries.
  console.log("\n=== Terminating runaway app queries ===\n");
  const killed = await sql`
    SELECT pg_terminate_backend(pid) AS terminated, pid, application_name,
           LEFT(query, 100) AS query
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'active'
       AND NOW() - query_start > INTERVAL '30 seconds'
       AND application_name NOT LIKE 'realtime_%'
       AND application_name <> 'postgres_exporter';
  `;
  if (killed.length === 0) {
    console.log("  (none over the 30s threshold)");
  } else {
    for (const k of killed) {
      console.log(`  terminated pid=${k.pid} (${k.application_name})`);
      console.log(`    was: ${k.query?.replace(/\s+/g, " ").trim()}`);
    }
  }

  // Check indexes on quote_sku_tiers.
  console.log("\n=== Indexes on quote_sku_tiers ===\n");
  const indexes = await sql`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE tablename = 'quote_sku_tiers';
  `;
  for (const i of indexes) {
    console.log(`  ${i.indexname}`);
    console.log(`    ${i.indexdef}`);
  }

  // Table size + row count.
  console.log("\n=== quote_sku_tiers stats ===\n");
  const stats = await sql`
    SELECT
      n_live_tup AS approx_rows,
      n_dead_tup AS dead_rows,
      last_analyze::text AS last_analyze,
      last_autoanalyze::text AS last_autoanalyze,
      last_vacuum::text AS last_vacuum,
      last_autovacuum::text AS last_autovacuum
    FROM pg_stat_user_tables
   WHERE relname = 'quote_sku_tiers';
  `;
  for (const s of stats) {
    console.log(`  approx_rows:        ${s.approx_rows}`);
    console.log(`  dead_rows:          ${s.dead_rows}`);
    console.log(`  last_analyze:       ${s.last_analyze ?? "never"}`);
    console.log(`  last_autoanalyze:   ${s.last_autoanalyze ?? "never"}`);
    console.log(`  last_vacuum:        ${s.last_vacuum ?? "never"}`);
    console.log(`  last_autovacuum:    ${s.last_autovacuum ?? "never"}`);
  }

  // Same for quote_skus.
  console.log("\n=== quote_skus stats ===\n");
  const skusStats = await sql`
    SELECT
      n_live_tup AS approx_rows,
      n_dead_tup AS dead_rows,
      last_analyze::text AS last_analyze,
      last_autoanalyze::text AS last_autoanalyze
    FROM pg_stat_user_tables
   WHERE relname = 'quote_skus';
  `;
  for (const s of skusStats) {
    console.log(`  approx_rows:        ${s.approx_rows}`);
    console.log(`  dead_rows:          ${s.dead_rows}`);
    console.log(`  last_analyze:       ${s.last_analyze ?? "never"}`);
    console.log(`  last_autoanalyze:   ${s.last_autoanalyze ?? "never"}`);
  }

  console.log("\n=== quote_skus indexes ===\n");
  const skusIdx = await sql`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE tablename = 'quote_skus';
  `;
  for (const i of skusIdx) {
    console.log(`  ${i.indexname}`);
    console.log(`    ${i.indexdef}`);
  }
} finally {
  await sql.end();
}
