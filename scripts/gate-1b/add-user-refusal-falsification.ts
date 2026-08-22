/**
 * Add User — does every refusal leave ZERO residue, and does the mechanism
 * actually write when it accepts? Runs against the live database.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS ───────────────────────
 *
 * `tests/unit/admin-add-user.test.ts` asserts that Add User is a front door
 * onto one mechanism, and that refusals are decided before the insert. That is
 * a claim about the SHAPE of the code. It cannot observe what the database
 * holds afterwards, and "no write happens" is a claim about the database.
 *
 * ── NO REAL EMPLOYEE IS CREATED ──────────────────────────────────────────
 *
 * The accept case uses a fixture address that is obviously not a person, and
 * the script removes it — row and audit row — before exiting, then verifies
 * the removal by reading back. `provisionPendingUser` opens its own
 * transaction, so it cannot be enrolled in an outer one and rolled back; a
 * created-then-removed fixture is the honest alternative to pretending it can.
 *
 * ── THE CONTROL IS LOAD-BEARING ──────────────────────────────────────────
 *
 * Five refusals that each write nothing prove nothing on their own: a harness
 * pointed at the wrong database, or one whose calls all throw early, reports
 * exactly the same clean result. The accept case runs through the SAME
 * function and must move both counts by exactly one. Without it, every
 * "unchanged" below is vacuous.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { provisionPendingUser } from "@/lib/auth/provision-pending-user";

/** Obviously not a person. Removed before exit. */
const FIXTURE_EMAIL = "zz-add-user-fixture@thedps.co";
const FIXTURE_NAME = "ZZ Add-User Fixture";

/** The administrator the audit row is attributed to. */
const ACTOR_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

type R = { name: string; got: string; want: string };
const results: R[] = [];
const rec = (name: string, got: string, want: string) =>
  results.push({ name, got, want });

async function counts() {
  const r = (await db.execute(sql`
    select
      (select count(*)::int from users) users,
      (select count(*)::int from audit_log
         where action = 'user_pre_authorized') audits
  `)) as unknown as Array<{ users: number; audits: number }>;
  return r[0];
}

/**
 * An address that is already BOUND, so duplicates can be tested against a live
 * person rather than only against a row this script made.
 *
 * CORPORATE only, and the constraint is not cosmetic. The first run of this
 * script took the oldest bound user, which is the historical non-corporate
 * actor (`edward.shin@gmail.com`); the domain check fires before the duplicate
 * check, so the case reported `non_corporate_email` and looked like a
 * mechanism defect. It was a defect in the harness's choice of subject — the
 * address it picked could not have reached the duplicate check by any route.
 */
async function anyBoundEmail(): Promise<string | null> {
  const r = (await db.execute(sql`
    select email from users
     where binding_state = 'bound' and lower(email) like '%@thedps.co'
     order by created_at limit 1
  `)) as unknown as Array<{ email: string }>;
  return r[0]?.email ?? null;
}

async function main() {
  const bound = await anyBoundEmail();
  if (!bound) {
    console.error("no bound corporate user to test duplicate detection against; aborting");
    process.exit(1);
  }

  const pre = (await db.execute(sql`
    select count(*)::int n from users where lower(email) = ${FIXTURE_EMAIL}
  `)) as unknown as Array<{ n: number }>;
  if (pre[0].n !== 0) {
    console.error("fixture address already present; refusing to run");
    process.exit(1);
  }

  const base = await counts();

  // ── REFUSALS ───────────────────────────────────────────────────────────
  //
  // Each is checked for its NAMED code, not merely for failure: five refusals
  // collapsed into one "invalid" would still pass a test that only asked
  // whether the call succeeded, and would tell an admin nothing about what to
  // fix.
  const cases: Array<{ label: string; want: string; args: Parameters<typeof provisionPendingUser>[0] }> = [
    {
      label: "empty name",
      want: "invalid_name",
      args: { name: "   ", email: FIXTURE_EMAIL, role: "pm", actorUserId: ACTOR_USER_ID },
    },
    {
      label: "malformed email",
      want: "invalid_email",
      args: { name: FIXTURE_NAME, email: "not-an-address", role: "pm", actorUserId: ACTOR_USER_ID },
    },
    {
      label: "non-corporate domain",
      want: "non_corporate_email",
      args: { name: FIXTURE_NAME, email: "someone@gmail.com", role: "pm", actorUserId: ACTOR_USER_ID },
    },
    {
      label: "invalid role",
      want: "invalid_role",
      args: { name: FIXTURE_NAME, email: FIXTURE_EMAIL, role: "superuser", actorUserId: ACTOR_USER_ID },
    },
    {
      label: "duplicate of a BOUND user, upper-cased",
      want: "duplicate_email",
      args: { name: FIXTURE_NAME, email: bound.toUpperCase(), role: "pm", actorUserId: ACTOR_USER_ID },
    },
  ];

  for (const c of cases) {
    const r = await provisionPendingUser(c.args);
    rec(`refused: ${c.label}`, r.ok ? "ACCEPTED" : r.code, c.want);
  }

  const afterRefusals = await counts();
  rec(
    "no user row from any refusal",
    String(afterRefusals.users - base.users),
    "0",
  );
  rec(
    "no audit row from any refusal",
    String(afterRefusals.audits - base.audits),
    "0",
  );

  // ── CONTROL: the same function, accepting ──────────────────────────────
  const ok = await provisionPendingUser({
    name: FIXTURE_NAME,
    email: FIXTURE_EMAIL,
    role: "read_only",
    actorUserId: ACTOR_USER_ID,
  });
  rec("CONTROL accepted", ok.ok ? "accepted" : `refused ${ok.code}`, "accepted");
  if (!ok.ok) {
    report();
    return;
  }

  const afterAccept = await counts();
  rec("CONTROL wrote exactly one user", String(afterAccept.users - afterRefusals.users), "1");
  rec("CONTROL wrote exactly one audit", String(afterAccept.audits - afterRefusals.audits), "1");

  // The shape of what was written — read back from the database, not taken
  // from the function's return value. A function reporting what it believes it
  // wrote is not evidence about what was written.
  const rows = (await db.execute(sql`
    select binding_state, clerk_user_id, role, commercial_approver,
           can_edit_specs, can_create_leaves, email
      from users where id = ${ok.userId}::uuid
  `)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  rec("  binding_state", String(row.binding_state), "pending_first_sign_in");
  rec("  clerk_user_id", row.clerk_user_id === null ? "null" : String(row.clerk_user_id), "null");
  rec("  role", String(row.role), "read_only");
  rec("  commercial_approver", String(row.commercial_approver), "false");
  rec("  can_edit_specs", String(row.can_edit_specs), "false");
  rec("  can_create_leaves", String(row.can_create_leaves), "false");

  const audits = (await db.execute(sql`
    select user_id, entity_type, diff_json->>'audit_source' src
      from audit_log
     where action = 'user_pre_authorized' and entity_id = ${ok.userId}
  `)) as unknown as Array<Record<string, unknown>>;
  rec("  audit rows for this user", String(audits.length), "1");
  rec("  audit attributes the actor", String(audits[0]?.user_id ?? "none"), ACTOR_USER_ID);
  rec("  audit entity_type", String(audits[0]?.entity_type ?? "none"), "user");

  // A duplicate of the row we just made — proving the check catches PENDING
  // rows too, not only bound ones.
  const dup = await provisionPendingUser({
    name: FIXTURE_NAME,
    email: FIXTURE_EMAIL.toUpperCase(),
    role: "pm",
    actorUserId: ACTOR_USER_ID,
  });
  rec("refused: duplicate of a PENDING user, upper-cased", dup.ok ? "ACCEPTED" : dup.code, "duplicate_email");

  // ── CLEANUP ────────────────────────────────────────────────────────────
  await db.execute(sql`delete from audit_log where entity_id = ${ok.userId}`);
  await db.execute(sql`delete from users where id = ${ok.userId}::uuid`);

  const final = await counts();
  rec("fixture removed — user count back to baseline", String(final.users - base.users), "0");
  rec("fixture removed — audit count back to baseline", String(final.audits - base.audits), "0");

  report();
}

function report() {
  console.log("ADD USER — refusal residue and accept control\n");
  let failed = 0;
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${ok ? r.got : `got ${r.got}, want ${r.want}`}`,
    );
  }
  console.log(
    `\nVERDICT: ${
      failed === 0
        ? "every refusal writes nothing; the accept path writes exactly one user and one audit."
        : `${failed} failure(s).`
    }`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
