"use server";

import { and, count, eq, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, productionInputs, quotes, quoteSkus } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  quoteNotDraftMessage,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Snapshots returned to the client after a save so controlled state
// re-hydrates from canonical server data — never from the form's
// defaultValue (per CLAUDE.md "Form state pattern").

export type ProductionCellSnapshot = {
  rowId: string;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  setupFeeTotal: string | null;
  toolingArtworkTotal: string | null;
  rdTotal: string | null;
  otherServiceTotal: string | null;
  bulkRawCost: string | null;
  actualUnitsProduced: number | null;
};

export type ProductionPolicySnapshot = {
  quoteSkuId: string;
  customerShipsRaws: boolean;
  allocateServiceFeesToCost: boolean;
  notes: string | null;
};

// ---------- helpers ----------

type Diff = Record<string, { from: unknown; to: unknown }>;

function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Diff {
  const d: Diff = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) d[String(k)] = { from: before[k], to: after[k] };
  }
  return d;
}

async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    diffJson: args.diffJson ?? {},
  });
}

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function parseNumericOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

function parseIntOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

// PostgreSQL numeric returns canonical strings ("0.40") while form values
// arrive shorter ("0.4"). Compare numerically to avoid spurious "changes".
function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

// Resolve quote ownership through (sku → quote) and assert draft. Used by
// both per-cell and per-SKU actions.
async function quoteForSku(quoteSkuId: string) {
  const rows = await db
    .select({ quote: quotes, sku: quoteSkus })
    .from(quoteSkus)
    .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
    .where(eq(quoteSkus.id, quoteSkuId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "SKU not found");
  const { quote, sku } = rows[0];
  if (quote.status !== "draft")
    throw new ActionGuardError(
      ERR.QUOTE_NOT_DRAFT,
      quoteNotDraftMessage(quote.status),
    );
  if (sku.skuRole !== "leaf")
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Production inputs only apply to leaf SKUs.",
    );
  return { quote, sku };
}

// ---------- read helpers ----------

// Counts production_inputs rows for the quote that carry any non-null cost
// data or actual_units_produced. Used by the tier-preset confirm dialog
// to warn about destructive data loss; the audit-log forensic snapshot
// captures the same shape but PMs need the warning *before* clicking.
export async function countProductionCellsWithDataForQuote(
  quoteId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(productionInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, productionInputs.quoteSkuId))
    .where(
      and(
        eq(quoteSkus.quoteId, quoteId),
        or(
          isNotNull(productionInputs.fillingBlendingCost),
          isNotNull(productionInputs.cmAssemblyTotal),
          isNotNull(productionInputs.setupFeeTotal),
          isNotNull(productionInputs.toolingArtworkTotal),
          isNotNull(productionInputs.rdTotal),
          isNotNull(productionInputs.otherServiceTotal),
          isNotNull(productionInputs.bulkRawCost),
          isNotNull(productionInputs.actualUnitsProduced),
        ),
      ),
    );
  return row?.count ?? 0;
}

// ---------- per-(SKU, tier) cell action ----------

// Updates one (sku, tier) row's per-tier cost fields and
// actual_units_produced. Policy fields (customer_ships_raws,
// allocate_service_fees_to_cost, notes) are NOT touched here — they go
// through updateSkuProductionPolicy which fans out across all tier rows.
//
// bulk_raw_cost survives the customer_ships_raws toggle. The UI hides
// the cell when customer_ships_raws=true; the data stays in place so
// toggling back restores the value.
export async function upsertProductionInputs(
  formData: FormData,
): Promise<ActionResult<ProductionCellSnapshot>> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    const { quote } = await quoteForSku(quoteSkuId);

    const newFields = {
      fillingBlendingCost: parseNumericOrNull(formData.get("fillingBlendingCost")),
      cmAssemblyTotal: parseNumericOrNull(formData.get("cmAssemblyTotal")),
      setupFeeTotal: parseNumericOrNull(formData.get("setupFeeTotal")),
      toolingArtworkTotal: parseNumericOrNull(formData.get("toolingArtworkTotal")),
      rdTotal: parseNumericOrNull(formData.get("rdTotal")),
      otherServiceTotal: parseNumericOrNull(formData.get("otherServiceTotal")),
      bulkRawCost: parseNumericOrNull(formData.get("bulkRawCost")),
      actualUnitsProduced: parseIntOrNull(formData.get("actualUnitsProduced")),
    };

    const existingRows = await db
      .select()
      .from(productionInputs)
      .where(
        and(
          eq(productionInputs.quoteSkuId, quoteSkuId),
          eq(productionInputs.tierId, tierId),
        ),
      )
      .limit(1);

    let rowId: string;
    let before: typeof newFields & { actualUnitsProduced: number | null };
    if (existingRows.length === 0) {
      // Should be rare — addTier and addSkuFromHubspotProduct seed these
      // automatically. But handle it: insert with defaults for the row,
      // overwrite with form values.
      const [inserted] = await db
        .insert(productionInputs)
        .values({
          quoteSkuId,
          tierId,
          ...newFields,
        })
        .returning();
      rowId = inserted.id;
      const diff: Diff = {};
      for (const [k, v] of Object.entries(newFields)) {
        if (v !== null) diff[k] = { from: null, to: v };
      }
      await logAudit({
        userId: user.id,
        entityType: "production_input",
        entityId: rowId,
        action: "created",
        diffJson: diff,
      });
      revalidatePath(
        `/projects/${quote.projectId}/quotes/${quote.id}/production`,
      );
      return { rowId, ...newFields };
    } else {
      const row = existingRows[0];
      rowId = row.id;
      before = {
        fillingBlendingCost: row.fillingBlendingCost,
        cmAssemblyTotal: row.cmAssemblyTotal,
        setupFeeTotal: row.setupFeeTotal,
        toolingArtworkTotal: row.toolingArtworkTotal,
        rdTotal: row.rdTotal,
        otherServiceTotal: row.otherServiceTotal,
        bulkRawCost: row.bulkRawCost,
        actualUnitsProduced: row.actualUnitsProduced,
      };

      // Build diff using numeric equality for numeric columns (avoid
      // spurious "0.40" vs "0.4" change records).
      const diff: Diff = {};
      const numericKeys = [
        "fillingBlendingCost",
        "cmAssemblyTotal",
        "setupFeeTotal",
        "toolingArtworkTotal",
        "rdTotal",
        "otherServiceTotal",
        "bulkRawCost",
      ] as const;
      for (const k of numericKeys) {
        if (!numericEquals(before[k], newFields[k])) {
          diff[k] = { from: before[k], to: newFields[k] };
        }
      }
      if (before.actualUnitsProduced !== newFields.actualUnitsProduced) {
        diff.actualUnitsProduced = {
          from: before.actualUnitsProduced,
          to: newFields.actualUnitsProduced,
        };
      }

      if (Object.keys(diff).length === 0) {
        // No-op; return the existing row's snapshot.
        return { rowId, ...before };
      }

      await db
        .update(productionInputs)
        .set({ ...newFields, updatedAt: new Date() })
        .where(eq(productionInputs.id, rowId));

      await logAudit({
        userId: user.id,
        entityType: "production_input",
        entityId: rowId,
        action: "updated",
        diffJson: diff,
      });

      revalidatePath(
        `/projects/${quote.projectId}/quotes/${quote.id}/production`,
      );
      return { rowId, ...newFields };
    }
  });
}

// ---------- per-SKU policy fan-out ----------

// Updates the three per-SKU policy fields (customer_ships_raws,
// allocate_service_fees_to_cost, notes) across ALL tier rows of this SKU
// in one statement. Per-tier cost fields are explicitly NOT touched —
// bulk_raw_cost in particular survives a customer_ships_raws toggle.
export async function updateSkuProductionPolicy(
  formData: FormData,
): Promise<ActionResult<ProductionPolicySnapshot>> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");

    const user = await ensureUser();
    const { quote } = await quoteForSku(quoteSkuId);

    const newCustomerShipsRaws = parseBool(formData.get("customerShipsRaws"));
    const newAllocate = parseBool(formData.get("allocateServiceFeesToCost"));
    const newNotes = trimOrNull(formData.get("notes"));

    // Read current policy from any one tier row (denormalized; all rows
    // carry the same values).
    const beforeRows = await db
      .select({
        customerShipsRaws: productionInputs.customerShipsRaws,
        allocateServiceFeesToCost: productionInputs.allocateServiceFeesToCost,
        notes: productionInputs.notes,
      })
      .from(productionInputs)
      .where(eq(productionInputs.quoteSkuId, quoteSkuId))
      .limit(1);
    if (beforeRows.length === 0) {
      // This shouldn't happen for a leaf SKU — addTier / SKU creation
      // seeds rows. Treat as a no-op rather than a hard error.
      return {
        quoteSkuId,
        customerShipsRaws: newCustomerShipsRaws,
        allocateServiceFeesToCost: newAllocate,
        notes: newNotes,
      };
    }
    const before = beforeRows[0];

    const diff: Diff = {};
    if (before.customerShipsRaws !== newCustomerShipsRaws) {
      diff.customer_ships_raws = {
        from: before.customerShipsRaws,
        to: newCustomerShipsRaws,
      };
    }
    if (before.allocateServiceFeesToCost !== newAllocate) {
      diff.allocate_service_fees_to_cost = {
        from: before.allocateServiceFeesToCost,
        to: newAllocate,
      };
    }
    if (before.notes !== newNotes) {
      diff.notes = { from: before.notes, to: newNotes };
    }

    if (Object.keys(diff).length === 0) {
      return {
        quoteSkuId,
        customerShipsRaws: before.customerShipsRaws,
        allocateServiceFeesToCost: before.allocateServiceFeesToCost,
        notes: before.notes,
      };
    }

    // Fan out to every tier row of this SKU. NOT touching any per-tier
    // cost columns — bulk_raw_cost in particular survives this update.
    await db
      .update(productionInputs)
      .set({
        customerShipsRaws: newCustomerShipsRaws,
        allocateServiceFeesToCost: newAllocate,
        notes: newNotes,
        updatedAt: new Date(),
      })
      .where(eq(productionInputs.quoteSkuId, quoteSkuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: quoteSkuId,
      action: "production_policy_updated",
      diffJson: diff,
    });

    revalidatePath(
      `/projects/${quote.projectId}/quotes/${quote.id}/production`,
    );

    return {
      quoteSkuId,
      customerShipsRaws: newCustomerShipsRaws,
      allocateServiceFeesToCost: newAllocate,
      notes: newNotes,
    };
  });
}
