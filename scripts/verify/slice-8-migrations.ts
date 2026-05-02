// One-off: confirms Slice 8 migrations 0011, 0012, 0013 are applied.
// Run against whichever DATABASE_URL points at the environment you
// want to check (typically prod, when diagnosing a post-deploy crash).
//
// Usage:
//   DATABASE_URL=<prod-connection-string> \
//     node --experimental-strip-types scripts/verify/slice-8-migrations.ts
//
// Or via .env.local pointing at prod (don't forget to revert):
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/verify/slice-8-migrations.ts
//
// Reports PASS / FAIL per migration. Exits non-zero if any are missing.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

// Sanity print: which DB are we hitting? Show just the host.
const hostMatch = url.match(/@([^/?]+)/);
console.log(`Checking: ${hostMatch?.[1] ?? "(unknown host)"}\n`);

const sql = postgres(url, { prepare: false, max: 2 });

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

// --- 0011: firm_settings table exists ---
console.log("=== Migration 0011: firm_settings table ===");
const firmTable = await sql<{ regclass: string | null }[]>`
  SELECT to_regclass('public.firm_settings')::text AS regclass
`;
check(
  "firm_settings table exists",
  firmTable[0]?.regclass === "firm_settings",
  `to_regclass returned ${firmTable[0]?.regclass ?? "null"}`,
);

if (firmTable[0]?.regclass === "firm_settings") {
  const seedCount = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n FROM firm_settings WHERE effective_until IS NULL
  `;
  check(
    "firm_settings has exactly one current row (seeded)",
    seedCount[0]?.n === "1",
    `found ${seedCount[0]?.n ?? "?"} current rows — run scripts/seed-firm-settings.mjs if 0`,
  );
}

// --- 0012: freight_inputs.sku_total_cbm exists; quote_skus.cbm_per_unit dropped ---
console.log("\n=== Migration 0012: CBM schema correction ===");
const cbmCol = await sql<{ column_name: string }[]>`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'freight_inputs' AND column_name = 'sku_total_cbm'
`;
check(
  "freight_inputs.sku_total_cbm column exists",
  cbmCol.length === 1,
  `found ${cbmCol.length} matching columns`,
);

const oldCbmCol = await sql<{ column_name: string }[]>`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'quote_skus' AND column_name = 'cbm_per_unit'
`;
check(
  "quote_skus.cbm_per_unit column was dropped",
  oldCbmCol.length === 0,
  `still present (migration 0012 dropped it; presence means migration didn't run)`,
);

// --- 0013: audit_log.entity_id is text, not uuid ---
console.log("\n=== Migration 0013: audit_log.entity_id text ===");
const entityIdType = await sql<{ data_type: string }[]>`
  SELECT data_type FROM information_schema.columns
  WHERE table_name = 'audit_log' AND column_name = 'entity_id'
`;
check(
  "audit_log.entity_id is text",
  entityIdType[0]?.data_type === "text",
  `data_type is ${entityIdType[0]?.data_type ?? "(missing)"} — should be text`,
);

// --- markup_defaults seeded? (separate from migration; data check) ---
console.log("\n=== Seed check: markup_defaults rows ===");
const markupCount = await sql<{ n: string }[]>`
  SELECT COUNT(*)::text AS n FROM markup_defaults
`;
check(
  "markup_defaults has at least one row",
  Number(markupCount[0]?.n ?? "0") >= 1,
  `found ${markupCount[0]?.n ?? "0"} rows — admin /admin/markup-defaults will be empty if 0`,
);

// --- Diagnostic: when did the latest migrations land? ---
// Tells us whether 0011/0012/0013 hit this DB in a single batch (one
// accidental `drizzle-kit migrate` against prod URL) or arrived
// staggered over time (something more systematic, like a build hook
// or staged manual application). Informs the migration-deploy-hygiene
// fix in the v1.5+ backlog.
console.log("\n=== drizzle.__drizzle_migrations (latest 5) ===");
try {
  const migrationLog = await sql<{
    hash: string;
    created_at: string;
  }[]>`
    SELECT hash, created_at::text
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC
    LIMIT 5
  `;
  for (const m of migrationLog) {
    console.log(`  ${m.created_at}  ${m.hash}`);
  }
  if (migrationLog.length === 0) {
    console.log("  (no rows — drizzle.__drizzle_migrations is empty?)");
  }
} catch (err) {
  console.log(
    `  (query failed: ${err instanceof Error ? err.message : String(err)})`,
  );
}

console.log(
  `\n${failures === 0 ? "✓ ALL CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED — apply missing migration(s) via npx drizzle-kit migrate against this DATABASE_URL`}\n`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
