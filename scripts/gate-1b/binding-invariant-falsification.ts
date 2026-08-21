/**
 * #327 — database-level falsification. Every write is ROLLED BACK.
 *
 * Asserting that a constraint exists is not the same as asserting it refuses
 * anything. These transactions attempt each forbidden state and require the
 * database to reject it; a state that commits is a failure of the test, and the
 * rollback means nothing persists either way.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

type Case = { name: string; stmt: string; mustFail: true };

const CASES: Case[] = [
  {
    name: "bound row with no Clerk identity",
    stmt: `insert into users (email, name, role, binding_state, clerk_user_id)
           values ('falsify-a@example.invalid', 'x', 'read_only', 'bound', null)`,
    mustFail: true,
  },
  {
    name: "pending row that already carries a Clerk identity",
    stmt: `insert into users (email, name, role, binding_state, clerk_user_id)
           values ('falsify-b@example.invalid', 'x', 'read_only', 'pending_first_sign_in', 'user_falsify')`,
    mustFail: true,
  },
  {
    name: "a second pending row for the same address in different case",
    stmt: `insert into users (email, name, role, binding_state, clerk_user_id)
             values ('falsify-c@example.invalid', 'x', 'read_only', 'pending_first_sign_in', null);
           insert into users (email, name, role, binding_state, clerk_user_id)
             values ('FALSIFY-C@example.invalid', 'x', 'read_only', 'pending_first_sign_in', null)`,
    mustFail: true,
  },
  {
    name: "two rows claiming one Clerk identity",
    stmt: `insert into users (email, name, role, binding_state, clerk_user_id)
             values ('falsify-d@example.invalid', 'x', 'read_only', 'bound', 'user_dup_falsify');
           insert into users (email, name, role, binding_state, clerk_user_id)
             values ('falsify-e@example.invalid', 'x', 'read_only', 'bound', 'user_dup_falsify')`,
    mustFail: true,
  },
];

/** The control. If this does NOT commit, the harness is rejecting everything. */
const CONTROL = {
  name: "CONTROL — a legitimate pending row",
  stmt: `insert into users (email, name, role, binding_state, clerk_user_id)
         values ('falsify-ok@example.invalid', 'x', 'logistics', 'pending_first_sign_in', null)`,
};

async function attempt(stmt: string): Promise<string | null> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(stmt));
      // Never persist. The question is whether the DB ACCEPTED it, not whether
      // we want to keep it.
      throw new Error("__rollback__");
    });
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return msg === "__rollback__" ? null : msg;
  }
}

async function main() {
  let failures = 0;

  console.log("FORBIDDEN STATES — each must be refused by the database\n");
  for (const c of CASES) {
    const err = await attempt(c.stmt);
    const refused = err !== null;
    if (!refused) failures++;
    console.log(`  ${refused ? "REFUSED " : "ACCEPTED"}  ${c.name}`);
    if (refused) console.log(`             ${err!.split("\n")[0].slice(0, 96)}`);
  }

  console.log("\nCONTROL — must be ACCEPTED, or the harness proves nothing\n");
  const controlErr = await attempt(CONTROL.stmt);
  const accepted = controlErr === null;
  if (!accepted) failures++;
  console.log(`  ${accepted ? "ACCEPTED" : "REFUSED "}  ${CONTROL.name}`);
  if (!accepted) console.log(`             ${controlErr}`);

  console.log(
    `\nVERDICT: ${failures === 0 ? "every forbidden state refused, control accepted, nothing persisted." : `${failures} failure(s) — see above.`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
