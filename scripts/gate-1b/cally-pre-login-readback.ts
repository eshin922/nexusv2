/**
 * Cally pre-login readback. READ-ONLY.
 *
 * Read back from the database rather than trusting the provisioning script's
 * own console output — a script reporting what it believes it wrote is not
 * evidence about what the database holds.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const EMAIL = "cally@thedps.co";

type Check = { name: string; got: string; want: string };

async function main() {
  const rows = (await db.execute(
    sql`select id, email, name, role::text as role, binding_state::text as binding_state,
               clerk_user_id, commercial_approver, can_edit_specs, can_create_leaves,
               slack_user_id, hubspot_owner_id
          from public.users where lower(email) = ${EMAIL}`,
  )) as unknown as Array<Record<string, unknown>>;

  if (rows.length !== 1) {
    console.error(`FAIL — expected exactly one row for ${EMAIL}, found ${rows.length}`);
    process.exit(1);
  }
  const u = rows[0];

  const checks: Check[] = [
    { name: "binding_state", got: String(u.binding_state), want: "pending_first_sign_in" },
    { name: "clerk_user_id", got: String(u.clerk_user_id), want: "null" },
    { name: "role", got: String(u.role), want: "logistics" },
    { name: "commercial_approver", got: String(u.commercial_approver), want: "false" },
    { name: "can_edit_specs", got: String(u.can_edit_specs), want: "false" },
    { name: "can_create_leaves", got: String(u.can_create_leaves), want: "false" },
    { name: "slack_user_id", got: String(u.slack_user_id), want: "null" },
    { name: "hubspot_owner_id", got: String(u.hubspot_owner_id), want: "null" },
  ];

  // Exactly one provisioning audit row, and no binding audit row yet.
  const audit = (await db.execute(
    sql`select action, actor_display_name, created_at, diff_json
          from public.audit_log
         where entity_type = 'user' and entity_id = ${String(u.id)}
         order by created_at`,
  )) as unknown as Array<Record<string, unknown>>;

  checks.push({
    name: "audit rows for this user",
    got: String(audit.length),
    want: "1",
  });
  checks.push({
    name: "audit action",
    got: audit.length ? String(audit[0].action) : "(none)",
    want: "user_pre_authorized",
  });
  checks.push({
    name: "no binding audit yet",
    got: String(audit.filter((a) => a.action === "user_identity_bound").length),
    want: "0",
  });

  // Nobody else was created.
  const all = (await db.execute(
    sql`select email, role::text as role, binding_state::text as binding_state,
               clerk_user_id is not null as bound
          from public.users order by email`,
  )) as unknown as Array<Record<string, unknown>>;
  checks.push({ name: "total users", got: String(all.length), want: "4" });
  checks.push({
    name: "pending users",
    got: String(all.filter((r) => r.binding_state === "pending_first_sign_in").length),
    want: "1",
  });
  const otherRoster = all.filter(
    (r) =>
      String(r.email).endsWith("@thedps.co") && String(r.email).toLowerCase() !== EMAIL,
  );
  checks.push({
    name: "other @thedps.co users created",
    got: String(otherRoster.filter((r) => r.binding_state === "pending_first_sign_in").length),
    want: "0",
  });

  console.log(`CALLY — PRE-LOGIN READBACK   nexus user ${String(u.id)}\n`);
  let failed = 0;
  for (const c of checks) {
    const ok = c.got === c.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(30)} ${ok ? c.got : `got ${c.got}, want ${c.want}`}`,
    );
  }

  console.log("\nFULL USER TABLE:");
  console.table(all);

  if (audit.length === 1) {
    console.log("\nPROVISIONING AUDIT ROW:");
    console.log("  action :", audit[0].action);
    console.log("  actor  :", audit[0].actor_display_name);
    console.log("  diff   :", JSON.stringify(audit[0].diff_json));
  }

  console.log(
    `\nVERDICT: ${failed === 0 ? "pending as specified; no other roster user created; no binding has occurred." : `${failed} check(s) failed.`}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
