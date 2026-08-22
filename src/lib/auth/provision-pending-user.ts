import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { userRole, users } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import {
  CORPORATE_DOMAIN,
  isCorporateEmail,
  normalizeCorporateEmail,
} from "@/lib/auth/corporate-email";

/**
 * Pre-authorize ONE Nexus user. THE provisioning mechanism — there is no other.
 *
 * ── WHY THIS IS A SHARED FUNCTION AND NOT A SECOND IMPLEMENTATION ────────
 *
 * The certified mechanism was a script, and the Admin UI needed the same
 * behaviour. Writing the insert again in a server action would have produced
 * two enrollment paths that agree today and drift the first time either is
 * touched — and the one that drifts is whichever is edited without the other in
 * view. Extracted instead, so `scripts/gate-1b/provision-pending-user.ts` and
 * the Admin action are the SAME code with different front doors.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * No authorization. The CALLER establishes who may provision — the Admin action
 * uses the role-based guard, the script is run by an operator with database
 * access. Putting the guard here would give the script a caller it cannot
 * satisfy, and would hide the authority decision inside a data function.
 *
 * No grant of authority beyond `role`. `commercial_approver`, `can_edit_specs`
 * and `can_create_leaves` are written FALSE explicitly rather than left to
 * their defaults, so a reader sees the omission is deliberate. BV-005 keeps
 * commercial approval independent of role, and a provisioning parameter is the
 * first place that independence would erode.
 */

export type ProvisionRole = (typeof userRole.enumValues)[number];

export type ProvisionResult =
  | { ok: true; userId: string; email: string; role: ProvisionRole }
  | { ok: false; code: ProvisionRefusal; message: string };

export type ProvisionRefusal =
  | "invalid_name"
  | "invalid_email"
  | "non_corporate_email"
  | "invalid_role"
  | "duplicate_email";

/** Deliberately permissive on shape, strict on domain — the domain is the gate. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function provisionPendingUser(args: {
  name: string;
  email: string;
  role: string;
  /** Who is accountable. Named on the audit row. */
  actorUserId: string;
}): Promise<ProvisionResult> {
  const name = args.name.trim();
  if (name.length === 0) {
    return { ok: false, code: "invalid_name", message: "A name is required." };
  }

  const raw = args.email.trim();
  if (!EMAIL_SHAPE.test(raw)) {
    return { ok: false, code: "invalid_email", message: "That is not a valid email address." };
  }
  if (!isCorporateEmail(raw)) {
    return {
      ok: false,
      code: "non_corporate_email",
      // The domain is interpolated, not retyped: a message that names a
      // different domain than the check enforces would refuse correctly and
      // explain wrongly.
      message:
        `Only ${CORPORATE_DOMAIN} addresses can be pre-authorized. Sign-in resolves ` +
        "the corporate domain only, so a row for anything else could never be bound.",
    };
  }
  const normalized = normalizeCorporateEmail(raw);

  if (!(userRole.enumValues as readonly string[]).includes(args.role)) {
    return {
      ok: false,
      code: "invalid_role",
      message: `"${args.role}" is not a Nexus role.`,
    };
  }
  const role = args.role as ProvisionRole;

  // Checked so the refusal is legible. `users_email_lower_unique` would also
  // stop it, but as a constraint violation — an error about an index shown to
  // an admin who needs to be told the person already exists.
  //
  // Matched on lower(email) REGARDLESS of binding state: an address already
  // bound is just as much a duplicate as a pending one, and reporting only
  // pending collisions would let an admin believe they had created a second
  // record for an active employee.
  const clash = await db
    .select({ id: users.id, bindingState: users.bindingState })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`);
  if (clash.length > 0) {
    return {
      ok: false,
      code: "duplicate_email",
      message:
        `A Nexus user already exists for ${normalized} ` +
        `(${clash[0].bindingState === "bound" ? "already signed in" : "pending first sign-in"}).`,
    };
  }

  // ONE TRANSACTION. The row and the record of who created it commit together
  // or not at all: a pending user with no provenance is an unexplained grant of
  // future access, and an audit row for a user that does not exist is a claim
  // about nothing.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: raw,
        name,
        role,
        // The whole point: no identity yet, and the state SAYS so.
        clerkUserId: null,
        bindingState: "pending_first_sign_in" as const,
        // Written explicitly, not left to defaults, so the omission reads as
        // deliberate to whoever changes this next.
        commercialApprover: false,
        canEditSpecs: false,
        canCreateLeaves: false,
      })
      .returning();

    await writeAuditEntry(
      {
        userId: args.actorUserId,
        entityType: "user",
        entityId: row.id,
        action: "user_pre_authorized",
        diffJson: {
          email: row.email,
          name: row.name,
          role: row.role,
          binding_state: row.bindingState,
          commercial_approver: row.commercialApprover,
          can_edit_specs: row.canEditSpecs,
          can_create_leaves: row.canCreateLeaves,
          audit_source: "admin_provisioning",
        },
        summary: `Pre-authorized ${row.email} as ${row.role}, pending first sign-in.`,
      },
      tx,
    );

    return row;
  });

  return { ok: true, userId: created.id, email: created.email, role };
}
