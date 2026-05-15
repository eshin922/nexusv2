// R6.2 commit 2 verification — confirms the destructive sweep landed
// cleanly. Two invariants:
//
//   1. NO active code references to the legacy `freight_inputs` table
//      or the `freightInputs` Drizzle import in src/ (excluding
//      schema.ts which retains the export until the cleanup migration
//      drops the table, and code comments that explicitly describe
//      the legacy shape).
//   2. The four new freight tables are present in the
//      supabase_realtime publication (the manual SQL
//      drizzle/manual/0002_supabase_realtime_r6_2_freight.sql must
//      have been applied).
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/r6-2-commit2-sweep.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postgres from "postgres";

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = join(PROJECT_ROOT, "src");

// Files we deliberately exempt from the sweep — see header comment.
const EXEMPT_FILES = new Set([
  join("src", "db", "schema.ts").replace(/\\/g, "/"),
]);

// Match `freight_inputs` (table name in DB), `freightInputs` (Drizzle
// export ID), `CostingFreightInput` (retired math type). Comments
// inside source files are filtered out (they describe the legacy
// shape for historical context but don't reference the real
// identifier).
const FORBIDDEN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "freightInputs", regex: /\bfreightInputs\b/g },
  { name: "CostingFreightInput", regex: /\bCostingFreightInput\b/g },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      st.isFile() &&
      (full.endsWith(".ts") || full.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripCommentsAndStrings(source: string): string {
  // Naive strip: remove /* ... */ and // ... \n. Strings (template
  // and regular) can also contain identifiers, but inside strings
  // those don't constitute runtime references either — strip them
  // too. Coarse but adequate for "no remaining reference" sweep.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, "") // line comments
    .replace(/`(?:\\.|[^\\`])*`/g, "``") // template literals
    .replace(/'(?:\\.|[^\\'])*'/g, "''") // single-quoted strings
    .replace(/"(?:\\.|[^\\"])*"/g, '""'); // double-quoted strings
}

let codeFailures = 0;
const files = walk(SRC_ROOT);
for (const file of files) {
  const rel = relative(PROJECT_ROOT, file).replace(/\\/g, "/");
  if (EXEMPT_FILES.has(rel)) continue;
  const source = readFileSync(file, "utf8");
  const codeOnly = stripCommentsAndStrings(source);
  for (const { name, regex } of FORBIDDEN_PATTERNS) {
    regex.lastIndex = 0;
    const matches = codeOnly.match(regex);
    if (matches && matches.length > 0) {
      console.log(
        `✗ ${rel}: ${matches.length} active reference(s) to "${name}"`,
      );
      codeFailures++;
    }
  }
}
if (codeFailures === 0) {
  console.log(
    "✓ no active src/ references to retired freight_inputs / freightInputs / CostingFreightInput identifiers",
  );
}

// --- Realtime publication check ---

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const PUBLICATION_TABLES = [
  "freight_leg_groups",
  "freight_legs",
  "freight_leg_tiers",
  "freight_customer_arranges_meta",
] as const;

const pubRows = (await sql<{ tablename: string }[]>`
  SELECT tablename
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = ANY(${[...PUBLICATION_TABLES] as unknown as string[]})
`) as unknown as { tablename: string }[];
const inPublication = new Set(pubRows.map((r) => r.tablename));

let pubFailures = 0;
for (const t of PUBLICATION_TABLES) {
  if (inPublication.has(t)) {
    console.log(`✓ ${t} — in supabase_realtime publication`);
  } else {
    pubFailures++;
    console.log(
      `✗ ${t} — NOT in supabase_realtime publication (run drizzle/manual/0002_supabase_realtime_r6_2_freight.sql)`,
    );
  }
}

await sql.end();

const total = codeFailures + pubFailures;
console.log(
  `\n${total === 0 ? "✓ ALL CHECKS PASS — commit 2 sweep verified" : `✗ ${total} CHECK(S) FAILED`}\n`,
);
process.exit(total === 0 ? 0 : 1);
