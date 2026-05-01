// Slice 8 — seed the first firm_settings row.
//
// Run via:
//   node --env-file=.env.local scripts/seed-firm-settings.mjs
//
// Idempotent: if a row already exists with effective_until IS NULL,
// no-op. Otherwise inserts target=0.35, floor=0.25, effective_from=today,
// effective_until=NULL, updated_by_user_id=NULL.
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  const existing = await sql`
    SELECT id, target_margin_pct, floor_margin_pct, effective_from
    FROM firm_settings
    WHERE effective_until IS NULL
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(
      `[seed-firm-settings] Already seeded — current row: target=${existing[0].target_margin_pct}, floor=${existing[0].floor_margin_pct}, effective_from=${existing[0].effective_from}. No-op.`,
    );
  } else {
    const [inserted] = await sql`
      INSERT INTO firm_settings (target_margin_pct, floor_margin_pct)
      VALUES ('0.3500', '0.2500')
      RETURNING id, target_margin_pct, floor_margin_pct, effective_from, effective_until, updated_by_user_id
    `;
    console.log("[seed-firm-settings] Seeded:", inserted);
  }
} finally {
  await sql.end();
}
