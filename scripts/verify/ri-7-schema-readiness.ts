// Slice RI.7 — schema readiness verifier.
//
// Confirms:
//   - all 22 new columns are present (firm_settings 9, users 1, quotes 12)
//   - 2 new FKs land on quotes
//   - quote_number partial unique index exists
//   - quote_number_seq sequence exists with start=1000
//   - DPS seed values landed on the active firm_settings row (per
//     ri7-brief-amendment §5.1, §5.3-§5.7; tcs_default expected NULL
//     pending hold-gate text)
//
// Run: npm run verify:ri-7-readiness
// (also useful: `node --env-file=.env.local --experimental-strip-types
//  scripts/verify/ri-7-schema-readiness.ts`)

// Run via `node --env-file=.env.local --experimental-strip-types scripts/verify/ri-7-schema-readiness.ts`
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

type ColumnRow = { table_name: string; column_name: string; data_type: string };
type IndexRow = { indexname: string; indexdef: string };
type FkRow = { conname: string };
type SeqRow = { sequencename: string; start_value: string; increment_by: string };
type FirmSettingsRow = {
  vendor_name: string | null;
  vendor_tagline: string | null;
  vendor_address: string | null;
  quote_number_prefix: string | null;
  tcs_default: string | null;
  payment_terms_default: string | null;
  lead_time_default: string | null;
  incoterms_default: string | null;
  days_valid_default: number | null;
};

const EXPECTED_COLUMNS: Record<string, string[]> = {
  firm_settings: [
    "vendor_name",
    "vendor_tagline",
    "vendor_address",
    "quote_number_prefix",
    "tcs_default",
    "payment_terms_default",
    "lead_time_default",
    "incoterms_default",
    "days_valid_default",
  ],
  users: ["phone"],
  quotes: [
    "customer_accepted_at",
    "customer_accepted_tier_id",
    "customer_accepted_recorded_by_user_id",
    "quote_number",
    "payment_terms_snapshot",
    "lead_time_snapshot",
    "incoterms_snapshot",
    "tcs_snapshot",
    "days_valid_snapshot",
    "prepared_by_name_snapshot",
    "prepared_by_email_snapshot",
    "prepared_by_phone_snapshot",
  ],
};

const EXPECTED_FKS = [
  "quotes_customer_accepted_tier_id_quote_tiers_id_fk",
  "quotes_customer_accepted_recorded_by_user_id_users_id_fk",
];

let failures = 0;

async function check<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const result = await fn();
    console.log(`  ✓ ${label}`);
    return result;
  } catch (err) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failures++;
    return null;
  }
}

async function main() {
  console.log("RI.7 schema readiness check\n");

  console.log("Columns:");
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    for (const col of columns) {
      await check(`${table}.${col}`, async () => {
        const rows = (await sql`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${table}
            AND column_name = ${col}
        `) as unknown as ColumnRow[];
        if (rows.length === 0) throw new Error("column missing");
      });
    }
  }

  console.log("\nForeign keys:");
  for (const conname of EXPECTED_FKS) {
    await check(conname, async () => {
      const rows = (await sql`
        SELECT conname FROM pg_constraint WHERE conname = ${conname}
      `) as unknown as FkRow[];
      if (rows.length === 0) throw new Error("FK missing");
    });
  }

  console.log("\nIndexes:");
  await check("quotes_quote_number_idx (partial unique)", async () => {
    const rows = (await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'quotes_quote_number_idx'
    `) as unknown as IndexRow[];
    if (rows.length === 0) throw new Error("index missing");
    const def = rows[0].indexdef.toLowerCase();
    if (!def.includes("unique")) throw new Error("not unique");
    if (!def.includes("where")) throw new Error("not partial");
  });

  console.log("\nSequence:");
  await check("quote_number_seq START 1000", async () => {
    const rows = (await sql`
      SELECT sequencename, start_value::text, increment_by::text
      FROM pg_sequences
      WHERE schemaname = 'public' AND sequencename = 'quote_number_seq'
    `) as unknown as SeqRow[];
    if (rows.length === 0) throw new Error("sequence missing");
    if (rows[0].start_value !== "1000") throw new Error(`start != 1000 (got ${rows[0].start_value})`);
    if (rows[0].increment_by !== "1") throw new Error(`increment != 1 (got ${rows[0].increment_by})`);
  });

  console.log("\nSeed values on active firm_settings row:");
  const firmRows = (await sql`
    SELECT vendor_name, vendor_tagline, vendor_address, quote_number_prefix,
           tcs_default, payment_terms_default, lead_time_default,
           incoterms_default, days_valid_default
    FROM firm_settings
    WHERE effective_until IS NULL
  `) as unknown as FirmSettingsRow[];
  if (firmRows.length === 0) {
    console.log("  ✗ no active firm_settings row");
    failures++;
  } else {
    const row = firmRows[0];
    const expected: Array<[keyof FirmSettingsRow, string | number | null]> = [
      ["vendor_name", "The DPS"],
      [
        "vendor_tagline",
        "Turnkey product development & manufacturing for beauty, health & wellness brands",
      ],
      ["vendor_address", "3943 Irvine Blvd, #1129 Irvine, CA 92602"],
      ["quote_number_prefix", "DPS"],
      ["payment_terms_default", "50% deposit, 50% on shipment"],
      ["lead_time_default", "8–12 weeks from confirmed PO"],
      ["incoterms_default", "FOB Long Beach"],
      ["days_valid_default", 30],
      ["tcs_default", null], // expected NULL — hold gate
    ];
    for (const [col, want] of expected) {
      const got = row[col];
      const label =
        col === "tcs_default"
          ? `${col} = NULL (hold gate)`
          : `${col} = ${JSON.stringify(want)}`;
      if (got === want) {
        console.log(`  ✓ ${label}`);
      } else {
        console.log(`  ✗ ${label} — got ${JSON.stringify(got)}`);
        failures++;
      }
    }
  }

  await sql.end();

  console.log();
  if (failures > 0) {
    console.log(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  } else {
    console.log("OK — RI.7 schema ready");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
