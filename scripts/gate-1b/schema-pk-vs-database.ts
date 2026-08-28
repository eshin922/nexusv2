/**
 * Declared primary keys vs the ones the database actually has.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * `quote_charge_recovery` was declared `primaryKey([quoteId, chargeKey])` in
 * `schema.ts` long after phase 1b moved the key onto `charge_instance_id` and
 * phase 2 (migration 0110) dropped the temporary composite unique. Nothing
 * broke — the writer names the instance column explicitly — but a stale
 * declaration on a table is not cosmetic: `drizzle-kit generate` diffs the
 * DECLARATION, so a generation could emit a migration dropping the real key and
 * recreating the one a two-PR sequence removed.
 *
 * It was found by a trace that attempted `on conflict (quote_id, charge_key)`
 * and got `42P10 · there is no unique or exclusion constraint matching`. The
 * model said one thing and the database another, and only a write asked.
 *
 * ── WHY THE EXISTING DRIFT DETECTOR COULD NOT SEE IT ────────────────────
 *
 * `npm run db:generate` reports "OK · zero statements" for the stale
 * declaration AND the corrected one — measured, both. It diffs against the
 * drizzle META SNAPSHOTS, and those stop at `0065_snapshot.json` while the
 * journal carries 110 entries: every migration from 0066 onward is
 * hand-authored SQL with no snapshot. So the detector is structurally blind to
 * every table created or altered since, which includes the whole OD-032 set.
 *
 * That is not a reason to distrust it for what it does cover. It is a reason
 * not to accept its silence as evidence about what it does not — the same
 * shape as a grep that cannot match the difference it is looking for.
 *
 * This asks the database instead.
 *
 *   usage: npm run gate1b:schema-pk
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readFileSync } from "node:fs";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * The tables whose primary key is a governed identity decision.
 *
 * Deliberately a NAMED LIST rather than every table: these are the ones where
 * the key IS the model — a contraction onto the instance, a composite that
 * encodes a grain — and where getting it wrong reverses a disposition rather
 * than just a column. A blanket sweep would drown the signal in tables whose
 * key nobody has ever argued about.
 */
const GOVERNED = [
  {
    table: "quote_charge_recovery",
    expected: ["charge_instance_id"],
    why: "OD-032 phase 1b/2 contracted the election onto its instance. `(quote_id, charge_key)` can address only ONE charge of a type per quote, and two cartons may each cause print plates.",
    // What the declaration must say, and must NOT say.
    declares: "primaryKey({ columns: [t.chargeInstanceId] })",
    forbids: "primaryKey({ columns: [t.quoteId, t.chargeKey] })",
  },
  {
    table: "quote_charge_instance_tiers",
    expected: ["charge_instance_id", "tier_id"],
    why: "Economics are per (instance, tier). A row exists iff a positive cost was stated for that tier.",
    declares: "primaryKey({ columns: [t.chargeInstanceId, t.tierId] })",
    forbids: null,
  },
];

async function main() {
  const schema = readFileSync("src/db/schema.ts", "utf8");

  for (const g of GOVERNED) {
    const rows = await db.execute(sql`
      select a.attname as col, a.attnum, con.conkey
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join unnest(con.conkey) with ordinality as k(attnum, ord) on true
        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
       where c.relname = ${g.table} and con.contype = 'p'
       order by k.ord`);
    const live = rows.map((r) => String(r.col));

    record(
      `${g.table} · live PK is (${g.expected.join(", ")})`,
      live.length === g.expected.length && live.every((c, i) => c === g.expected[i]),
      `database has (${live.join(", ") || "none"})`,
    );

    // The DECLARATION must say the same thing. This is the half `drizzle-kit
    // generate` reads, and the half that was wrong.
    record(
      `${g.table} · schema.ts declares the same key`,
      schema.includes(g.declares),
      g.declares,
    );

    if (g.forbids) {
      record(
        `${g.table} · the pre-contraction key is GONE from the declaration`,
        !schema.includes(g.forbids),
        `must not contain ${g.forbids}`,
      );
      // And gone from the database, which is the thing the contraction did.
      const stale = await db.execute(sql`
        select count(*) n
          from pg_constraint con join pg_class c on c.oid = con.conrelid
         where c.relname = ${g.table}
           and con.contype in ('p', 'u')
           and pg_get_constraintdef(con.oid) like '%quote_id, charge_key%'`);
      record(
        `${g.table} · no constraint on (quote_id, charge_key) survives`,
        Number(stale[0].n) === 0,
        `${stale[0].n} such constraint(s)`,
      );
    }
  }

  // ── THE BLIND CONTROL, STATED ────────────────────────────────────────
  //
  // Asserted rather than described, so the day someone regenerates the
  // snapshots this stops claiming a blindness that no longer exists.
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: { tag: string }[];
  };
  const { readdirSync } = await import("node:fs");
  const snaps = readdirSync("drizzle/meta").filter((f) => f.endsWith("_snapshot.json"));
  const last = snaps.sort().at(-1) ?? "none";
  record(
    "CONTROL · the snapshot-based drift detector cannot cover these tables",
    journal.entries.length > snaps.length,
    `${journal.entries.length} journal entries, ${snaps.length} snapshots, latest ${last} — ` +
      "which is why its silence is not evidence about anything after it",
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
