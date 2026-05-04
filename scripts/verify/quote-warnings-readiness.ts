// Slice 9.5 verification — verifies quote_warnings table shape +
// indexes + lifecycle round-trip after migration 0017.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/quote-warnings-readiness.ts
//
// When to run:
//   - After applying migration 0017 to confirm schema landed correctly
//   - After any quote_warnings shape change (column type, new column)
//   - When debugging warning lifecycle issues
//
// Verifies:
//   1. Table exists with all 19 columns at expected types
//   2. Three indexes present (active partial, scope, row partial)
//   3. FK references resolve to quotes / quote_tiers / users
//   4. Lifecycle round-trip on a real quote: insert active → update
//      to accepted → simulate auto_resolved → cleanup
//
// Lifecycle round-trip uses a real (existing) quote ID — picks the
// most recent quote — and writes a single test row that gets
// fully cleaned up before exit. Idempotent; safe to run repeatedly.

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

// ---------- 1. table + columns ----------

console.log("=== 1. quote_warnings columns ===");
const expectedColumns: Record<string, string> = {
  id: "uuid",
  quote_id: "uuid",
  scope: "text",
  table_name: "text",
  row_id: "text", // TEXT, not UUID — architect option 2b-A
  field_name: "text",
  tier_id: "uuid",
  kind: "text",
  severity: "text",
  status: "text",
  accepted_by_user_id: "uuid",
  accepted_at: "timestamp with time zone",
  accept_reason_kind: "text",
  accept_reason_text: "text",
  auto_resolved_at: "timestamp with time zone",
  message: "text",
  detail_json: "jsonb",
  created_at: "timestamp with time zone",
  last_evaluated_at: "timestamp with time zone",
};

const columns = (await sql<
  { column_name: string; data_type: string; is_nullable: string }[]
>`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quote_warnings'
  ORDER BY ordinal_position
`) as unknown as { column_name: string; data_type: string; is_nullable: string }[];

check(
  "quote_warnings table exists with 19 columns",
  columns.length === 19,
  `${columns.length} columns found`,
);

for (const [name, expectedType] of Object.entries(expectedColumns)) {
  const col = columns.find((c) => c.column_name === name);
  check(
    `column ${name} (${expectedType})`,
    col !== undefined && col.data_type === expectedType,
    col ? `is ${col.data_type}, nullable=${col.is_nullable}` : "MISSING",
  );
}

// ---------- 2. indexes ----------

console.log("\n=== 2. indexes ===");
const indexes = (await sql<{ indexname: string; indexdef: string }[]>`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'quote_warnings'
  ORDER BY indexname
`) as unknown as { indexname: string; indexdef: string }[];

const expectedIndexes = [
  "quote_warnings_pkey",
  "quote_warnings_quote_active_idx",
  "quote_warnings_quote_scope_idx",
  "quote_warnings_row_idx",
];
for (const idx of expectedIndexes) {
  const found = indexes.find((i) => i.indexname === idx);
  check(`index ${idx}`, found !== undefined, found?.indexdef ?? "MISSING");
}

const activeIdx = indexes.find(
  (i) => i.indexname === "quote_warnings_quote_active_idx",
);
check(
  "active idx is partial (WHERE status = 'active')",
  activeIdx !== undefined && activeIdx.indexdef.includes("status = 'active'"),
  activeIdx?.indexdef.match(/WHERE.*$/)?.[0] ?? "no WHERE clause",
);

const rowIdx = indexes.find((i) => i.indexname === "quote_warnings_row_idx");
check(
  "row idx is partial (WHERE table_name IS NOT NULL)",
  rowIdx !== undefined && rowIdx.indexdef.includes("table_name IS NOT NULL"),
  rowIdx?.indexdef.match(/WHERE.*$/)?.[0] ?? "no WHERE clause",
);

// ---------- 3. FKs ----------

console.log("\n=== 3. FKs ===");
const fks = (await sql<
  {
    constraint_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    delete_rule: string;
  }[]
>`
  SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'quote_warnings'
`) as unknown as {
  constraint_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
  delete_rule: string;
}[];

const fkExpectations = [
  { col: "quote_id", target: "quotes", deleteRule: "CASCADE" },
  { col: "tier_id", target: "quote_tiers", deleteRule: "CASCADE" },
  { col: "accepted_by_user_id", target: "users", deleteRule: "NO ACTION" },
];
for (const exp of fkExpectations) {
  const fk = fks.find((f) => f.column_name === exp.col);
  check(
    `${exp.col} → ${exp.target} (ON DELETE ${exp.deleteRule})`,
    fk !== undefined &&
      fk.foreign_table_name === exp.target &&
      fk.delete_rule === exp.deleteRule,
    fk
      ? `→ ${fk.foreign_table_name}.${fk.foreign_column_name}, ON DELETE ${fk.delete_rule}`
      : "MISSING",
  );
}

// ---------- 4. lifecycle round-trip ----------

console.log("\n=== 4. lifecycle round-trip on a real quote ===");

const quoteRow = (await sql<{ id: string }[]>`
  SELECT id FROM quotes ORDER BY created_at DESC LIMIT 1
`) as unknown as { id: string }[];

if (quoteRow.length === 0) {
  console.log("  SKIP  no quotes in DB; lifecycle round-trip skipped");
} else {
  const quoteId = quoteRow[0].id;
  const TEST_KIND = "verify_round_trip";
  const TEST_ROW_ID = "verify:lifecycle";

  // 4a. INSERT active
  const inserted = (await sql<{ id: string; status: string }[]>`
    INSERT INTO quote_warnings
      (quote_id, scope, table_name, row_id, kind, severity, status, message, detail_json)
    VALUES
      (${quoteId}, 'line', 'verify', ${TEST_ROW_ID}, ${TEST_KIND}, 'info', 'active',
       'Verification round-trip row', '{"verify": true}'::jsonb)
    RETURNING id, status
  `) as unknown as { id: string; status: string }[];
  const insertedId = inserted[0].id;
  check(
    "INSERT active row",
    inserted[0].status === "active" && insertedId.length > 0,
    `id=${insertedId} status=${inserted[0].status}`,
  );

  // 4b. UPDATE to accepted
  await sql`
    UPDATE quote_warnings
    SET status = 'accepted',
        accepted_at = now(),
        accept_reason_kind = 'custom',
        accept_reason_text = 'verify-lifecycle-round-trip'
    WHERE id = ${insertedId}
  `;
  const accepted = (await sql<{ status: string; accept_reason_kind: string }[]>`
    SELECT status, accept_reason_kind FROM quote_warnings WHERE id = ${insertedId}
  `) as unknown as { status: string; accept_reason_kind: string }[];
  check(
    "UPDATE → accepted",
    accepted[0].status === "accepted" && accepted[0].accept_reason_kind === "custom",
    `status=${accepted[0].status} reason_kind=${accepted[0].accept_reason_kind}`,
  );

  // 4c. UPDATE to auto_resolved (simulating engine auto-resolve)
  await sql`
    UPDATE quote_warnings
    SET status = 'auto_resolved',
        auto_resolved_at = now()
    WHERE id = ${insertedId}
  `;
  const resolved = (await sql<{ status: string; auto_resolved_at: string }[]>`
    SELECT status, auto_resolved_at::text FROM quote_warnings WHERE id = ${insertedId}
  `) as unknown as { status: string; auto_resolved_at: string }[];
  check(
    "UPDATE → auto_resolved",
    resolved[0].status === "auto_resolved" && resolved[0].auto_resolved_at !== null,
    `status=${resolved[0].status} auto_resolved_at=${resolved[0].auto_resolved_at}`,
  );

  // 4d. Cleanup — DELETE the test row
  const deleted = (await sql<{ id: string }[]>`
    DELETE FROM quote_warnings WHERE id = ${insertedId} RETURNING id
  `) as unknown as { id: string }[];
  check("DELETE test row", deleted.length === 1, `${deleted.length} row deleted`);

  // 4e. Confirm cascade — INSERT another, delete the quote (would
  // cascade via FK), verify gone. We skip the destructive cascade
  // test (would delete a real quote); just confirm the FK constraint
  // exists and the cascade rule is in place.
  console.log("  NOTE  cascade-on-quote-delete confirmed via FK rule (step 3)");
}

// ---------- summary ----------

console.log(
  `\n${failures === 0 ? "✓ ALL CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED`}`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
