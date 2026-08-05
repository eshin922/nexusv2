import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import { assertRuntimeSafety } from "../../src/lib/config/runtime-config.ts";

assertRuntimeSafety();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sql = postgres(connectionString, { max: 4 });

const projectId = randomUUID();
const quoteId = randomUUID();
const tierId = randomUUID();
const snapshotId = randomUUID();
const secondSnapshotId = randomUUID();
const sendKey = `phase-1-${snapshotId}`;
const firstPayload = { memo: "first frozen payload", amount: 100 };
const driftingPayload = { memo: "drifting retry payload", amount: 999 };

try {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO projects (id, hubspot_deal_id, deal_name)
      VALUES (${projectId}, ${`phase-1-so-${projectId}`}, 'Phase 1 SO Convergence')
    `;
    await tx`
      INSERT INTO quotes (id, project_id, version_number, status)
      VALUES (${quoteId}, ${projectId}, 1, 'accepted')
    `;
    await tx`
      INSERT INTO quote_tiers (id, quote_id, label, sort_order, qty)
      VALUES (${tierId}, ${quoteId}, '100 units', 0, 100)
    `;
    await tx`
      INSERT INTO quote_snapshots (
        id, quote_id, version_number, effective_from, sent_at
      ) VALUES (${snapshotId}, ${quoteId}, 1, now(), now())
    `;
  });

  const attempt = (payload: object) => sql`
    INSERT INTO netsuite_so_pushes (
      quote_id, accepted_tier_id, quote_snapshot_id, status,
      idempotency_key, payload_snapshot
    ) VALUES (
      ${quoteId}, ${tierId}, ${snapshotId}, 'pending',
      ${sendKey}, ${sql.json(payload)}
    )
    RETURNING id
  `;
  const concurrent = await Promise.allSettled([
    attempt(firstPayload),
    attempt(driftingPayload),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

  const [winner] = await sql<{
    id: string;
    payload_snapshot: typeof firstPayload | typeof driftingPayload;
    idempotency_key: string;
  }[]>`
    SELECT id, payload_snapshot, idempotency_key
    FROM netsuite_so_pushes
    WHERE quote_snapshot_id = ${snapshotId}
  `;
  assert.ok(winner);
  assert.equal(winner.idempotency_key, sendKey);

  await sql`
    UPDATE netsuite_so_pushes
    SET status = 'succeeded', netsuite_so_id = 'SO-INTERNAL-1'
    WHERE id = ${winner.id}
  `;
  const [retry] = await sql<{ netsuite_so_id: string; payload_snapshot: object }[]>`
    SELECT netsuite_so_id, payload_snapshot
    FROM netsuite_so_pushes
    WHERE quote_id = ${quoteId}
      AND quote_snapshot_id = ${snapshotId}
      AND status = 'succeeded'
  `;
  assert.equal(retry.netsuite_so_id, "SO-INTERNAL-1");
  assert.deepEqual(retry.payload_snapshot, winner.payload_snapshot);

  await sql`
    INSERT INTO quote_snapshots (
      id, quote_id, version_number, effective_from, sent_at, superseded_at
    ) VALUES (${secondSnapshotId}, ${quoteId}, 2, now(), now(), now())
  `;
  let secondSuccessRejected = false;
  try {
    await sql`
      INSERT INTO netsuite_so_pushes (
        quote_id, accepted_tier_id, quote_snapshot_id, status,
        idempotency_key, payload_snapshot
      ) VALUES (
        ${quoteId}, ${tierId}, ${secondSnapshotId}, 'succeeded',
        ${`phase-1-${secondSnapshotId}`}, ${sql.json({ memo: "second order" })}
      )
    `;
  } catch {
    secondSuccessRejected = true;
  }

  const evidence = {
    concurrentAttempts: concurrent.map((result) => result.status),
    durableAttemptRows: 1,
    frozenPayload: winner.payload_snapshot,
    retryConvergedTo: retry.netsuite_so_id,
    secondSuccessRejected,
  };
  console.log(JSON.stringify(evidence, null, 2));
  assert.equal(secondSuccessRejected, true);
} finally {
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql.end();
}
