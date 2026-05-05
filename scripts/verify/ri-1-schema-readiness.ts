// Slice RI.1 verification — confirms all RI.1 schema additions
// landed correctly on shared DB after migration 0019.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/ri-1-schema-readiness.ts
//
// Verifies:
//   1. pg_trgm extension installed
//   2. 5 new enums (scenario_drop_reason, raws_mode, deposit_status,
//      bulk_raw_native_unit, cost_section_kind)
//   3. 6 new tables present (user_pinned_projects, user_project_visits,
//      bulk_raw_section_meta, bulk_raw_categories, bulk_raw_ingredients,
//      cost_section_deposits)
//   4. 7 ALTER ADD COLUMN — audit_log: caused_by_audit_id + summary +
//      entity_label; quotes: is_recommended + drop_reason +
//      dropped_by_user_id + dropped_at
//   5. 5 new indexes — cascade rollup, trigram on summary +
//      entity_label, recommended pin partial index
//   6. Lifecycle round-trip on user_pinned_projects (insert + select +
//      delete) to confirm composite PK + FK + cleanup
//
// Idempotent; safe to re-run.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const hostMatch = url.match(/@([^/?]+)/);
console.log(`Checking: ${hostMatch?.[1] ?? "(unknown host)"}\n`);

const sql = postgres(url, { prepare: false, max: 2 });

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// ---------- 1. pg_trgm extension ----------

console.log("=== 1. pg_trgm extension ===");
const exts = (await sql<{ extname: string }[]>`
  SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
`) as unknown as { extname: string }[];
check("pg_trgm installed", exts.length === 1);

// ---------- 2. enums ----------

console.log("\n=== 2. enums ===");
const expectedEnums = [
  "scenario_drop_reason",
  "raws_mode",
  "deposit_status",
  "bulk_raw_native_unit",
  "cost_section_kind",
];
const enumRows = (await sql<{ typname: string }[]>`
  SELECT typname FROM pg_type
  WHERE typcategory = 'E' AND typname = ANY(${expectedEnums})
`) as unknown as { typname: string }[];
const foundEnums = new Set(enumRows.map((r) => r.typname));
for (const e of expectedEnums) {
  check(`enum ${e}`, foundEnums.has(e));
}

// ---------- 3. tables ----------

console.log("\n=== 3. tables ===");
const expectedTables = [
  "user_pinned_projects",
  "user_project_visits",
  "bulk_raw_section_meta",
  "bulk_raw_categories",
  "bulk_raw_ingredients",
  "cost_section_deposits",
];
const tableRows = (await sql<{ table_name: string }[]>`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY(${expectedTables})
`) as unknown as { table_name: string }[];
const foundTables = new Set(tableRows.map((r) => r.table_name));
for (const t of expectedTables) {
  check(`table ${t}`, foundTables.has(t));
}

// ---------- 4. ALTER COLUMNS ----------

console.log("\n=== 4. ALTER ADD COLUMNs ===");
const expectedCols = [
  ["audit_log", "caused_by_audit_id"],
  ["audit_log", "summary"],
  ["audit_log", "entity_label"],
  ["quotes", "is_recommended"],
  ["quotes", "drop_reason"],
  ["quotes", "dropped_by_user_id"],
  ["quotes", "dropped_at"],
];
for (const [tbl, col] of expectedCols) {
  const rows = (await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tbl} AND column_name = ${col}
  `) as unknown as { column_name: string }[];
  check(`${tbl}.${col}`, rows.length === 1);
}

// ---------- 5. indexes ----------

console.log("\n=== 5. indexes ===");
const expectedIndexes = [
  "audit_log_caused_by_idx",
  "audit_log_summary_trgm_idx",
  "audit_log_entity_label_trgm_idx",
  "quotes_project_recommended_idx",
  "user_pinned_projects_user_pin_order_idx",
  "user_project_visits_user_visited_idx",
];
const idxRows = (await sql<{ indexname: string }[]>`
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = ANY(${expectedIndexes})
`) as unknown as { indexname: string }[];
const foundIdx = new Set(idxRows.map((r) => r.indexname));
for (const i of expectedIndexes) {
  check(`index ${i}`, foundIdx.has(i));
}

// ---------- 6. lifecycle round-trip on user_pinned_projects ----------

console.log("\n=== 6. lifecycle round-trip ===");
// Pick the first user + project that exists to round-trip a pin.
const userRows = (await sql<{ id: string }[]>`
  SELECT id FROM users LIMIT 1
`) as unknown as { id: string }[];
const projectRows = (await sql<{ id: string }[]>`
  SELECT id FROM projects LIMIT 1
`) as unknown as { id: string }[];
if (userRows.length === 0 || projectRows.length === 0) {
  console.log("  SKIP  no users or no projects in DB; lifecycle skipped");
} else {
  const userId = userRows[0].id;
  const projectId = projectRows[0].id;
  // Snapshot current pin state to restore.
  const before = (await sql<{ count: string }[]>`
    SELECT COUNT(*)::text AS count FROM user_pinned_projects
    WHERE user_id = ${userId} AND project_id = ${projectId}
  `) as unknown as { count: string }[];
  const wasPinned = before[0].count !== "0";
  try {
    if (!wasPinned) {
      await sql`
        INSERT INTO user_pinned_projects (user_id, project_id, pin_order)
        VALUES (${userId}, ${projectId}, 0)
      `;
      const after = (await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM user_pinned_projects
        WHERE user_id = ${userId} AND project_id = ${projectId}
      `) as unknown as { count: string }[];
      check("INSERT pin round-trip", after[0].count === "1");
    } else {
      console.log(
        `  SKIP  user/project already pinned; round-trip needs a clean slot`,
      );
    }
  } finally {
    if (!wasPinned) {
      await sql`
        DELETE FROM user_pinned_projects
        WHERE user_id = ${userId} AND project_id = ${projectId}
      `;
      console.log(
        `  Cleanup: removed test pin for user ${userId.slice(0, 8)}... project ${projectId.slice(0, 8)}...`,
      );
    }
  }
}

console.log(
  `\n${failures === 0 ? "✓ ALL CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED`}`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
