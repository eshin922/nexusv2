#!/usr/bin/env node
// Apply a manual SQL file from drizzle/manual/ to the database
// referenced by DIRECT_URL. Used when psql isn't on PATH or when
// scripted application via Node is preferred.
//
// Usage: node --env-file=.env.local scripts/apply-manual-sql.mjs <path-to-sql>

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: apply-manual-sql.mjs <path-to-sql>");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set. Run with: node --env-file=.env.local ...");
  process.exit(1);
}

const sql = fs.readFileSync(absolutePath, "utf8");
console.log(`Applying ${path.relative(process.cwd(), absolutePath)} (${sql.length} chars) against ${new URL(url).hostname} ...`);

const client = postgres(url, { max: 1, prepare: false });
try {
  await client.unsafe(sql);
  console.log("✓ applied successfully");
} catch (e) {
  console.error("✗ apply failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
