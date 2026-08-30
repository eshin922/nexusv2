/** READ-ONLY. Migration-history identity trace.
 *
 *  Reconciles `drizzle/meta/_journal.json`, the migration files, and the live
 *  `drizzle.__drizzle_migrations` table, and reports what
 *  `drizzle-kit migrate` would ACTUALLY execute against this database.
 *
 *  ── WHY THE OBVIOUS COMPARISON IS THE WRONG ONE ─────────────────────────
 *
 *  Comparing each journal `when` against the set of `created_at` values looks
 *  like the right check and is not. drizzle-orm's `migrate` reads exactly ONE
 *  row -- `order by created_at desc limit 1` -- and then runs every journal
 *  entry whose `when` is strictly greater than that single value. It never
 *  compares hashes, and it never looks at any other row.
 *
 *  So set-difference answers a question nobody asks, and it over-reports:
 *  it will call an applied migration "pending" whenever that migration's row
 *  carries a `created_at` the journal does not also carry. This script reports
 *  the high-water-mark answer as authoritative and keeps the set answer only
 *  to show where the two disagree.
 *
 *  Writes nothing. Executes no migration.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

type Row = Record<string, string | null>;
const FOLDER = "drizzle";

const journal = JSON.parse(
  readFileSync(path.join(FOLDER, "meta/_journal.json"), "utf8"),
) as { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };

// Hash exactly as `readMigrationFiles` does: sha256 of the whole file.
const fileHash = (tag: string) => {
  const p = path.join(FOLDER, `${tag}.sql`);
  if (!existsSync(p)) return null;
  return createHash("sha256").update(readFileSync(p).toString()).digest("hex");
};

const dbRows = (await db.execute(sql`
  select id::text id, hash::text hash, created_at::text created_at
    from drizzle.__drizzle_migrations
   order by created_at asc, id asc`)) as unknown as Row[];

const byHash = new Map(dbRows.map((r) => [String(r.hash), r]));
const dbCreatedAt = new Set(dbRows.map((r) => String(r.created_at)));

// The single value the migrator actually reads.
const highWater = dbRows.reduce(
  (max, r) => Math.max(max, Number(r.created_at)),
  Number.NEGATIVE_INFINITY,
);

console.log("=".repeat(78));
console.log("A · IDENTITY THE MIGRATOR USES");
console.log("=".repeat(78));
console.log("  drizzle-orm/pg-core dialect.migrate():");
console.log("    select id, hash, created_at ... order by created_at desc limit 1");
console.log("    run when:  Number(lastDbMigration.created_at) < migration.folderMillis");
console.log("    folderMillis === journal entry `when`;  hash is WRITTEN, never READ");
console.log(`\n  journal entries          ${journal.entries.length}`);
console.log(`  __drizzle_migrations     ${dbRows.length}`);
console.log(`  MAX(created_at)          ${highWater}`);

const wouldRun = journal.entries.filter((e) => highWater < e.when);
console.log(`\n  WOULD EXECUTE on a bare \`db:migrate\`: ${wouldRun.length}`);
for (const e of wouldRun) console.log(`    idx=${e.idx} when=${e.when} ${e.tag}`);

console.log("\n" + "=".repeat(78));
console.log("B · PER-MIGRATION CLASSIFICATION");
console.log("=".repeat(78));
console.log(
  "tag".padEnd(46) +
    "when            hash   created_at   verdict",
);
console.log("-".repeat(110));

let hashMatched = 0;
let whenMatched = 0;
const anomalies: string[] = [];

for (const e of journal.entries) {
  const h = fileHash(e.tag);
  const hashRow = h ? byHash.get(h) : undefined;
  const whenPresent = dbCreatedAt.has(String(e.when));
  if (hashRow) hashMatched++;
  if (whenPresent) whenMatched++;

  // The authoritative verdict is the migrator's own rule.
  const verdict = highWater >= e.when ? "not-run (below high-water)" : "WOULD RUN";

  console.log(
    e.tag.slice(0, 45).padEnd(46) +
      String(e.when).padEnd(16) +
      (h === null ? "NOFILE" : hashRow ? "  ✓   " : "  ✗   ").padEnd(7) +
      (whenPresent ? "   ✓     " : "   ✗     ").padEnd(13) +
      verdict,
  );

  if (h === null) anomalies.push(`${e.tag}: journal entry has NO .sql file`);
  if (h !== null && !hashRow && whenPresent) {
    anomalies.push(
      `${e.tag}: a row carries its \`when\` but NO row carries its file hash — ` +
        `the file changed after it was applied, or it was recorded by another path`,
    );
  }
  if (h !== null && hashRow && String(hashRow.created_at) !== String(e.when)) {
    anomalies.push(
      `${e.tag}: hash row exists but created_at=${hashRow.created_at} ≠ journal when=${e.when}`,
    );
  }
}

console.log(
  `\n  journal entries whose FILE HASH appears in the table: ${hashMatched}/${journal.entries.length}`,
);
console.log(
  `  journal entries whose WHEN appears as a created_at:   ${whenMatched}/${journal.entries.length}`,
);

console.log("\n" + "=".repeat(78));
console.log("C · ROWS IN THE TABLE THAT NO JOURNAL ENTRY EXPLAINS");
console.log("=".repeat(78));
const journalHashes = new Set(
  journal.entries.map((e) => fileHash(e.tag)).filter(Boolean) as string[],
);
const orphans = dbRows.filter((r) => !journalHashes.has(String(r.hash)));
console.log(`  ${orphans.length} of ${dbRows.length} rows carry a hash no current file produces.`);
for (const r of orphans.slice(0, 12))
  console.log(`    id=${r.id} created_at=${r.created_at} hash=${String(r.hash).slice(0, 16)}…`);
if (orphans.length > 12) console.log(`    … and ${orphans.length - 12} more`);

console.log("\n" + "=".repeat(78));
console.log("D · SNAPSHOT CHAIN (db:generate depends on this)");
console.log("=".repeat(78));
const snaps = readdirSync(path.join(FOLDER, "meta"))
  .filter((f) => f.endsWith("_snapshot.json"))
  .sort();
console.log(`  ${snaps.length} snapshots for ${journal.entries.length} journal entries`);
if (snaps.length) console.log(`  first: ${snaps[0]}\n  last:  ${snaps[snaps.length - 1]}`);
const snapIdx = new Set(snaps.map((f) => f.slice(0, 4)));
const missing = journal.entries.filter(
  (e) => !snapIdx.has(String(e.idx).padStart(4, "0")),
);
console.log(`  journal entries with NO snapshot: ${missing.length}`);
if (missing.length)
  console.log(
    `    from idx=${missing[0].idx} (${missing[0].tag}) to idx=${missing[missing.length - 1].idx}`,
  );

console.log("\n" + "=".repeat(78));
console.log("E · ANOMALIES");
console.log("=".repeat(78));
if (anomalies.length === 0) console.log("  none");
for (const a of anomalies) console.log(`  · ${a}`);

process.exit(0);
