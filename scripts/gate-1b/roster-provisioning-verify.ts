/**
 * Roster provisioning verification. READ-ONLY.
 *
 * Reads back from the database rather than trusting the provisioning script's
 * own console output — a script reporting what it believes it wrote is not
 * evidence about what the database holds.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const EXPECTED: Array<{ email: string; name: string; role: string }> = [
  { email: "jackie@thedps.co", name: "Jackie King", role: "pm" },
  { email: "lexa@thedps.co", name: "Lexa Yerges", role: "pm" },
  { email: "aisha@thedps.co", name: "Aisha Manjra", role: "pm" },
  { email: "daniel@thedps.co", name: "Daniel Park", role: "admin" },
  { email: "melinda@thedps.co", name: "Melinda Will", role: "accounting" },
  { email: "jing@thedps.co", name: "Jing Santos", role: "sales" },
];

/** Onboarded before this run. Must be untouched. */
const PREEXISTING = [
  { email: "amy@thedps.co", role: "admin" },
  { email: "cally@thedps.co", role: "logistics" },
  { email: "edisonlshin@gmail.com", role: "pm" },
  { email: "edward.shin@gmail.com", role: "admin" },
  { email: "edward@thedps.co", role: "admin" },
];

type Check = { name: string; got: string; want: string };

async function main() {
  const r = async (q: unknown) =>
    (await db.execute(q as never)) as unknown as Array<Record<string, unknown>>;
  const checks: Check[] = [];
  const add = (n: string, g: string, w: string) => checks.push({ name: n, got: g, want: w });

  const rows = await r(sql`
    select id, email, name, role::text as role, binding_state::text as bs,
           clerk_user_id, commercial_approver, can_edit_specs, can_create_leaves,
           hubspot_owner_id, slack_user_id
      from public.users order by email`);

  add("total users", String(rows.length), String(EXPECTED.length + PREEXISTING.length));

  for (const want of EXPECTED) {
    const u = rows.find((x) => String(x.email).toLowerCase() === want.email);
    if (!u) {
      add(`${want.email} exists`, "MISSING", "present");
      continue;
    }
    add(`${want.email} role`, String(u.role), want.role);
    add(`${want.email} pending`, String(u.bs), "pending_first_sign_in");
    add(`${want.email} clerk id null`, String(u.clerk_user_id), "null");
    add(`${want.email} commercial_approver`, String(u.commercial_approver), "false");
    add(`${want.email} spec/leaf grants`, `${u.can_edit_specs}/${u.can_create_leaves}`, "false/false");
    add(`${want.email} hubspot/slack`, `${u.hubspot_owner_id}/${u.slack_user_id}`, "null/null");
    add(`${want.email} name`, String(u.name), want.name);
  }

  // The pre-existing five must be exactly as they were — provisioning six new
  // rows must not have touched anyone already onboarded.
  for (const p of PREEXISTING) {
    const u = rows.find((x) => String(x.email).toLowerCase() === p.email);
    add(`${p.email} untouched role`, u ? String(u.role) : "MISSING", p.role);
    add(`${p.email} still bound`, u ? String(u.bs) : "MISSING", "bound");
  }

  // No duplicates, in any casing.
  const dupes = await r(sql`
    select lower(email) e, count(*)::int n from public.users group by 1 having count(*) > 1`);
  add("duplicate emails", String(dupes.length), "0");

  // Exactly one provisioning audit per new user, and no binding audit yet.
  for (const want of EXPECTED) {
    const u = rows.find((x) => String(x.email).toLowerCase() === want.email);
    if (!u) continue;
    const audit = await r(sql`
      select action, actor_display_name from public.audit_log
       where entity_type = 'user' and entity_id = ${String(u.id)}`);
    add(
      `${want.email} audit`,
      `${audit.length} row(s): ${audit.map((a) => a.action).join(",") || "none"}`,
      "1 row(s): user_pre_authorized",
    );
  }

  console.log("ROSTER PROVISIONING — verification\n");
  let failed = 0;
  for (const c of checks) {
    const ok = c.got === c.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(38)} ${ok ? c.got : `got ${c.got}, want ${c.want}`}`,
    );
  }

  console.log("\nFULL USER TABLE:");
  console.table(
    rows.map((u) => ({
      email: u.email,
      role: u.role,
      state: u.bs,
      bound: u.clerk_user_id !== null,
      ca: u.commercial_approver,
    })),
  );

  console.log(`\nVERDICT: ${failed === 0 ? "six pending rows created exactly as specified; nobody existing was touched." : `${failed} check(s) failed.`}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
