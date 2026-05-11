// One-shot sanity check on the 0021 backfill. Not added to package.json
// scripts — run on demand:
//   node --env-file=.env.local --experimental-strip-types scripts/verify/ri-7-backfill-sanity.ts

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

type Row = {
  id: string;
  quote_number: string | null;
  status: string;
  sent_at: Date | null;
  created_at: Date;
};

const rows = (await sql`
  SELECT id, quote_number, status, sent_at, created_at
  FROM quotes
  WHERE status IN ('sent', 'accepted', 'superseded', 'lost')
  ORDER BY quote_number NULLS LAST
`) as unknown as Row[];

console.log("Sent+ quotes with their numbers:");
for (const r of rows) {
  console.log(
    `  ${r.quote_number ?? "(null)"} · ${r.status} · sent ${r.sent_at?.toISOString() ?? "(unknown)"} · created ${r.created_at.toISOString()}`,
  );
}

await sql.end();
