/**
 * #327 — provision ONE pre-authorized Nexus user. WRITES.
 *
 * The admin act the binding design assumes: create the row, with its role and
 * authorities, before the person has ever reached Clerk.
 *
 * Usage:
 *   node … provision-pending-user.ts --email cally@thedps.co --name "Cally Hou" --role logistics
 *
 * ── ORDERING, WHICH MATTERS MORE THAN IT LOOKS ───────────────────────────
 *
 * Do NOT run this before the binding code is DEPLOYED. A pending row created
 * against a deployment that predates #327 is not merely unused — the old
 * `ensure-user` would try to INSERT a second row for the same address on that
 * person's first sign-in and hit the unique constraint on `email`, so their
 * sign-in fails outright while the pending row sits unclaimed.
 *
 *   merge -> deploy -> provision -> sign in
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────
 *
 * Non-corporate address, an address already present in any case, and any
 * attempt to set authority beyond `role`. `commercial_approver`,
 * `can_edit_specs` and `can_create_leaves` are NOT settable here: they default
 * false and are granted separately and deliberately. BV-005 keeps commercial
 * approval independent of role, and a provisioning flag would be the first
 * place that independence eroded.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { normalizeCorporateEmail } from "@/lib/auth/corporate-email";

const ROLES = [
  "admin",
  "pm",
  "purchasing",
  "production",
  "accounting",
  "logistics",
  "sales",
  "read_only",
] as const;
type Role = (typeof ROLES)[number];

const CORPORATE_DOMAIN = "@thedps.co";
/** The admin performing the provisioning; the audit must name a real actor. */
const ACTOR_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const rawEmail = arg("--email");
  const name = arg("--name");
  const role = arg("--role") as Role | null;

  if (!rawEmail || !name || !role) {
    console.error("usage: --email <addr> --name <name> --role <" + ROLES.join("|") + ">");
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`REFUSED — "${role}" is not a Nexus role. One of: ${ROLES.join(", ")}`);
    process.exit(1);
  }

  const email = normalizeCorporateEmail(rawEmail);
  if (!email.endsWith(CORPORATE_DOMAIN)) {
    console.error(
      `REFUSED — ${email} is not a ${CORPORATE_DOMAIN} address. Enterprise SSO ` +
        `only resolves the corporate domain, so a row for anything else could ` +
        `never be bound.`,
    );
    process.exit(1);
  }

  const clash = (await db.execute(
    sql.raw(`select id, email, binding_state::text, clerk_user_id is not null as bound
               from public.users where lower(email) = '${email.replace(/'/g, "''")}'`),
  )) as unknown as Array<Record<string, unknown>>;
  if (clash.length > 0) {
    console.error(`REFUSED — a Nexus user already exists for ${email}:`);
    console.error("  " + JSON.stringify(clash[0]));
    console.error(
      "  Provisioning a second would be unrepresentable anyway (users_email_lower_unique).",
    );
    process.exit(1);
  }

  const [created] = await db
    .insert(users)
    .values({
      email: rawEmail.trim(),
      name,
      role,
      // The whole point: no identity yet, and the state SAYS so.
      clerkUserId: null,
      bindingState: "pending_first_sign_in" as const,
      // Left to their defaults (false), stated here so a reader sees the
      // omission is deliberate rather than forgotten.
      commercialApprover: false,
      canEditSpecs: false,
      canCreateLeaves: false,
    })
    .returning();

  await writeAuditEntry({
    userId: ACTOR_USER_ID,
    entityType: "user",
    entityId: created.id,
    action: "user_pre_authorized",
    diffJson: {
      email: created.email,
      name: created.name,
      role: created.role,
      binding_state: created.bindingState,
      commercial_approver: created.commercialApprover,
      can_edit_specs: created.canEditSpecs,
      can_create_leaves: created.canCreateLeaves,
      audit_source: "admin_provisioning",
    },
    summary: `Pre-authorized ${created.email} as ${created.role}, pending first sign-in.`,
  });

  console.log("PROVISIONED — pending first sign-in");
  console.log("  nexus user id     :", created.id);
  console.log("  email             :", created.email);
  console.log("  name              :", created.name);
  console.log("  role              :", created.role);
  console.log("  binding_state     :", created.bindingState);
  console.log("  clerk_user_id     :", created.clerkUserId);
  console.log("  commercial_approver:", created.commercialApprover);
  process.exit(0);
}

void main();
