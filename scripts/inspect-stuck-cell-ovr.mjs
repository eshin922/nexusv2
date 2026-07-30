// Why is cell_ovr stuck even after compute upgrade?
// Capture wait_event, query plan stats, and Supavisor state.

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  console.log("\n=== Stuck cell_ovr queries with wait events ===\n");
  const stuck = await sql`
    SELECT pid, usename, application_name, client_addr,
           state,
           wait_event_type,
           wait_event,
           backend_xmin,
           (NOW() - query_start)::text AS query_age,
           (NOW() - state_change)::text AS state_age,
           backend_start::text AS backend_start,
           LEFT(query, 250) AS query
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND query LIKE '%quote_sku_tiers%'
       AND state = 'active'
     ORDER BY query_start ASC;
  `;
  for (const r of stuck) {
    console.log(`  pid=${r.pid}`);
    console.log(`    app:           ${r.application_name}`);
    console.log(`    client_addr:   ${r.client_addr ?? "(local)"}`);
    console.log(`    state:         ${r.state}`);
    console.log(
      `    wait:          ${r.wait_event_type ?? "(none)"} / ${r.wait_event ?? "(none)"}`,
    );
    console.log(`    query_age:     ${r.query_age}`);
    console.log(`    state_age:     ${r.state_age}`);
    console.log(`    backend_start: ${r.backend_start}`);
    console.log(`    query: ${r.query?.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    console.log("");
  }

  console.log("=== Terminating stuck cell_ovr backends ===\n");
  const killed = await sql`
    SELECT pg_terminate_backend(pid) AS terminated, pid, application_name
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND query LIKE '%quote_sku_tiers%'
       AND state = 'active'
       AND NOW() - query_start > INTERVAL '30 seconds';
  `;
  for (const k of killed) {
    console.log(`  terminated pid=${k.pid} (${k.application_name})`);
  }
  if (killed.length === 0) {
    console.log("  (none over the 30s threshold)");
  }

  console.log("\n=== Test the exact cell_ovr query shape locally ===\n");
  // Find a quote with some data to test against.
  const sampleQuote = await sql`
    SELECT q.id, p.client_name
      FROM quotes q
           INNER JOIN projects p ON p.id = q.project_id
     WHERE EXISTS (
       SELECT 1 FROM quote_sku_tiers qst
             INNER JOIN quote_skus qs ON qs.id = qst.quote_sku_id
        WHERE qs.quote_id = q.id
     )
     LIMIT 1;
  `;
  if (sampleQuote.length > 0) {
    const testQuoteId = sampleQuote[0].id;
    console.log(
      `  Testing with quote ${testQuoteId.slice(0, 8)} (${sampleQuote[0].client_name})...`,
    );
    const t0 = Date.now();
    const result = await sql`
      SELECT qst.quote_sku_id, qst.tier_id, qst.sell_price_override
        FROM quote_sku_tiers qst
             INNER JOIN quote_skus qs ON qs.id = qst.quote_sku_id
       WHERE qs.quote_id = ${testQuoteId};
    `;
    const dt = Date.now() - t0;
    console.log(`  → ${result.length} rows in ${dt}ms`);
  } else {
    console.log("  (no quote with quote_sku_tiers data found)");
  }

  console.log("\n=== EXPLAIN ANALYZE on the cell_ovr query ===\n");
  if (sampleQuote.length > 0) {
    const testQuoteId = sampleQuote[0].id;
    const plan = await sql.unsafe(`
      EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
      SELECT qst.quote_sku_id, qst.tier_id, qst.sell_price_override
        FROM quote_sku_tiers qst
             INNER JOIN quote_skus qs ON qs.id = qst.quote_sku_id
       WHERE qs.quote_id = $1;
    `, [testQuoteId]);
    for (const line of plan) console.log(`  ${line["QUERY PLAN"]}`);
  }

  console.log("\n=== Application source distribution ===\n");
  const apps = await sql`
    SELECT application_name, state, count(*)::int AS n
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND application_name IS NOT NULL
     GROUP BY application_name, state
     ORDER BY application_name, state;
  `;
  for (const a of apps) {
    console.log(
      `  ${(a.application_name || "(none)").padEnd(40)} ${(a.state ?? "—").padEnd(20)} ${a.n}`,
    );
  }
} finally {
  await sql.end();
}
