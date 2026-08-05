import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");

const sql = postgres(connectionString, { max: 1 });
try {
  const [summary] = await sql<{
    push_rows: number;
    succeeded_rows: number;
    succeeded_quotes: number;
  }[]>`
    SELECT
      count(*)::int AS push_rows,
      count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded_rows,
      count(DISTINCT quote_id) FILTER (WHERE status = 'succeeded')::int AS succeeded_quotes
    FROM netsuite_so_pushes
  `;
  const [duplicates] = await sql<{ duplicate_success_quotes: number }[]>`
    SELECT count(*)::int AS duplicate_success_quotes
    FROM (
      SELECT quote_id
      FROM netsuite_so_pushes
      WHERE status = 'succeeded'
      GROUP BY quote_id
      HAVING count(*) > 1
    ) duplicate_quotes
  `;
  const [association] = await sql<{ rows_with_exact_active_snapshot: number }[]>`
    SELECT count(*)::int AS rows_with_exact_active_snapshot
    FROM netsuite_so_pushes push
    WHERE (
      SELECT count(*)
      FROM quote_snapshots snapshot
      WHERE snapshot.quote_id = push.quote_id
        AND snapshot.superseded_at IS NULL
    ) = 1
  `;

  console.log(JSON.stringify({ summary, duplicates, association }, null, 2));
  if (duplicates.duplicate_success_quotes !== 0) process.exitCode = 1;
  if (association.rows_with_exact_active_snapshot !== summary.push_rows) {
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
