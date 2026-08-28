/** READ-ONLY. Where does the corrupt tier label still exist in the database?
 *
 *  Repairing `quote_tiers.label` fixes the authoritative column. It does not
 *  follow the value anywhere it was COPIED — denormalized audit diffs, frozen
 *  snapshot rows, cached projections. This sweep asks every text-bearing column
 *  in the public schema, so the answer is measured rather than reasoned.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const rows = <T,>(r: unknown) => r as unknown as T[];
const FRAGMENT = "Additional reachability defect";

const cols = rows<{ t: string; c: string; d: string }>(
  await db.execute(sql`select table_name t, column_name c, data_type d
                         from information_schema.columns
                        where table_schema = 'public'
                          and data_type in ('text','character varying','jsonb','json')
                        order by table_name, column_name`),
);
console.log(`scanning ${cols.length} text/json columns across the public schema`);

// CONTROL FIRST. A sweep that cannot find a value it is known to contain
// reports "clean" for the wrong reason. `audit_log.diff_json` is known to
// carry the fragment, so if the control comes back zero the instrument is
// broken and every other zero below is meaningless.
const [ctl] = rows<{ n: string }>(
  await db.execute(sql`select count(*)::text n from audit_log
                        where diff_json::text like ${"%" + FRAGMENT + "%"}`),
);
console.log(`CONTROL — audit_log.diff_json known-positive : ${ctl.n}`);
if (Number(ctl.n) === 0) {
  console.log("CONTROL FAILED — the sweep cannot see a value it is known to contain. Stopping.");
  process.exit(1);
}

let hits = 0;
let scanned = 0;
let failed = 0;
for (const col of cols) {
  const q = `select count(*)::int n from "${col.t}" where "${col.c}"::text like '%${FRAGMENT}%'`;
  try {
    const [r] = rows<{ n: number }>(await db.execute(sql.raw(q)));
    scanned++;
    if (r.n > 0) {
      hits++;
      console.log(`  HIT  ${col.t}.${col.c} (${col.d}) : ${r.n} row(s)`);
    }
  } catch (e) {
    // A column the sweep could not read is INDETERMINATE, never "clean".
    failed++;
    console.log(`  UNREADABLE  ${col.t}.${col.c} : ${(e as Error).message.slice(0, 80)}`);
  }
}

console.log();
console.log(`scanned ${scanned} columns · ${hits} carrying the fragment · ${failed} unreadable`);
if (failed > 0) console.log("VERDICT INDETERMINATE — some columns could not be read.");
else if (hits === 0) console.log("VERDICT: fragment is absent from every readable column.");
process.exit(0);
