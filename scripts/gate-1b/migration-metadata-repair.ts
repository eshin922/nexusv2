/** Bounded metadata repair — records four ALREADY-APPLIED migrations.
 *
 *  Writes exactly four rows into `drizzle.__drizzle_migrations` and touches
 *  nothing else. No schema changes. No application data. No `drizzle-kit
 *  migrate`.
 *
 *  ── THE ORDER OF PROOF IS THE POINT ─────────────────────────────────────
 *
 *  Each row is inserted ONLY after this script independently re-proves that
 *  its migration's schema effect is present. The metadata records a fact
 *  established elsewhere; it must never become the evidence that the migration
 *  ran. If a proof fails, that row is REFUSED and the run reports it — a
 *  missing proof means the migration did not run, and inserting the row would
 *  then permanently hide it from the migrator.
 *
 *  That is the whole hazard being repaired, so it must not be recreated by the
 *  repair itself.
 *
 *  ── WHY NOT `drizzle-kit migrate` ───────────────────────────────────────
 *
 *  It would EXECUTE these four rather than record them, because it runs every
 *  journal entry above `max(created_at)`. Two of the four are bare `ALTER
 *  TABLE` / `CREATE TYPE` and would error; the transaction would roll back and
 *  the metadata would still be wrong. Recording is not executing.
 *
 *  ── ROLLBACK ────────────────────────────────────────────────────────────
 *
 *      delete from drizzle.__drizzle_migrations
 *       where created_at in (1788251520000, 1788337920000,
 *                            1788424320000, 1788510720000);
 *
 *  By exact `created_at`. NEVER by `hash LIKE '%0115%'` — `hash` is a content
 *  digest and carries no tag, so that predicate matches nothing and deletes
 *  nothing silently.
 *
 *  Pass `--apply` to write. Without it the script proves and reports only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

type Row = Record<string, string | null>;
const APPLY = process.argv.includes("--apply");

const journal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8"),
) as { entries: { idx: number; when: number; tag: string }[] };

const count = async (q: ReturnType<typeof sql>) =>
  Number((((await db.execute(q)) as unknown as Row[])[0]?.n) ?? 0);

/** Independent proof per migration: the schema effect, read from the catalog. */
const SUBJECTS: {
  tag: string;
  proof: string;
  check: () => Promise<boolean>;
}[] = [
  {
    tag: "0112_od_032_manual_all_in_sell_provenance",
    proof: "quote_snapshot_recovery_instructions.manual_all_in_sell column exists",
    check: async () =>
      (await count(sql`select count(*)::text n from information_schema.columns
         where table_name='quote_snapshot_recovery_instructions'
           and column_name='manual_all_in_sell'`)) === 1,
  },
  {
    tag: "0113_od_028_frozen_owner_kind",
    proof: "recovery_owner_kind type exists AND owner_kind column exists",
    check: async () =>
      (await count(sql`select count(*)::text n from pg_type where typname='recovery_owner_kind'`)) === 1 &&
      (await count(sql`select count(*)::text n from information_schema.columns
         where table_name='quote_snapshot_recovery_instructions'
           and column_name='owner_kind'`)) === 1,
  },
  {
    tag: "0114_od_028_item_group_commercial_line",
    proof: "commercial_line_kind carries the label 'item_group'",
    check: async () =>
      (await count(sql`select count(*)::text n from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='commercial_line_kind' and e.enumlabel='item_group'`)) === 1,
  },
  {
    tag: "0115_component_charge_samples_key",
    proof: "recovery_charge carries the label 'samples'",
    check: async () =>
      (await count(sql`select count(*)::text n from pg_enum e join pg_type t on t.oid=e.enumtypid
         where t.typname='recovery_charge' and e.enumlabel='samples'`)) === 1,
  },
];

/** Schema + data fingerprint, so "changed nothing else" is measured. */
async function fingerprint() {
  return {
    tables: await count(sql`select count(*)::text n from information_schema.tables where table_schema='public'`),
    columns: await count(sql`select count(*)::text n from information_schema.columns where table_schema='public'`),
    types: await count(sql`select count(*)::text n from pg_type t join pg_namespace ns on ns.oid=t.typnamespace where ns.nspname='public'`),
    enumLabels: await count(sql`select count(*)::text n from pg_enum`),
    indexes: await count(sql`select count(*)::text n from pg_indexes where schemaname='public'`),
    constraints: await count(sql`select count(*)::text n from pg_constraint c join pg_namespace ns on ns.oid=c.connamespace where ns.nspname='public'`),
    quotes: await count(sql`select count(*)::text n from quotes`),
    quoteTiers: await count(sql`select count(*)::text n from quote_tiers`),
    chargeInstances: await count(sql`select count(*)::text n from quote_charge_instances`),
    snapshotLines: await count(sql`select count(*)::text n from quote_snapshot_lines`),
    auditLog: await count(sql`select count(*)::text n from audit_log`),
  };
}

// ── 1 · PROVE ─────────────────────────────────────────────────────────────
console.log("1 · INDEPENDENT PROOF (metadata is written only after this passes)\n");
const planned: { tag: string; when: number; hash: string }[] = [];
let refused = 0;

for (const s of SUBJECTS) {
  const entry = journal.entries.find((e) => e.tag === s.tag);
  if (!entry) {
    console.log(`  REFUSED ${s.tag} — no journal entry`);
    refused++;
    continue;
  }
  const ok = await s.check();
  // LF-normalised, matching how the hash was computed when these files were
  // authored on a CRLF checkout. `readMigrationFiles` hashes file bytes; the
  // stored digests across this table are LF.
  const lf = readFileSync(path.join("drizzle", `${s.tag}.sql`)).toString().replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(lf).digest("hex");
  console.log(`  ${ok ? "PROVEN " : "REFUSED"} ${s.tag}`);
  console.log(`          ${s.proof} → ${ok}`);
  console.log(`          when=${entry.when}  hash=${hash.slice(0, 16)}…`);
  if (ok) planned.push({ tag: s.tag, when: entry.when, hash });
  else refused++;
}

if (refused > 0) {
  console.log(`\nREFUSING THE WHOLE RUN — ${refused} migration(s) could not be proven applied.`);
  console.log("A missing proof means the migration did not run. Recording it would hide it");
  console.log("from the migrator permanently, which is the hazard this repair exists to fix.");
  process.exit(1);
}

// ── 2 · BEFORE ────────────────────────────────────────────────────────────
const before = await fingerprint();
const rowsBefore = await count(sql`select count(*)::text n from drizzle.__drizzle_migrations`);
const hwBefore = Number(
  (((await db.execute(sql`select coalesce(max(created_at),0)::text n from drizzle.__drizzle_migrations`)) as unknown as Row[])[0]?.n) ?? 0,
);
console.log(`\n2 · BEFORE   rows=${rowsBefore}  max(created_at)=${hwBefore}`);
console.log(`             fingerprint ${JSON.stringify(before)}`);

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply to write. Nothing was changed.");
  process.exit(0);
}

// ── 3 · APPLY ─────────────────────────────────────────────────────────────
console.log("\n3 · APPLY (four guarded inserts, nothing else)\n");
for (const p of planned) {
  const res = (await db.execute(sql`
    insert into drizzle.__drizzle_migrations ("hash", "created_at")
    select ${p.hash}, ${p.when}
     where not exists (
       select 1 from drizzle.__drizzle_migrations where created_at = ${p.when}
     )
    returning id::text n`)) as unknown as Row[];
  console.log(`  ${p.tag.padEnd(46)} ${res.length ? `inserted id=${res[0].n}` : "already present — guard held"}`);
}

// ── 4 · AFTER ─────────────────────────────────────────────────────────────
const after = await fingerprint();
const rowsAfter = await count(sql`select count(*)::text n from drizzle.__drizzle_migrations`);
const hwAfter = Number(
  (((await db.execute(sql`select coalesce(max(created_at),0)::text n from drizzle.__drizzle_migrations`)) as unknown as Row[])[0]?.n) ?? 0,
);
console.log(`\n4 · AFTER    rows=${rowsAfter}  max(created_at)=${hwAfter}`);

const drift = Object.keys(before).filter(
  (k) => (before as Record<string, number>)[k] !== (after as Record<string, number>)[k],
);
console.log(`             schema/data fingerprint unchanged: ${drift.length === 0}`);
if (drift.length) {
  console.log(`             CHANGED: ${drift.join(", ")}`);
  console.log(`             before ${JSON.stringify(before)}`);
  console.log(`             after  ${JSON.stringify(after)}`);
  process.exit(1);
}

const expectedHw = journal.entries[journal.entries.length - 1].when;
console.log(`             high-water == 0115 journal when: ${hwAfter === expectedHw} (${expectedHw})`);
console.log(`             rows ${rowsBefore} → ${rowsAfter} (expected +4)`);
process.exit(rowsAfter === rowsBefore + 4 && hwAfter === expectedHw ? 0 : 1);
