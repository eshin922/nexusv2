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

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
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

// Slice RI.7 — versioned-insert helper. RI.7 adds 9 new firm_settings
// columns alongside the existing target/floor margin pair. Every
// versioned update must carry forward all columns from the prior
// current row; otherwise a vendor_identity edit would null out
// target_margin_pct (and vice versa). Helper centralizes the
// carry-forward + new-row insert + audit-log so both updateFirmSettings
// (margin policy) and updateFirmSettingsCustomerFacingDefaults (vendor
// + commercial defaults) stay consistent.
//
// The `overrides` arg specifies which columns the caller is editing;
// the helper merges them over the prior row, closes the prior row,
// inserts the new row, and writes the audit log entry with structured
// diff. Caller supplies the effective_from date (typically today) and
// the audit_log diff_json shape (subset of changed columns).
async function versionedFirmSettingsUpdate(args: {
  adminUserId: string;
  effectiveFromStr: string;
  overrides: Partial<typeof firmSettings.$inferInsert>;
  auditDiff: { from: Record<string, unknown> | null; to: Record<string, unknown> };
}): Promise<FirmSettingsRow> {
  const { adminUserId, effectiveFromStr, overrides, auditDiff } = args;
  return await db.transaction(async (tx) => {
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

    // Carry-forward: start from prior row's columns, override with
    // caller's edits. id / effective_from / effective_until /
    // updated_by_user_id / updated_at all explicitly set to new values.
    const newRow: typeof firmSettings.$inferInsert = {
      // Margin (carry-forward; updateFirmSettings overrides these)
      targetMarginPct: prior?.targetMarginPct ?? "0.3500",
      floorMarginPct: prior?.floorMarginPct ?? "0.2500",
      // Vendor identity (carry-forward; CFD action overrides these)
      vendorName: prior?.vendorName ?? null,
      vendorTagline: prior?.vendorTagline ?? null,
      vendorAddress: prior?.vendorAddress ?? null,
      // Customer-facing commercial defaults (carry-forward)
      quoteNumberPrefix: prior?.quoteNumberPrefix ?? null,
      tcsDefault: prior?.tcsDefault ?? null,
      paymentTermsDefault: prior?.paymentTermsDefault ?? null,
      leadTimeDefault: prior?.leadTimeDefault ?? null,
      incotermsDefault: prior?.incotermsDefault ?? null,
      daysValidDefault: prior?.daysValidDefault ?? null,
      // Override with caller's edits
      ...overrides,
      // Versioning fields (always new)
      effectiveFrom: effectiveFromStr,
      effectiveUntil: null,
      updatedByUserId: adminUserId,
    };

    const [created] = await tx.insert(firmSettings).values(newRow).returning();

    await tx.insert(auditLog).values({
      userId: adminUserId,
      entityType: "firm_settings",
      entityId: created.id,
      action: "firm_settings_updated",
      diffJson: auditDiff,
    });

    return created;
  });
}

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

    // Capture prior margin values for audit before the carry-forward
    // helper overwrites them.
    const [prior] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);

    const inserted = await versionedFirmSettingsUpdate({
      adminUserId: admin.id,
      effectiveFromStr,
      overrides: {
        targetMarginPct: target,
        floorMarginPct: floor,
      },
      auditDiff: {
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

    // Open quote tabs won't auto-refresh (per architectural decision —
    // admin changes are rare; PMs reload to pick them up). Revalidate
    // the admin page itself so the form rehydrates with the new
    // current row.
    revalidatePath("/admin/firm-settings");

    return inserted;
  });
}

// Slice RI.7 — vendor identity + customer-facing commercial defaults.
// Per docs/ri7-brief-amendment.md §3.10.a-g. Same versioning pattern as
// updateFirmSettings (close prior row, insert new row with carry-forward).
//
// Single action handles all 9 new RI.7 firm_settings fields:
//   - vendor_name / vendor_tagline / vendor_address (firm identity;
//     renders live on customer view)
//   - quote_number_prefix (consumed by sendQuote at send-time)
//   - tcs_default / payment_terms_default / lead_time_default /
//     incoterms_default / days_valid_default (snapshotted onto each
//     quote at sendQuote per DEC-7)
//
// Each field is optional in the form — empty input → NULL in the new
// row (matches the carry-forward, which inherits prior value if not
// in overrides).
//
// Validation: days_valid_default must be a positive integer if provided;
// percent / decimal-shape checks not applicable (all text fields).
export async function updateFirmSettingsCustomerFacingDefaults(
  formData: FormData,
): Promise<ActionResult<FirmSettingsRow>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const vendorName = trimOrNull(formData.get("vendorName"));
    const vendorTagline = trimOrNull(formData.get("vendorTagline"));
    const vendorAddress = trimOrNull(formData.get("vendorAddress"));
    const quoteNumberPrefix = trimOrNull(formData.get("quoteNumberPrefix"));
    const tcsDefault = trimOrNull(formData.get("tcsDefault"));
    const paymentTermsDefault = trimOrNull(formData.get("paymentTermsDefault"));
    const leadTimeDefault = trimOrNull(formData.get("leadTimeDefault"));
    const incotermsDefault = trimOrNull(formData.get("incotermsDefault"));
    const daysValidDefault = parseIntOrNull(formData.get("daysValidDefault"));
    const effectiveFromStr = String(formData.get("effectiveFrom") ?? "").trim();

    if (daysValidDefault !== null && !(daysValidDefault > 0)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Days valid must be a positive integer.",
      );
    }
    if (effectiveFromStr === "") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from date is required.",
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromStr)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Effective-from must be a YYYY-MM-DD date.",
      );
    }

    // Capture prior values for the audit diff.
    const [prior] = await db
      .select()
      .from(firmSettings)
      .where(isNull(firmSettings.effectiveUntil))
      .orderBy(desc(firmSettings.effectiveFrom))
      .limit(1);

    const newValues = {
      vendorName,
      vendorTagline,
      vendorAddress,
      quoteNumberPrefix,
      tcsDefault,
      paymentTermsDefault,
      leadTimeDefault,
      incotermsDefault,
      daysValidDefault,
    };

    const inserted = await versionedFirmSettingsUpdate({
      adminUserId: admin.id,
      effectiveFromStr,
      overrides: newValues,
      auditDiff: {
        from: prior
          ? {
              vendorName: prior.vendorName,
              vendorTagline: prior.vendorTagline,
              vendorAddress: prior.vendorAddress,
              quoteNumberPrefix: prior.quoteNumberPrefix,
              tcsDefault: prior.tcsDefault,
              paymentTermsDefault: prior.paymentTermsDefault,
              leadTimeDefault: prior.leadTimeDefault,
              incotermsDefault: prior.incotermsDefault,
              daysValidDefault: prior.daysValidDefault,
              effectiveFrom: prior.effectiveFrom,
            }
          : null,
        to: { ...newValues, effectiveFrom: effectiveFromStr },
      },
    });

    revalidatePath("/admin/firm-settings");

    return inserted;
  });
}
