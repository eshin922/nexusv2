"use server";

import { desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, firmSettings } from "@/db/schema";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Firm-level policy admin actions. The /admin layout already gates
// access via requireAdmin, but each action calls it again — defense in
// depth. Action endpoints are reachable without going through the
// layout.

function pctDisplayToDecimalString(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toString();
}

export type FirmSettingsRow = typeof firmSettings.$inferSelect;

export async function listFirmSettingsHistory(): Promise<
  ActionResult<FirmSettingsRow[]>
> {
  return runAction(async () => {
    await requireAdminAction();
    const rows = await db
      .select()
      .from(firmSettings)
      .orderBy(desc(firmSettings.effectiveFrom));
    return rows;
  });
}

// Versioned update: closes the prior current row by setting its
// effective_until = the new effective_from, then inserts the new row.
// In a transaction so we never end up with two current rows or none.
//
// Validation: floor < target, both > 0, both < 1. Postgres also enforces
// numeric(5,4) bounds; client validation prevents the obvious mistakes
// (typing 35 vs 0.35) before the action fires.
export async function updateFirmSettings(
  formData: FormData,
): Promise<ActionResult<FirmSettingsRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const target = pctDisplayToDecimalString(formData.get("targetMarginPct"));
    const floor = pctDisplayToDecimalString(formData.get("floorMarginPct"));
    const effectiveFromStr = String(formData.get("effectiveFrom") ?? "").trim();

    if (target === null) {
      throw new ActionGuardError(ERR.VALIDATION, "Target margin is required.");
    }
    if (floor === null) {
      throw new ActionGuardError(ERR.VALIDATION, "Floor margin is required.");
    }
    const targetN = Number(target);
    const floorN = Number(floor);
    if (!(targetN > 0 && targetN < 1)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Target margin must be between 0% and 100% (exclusive).",
      );
    }
    if (!(floorN > 0 && floorN < 1)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Floor margin must be between 0% and 100% (exclusive).",
      );
    }
    if (!(floorN < targetN)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Floor margin must be less than target margin.",
      );
    }
    if (effectiveFromStr === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from date is required.",
      );
    }
    // YYYY-MM-DD shape validation; Postgres date column will reject
    // anything else but the friendlier message helps.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromStr)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from must be a YYYY-MM-DD date.",
      );
    }

    const inserted = await db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(firmSettings)
        .where(isNull(firmSettings.effectiveUntil))
        .orderBy(desc(firmSettings.effectiveFrom))
        .limit(1);

      if (prior) {
        await tx
          .update(firmSettings)
          .set({ effectiveUntil: effectiveFromStr })
          .where(eq(firmSettings.id, prior.id));
      }

      const [created] = await tx
        .insert(firmSettings)
        .values({
          targetMarginPct: target,
          floorMarginPct: floor,
          effectiveFrom: effectiveFromStr,
          effectiveUntil: null,
          updatedByUserId: admin.id,
        })
        .returning();

      await tx.insert(auditLog).values({
        userId: admin.id,
        entityType: "firm_settings",
        entityId: created.id,
        action: "update",
        diffJson: {
          from: prior
            ? {
                targetMarginPct: prior.targetMarginPct,
                floorMarginPct: prior.floorMarginPct,
                effectiveFrom: prior.effectiveFrom,
              }
            : null,
          to: {
            targetMarginPct: target,
            floorMarginPct: floor,
            effectiveFrom: effectiveFromStr,
          },
        },
      });

      return created;
    });

    // Open quote tabs won't auto-refresh (per architectural decision —
    // admin changes are rare; PMs reload to pick them up). Revalidate
    // the admin page itself so the form rehydrates with the new
    // current row.
    revalidatePath("/admin/firm-settings");

    return inserted;
  });
}

