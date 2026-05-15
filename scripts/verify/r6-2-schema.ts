// R6.2 commit 1 verification — confirms migration 0026 landed the
// four new tables + three new enums against the shared Supabase DB.
// Run: node --env-file=.env.local --experimental-strip-types scripts/verify/r6-2-schema.ts

import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const expectedTables = [
  "freight_leg_groups",
  "freight_legs",
  "freight_leg_tiers",
  "freight_customer_arranges_meta",
];

const expectedEnums: Record<string, string[]> = {
  freight_direction: ["inbound", "outbound"],
  freight_incoterm: ["DDP", "DAP", "FOB", "EXW", "FCA", "CIF"],
  freight_leg_mode: [
    "parcel",
    "ocean_fcl",
    "ocean_lcl",
    "air_freight",
    "air_express",
    "ltl_truck",
    "truckload",
    "drayage",
    "exw_pickup",
    "other",
  ],
};

let failures = 0;

for (const table of expectedTables) {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `;
  const present = rows[0]?.exists ?? false;
  console.log(`${present ? "✓" : "✗"} table ${table}`);
  if (!present) failures++;
}

for (const [enumName, expectedValues] of Object.entries(expectedEnums)) {
  const rows = await sql<{ enumlabel: string; enumsortorder: number }[]>`
    SELECT enumlabel, enumsortorder
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = ${enumName}
    ORDER BY enumsortorder
  `;
  const actualValues = rows.map((r) => r.enumlabel);
  const matches =
    actualValues.length === expectedValues.length &&
    actualValues.every((v, i) => v === expectedValues[i]);
  console.log(
    `${matches ? "✓" : "✗"} enum ${enumName} [${actualValues.join(", ")}]`,
  );
  if (!matches) {
    console.log(`  expected: [${expectedValues.join(", ")}]`);
    failures++;
  }
}

// Commit 3 retirement check — legacy `freight_inputs` table + legacy
// `freight_mode` enum should NO LONGER exist. Migration 0027 dropped
// both; the publication-drop manual SQL (drizzle/manual/0003_*) ran
// against the shared DB first. This commit-1 script was originally
// written to assert "additive co-existence preserved post-commit-1";
// it now asserts the closure-out post-commit-3 by flipping the
// expected sense on these two checks.
const legacyTable = await sql<{ exists: boolean }[]>`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'freight_inputs'
  ) AS exists
`;
console.log(
  `${!legacyTable[0]?.exists ? "✓" : "✗"} legacy freight_inputs retired (commit 3 dropped)`,
);
if (legacyTable[0]?.exists) failures++;

const legacyEnum = await sql<{ enumlabel: string }[]>`
  SELECT enumlabel FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'freight_mode'
  ORDER BY enumsortorder
`;
const legacyEnumValues = legacyEnum.map((r) => r.enumlabel);
console.log(
  `${legacyEnumValues.length === 0 ? "✓" : "✗"} legacy freight_mode enum retired (commit 3 dropped)`,
);
if (legacyEnumValues.length !== 0) failures++;

await sql.end();

console.log(
  `\n${failures === 0 ? "✓ ALL CHECKS PASS — commit 1 schema verified" : `✗ ${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
