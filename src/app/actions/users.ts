"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { requireAdminAction } from "@/lib/admin-guard";
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

      await tx.insert(auditLog).values({
        userId: admin.id,
        entityType: "user",
        entityId: userId,
        action: "user_phone_updated",
        diffJson: { from: prior.phone, to: phone },
      });

      return [row];
    });

    revalidatePath("/admin/users");
    return updated;
  });
}
