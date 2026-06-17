// Production hang triage — pg_stat_activity inspection.
// Opens ONE connection, queries activity, reports, closes.
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
console.log(`[pool-diag] Using URL host: ${new URL(url).hostname}`);
console.log(`[pool-diag] Pool mode (port): ${new URL(url).port}`);

const sql = postgres(url, { max: 1, idle_timeout: 5 });

try {
  console.log("\n=== Active backends (pg_stat_activity) ===\n");
  const rows = await sql`
    SELECT pid,
           usename,
           application_name,
           client_addr,
           state,
           wait_event_type,
           wait_event,
           NOW() - state_change AS idle_for,
           NOW() - xact_start  AS xact_age,
           NOW() - query_start AS query_age,
           LEFT(query, 200)     AS query_preview
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state IS NOT NULL
     ORDER BY state_change ASC;
  `;

  if (rows.length === 0) {
    console.log("  (no active backends)");
  } else {
    for (const r of rows) {
      const idle = r.idle_for ? formatInterval(r.idle_for) : "—";
      const xact = r.xact_age ? formatInterval(r.xact_age) : "—";
      const queryAge = r.query_age ? formatInterval(r.query_age) : "—";
      const flag =
        r.state === "idle in transaction" && r.idle_for.seconds > 60
          ? "  ⚠ LEAK"
          : r.state === "idle in transaction"
            ? "  · idle-txn"
            : r.state === "active" && r.query_age && r.query_age.seconds > 30
              ? "  ⚠ LONG-RUNNING"
              : "";
      console.log(
        `  pid=${String(r.pid).padEnd(8)} state=${(r.state ?? "").padEnd(20)} idle_for=${idle.padEnd(12)} xact=${xact.padEnd(12)} query_age=${queryAge.padEnd(12)} app=${r.application_name || "—"}${flag}`,
      );
      if (r.wait_event_type) {
        console.log(`    wait: ${r.wait_event_type} / ${r.wait_event}`);
      }
      const preview = (r.query_preview ?? "").replace(/\s+/g, " ").trim();
      if (preview && preview !== "<insufficient privilege>") {
        console.log(`    query: ${preview.slice(0, 180)}`);
      }
    }
  }

  console.log("\n=== Summary ===\n");
  const summary = await sql`
    SELECT state, count(*)::int AS n
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state IS NOT NULL
     GROUP BY state
     ORDER BY n DESC;
  `;
  for (const s of summary) {
    console.log(`  ${s.state.padEnd(28)} ${s.n}`);
  }

  // Connection limit check
  const limit = await sql`SHOW max_connections;`;
  console.log(`\n  max_connections (server): ${limit[0].max_connections}`);

  // Idle-in-transaction leaks specifically
  const leaks = await sql`
    SELECT count(*)::int AS n
      FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'idle in transaction'
       AND state_change < NOW() - INTERVAL '1 minute';
  `;
  console.log(`  idle-in-txn > 1 min:      ${leaks[0].n}`);
} finally {
  await sql.end();
}

function formatInterval(pgInterval) {
  // postgres-js returns intervals as objects: { years, months, days, hours, minutes, seconds }
  if (!pgInterval) return "—";
  const h = pgInterval.hours ?? 0;
  const m = pgInterval.minutes ?? 0;
  const s = Math.floor(pgInterval.seconds ?? 0);
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
