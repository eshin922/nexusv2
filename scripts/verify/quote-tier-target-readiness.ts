// Slice 9.4c verification — verifies quote_tiers.client_target_price_total
// column shape after migration 0018 + lifecycle round-trip on a real tier.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/quote-tier-target-readiness.ts
//
// When to run:
//   - After applying migration 0018 to confirm column landed correctly
//   - After any quote_tiers shape change touching the new column
//
// Verifies:
//   1. Column exists on quote_tiers with expected type (numeric, nullable)
//   2. Lifecycle round-trip on a real tier: NULL → set value → update → clear
//   3. Cleanup: any value set during the test is cleared before exit
//
// Idempotent; safe to run repeatedly.

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

// ---------- 1. column shape ----------

console.log("=== 1. quote_tiers.client_target_price_total column ===");

const columns = (await sql<
  {
    column_name: string;
    data_type: string;
    numeric_precision: number | null;
    numeric_scale: number | null;
    is_nullable: string;
  }[]
>`
  SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'quote_tiers'
    AND column_name = 'client_target_price_total'
`) as unknown as {
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
}[];

check(
  "column exists",
  columns.length === 1,
  `${columns.length} match`,
);

if (columns.length === 1) {
  const col = columns[0];
  check(
    "data_type = numeric",
    col.data_type === "numeric",
    `is ${col.data_type}`,
  );
  check(
    "precision = 12",
    col.numeric_precision === 12,
    `is ${col.numeric_precision}`,
  );
  check(
    "scale = 4",
    col.numeric_scale === 4,
    `is ${col.numeric_scale}`,
  );
  check(
    "nullable = YES",
    col.is_nullable === "YES",
    `is ${col.is_nullable}`,
  );
}

// ---------- 2. lifecycle round-trip ----------

console.log("\n=== 2. lifecycle round-trip on a real tier ===");

const tierRow = (await sql<{ id: string }[]>`
  SELECT id FROM quote_tiers ORDER BY created_at DESC LIMIT 1
`) as unknown as { id: string }[];

if (tierRow.length === 0) {
  console.log("  SKIP  no quote_tiers in DB; lifecycle round-trip skipped");
} else {
  const tierId = tierRow[0].id;

  // Snapshot the existing value so we can restore on cleanup.
  const before = (await sql<{ value: string | null }[]>`
    SELECT client_target_price_total::text AS value FROM quote_tiers WHERE id = ${tierId}
  `) as unknown as { value: string | null }[];
  const originalValue = before[0]?.value ?? null;

  try {
    // Set to a known value
    await sql`
      UPDATE quote_tiers
      SET client_target_price_total = 12345.6789
      WHERE id = ${tierId}
    `;
    const afterSet = (await sql<{ value: string | null }[]>`
      SELECT client_target_price_total::text AS value FROM quote_tiers WHERE id = ${tierId}
    `) as unknown as { value: string | null }[];
    check(
      "UPDATE → set value (12345.6789)",
      afterSet[0]?.value === "12345.6789",
      `stored as ${afterSet[0]?.value}`,
    );

    // Update to a different value
    await sql`
      UPDATE quote_tiers
      SET client_target_price_total = 200000.0000
      WHERE id = ${tierId}
    `;
    const afterUpdate = (await sql<{ value: string | null }[]>`
      SELECT client_target_price_total::text AS value FROM quote_tiers WHERE id = ${tierId}
    `) as unknown as { value: string | null }[];
    check(
      "UPDATE → change value (200000.0000)",
      afterUpdate[0]?.value === "200000.0000",
      `stored as ${afterUpdate[0]?.value}`,
    );

    // Clear back to NULL
    await sql`
      UPDATE quote_tiers
      SET client_target_price_total = NULL
      WHERE id = ${tierId}
    `;
    const afterClear = (await sql<{ value: string | null }[]>`
      SELECT client_target_price_total::text AS value FROM quote_tiers WHERE id = ${tierId}
    `) as unknown as { value: string | null }[];
    check(
      "UPDATE → NULL (clear)",
      afterClear[0]?.value === null,
      `stored as ${afterClear[0]?.value}`,
    );

    // Test wide-precision support — 12 digits, 4 decimal places
    // (six-figure totals are common; brief §2 schema rationale).
    await sql`
      UPDATE quote_tiers
      SET client_target_price_total = 99999999.9999
      WHERE id = ${tierId}
    `;
    const afterWide = (await sql<{ value: string | null }[]>`
      SELECT client_target_price_total::text AS value FROM quote_tiers WHERE id = ${tierId}
    `) as unknown as { value: string | null }[];
    check(
      "wide precision (8 integer digits + 4 decimal)",
      afterWide[0]?.value === "99999999.9999",
      `stored as ${afterWide[0]?.value}`,
    );
  } finally {
    // Restore original value (clean state for subsequent runs)
    if (originalValue === null) {
      await sql`
        UPDATE quote_tiers
        SET client_target_price_total = NULL
        WHERE id = ${tierId}
      `;
    } else {
      await sql`
        UPDATE quote_tiers
        SET client_target_price_total = ${originalValue}::numeric(12,4)
        WHERE id = ${tierId}
      `;
    }
    console.log(
      `  Cleanup: restored client_target_price_total to ${originalValue ?? "NULL"} on tier ${tierId.slice(0, 8)}...`,
    );
  }
}

// ---------- summary ----------

console.log(
  `\n${failures === 0 ? "✓ ALL CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED`}`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
