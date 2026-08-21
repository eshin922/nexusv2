/**
 * Ordered-spec freeze — database-level falsification. Every write ROLLED BACK.
 *
 * The unit suite asserts the migration TEXT contains a trigger and a
 * constraint. That is a claim about a file. This asserts they REFUSE, against
 * the live schema, with a control proving the harness can also accept.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type R = { name: string; got: string; want: string };
const results: R[] = [];
const rec = (name: string, got: string, want: string) => results.push({ name, got, want });

/** Run inside a transaction that always rolls back. Returns the error, or null. */
async function attempt(stmts: string[]): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      for (const s of stmts) await tx.execute(sql.raw(s));
      throw new Error("__rollback__");
    });
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return m === "__rollback__" ? null : m;
  }
}

/** A real snapshot to hang probe rows from; nothing is kept. */
const SNAP = `(select id from quote_snapshots order by created_at desc limit 1)`;
const LEAF = `'00000000-0000-0000-0000-0000000000aa'::uuid`;
const ins = (extra = "") => `
  insert into quote_snapshot_leaf_specs
    (quote_snapshot_id, quote_leaf_id, spec_values, product_type_id, spec_schema,
     content_hash, disposition)
  values (${SNAP}, ${LEAF}, '{"a":1}'::jsonb, 'pt-probe', 'primary',
          'hash-probe', 'specified') ${extra}`;

async function main() {
  const snapCount = (await db.execute(
    sql`select count(*)::int n from quote_snapshots`,
  )) as unknown as Array<{ n: number }>;
  if (snapCount[0].n === 0) {
    console.error("No snapshot to anchor the probe to; cannot falsify.");
    process.exit(1);
  }

  // CONTROL — a legitimate insert must be ACCEPTED, or the harness proves
  // nothing by rejecting everything below.
  rec("CONTROL insert accepted", (await attempt([ins()])) === null ? "accepted" : "refused", "accepted");

  // IMMUTABILITY — the trigger must refuse an UPDATE.
  const upd = await attempt([
    ins(),
    `update quote_snapshot_leaf_specs set spec_values = '{"a":2}'::jsonb where content_hash = 'hash-probe'`,
  ]);
  rec("UPDATE refused by trigger", upd ? "refused" : "ACCEPTED", "refused");
  if (upd) console.log(`      ${upd.split("\n")[0].slice(0, 110)}`);

  // Even a no-op update must be refused — "immutable" is not "immutable unless
  // the value happens to match".
  const noop = await attempt([
    ins(),
    `update quote_snapshot_leaf_specs set disposition = disposition where content_hash = 'hash-probe'`,
  ]);
  rec("no-op UPDATE also refused", noop ? "refused" : "ACCEPTED", "refused");

  // DELETE must stay permitted, so the snapshot FK can cascade.
  const del = await attempt([
    ins(),
    `delete from quote_snapshot_leaf_specs where content_hash = 'hash-probe'`,
  ]);
  rec("DELETE permitted (FK cascade)", del ? "refused" : "permitted", "permitted");
  if (del) console.log(`      ${del.split("\n")[0].slice(0, 110)}`);

  // ONE ROW PER (snapshot, leaf) — a second freeze of the same offer must fail.
  const dupe = await attempt([ins(), ins()]);
  rec("duplicate (snapshot, leaf) refused", dupe ? "refused" : "ACCEPTED", "refused");

  // A DIFFERENT leaf on the same snapshot is legitimate.
  const other = await attempt([
    ins(),
    ins().replace(LEAF, `'00000000-0000-0000-0000-0000000000bb'::uuid`),
  ]);
  rec("second leaf on same snapshot accepted", other ? "refused" : "accepted", "accepted");

  // DISPOSITION is constrained — an invented value must not be storable.
  const bad = await attempt([ins().replace("'specified'", "'probably_fine'")]);
  rec("unknown disposition refused", bad ? "refused" : "ACCEPTED", "refused");

  // content_hash is required.
  const noHash = await attempt([ins().replace("'hash-probe'", "null")]);
  rec("null content_hash refused", noHash ? "refused" : "ACCEPTED", "refused");

  console.log("ORDERED-SPEC FREEZE — live falsification, all rolled back\n");
  let failed = 0;
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(38)} ${ok ? r.got : `got ${r.got}, want ${r.want}`}`);
  }

  const residue = (await db.execute(
    sql`select count(*)::int n from quote_snapshot_leaf_specs`,
  )) as unknown as Array<{ n: number }>;
  console.log(`\nresidue rows: ${residue[0].n}`);
  console.log(
    `\nVERDICT: ${failed === 0 && residue[0].n === 0 ? "immutability and uniqueness enforced by the database; nothing persisted." : `${failed} failure(s).`}`,
  );
  process.exit(failed === 0 && residue[0].n === 0 ? 0 : 1);
}

void main();
