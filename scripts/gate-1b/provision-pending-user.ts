/**
 * #327 — provision ONE pre-authorized Nexus user from the command line. WRITES.
 *
 * A FRONT DOOR, not a mechanism. The provisioning itself lives in
 * `src/lib/auth/provision-pending-user.ts` and is shared verbatim with the
 * Admin → Users → Add User action. Reimplementing the insert here would have
 * produced two enrollment paths that agree today and drift the first time
 * either is touched — and the one that drifts is whichever gets edited without
 * the other in view.
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
 * ── AUTHORIZATION ────────────────────────────────────────────────────────
 *
 * This front door is authorized by database access: running it requires the
 * production connection string. The Admin UI front door uses the role-based
 * admin guard. The shared mechanism deliberately holds NEITHER, because a guard
 * inside it would give this caller one it cannot satisfy.
 */
import { userRole } from "@/db/schema";
import { provisionPendingUser } from "@/lib/auth/provision-pending-user";

/** The administrator accountable for a CLI provisioning. */
const ACTOR_USER_ID = "e60b5670-86d8-437b-9654-36a1284c7b19";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const email = arg("--email");
  const name = arg("--name");
  const role = arg("--role");

  if (!email || !name || !role) {
    console.error(
      `usage: --email <addr> --name <name> --role <${userRole.enumValues.join("|")}>`,
    );
    process.exit(1);
  }

  const result = await provisionPendingUser({
    name,
    email,
    role,
    actorUserId: ACTOR_USER_ID,
  });

  if (!result.ok) {
    console.error(`REFUSED (${result.code}) — ${result.message}`);
    process.exit(1);
  }

  console.log("PROVISIONED — pending first sign-in");
  console.log("  nexus user id     :", result.userId);
  console.log("  email             :", result.email);
  console.log("  name              :", name.trim());
  console.log("  role              :", result.role);
  console.log("  binding_state     : pending_first_sign_in");
  console.log("  clerk_user_id     : null");
  console.log("  commercial_approver: false");
  process.exit(0);
}

void main();
