"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { writeAuditEntry, writeAuditEntryReturningId } from "@/lib/audit";
import { requireAdminAction } from "@/lib/admin-guard";
import { provisionPendingUser } from "@/lib/auth/provision-pending-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Slice RI.7 — admin user-management actions.
//
// Phone is the load-bearing field for v1: customer-view PreparedBy
// renders the phone line from `users.phone` via the snapshot pipeline
// (DEC-8 in docs/ri7-state-machine.md). HubSpot Owners API has no
// phone, so manual admin entry is the sole source. Per brief amendment
// §3.10.h, users without phone render PdfHeader without the phone
// line (graceful degradation; email is the canonical contact).
//
// Role transitions and archival affordances live here too as future
// scope — the surface is the right home for user-management work.

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export type AdminUserRow = typeof users.$inferSelect;

export async function listUsersForAdmin(): Promise<ActionResult<AdminUserRow[]>> {
  return runAction(async () => {
    await requireAdminAction();
    const rows = await db.select().from(users).orderBy(users.name, users.email);
    return rows;
  });
}

// Update a user's phone number. Admin-only.
//
// Validation:
// - Phone format is intentionally permissive (international + extension
//   variation). Trim to NULL if empty. No regex enforcement at action
//   layer; the UI renders whatever PM entered. If invalid characters
//   show up in customer-facing PDF, PM corrects via the same admin
//   surface — same blast-radius as any other free-text vendor field.
export async function updateUserPhone(
  formData: FormData,
): Promise<ActionResult<AdminUserRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) {
      throw new ActionGuardError(ERR.VALIDATION, "userId is required.");
    }
    const phone = trimOrNull(formData.get("phone"));

    const [prior] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!prior) {
      throw new ActionGuardError(ERR.NOT_FOUND, "User not found.");
    }

    if (prior.phone === phone) {
      // No-op edit. Return the row without audit churn.
      return prior;
    }

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ phone, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

      await writeAuditEntry({
        userId: admin.id,
        entityType: "user",
        entityId: userId,
        action: "user_phone_updated",
        diffJson: { from: prior.phone, to: phone },
      }, tx);

      return [row];
    });

    revalidatePath("/admin/users");
    return updated;
  });
}

/**
 * Admin → Users → Add User. Pre-authorize ONE employee before they sign in.
 *
 * A FRONT DOOR over the certified mechanism in
 * `src/lib/auth/provision-pending-user.ts` — the same function the CLI
 * provisioner runs, so the UI cannot enroll anyone by a path the certified
 * evidence does not cover.
 *
 * ── AUTHORITY ────────────────────────────────────────────────────────────
 *
 * `requireAdminAction()` — the ROLE-based guard, reading `users.role` from the
 * database. Deliberately NOT `isAdmin(email)` / ADMIN_EMAILS: that env list
 * only ever seeds the first role assignment, so using it as the write
 * authority would let anyone listed there create users regardless of what
 * their Nexus role actually is, and would keep granting that after a
 * demotion the database already recorded.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * Creation only. No role editing, no deletion, no disabling, no
 * commercial-approver grant, no Slack or HubSpot mapping, no spec/leaf
 * authority. Every one of those is a separate decision with its own
 * accountability, and folding any into a create form would grant it as a
 * side effect of hiring someone.
 */
export async function addUser(
  formData: FormData,
): Promise<ActionResult<{ userId: string; email: string; role: string }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const result = await provisionPendingUser({
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? ""),
      actorUserId: admin.id,
    });

    if (!result.ok) {
      // Refusals arrive as values, not exceptions, and are re-thrown here so
      // `runAction` renders them in the same shape as every other action's
      // refusal. The mechanism's message is passed through verbatim: it
      // explains WHY, which a generic "validation failed" would discard.
      throw new ActionGuardError(ERR.VALIDATION, result.message);
    }

    revalidatePath("/admin/users");
    return { userId: result.userId, email: result.email, role: result.role };
  });
}

/**
 * Grant or withdraw the two per-user permissions.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `users.can_edit_specs` and `users.can_create_leaves` are read by
 * `assertCanEditSpecs` / `assertCanCreateLeaves` on every spec and library
 * write, and until now NOTHING could set them. They were seeded by migration
 * and never touched again, so in practice both resolved to "admins only" —
 * admins pass those guards implicitly, by role, without the column being true.
 *
 * That is why a PM asked to complete a SKU was refused at save, after the form
 * had let her type it: the guard was working, and the grant was unreachable.
 *
 * ── A GRANT IS ITS OWN DECISION ──────────────────────────────────────────
 *
 * Deliberately NOT folded into Add User, and deliberately not implied by a
 * role. Both stay separate acts, because each is a decision someone should
 * have to make on purpose rather than inherit from a hiring form — the same
 * reasoning that keeps `commercial_approver` out of the create path.
 *
 * ── ADMINS ARE UNAFFECTED BY IT ──────────────────────────────────────────
 *
 * The guards return early on `role === "admin"`, so these columns say nothing
 * about what an admin can do. Setting them on an admin is permitted and
 * recorded, but changes no access; the surface says so rather than implying
 * the toggle is doing something.
 */
export async function updateUserGrants(
  formData: FormData,
): Promise<ActionResult<{ userId: string; canEditSpecs: boolean; canCreateLeaves: boolean }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const userId = String(formData.get("userId") ?? "").trim();
    if (!userId) {
      throw new ActionGuardError(ERR.VALIDATION, "userId is required.");
    }
    // Strict match on the value a checkbox actually submits. `Boolean(get(...))`
    // would read ANY non-empty string as a grant -- including the literal
    // "off", and including "false" -- so a caller that spells the negative out
    // would be granted authority by saying it did not want it.
    //
    // An absent field is no grant. That is the safe direction for a permission:
    // a malformed submission can only fail to confer, never confer by accident.
    const canEditSpecs = formData.get("canEditSpecs") === "on";
    const canCreateLeaves = formData.get("canCreateLeaves") === "on";

    const granted = await db.transaction(async (tx) => {
      // Read inside the transaction so the audit records what this write
      // actually changed FROM, rather than what the screen last displayed.
      const [prior] = await tx
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          canEditSpecs: users.canEditSpecs,
          canCreateLeaves: users.canCreateLeaves,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!prior) {
        throw new ActionGuardError(ERR.NOT_FOUND, "That is not a current Nexus user.");
      }

      await tx
        .update(users)
        .set({ canEditSpecs, canCreateLeaves })
        .where(eq(users.id, userId));

      // In the SAME transaction. Authority granted with no record of who
      // granted it is the one kind of change that must never be able to
      // survive its own audit failing.
      await writeAuditEntry(
        {
          userId: admin.id,
          entityType: "user",
          entityId: userId,
          action: "user_grants_updated",
          diffJson: {
            subject_email: prior.email,
            subject_role: prior.role,
            from: {
              can_edit_specs: prior.canEditSpecs,
              can_create_leaves: prior.canCreateLeaves,
            },
            to: { can_edit_specs: canEditSpecs, can_create_leaves: canCreateLeaves },
          },
        },
        tx,
      );

      return { userId, canEditSpecs, canCreateLeaves };
    });

    revalidatePath("/admin/users");
    return granted;
  });
}
