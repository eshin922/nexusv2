/**
 * Gate 1A — adversarial test of the 0062 constraints. READ ONLY in effect.
 *
 * Reading the DDL back proves the constraints EXIST. It does not prove they
 * REJECT anything, and those are different claims — a CHECK written against
 * the wrong column, or one added NOT VALID, reads correctly and stops nothing.
 * The same reasoning that made the single-writer verifier worth breaking on
 * purpose applies here.
 *
 * So each malformed row the actor model is supposed to make impossible is
 * attempted directly, bypassing the writer, and must be rejected by the
 * database itself. Every attempt runs in its own transaction that is rolled
 * back, so nothing is committed either way — this database is shared with
 * production.
 *
 * Raw SQL is used deliberately: the point is to test the constraint, not the
 * writer, and the writer cannot express these shapes.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";

let failed = false;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => {
  failed = true;
  console.error(`  FAIL  ${m}`);
};

const [actor] = (await db.execute(
  sql`select id::text as id from users where btrim(coalesce(name,'')) <> '' limit 1`,
)) as unknown as { id: string }[];

type Case = { name: string; expect: string; row: Row };
type Row = {
  userId: string | null;
  actorUserId: string | null;
  displayName: string | null;
  kind: "human" | "system" | null;
};

/** Raw insert, bypassing the writer — the constraint is what is under test. */
async function attempt(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, r: Row, action: string) {
  await tx.execute(sql`
    insert into audit_log (user_id, actor_user_id, actor_display_name, actor_kind,
                           entity_type, entity_id, action, diff_json)
    values (${r.userId}::uuid, ${r.actorUserId}::uuid, ${r.displayName},
            ${r.kind}::audit_actor_kind,
            'gate_1a_probe', 'x', ${action}, '{}'::jsonb)
  `);
}

const cases: Case[] = [
  {
    name: "human row with no actor_user_id",
    expect: "audit_log_actor_shape",
    row: { userId: actor.id, actorUserId: null, displayName: "Ed Shin", kind: "human" },
  },
  {
    name: "system row carrying an actor_user_id",
    expect: "audit_log_actor_shape",
    row: { userId: null, actorUserId: actor.id, displayName: "NetSuite integration", kind: "system" },
  },
  {
    name: "blank actor_display_name",
    expect: "audit_log_actor_display_name_not_blank",
    row: { userId: actor.id, actorUserId: actor.id, displayName: "   ", kind: "human" },
  },
  {
    name: "null actor_display_name",
    expect: "not-null",
    row: { userId: actor.id, actorUserId: actor.id, displayName: null, kind: "human" },
  },
  {
    name: "no actor_kind at all",
    expect: "not-null",
    row: { userId: actor.id, actorUserId: actor.id, displayName: "Ed Shin", kind: null },
  },
];

console.log("\nGate 1A — do the constraints actually bite?\n");

const ROLLBACK = Symbol("rollback");

for (const c of cases) {
  let rejected: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await attempt(tx, c.row, "gate_1a_probe_bad");
      throw ROLLBACK;
    });
  } catch (e) {
    if (e === ROLLBACK) rejected = null;
    else rejected = (e as { constraint_name?: string; message?: string }).constraint_name ?? (e as Error).message;
  }

  if (rejected === null) {
    fail(`${c.name} — ACCEPTED. The constraint does not bite.`);
  } else if (c.expect === "not-null") {
    if (/null value in column|not-null/i.test(rejected)) pass(`${c.name} — rejected (NOT NULL)`);
    else fail(`${c.name} — rejected by "${rejected}", expected a NOT NULL violation`);
  } else if (rejected === c.expect) {
    pass(`${c.name} — rejected by ${rejected}`);
  } else {
    fail(`${c.name} — rejected by "${rejected}", expected ${c.expect}`);
  }
}

// And the shapes that SHOULD be accepted still are — a constraint that
// rejects everything would pass every test above and break the application.
for (const [name, row] of [
  ["a valid human row", { userId: actor.id, actorUserId: actor.id, displayName: "Ed Shin", kind: "human" }],
  ["a valid system row", { userId: null, actorUserId: null, displayName: "NetSuite integration", kind: "system" }],
] as [string, Row][]) {
  let accepted = false;
  try {
    await db.transaction(async (tx) => {
      await attempt(tx, row, "gate_1a_probe_good");
      accepted = true;
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) fail(`${name} — REJECTED: ${(e as Error).message}`);
  }
  if (accepted) pass(`${name} — accepted`);
}

const [{ leftover }] = (await db.execute(
  sql`select count(*)::text as leftover from audit_log where action like 'gate_1a_probe%'`,
)) as unknown as { leftover: string }[];
if (leftover === "0") pass("rolled back — nothing committed");
else fail(`${leftover} probe row(s) survived`);

console.log(failed ? "\nCONSTRAINTS: FAILED\n" : "\nCONSTRAINTS: enforced, and permissive of exactly the two valid shapes.\n");
process.exit(failed ? 1 : 0);
