// Ad-hoc query helper. Run via:
//   node --env-file=.env.local scripts/q.mjs "<sql>"
// or for a query that takes no params and lives in a file:
//   node --env-file=.env.local scripts/q.mjs "$(cat scripts/q.sql)"
//
// Used during slice smoke testing for DB-state verification.
// Not a long-lived production tool.
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const query = process.argv[2];
if (!query) {
  console.error("usage: node --env-file=.env.local scripts/q.mjs '<sql>'");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const rows = await sql.unsafe(query);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await sql.end();
}
