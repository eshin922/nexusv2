// Verifies the single-current invariant on firm_settings.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/firm-settings-invariant.ts
//
// When to run:
//   - After any change to updateFirmSettings or its transaction shape.
//   - After any firm_settings schema migration.
//   - When debugging a "wrong margin status threshold" report — if
//     more than one row has effective_until IS NULL, the costing
//     module's "current row" lookup is non-deterministic and every
//     downstream margin check is suspect.
//
// Inlines the postgres client (rather than importing from src/db) to
// avoid Node's ESM-with-explicit-extension requirement on transitive
// imports.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 2 });

type Row = {
  id: string;
  target_margin_pct: string;
  floor_margin_pct: string;
  effective_from: string;
  effective_until: string | null;
};

// Tie-break by updated_at DESC: when an admin makes multiple changes
// in a single day, all rows share effective_from. Without the
// tiebreak, the current row's position in the result is
// non-deterministic — and downstream "current row first" checks
// false-fail. updated_at is monotonic on insert (defaultNow()).
const rows = (await sql<Row[]>`
  SELECT id, target_margin_pct, floor_margin_pct,
         effective_from::text, effective_until::text
  FROM firm_settings
  ORDER BY effective_from DESC, updated_at DESC
`) as unknown as Row[];

console.log(`\n=== firm_settings rows (${rows.length} total) ===`);
for (const r of rows) {
  console.log(
    `  ${r.effective_from} → ${r.effective_until ?? "(current)"}  target=${r.target_margin_pct}  floor=${r.floor_margin_pct}  id=${r.id.slice(0, 8)}`,
  );
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

console.log("\n=== Invariant checks ===");

const currents = rows.filter((r) => r.effective_until === null);
check(
  "exactly one row with effective_until IS NULL",
  currents.length === 1,
  `found ${currents.length}`,
);

if (currents.length === 1 && rows.length > 0) {
  check(
    "current row sorted first (newest effective_from)",
    rows[0].id === currents[0].id,
    "current row not first in DESC order — possible date inversion",
  );
}

// No gap/overlap: prior row's effective_until = newer row's effective_from
for (let i = 0; i < rows.length - 1; i += 1) {
  const newer = rows[i];
  const older = rows[i + 1];
  check(
    `boundary between ${older.effective_from}/${older.effective_until} and ${newer.effective_from}/${newer.effective_until}`,
    older.effective_until === newer.effective_from,
    `older.effective_until="${older.effective_until}" should equal newer.effective_from="${newer.effective_from}"`,
  );
}

console.log(
  `\n${failures === 0 ? "✓ ALL INVARIANT CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED`}\n`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
