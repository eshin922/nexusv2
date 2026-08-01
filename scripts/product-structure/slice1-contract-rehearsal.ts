import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { runReconciliation } from "./slice1-preflight.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is required");
const databaseName = new URL(url).pathname.slice(1);
if (!databaseName.includes("compatibility_test")) {
  throw new Error("Contract rehearsal refused: database name lacks compatibility_test");
}

const sql = postgres(url, { max: 1, prepare: false });
const migration = await readFile(
  new URL("../../drizzle/0050_product_structure_slice1_contract.sql", import.meta.url),
  "utf8",
);
const rollback = await readFile(
  new URL("./slice1-contract-rollback.sql", import.meta.url),
  "utf8",
);

const protectedTables = [
  "assembly_leaves",
  "quote_leaves",
  "assembly_leaf_inputs",
  "assembly_leaf_overrides",
  "assembly_leaf_targets",
  "quote_snapshots",
  "netsuite_so_pushes",
] as const;

async function hashes(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of protectedTables) {
    const [row] = await sql.unsafe<Array<{ digest: string }>>(
      `SELECT md5(coalesce(string_agg(row_json, '' ORDER BY row_json), '')) AS digest
       FROM (SELECT to_jsonb(t)::text AS row_json FROM ${table} t) rows`,
    );
    result[table] = row.digest;
  }
  return result;
}

async function nullable(): Promise<boolean> {
  const [row] = await sql<Array<{ is_nullable: "YES" | "NO" }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assembly_leaves'
      AND column_name = 'quote_leaf_id'
  `;
  assert.ok(row, "quote_leaf_id column missing");
  return row.is_nullable === "YES";
}

async function apply(sqlText: string): Promise<number> {
  const started = performance.now();
  await sql.unsafe(sqlText);
  return performance.now() - started;
}

try {
  const beforeHashes = await hashes();
  const beforeReconciliation = await runReconciliation(sql);
  assert.equal(beforeReconciliation.pass, true);

  const firstApplyMs = await apply(migration);
  assert.equal(await nullable(), false);
  assert.deepEqual(await hashes(), beforeHashes);

  const rollbackMs = await apply(rollback);
  assert.equal(await nullable(), true);
  assert.deepEqual(await hashes(), beforeHashes);

  const [candidate] = await sql<Array<{ id: string; quote_leaf_id: string }>>`
    SELECT id, quote_leaf_id
    FROM assembly_leaves
    WHERE quote_leaf_id IS NOT NULL
    ORDER BY id
    LIMIT 1
  `;
  assert.ok(candidate, "representative copy requires one mapped membership");

  await sql.begin(async (tx) => {
    await tx`SET LOCAL nexus.product_structure_write_bypass = 'migration-0049'`;
    await tx`UPDATE assembly_leaves SET quote_leaf_id = NULL WHERE id = ${candidate.id}`;
  });

  let nullAbortMessage = "";
  try {
    await apply(migration);
    assert.fail("Contract migration unexpectedly accepted a null mapping");
  } catch (error) {
    nullAbortMessage = error instanceof Error ? error.message : String(error);
    await sql.unsafe("ROLLBACK");
  }
  assert.match(nullAbortMessage, /legacy_missing_mapping=1/);
  assert.equal(await nullable(), true);

  await sql.begin(async (tx) => {
    await tx`SET LOCAL nexus.product_structure_write_bypass = 'migration-0049'`;
    await tx`UPDATE assembly_leaves SET quote_leaf_id = ${candidate.quote_leaf_id} WHERE id = ${candidate.id}`;
  });
  assert.deepEqual(await hashes(), beforeHashes);

  const forwardReapplyMs = await apply(migration);
  assert.equal(await nullable(), false);
  assert.deepEqual(await hashes(), beforeHashes);

  const afterReconciliation = await runReconciliation(sql);
  assert.equal(afterReconciliation.pass, true);

  process.stdout.write(`${JSON.stringify({
    pass: true,
    firstApplyMs: Number(firstApplyMs.toFixed(3)),
    rollbackMs: Number(rollbackMs.toFixed(3)),
    forwardReapplyMs: Number(forwardReapplyMs.toFixed(3)),
    nullMappingAbort: true,
    dataHashesUnchanged: true,
    invariants: afterReconciliation.invariants,
    externalCalls: 0,
  }, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
