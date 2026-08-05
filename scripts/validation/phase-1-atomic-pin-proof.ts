import postgres from "postgres";

import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

assertRuntimeSafety();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sql = postgres(connectionString, { max: 1 });

const projectId = "10000000-0000-4000-8000-000000000001";
const quoteId = "10000000-0000-4000-8000-000000000002";

try {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM projects WHERE id = ${projectId}`;
    await tx`
      INSERT INTO projects (id, hubspot_deal_id, deal_name)
      VALUES (${projectId}, 'phase-1-atomic-proof', 'Phase 1 Atomic Proof')
    `;
    await tx`
      INSERT INTO quotes (id, project_id, version_number, status)
      VALUES (${quoteId}, ${projectId}, 1, 'sent')
    `;
  });

  let injectedFailureObserved = false;
  try {
    await sql.begin(async (tx) => {
      const [snapshot] = await tx<{ id: string }[]>`
        INSERT INTO quote_snapshots (
          quote_id, version_number, effective_from, sent_at
        ) VALUES (${quoteId}, 1, now(), now())
        RETURNING id
      `;
      await tx`
        INSERT INTO quote_commercial_settings_pins (
          quote_id, quote_snapshot_id, target_margin_pct, floor_margin_pct
        ) VALUES (${quoteId}, ${snapshot.id}, 0.35, 0.25)
      `;
      throw new Error("INJECT_AFTER_PIN_HEADER");
    });
  } catch (error) {
    injectedFailureObserved =
      error instanceof Error && error.message === "INJECT_AFTER_PIN_HEADER";
  }

  const [afterFailure] = await sql<{
    snapshots: number;
    pins: number;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM quote_snapshots WHERE quote_id = ${quoteId}) AS snapshots,
      (SELECT count(*)::int FROM quote_commercial_settings_pins WHERE quote_id = ${quoteId}) AS pins
  `;

  let orphanPinRejected = false;
  try {
    await sql`
      INSERT INTO quote_commercial_settings_pins (
        quote_id, quote_snapshot_id, target_margin_pct, floor_margin_pct
      ) VALUES (
        ${quoteId}, '10000000-0000-4000-8000-000000000099', 0.35, 0.25
      )
    `;
  } catch {
    orphanPinRejected = true;
  }

  await sql.begin(async (tx) => {
    const [snapshot] = await tx<{ id: string }[]>`
      INSERT INTO quote_snapshots (
        quote_id, version_number, effective_from, sent_at
      ) VALUES (${quoteId}, 1, now(), now())
      RETURNING id
    `;
    await tx`
      INSERT INTO quote_commercial_settings_pins (
        quote_id, quote_snapshot_id, target_margin_pct, floor_margin_pct
      ) VALUES (${quoteId}, ${snapshot.id}, 0.35, 0.25)
    `;
  });

  const [success] = await sql<{
    snapshots: number;
    pins: number;
    linked: number;
  }[]>`
    SELECT
      count(DISTINCT snapshot.id)::int AS snapshots,
      count(DISTINCT pin.id)::int AS pins,
      count(*) FILTER (WHERE pin.quote_snapshot_id = snapshot.id)::int AS linked
    FROM quote_snapshots snapshot
    JOIN quote_commercial_settings_pins pin
      ON pin.quote_snapshot_id = snapshot.id
    WHERE snapshot.quote_id = ${quoteId}
  `;

  const evidence = {
    injectedFailureObserved,
    afterFailure,
    orphanPinRejected,
    success,
  };
  console.log(JSON.stringify(evidence, null, 2));
  if (
    !injectedFailureObserved ||
    afterFailure.snapshots !== 0 ||
    afterFailure.pins !== 0 ||
    !orphanPinRejected ||
    success.snapshots !== 1 ||
    success.pins !== 1 ||
    success.linked !== 1
  ) {
    throw new Error("Phase 1 atomic pin proof failed.");
  }
} finally {
  await sql.end();
}
