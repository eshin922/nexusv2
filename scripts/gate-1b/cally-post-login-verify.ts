/**
 * Cally certification — post-login verification. READ-ONLY.
 *
 * Run after EACH sign-in:
 *   … cally-post-login-verify.ts --login 1
 *   … cally-post-login-verify.ts --login 2
 *
 * Login 1 asserts the binding happened correctly and changed nothing it was not
 * entitled to change. Login 2 asserts the binding did NOT happen again — that
 * the second sign-in resolved by Clerk id and never re-entered the email path.
 * The second is the one that proves the pending state was consumed rather than
 * merely satisfied.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const EMAIL = "cally@thedps.co";
const DURABLE_ID = "b4bd812b-3508-4692-b235-5ca633dc1af5";

type Check = { name: string; got: string; want: string };

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const login = arg("--login") ?? "1";

  const rows = (await db.execute(
    sql`select id, email, name, role::text as role, binding_state::text as binding_state,
               clerk_user_id, commercial_approver, can_edit_specs, can_create_leaves,
               slack_user_id, hubspot_owner_id, updated_at
          from public.users where lower(email) = ${EMAIL}`,
  )) as unknown as Array<Record<string, unknown>>;

  const checks: Check[] = [
    { name: "exactly one row for this address", got: String(rows.length), want: "1" },
  ];
  if (rows.length !== 1) {
    console.error("FAIL — cannot continue without exactly one row.");
    console.table(rows);
    process.exit(1);
  }
  const u = rows[0];

  checks.push(
    { name: "DURABLE users.id unchanged", got: String(u.id), want: DURABLE_ID },
    { name: "binding_state", got: String(u.binding_state), want: "bound" },
    { name: "clerk_user_id is set", got: u.clerk_user_id ? "set" : "null", want: "set" },
    { name: "role", got: String(u.role), want: "logistics" },
    { name: "commercial_approver", got: String(u.commercial_approver), want: "false" },
    { name: "can_edit_specs", got: String(u.can_edit_specs), want: "false" },
    { name: "can_create_leaves", got: String(u.can_create_leaves), want: "false" },
    { name: "slack_user_id", got: String(u.slack_user_id), want: "null" },
    { name: "hubspot_owner_id", got: String(u.hubspot_owner_id), want: "null" },
  );

  const all = (await db.execute(
    sql`select email, role::text as role, binding_state::text as binding_state
          from public.users order by email`,
  )) as unknown as Array<Record<string, unknown>>;
  checks.push({ name: "Nexus user count", got: String(all.length), want: "4" });
  checks.push({
    name: "no pending rows remain",
    got: String(all.filter((r) => r.binding_state === "pending_first_sign_in").length),
    want: "0",
  });

  const audit = (await db.execute(
    sql`select action, actor_display_name, created_at, diff_json
          from public.audit_log
         where entity_type = 'user' and entity_id = ${DURABLE_ID}
         order by created_at`,
  )) as unknown as Array<Record<string, unknown>>;

  const preAuth = audit.filter((a) => a.action === "user_pre_authorized");
  const bindings = audit.filter((a) => a.action === "user_identity_bound");

  checks.push(
    { name: "user_pre_authorized still intact", got: String(preAuth.length), want: "1" },
    // THE login-2 discriminator. A second binding row would mean the email path
    // ran again on a row that was already bound — the rebinding this design
    // forbids, and the failure that would otherwise be invisible.
    { name: "user_identity_bound rows", got: String(bindings.length), want: "1" },
  );

  if (login === "2") {
    checks.push({
      name: "no SECOND binding on login 2",
      got: String(bindings.length),
      want: "1",
    });
  }

  console.log(`CALLY — POST-LOGIN VERIFICATION (login ${login})\n`);
  let failed = 0;
  for (const c of checks) {
    const ok = c.got === c.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(34)} ${ok ? c.got : `got ${c.got}, want ${c.want}`}`,
    );
  }

  console.log(`\nclerk_user_id : ${String(u.clerk_user_id)}`);
  console.log(`updated_at    : ${String(u.updated_at)}`);
  console.log("\nAUDIT TRAIL FOR THIS USER:");
  for (const a of audit) {
    console.log(`  ${String(a.created_at)}  ${String(a.action)}  by ${String(a.actor_display_name)}`);
  }
  if (bindings.length === 1) {
    console.log("\nBINDING DIFF:");
    console.log("  " + JSON.stringify(bindings[0].diff_json));
  }
  console.log("\nFULL USER TABLE:");
  console.table(all);

  console.log(
    `\nVERDICT: ${failed === 0 ? `login ${login} certified.` : `${failed} check(s) failed.`}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
