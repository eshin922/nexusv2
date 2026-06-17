// Urgent triage — pg_stat_activity is timing out on transaction-mode.
// Try DIRECT_URL (session-mode :5432); generous timeout; tight query.
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
console.log(`[urgent-diag] URL host: ${new URL(url).hostname} port: ${new URL(url).port}`);

const sql = postgres(url, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 15,
  // No connection.statement_timeout override — let PG default apply.
});

try {
  // Tightest possible query first — just count.
  console.log("\n=== Active backend count (smallest possible query) ===\n");
  const counts = await sql`
    SELECT state, count(*)::int AS n
      FROM pg_stat_activity
     WHERE datname = current_database()
     GROUP BY state
     ORDER BY n DESC NULLS LAST;
  `;
  for (const c of counts) {
    console.log(`  ${(c.state ?? "(null)").padEnd(28)} ${c.n}`);
  }

  console.log("\n=== Long-running queries (>5s) ===\n");
  const long = await sql`
    SELECT pid, usename, application_name,
           (NOW() - query_start)::text AS age,
           state,
           LEFT(query, 200) AS query
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'active'
       AND NOW() - query_start > INTERVAL '5 seconds'
     ORDER BY query_start ASC
     LIMIT 10;
  `;
  if (long.length === 0) {
    console.log("  (none — no queries running > 5s)");
  } else {
    for (const r of long) {
      console.log(`  pid=${r.pid} age=${r.age} state=${r.state} app=${r.application_name}`);
      console.log(`    query: ${r.query?.replace(/\s+/g, " ").trim().slice(0, 180)}`);
    }
  }

  console.log("\n=== Locks blocking other queries ===\n");
  const locks = await sql`
    SELECT
      blocked.pid AS blocked_pid,
      blocked.usename AS blocked_user,
      blocking.pid AS blocking_pid,
      blocking.usename AS blocking_user,
      LEFT(blocked.query, 100) AS blocked_query,
      LEFT(blocking.query, 100) AS blocking_query
    FROM pg_stat_activity blocked
    JOIN pg_stat_activity blocking
      ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
    WHERE blocked.datname = current_database();
  `;
  if (locks.length === 0) {
    console.log("  (none — no blocking lock chains)");
  } else {
    for (const l of locks) {
      console.log(`  pid=${l.blocked_pid} blocked by pid=${l.blocking_pid}`);
      console.log(`    blocked: ${l.blocked_query}`);
      console.log(`    blocking: ${l.blocking_query}`);
    }
  }
} finally {
  await sql.end();
}
