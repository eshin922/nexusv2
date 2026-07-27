"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  assemblyProductionInputs,
  auditLog,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { quoteForAssembly } from "@/lib/quote-guards";

// ---------- Slice 11.5 — assembly_production_inputs write actions ----------
//
// NEW-model successors to the OLD `actions/production.ts` suite
// (upsertProductionInputs, updateSkuProductionPolicy). Per brief §4:
// 2 NEW actions replace the 2 OLD; countProductionCellsWithDataForQuote
// has no callers (dead code; not migrated).
//
// Audit names per brief §4 (v2 A7 implementation-time check):
//   - assembly_production_input_updated
//   - assembly_production_policy_updated
//
// FormData contract preserves OLD field names per Q2 (a). The
// "quoteSkuId" field now carries an assembly.id (not assembly_leaf.id
// — production policy lives at assembly level in NEW model per brief
// §2; the UI prop name keeps "quoteSkuId" but the value semantic
// shifts to assembly identity).

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

// ---------- helpers (copied verbatim from OLD production.ts) ----------

type Diff = Record<string, { from: unknown; to: unknown }>;

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

function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

// ---------- per-tier cell actions ----------

// Replaces OLD upsertProductionInputs. FormData field "quoteSkuId"
// carries the assembly.id (Q2 (a) preserve prop name; value shifts
// from leaf-keyed to assembly-keyed per brief §2).
export async function upsertAssemblyProductionInputs(
  formData: FormData,
): Promise<ActionResult<ProductionCellSnapshot>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("quoteSkuId") ?? "").trim();
    const tierId = String(formData.get("tierId") ?? "").trim();
    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");
    if (!tierId) throw new ActionGuardError(ERR.VALIDATION, "tierId required");

    const user = await ensureUser();
    const { quote } = await quoteForAssembly(assemblyId);

    const newFields = {
      fillingBlendingCost: parseNumericOrNull(formData.get("fillingBlendingCost")),
      cmAssemblyTotal: parseNumericOrNull(formData.get("cmAssemblyTotal")),
      setupFeeTotal: parseNumericOrNull(formData.get("setupFeeTotal")),
      toolingArtworkTotal: parseNumericOrNull(
        formData.get("toolingArtworkTotal"),
      ),
      rdTotal: parseNumericOrNull(formData.get("rdTotal")),
      otherServiceTotal: parseNumericOrNull(formData.get("otherServiceTotal")),
      bulkRawCost: parseNumericOrNull(formData.get("bulkRawCost")),
      actualUnitsProduced: parseIntOrNull(formData.get("actualUnitsProduced")),
    };

    const existingRows = await db
      .select()
      .from(assemblyProductionInputs)
      .where(
        and(
          eq(assemblyProductionInputs.assemblyId, assemblyId),
          eq(assemblyProductionInputs.tierId, tierId),
        ),
      )
      .limit(1);

    if (existingRows.length === 0) {
      // Slice 11 matrix Fix 1a (2026-07-27) — inherit policy from
      // sibling rows. When #126's per-cell fix started actually
      // reaching this INSERT branch (previously silently no-op'd
      // due to leaf-vs-assembly ID mismatch), fresh rows were
      // getting schema defaults (customerShipsRaws=false,
      // allocateServiceFeesToCost=true). If the PM had previously
      // toggled allocate=false on another tier row for this
      // assembly, the new tier row inherited a CONFLICTING policy
      // (alloc=true) — resolver picked the first row arbitrarily
      // and rendered accordingly, silently violating PM intent.
      //
      // Fix: look up any existing sibling row for this assembly
      // and inherit customerShipsRaws + allocateServiceFeesToCost
      // + notes. Only fall back to schema defaults when NO sibling
      // exists (this is the true first-touch on the assembly).
      const siblingRows = await db
        .select({
          customerShipsRaws: assemblyProductionInputs.customerShipsRaws,
          allocateServiceFeesToCost:
            assemblyProductionInputs.allocateServiceFeesToCost,
          notes: assemblyProductionInputs.notes,
        })
        .from(assemblyProductionInputs)
        .where(eq(assemblyProductionInputs.assemblyId, assemblyId))
        .limit(1);
      const inheritedPolicy =
        siblingRows.length > 0
          ? {
              customerShipsRaws: siblingRows[0].customerShipsRaws,
              allocateServiceFeesToCost:
                siblingRows[0].allocateServiceFeesToCost,
              notes: siblingRows[0].notes,
            }
          : {};

      const [inserted] = await db
        .insert(assemblyProductionInputs)
        .values({
          assemblyId,
          tierId,
          ...inheritedPolicy,
          ...newFields,
        })
        .returning();
      const rowId = inserted.id;
      const diff: Diff = {};
      for (const [k, v] of Object.entries(newFields)) {
        if (v !== null) diff[k] = { from: null, to: v };
      }
      await logAudit({
        userId: user.id,
        entityType: "assembly_production_input",
        entityId: rowId,
        action: "assembly_production_input_updated",
        diffJson: diff,
      });
      revalidateQuoteTree(quote.projectId, quote.id);
      return { rowId, ...newFields };
    }

    const row = existingRows[0];
    const rowId = row.id;
    const before = {
      fillingBlendingCost: row.fillingBlendingCost,
      cmAssemblyTotal: row.cmAssemblyTotal,
      setupFeeTotal: row.setupFeeTotal,
      toolingArtworkTotal: row.toolingArtworkTotal,
      rdTotal: row.rdTotal,
      otherServiceTotal: row.otherServiceTotal,
      bulkRawCost: row.bulkRawCost,
      actualUnitsProduced: row.actualUnitsProduced,
    };

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
      return { rowId, ...before };
    }

    await db
      .update(assemblyProductionInputs)
      .set({ ...newFields, updatedAt: new Date() })
      .where(eq(assemblyProductionInputs.id, rowId));

    await logAudit({
      userId: user.id,
      entityType: "assembly_production_input",
      entityId: rowId,
      action: "assembly_production_input_updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);
    return { rowId, ...newFields };
  });
}

// ---------- per-assembly policy fan-out ----------

// Replaces OLD updateSkuProductionPolicy. Fans the policy across all
// tier rows for this assembly (denormalized; same as OLD).
export async function updateAssemblyProductionPolicy(
  formData: FormData,
): Promise<ActionResult<ProductionPolicySnapshot>> {
  return runAction(async () => {
    const assemblyId = String(formData.get("quoteSkuId") ?? "").trim();
    if (!assemblyId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");

    const user = await ensureUser();
    const { quote } = await quoteForAssembly(assemblyId);

    const newCustomerShipsRaws = parseBool(formData.get("customerShipsRaws"));
    const newAllocate = parseBool(formData.get("allocateServiceFeesToCost"));
    const newNotes = trimOrNull(formData.get("notes"));

    const beforeRows = await db
      .select({
        customerShipsRaws: assemblyProductionInputs.customerShipsRaws,
        allocateServiceFeesToCost:
          assemblyProductionInputs.allocateServiceFeesToCost,
        notes: assemblyProductionInputs.notes,
      })
      .from(assemblyProductionInputs)
      .where(eq(assemblyProductionInputs.assemblyId, assemblyId))
      .limit(1);
    if (beforeRows.length === 0) {
      // No production_inputs rows yet for this assembly — treat as
      // no-op. Setup UI seeds policy rows lazily via the production
      // drilldown; if no row exists, the policy is the default
      // (customerShipsRaws=false, allocateServiceFeesToCost=true).
      // The UI re-fires the action when the user touches the cell.
      return {
        quoteSkuId: assemblyId,
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
        quoteSkuId: assemblyId,
        customerShipsRaws: before.customerShipsRaws,
        allocateServiceFeesToCost: before.allocateServiceFeesToCost,
        notes: before.notes,
      };
    }

    await db
      .update(assemblyProductionInputs)
      .set({
        customerShipsRaws: newCustomerShipsRaws,
        allocateServiceFeesToCost: newAllocate,
        notes: newNotes,
        updatedAt: new Date(),
      })
      .where(eq(assemblyProductionInputs.assemblyId, assemblyId));

    await logAudit({
      userId: user.id,
      entityType: "assembly",
      entityId: assemblyId,
      action: "assembly_production_policy_updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteSkuId: assemblyId,
      customerShipsRaws: newCustomerShipsRaws,
      allocateServiceFeesToCost: newAllocate,
      notes: newNotes,
    };
  });
}
