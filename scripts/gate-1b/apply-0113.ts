/** Applies drizzle/0113 and proves the resulting database state.
 *
 *  Additive; `drizzle-kit migrate` is never invoked, so nothing else can reach
 *  the database on this run.
 *
 *  NO SQL SPLITTER. The first version split the file on ";" and sent a fragment
 *  of a sentence to Postgres, because the rationale comments contain semicolons.
 *  It failed loudly and applied nothing — but a parser that can emit half a
 *  comment as SQL has no business running against a shared database. The
 *  statements are written out here and the .sql file is asserted to contain
 *  them, so what executes and what is committed cannot drift.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readFileSync } from "node:fs";

const rows = <T,>(r: unknown) => r as unknown as T[];
const TABLE = "quote_snapshot_recovery_instructions";
const COL = "owner_kind";
const NL = String.fromCharCode(10);

const CREATE_TYPE =
  `CREATE TYPE "recovery_owner_kind" AS ENUM ('assembly', 'component', 'direct_service')`;
const ADD_COLUMN =
  `ALTER TABLE "quote_snapshot_recovery_instructions"` +
  NL +
  `  ADD COLUMN IF NOT EXISTS "owner_kind" "recovery_owner_kind"`;

const body = readFileSync("drizzle/0113_od_028_frozen_owner_kind.sql", "utf8");
for (const st of [CREATE_TYPE, ADD_COLUMN]) {
  if (!body.includes(st)) {
    console.log(`REFUSING — the .sql file does not contain: ${st.slice(0, 60)}...`);
    process.exit(1);
  }
}

const before = rows<{ n: string }>(await db.execute(sql`
  select count(*)::text n from information_schema.columns
   where table_schema='public' and table_name=${TABLE} and column_name=${COL}`));
const rowsBefore = rows<{ n: string }>(
  await db.execute(sql.raw(`select count(*)::text n from "${TABLE}"`)),
);
const censusBefore = rows<{ k: string }>(await db.execute(sql`
  select table_name||'.'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') k
    from information_schema.columns where table_schema='public' order by 1`));

console.log(`BEFORE  ${COL} present : ${before[0].n}`);
console.log(`BEFORE  rows          : ${rowsBefore[0].n}`);
console.log(`BEFORE  public columns: ${censusBefore.length}`);
if (before[0].n !== "0") {
  console.log("REFUSING — column already exists; this run would prove nothing.");
  process.exit(1);
}

console.log(NL + "APPLYING 2 statement(s), both asserted present in the .sql file");
await db.execute(sql.raw(CREATE_TYPE));
await db.execute(sql.raw(ADD_COLUMN));
await db.execute(
  sql.raw(
    `COMMENT ON COLUMN "quote_snapshot_recovery_instructions"."owner_kind" IS ` +
      `'Which identity space owner_ref is in. NULL = frozen before the contract (OD-028); never inferred, never backfilled. Required for every post-cutover write.'`,
  ),
);

const after = rows<{ d: string; udt: string; nn: string; def: string | null }>(await db.execute(sql`
  select data_type d, udt_name udt, is_nullable nn, column_default def
    from information_schema.columns
   where table_schema='public' and table_name=${TABLE} and column_name=${COL}`));
const labels = rows<{ l: string }>(await db.execute(sql`
  select e.enumlabel l from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'recovery_owner_kind' order by e.enumsortorder`));
const vals = rows<{ total: string; nulls: string; nonnull: string }>(
  await db.execute(
    sql.raw(
      `select count(*)::text total, count(*) filter (where "${COL}" is null)::text nulls,
              count("${COL}")::text nonnull from "${TABLE}"`,
    ),
  ),
);

console.log(NL + `AFTER   data_type      : ${after[0]?.d} (${after[0]?.udt})`);
console.log(`AFTER   is_nullable    : ${after[0]?.nn}   (YES = historical rows read NULL)`);
console.log(`AFTER   column_default : ${after[0]?.def ?? "(none)"}`);
console.log(`AFTER   enum labels    : ${labels.map((l) => l.l).join(", ")}`);
console.log(`AFTER   rows           : ${vals[0].total}  NULL=${vals[0].nulls}  non-null=${vals[0].nonnull}`);

const censusAfter = rows<{ k: string }>(await db.execute(sql`
  select table_name||'.'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') k
    from information_schema.columns where table_schema='public' order by 1`));
const b = new Set(censusBefore.map((x) => x.k));
const a = new Set(censusAfter.map((x) => x.k));
const added = [...a].filter((x) => !b.has(x));
const removed = [...b].filter((x) => !a.has(x));
console.log(NL + `SCHEMA DELTA  added=${added.length} removed/changed=${removed.length}`);
for (const x of added) console.log(`  +  ${x}`);
for (const x of removed) console.log(`  -  ${x}`);

const ok =
  after.length === 1 &&
  after[0].udt === "recovery_owner_kind" &&
  after[0].nn === "YES" &&
  after[0].def === null &&
  labels.map((l) => l.l).join(",") === "assembly,component,direct_service" &&
  vals[0].total === rowsBefore[0].n &&
  vals[0].nulls === rowsBefore[0].n &&
  vals[0].nonnull === "0" &&
  added.length === 1 &&
  removed.length === 0;
console.log(NL + (ok ? "PASS — 0113 applied; historical rows untouched and NULL" : "FAIL"));
process.exit(ok ? 0 : 1);
