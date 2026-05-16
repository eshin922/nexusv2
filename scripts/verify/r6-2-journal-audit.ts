// R6.2 commit 1 follow-up — comprehensive journal audit.
//
// For every row in drizzle.__drizzle_migrations:
//   1. Compute LF-normalized SHA-256 of every on-disk migration.
//   2. Match each DB row's hash against the file hashes.
//   3. Report: row → file mapping, true orphans (no file match),
//      files with no DB row (potentially edited post-apply).
//
// Per Edward's refinement: hash-match EACH target orphan before
// any DELETE, plus surface any fourth orphan hiding that wasn't
// noticed. No DELETEs executed here — audit only.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
const sql = postgres(url, { max: 1, prepare: false });

function lfSha(file: string): string {
  return createHash("sha256")
    .update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");
}

const sqlFiles = readdirSync("drizzle")
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const fileHashes = new Map<string, string>();
for (const f of sqlFiles) fileHashes.set(lfSha(`drizzle/${f}`), f);

const dbRows = await sql<{ id: number; hash: string; created_at: bigint }[]>`
  SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
  ORDER BY id
`;

const matched: { id: number; file: string }[] = [];
const orphans: { id: number; hash: string; created_at: bigint }[] = [];
const fileToDb = new Map<string, number>();

for (const r of dbRows) {
  const f = fileHashes.get(r.hash);
  if (f) {
    matched.push({ id: r.id, file: f });
    fileToDb.set(f, r.id);
  } else {
    orphans.push(r);
  }
}

const orphanFiles = sqlFiles.filter((f) => !fileToDb.has(f));

console.log("=== DB rows → on-disk file ===\n");
for (const m of matched) console.log(`  ✓ id ${String(m.id).padStart(2)} → ${m.file}`);
for (const o of orphans)
  console.log(`  ✗ id ${String(o.id).padStart(2)} → NO FILE (hash ${o.hash.slice(0, 16)}..., when ${o.created_at})`);

console.log(`\n${orphans.length} orphan rows (DB hash has no matching on-disk file)`);

console.log("\n=== On-disk files with no DB row (potentially edited post-apply) ===\n");
if (orphanFiles.length === 0) console.log("  (none)");
for (const f of orphanFiles) console.log(`  ⚠ ${f} (hash ${lfSha(`drizzle/${f}`).slice(0, 16)}...)`);

console.log("\n=== Per-orphan pre-DELETE verification ===\n");
// For each orphan, confirm its hash matches NO on-disk file.
const targets = [19, 20, 24];
for (const id of targets) {
  const row = orphans.find((o) => o.id === id);
  if (!row) {
    console.log(`  ✗ id ${id} — NOT FOUND in orphan list (already deleted? or matched?)`);
    continue;
  }
  const hasFile = fileHashes.has(row.hash);
  console.log(
    `  id ${id}: hash ${row.hash.slice(0, 24)}... ${
      hasFile ? "✗ MATCHES " + fileHashes.get(row.hash) + " — DO NOT DELETE" : "✓ no file matches; safe to DELETE"
    }`,
  );
}

await sql.end();
