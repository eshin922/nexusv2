"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  assemblyProductionInputs,
  auditLog,
  quoteTiers,
} from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
  assertDraft,
} from "@/lib/action-result";
import { quoteForAssembly } from "@/lib/quote-guards";
import {
  parseIntegerInput,
  parseMoneyTotal,
} from "@/lib/numeric-input";
import { DEFAULT_ASSEMBLY_POLICY } from "@/lib/production-policy";

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
  toolingTotal: string | null;
  artworkTotal: string | null;
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

/**
 * Delegates to the single audit writer (src/lib/audit.ts). Kept as a local
 * alias so call sites in this file are unchanged -- the sweep changes how audit
 * rows are written, never what an action means or when it emits.
 */
async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await writeAuditEntry(args);
}

function trimOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
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
    // Lifecycle, not just ownership. Economics are authored in draft; the
    // governed way to change them after a send is revise-to-draft, which
    // supersedes the frozen matrix rather than editing underneath it.
    assertDraft((await quoteForAssembly(assemblyId)).quote);

    const changedFieldRaw = String(formData.get("changedField") ?? "").trim();
    const editableFields = [
      "fillingBlendingCost",
      "cmAssemblyTotal",
      "setupFeeTotal",
      "toolingArtworkTotal",
      "toolingTotal",
      "artworkTotal",
      "rdTotal",
      "otherServiceTotal",
      "bulkRawCost",
      "actualUnitsProduced",
    ] as const;
    const changedField =
      changedFieldRaw === ""
        ? null
        : editableFields.find((field) => field === changedFieldRaw);
    if (changedFieldRaw !== "" && !changedField) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Unknown production input field.",
        "changedField",
      );
    }

    const submittedFields = {
      fillingBlendingCost: parseMoneyTotal(
        formData.get("fillingBlendingCost"),
        "fillingBlendingCost",
        "Filling / blending tier total",
      ),
      cmAssemblyTotal: parseMoneyTotal(
        formData.get("cmAssemblyTotal"),
        "cmAssemblyTotal",
        "Contract manufacturing tier total",
      ),
      setupFeeTotal: parseMoneyTotal(
        formData.get("setupFeeTotal"),
        "setupFeeTotal",
        "Setup fee total",
      ),
      // LEGACY. Still writable so an operator can clear it while resolving the
      // amount into the two governed inputs below — the resolution path needs
      // to zero the combined value, and a read-only column could not be
      // resolved at all.
      toolingArtworkTotal: parseMoneyTotal(
        formData.get("toolingArtworkTotal"),
        "toolingArtworkTotal",
        "Tooling / artwork fee total (legacy)",
      ),
      toolingTotal: parseMoneyTotal(
        formData.get("toolingTotal"),
        "toolingTotal",
        "Tooling fee total",
      ),
      artworkTotal: parseMoneyTotal(
        formData.get("artworkTotal"),
        "artworkTotal",
        "Artwork fee total",
      ),
      rdTotal: parseMoneyTotal(
        formData.get("rdTotal"),
        "rdTotal",
        "Research / development fee total",
      ),
      otherServiceTotal: parseMoneyTotal(
        formData.get("otherServiceTotal"),
        "otherServiceTotal",
        "Other service fee total",
      ),
      bulkRawCost: parseMoneyTotal(
        formData.get("bulkRawCost"),
        "bulkRawCost",
        "Bulk raw tier total",
      ),
      actualUnitsProduced: parseIntegerInput(
        formData.get("actualUnitsProduced"),
        {
          field: "actualUnitsProduced",
          label: "Actual units produced",
          nullable: true,
          minExclusive: 0,
          max: 2147483647,
        },
      ),
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
          ...submittedFields,
        })
        .returning();
      const rowId = inserted.id;
      const persistedFields = {
        fillingBlendingCost: inserted.fillingBlendingCost,
        cmAssemblyTotal: inserted.cmAssemblyTotal,
        setupFeeTotal: inserted.setupFeeTotal,
        toolingArtworkTotal: inserted.toolingArtworkTotal,
        toolingTotal: inserted.toolingTotal,
        artworkTotal: inserted.artworkTotal,
        rdTotal: inserted.rdTotal,
        otherServiceTotal: inserted.otherServiceTotal,
        bulkRawCost: inserted.bulkRawCost,
        actualUnitsProduced: inserted.actualUnitsProduced,
      };
      const diff: Diff = {};
      for (const [k, v] of Object.entries(persistedFields)) {
        if (v !== null) diff[k] = { from: null, to: v };
      }
      await logAudit({
        userId: user.id,
        entityType: "assembly_production_input",
        entityId: rowId,
        action: "assembly_production_input_updated",
        diffJson: diff,
      });
      // The canonical action receipt updates this client and production
      // realtime reconciles other sessions. Revalidation here remounts sibling
      // cells and cancels their pending debounced saves.
      return { rowId, ...persistedFields };
    }

    const row = existingRows[0];
    const rowId = row.id;
    const before = {
      fillingBlendingCost: row.fillingBlendingCost,
      cmAssemblyTotal: row.cmAssemblyTotal,
      setupFeeTotal: row.setupFeeTotal,
      toolingArtworkTotal: row.toolingArtworkTotal,
      toolingTotal: row.toolingTotal,
      artworkTotal: row.artworkTotal,
      rdTotal: row.rdTotal,
      otherServiceTotal: row.otherServiceTotal,
      bulkRawCost: row.bulkRawCost,
      actualUnitsProduced: row.actualUnitsProduced,
    };
    // Autosave patches one cell. Preserve persisted siblings even when the
    // component's server props predate lazy-row creation or a prior save.
    const newFields = changedField
      ? { ...before, [changedField]: submittedFields[changedField] }
      : submittedFields;

    const diff: Diff = {};
    const numericKeys = [
      "fillingBlendingCost",
      "cmAssemblyTotal",
      "setupFeeTotal",
      "toolingArtworkTotal",
      "toolingTotal",
      "artworkTotal",
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

    const [persisted] = await db
      .update(assemblyProductionInputs)
      .set({ ...newFields, updatedAt: new Date() })
      .where(eq(assemblyProductionInputs.id, rowId))
      .returning();

    const persistedFields = {
      fillingBlendingCost: persisted.fillingBlendingCost,
      cmAssemblyTotal: persisted.cmAssemblyTotal,
      setupFeeTotal: persisted.setupFeeTotal,
      toolingArtworkTotal: persisted.toolingArtworkTotal,
      toolingTotal: persisted.toolingTotal,
      artworkTotal: persisted.artworkTotal,
      rdTotal: persisted.rdTotal,
      otherServiceTotal: persisted.otherServiceTotal,
      bulkRawCost: persisted.bulkRawCost,
      actualUnitsProduced: persisted.actualUnitsProduced,
    };
    const canonicalDiff: Diff = {};
    for (const key of Object.keys(diff)) {
      const field = key as keyof typeof persistedFields;
      canonicalDiff[field] = {
        from: before[field],
        to: persistedFields[field],
      };
    }

    await logAudit({
      userId: user.id,
      entityType: "assembly_production_input",
      entityId: rowId,
      action: "assembly_production_input_updated",
      diffJson: canonicalDiff,
    });

    return { rowId, ...persistedFields };
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
    // Same lifecycle rule as the cost cells above: allocation policy decides
    // whether a fee is billed separately, which is an economic statement.
    assertDraft(quote);

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
      // No policy row for this assembly yet — CREATE the rows the policy needs
      // to live on.
      //
      // This used to return a no-op that reported the caller's own requested
      // values back with `ok: true`, so the UI believed the write had landed
      // while nothing was persisted and no audit row was written. Its comment
      // said "the UI re-fires the action when the user touches the cell",
      // which made authoring allocation depend on first entering a production
      // COST — a dependency BV-012's authoring correction removed and that the
      // operator has no way to discover.
      //
      // The column lives on `(assembly, tier)` rows, so persisting a
      // per-assembly policy means materialising one row per tier. Costs stay
      // null: this creates the place the policy lives, not any economics.
      const quoteTierRows = await db
        .select({ id: quoteTiers.id })
        .from(quoteTiers)
        .where(eq(quoteTiers.quoteId, quote.id));

      if (quoteTierRows.length === 0) {
        // Nothing to hang the policy on. Refuse loudly rather than repeat the
        // silent success this branch replaces.
        throw new ActionGuardError(
          ERR.VALIDATION,
          "Add at least one tier before setting production policy.",
        );
      }

      await db.insert(assemblyProductionInputs).values(
        quoteTierRows.map((t) => ({
          assemblyId,
          tierId: t.id,
          customerShipsRaws: newCustomerShipsRaws,
          allocateServiceFeesToCost: newAllocate,
          notes: newNotes,
        })),
      );

      await logAudit({
        userId: user.id,
        entityType: "assembly",
        entityId: assemblyId,
        action: "assembly_production_policy_updated",
        diffJson: {
          customer_ships_raws: {
            from: DEFAULT_ASSEMBLY_POLICY.customerShipsRaws,
            to: newCustomerShipsRaws,
          },
          allocate_service_fees_to_cost: {
            from: DEFAULT_ASSEMBLY_POLICY.allocateServiceFeesToCost,
            to: newAllocate,
          },
          notes: { from: null, to: newNotes },
          // Honest as a from/to rather than cast past the Diff type: there
          // were zero rows for this assembly, and there are now one per tier.
          row_count: { from: 0, to: quoteTierRows.length },
        },
      });

      revalidateQuoteTree(quote.projectId, quote.id);

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
