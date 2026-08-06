"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  parseDecimalInput,
  parseMarkupDecimal,
  parseUnitMoney,
} from "@/lib/numeric-input";
import {
  assemblyLeafInputs,
  assemblyLeaves,
  auditLog,
  markupDefaults,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import type { HubSpotVendor } from "@/lib/integrations/hubspot-provider";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  quoteForAssemblyLeaf,
  quoteForAssemblyLeafInputLineGroup,
} from "@/lib/quote-guards";
import { reconcileWarnings } from "./warnings";

// ---------- Slice 11.5 — assembly_leaf_inputs write actions ----------
//
// NEW-model successors to the OLD `actions/packaging.ts` suite
// (addPackagingLine, updatePackagingLineMetadata, deletePackagingLine,
// updatePackagingTierCell). Per brief §4: 4 NEW actions replace 7 OLD
// (revertMarkupToDefault, movePackagingLine, copyTierValueToAllTiers,
// countPackagingLinesForQuote not in §4 list — orphan callers + dead
// code drop in Step 8).
//
// Audit names per brief §4 (v2 A7 implementation-time check):
//   - assembly_leaf_input_line_added
//   - assembly_leaf_input_line_updated
//   - assembly_leaf_input_line_deleted
//   - assembly_leaf_input_cell_updated
//
// FormData contract preserves OLD field names per Q2 (a) preserve-
// prop-names disposition. The "quoteSkuId" field carries an
// assembly_leaf.id; "rowId" carries an assembly_leaf_inputs.id;
// "lineGroupId" carries an assembly_leaf_inputs.line_group_id.

export type PackagingLineSnapshot = {
  lineGroupId: string;
  pricingVendorHubspotCompanyId: string | null;
  pricingVendorNameSnapshot: string | null;
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
};

export type PackagingCellSnapshot = {
  rowId: string;
  unitCost: string | null;
  purchaseQty: string | null;
};

// ---------- helpers (copied verbatim from OLD packaging.ts) ----------

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

export async function searchPricingVendors(
  query: string,
): Promise<HubSpotVendor[]> {
  await ensureUser();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const { hubspot } = await getApplicationDependencies();
  return hubspot.searchVendors(trimmed, 20);
}

function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

async function lookupCategoryDefault(
  category: string | null,
): Promise<string | null> {
  if (!category) return null;
  const rows = await db
    .select({ pct: markupDefaults.defaultMarkupPct })
    .from(markupDefaults)
    .where(eq(markupDefaults.category, category))
    .limit(1);
  return rows[0]?.pct ?? null;
}

// ---------- line actions ----------

// Replaces OLD addPackagingLine. FormData field "quoteSkuId" carries
// the assembly_leaf.id (Q2 (a) — preserve prop names, point at NEW
// table IDs).
/**
 * REMOVED: addAssemblyLeafInput (manual "Add line" in Packaging).
 *
 * Setup owns packaging structure; Costs consumes and prices it. Multiple
 * cartons, labels or inserts are separate Setup components, not PM-authored
 * cost rows. Packaging rows now materialize from Setup structure through
 * src/lib/packaging-materialization.ts on both axes -- leaf attach and tier
 * creation -- so there is no state this action was needed to reach.
 *
 * Business Authority confirmation, 2026-08-06.
 */

export async function updateAssemblyLeafInputLineMeta(
  formData: FormData,
): Promise<ActionResult<PackagingLineSnapshot>> {
  return runAction(async () => {
    const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
    if (!lineGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

    const user = await ensureUser();
    const { attachment } = await quoteForAssemblyLeafInputLineGroup(lineGroupId);

    const beforeRows = await db
      .select()
      .from(assemblyLeafInputs)
      .where(eq(assemblyLeafInputs.lineGroupId, lineGroupId))
      .limit(1);
    if (beforeRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Line not found");
    const beforeRow = beforeRows[0];

    const requestedVendorId = trimOrNull(
      formData.get("pricingVendorHubspotCompanyId"),
    );
    let newPricingVendor: HubSpotVendor | null = null;
    if (requestedVendorId !== null) {
      if (
        requestedVendorId === beforeRow.pricingVendorHubspotCompanyId &&
        beforeRow.pricingVendorNameSnapshot
      ) {
        // A snapshot is historical evidence, not a live company label. Resolve
        // only a newly selected identity; unrelated edits must never rewrite it
        // after a HubSpot rename.
        newPricingVendor = {
          id: requestedVendorId,
          name: beforeRow.pricingVendorNameSnapshot,
        };
      } else {
        const { hubspot } = await getApplicationDependencies();
        newPricingVendor = await hubspot.resolveVendor(requestedVendorId);
        if (!newPricingVendor) {
          throw new ActionGuardError(
            ERR.VALIDATION,
            "Pricing Vendor is missing, archived, or no longer classified as a HubSpot Vendor.",
            "pricingVendorHubspotCompanyId",
          );
        }
      }
    }
    const newQtyPerSellableUnit = parseDecimalInput(
      formData.get("qtyPerSellableUnit"),
      {
        field: "qtyPerSellableUnit",
        label: "Quantity per sellable unit",
        nullable: true,
        precision: 12,
        scale: 4,
        minExclusive: 0,
      },
    );
    const newCategory = trimOrNull(formData.get("category"));
    const newInventoryEligible =
      formData.get("inventoryEligible") === "on" ||
      formData.get("inventoryEligible") === "true";
    const newNotes = trimOrNull(formData.get("notes"));

    const formMarkup = parseMarkupDecimal(
      formData.get("markupPct"),
      "markupPct",
      "Packaging markup",
    );
    const dbMarkup = beforeRow.markupPct;
    const dbCategory = beforeRow.category;
    const dbSource = beforeRow.markupPctSource;

    const markupChanged = !numericEquals(formMarkup, dbMarkup);
    const categoryChanged = newCategory !== dbCategory;

    let nextMarkupPct: string | null = dbMarkup;
    let nextMarkupSource:
      | "category_default"
      | "manual_override"
      | null = dbSource;

    if (markupChanged) {
      nextMarkupPct = formMarkup;
      if (formMarkup === null) {
        nextMarkupSource = null;
      } else {
        const newCategoryDefault = await lookupCategoryDefault(newCategory);
        nextMarkupSource = numericEquals(formMarkup, newCategoryDefault)
          ? "category_default"
          : "manual_override";
      }
    } else if (categoryChanged) {
      if (dbSource === "manual_override") {
        // Rule 2: sticky override — preserve markup + source.
      } else {
        const newCategoryDefault = await lookupCategoryDefault(newCategory);
        nextMarkupPct = newCategoryDefault;
        nextMarkupSource = newCategoryDefault !== null ? "category_default" : null;
      }
    }

    const before = {
      pricing_vendor_hubspot_company_id:
        beforeRow.pricingVendorHubspotCompanyId,
      pricing_vendor_name_snapshot: beforeRow.pricingVendorNameSnapshot,
      qty_per_sellable_unit: beforeRow.qtyPerSellableUnit,
      category: beforeRow.category,
      markup_pct: beforeRow.markupPct,
      markup_pct_source: beforeRow.markupPctSource,
      inventory_eligible: beforeRow.inventoryEligible,
      notes: beforeRow.notes,
    };
    const after = {
      pricing_vendor_hubspot_company_id: newPricingVendor?.id ?? null,
      pricing_vendor_name_snapshot: newPricingVendor?.name ?? null,
      qty_per_sellable_unit: newQtyPerSellableUnit,
      category: newCategory,
      markup_pct: nextMarkupPct,
      markup_pct_source: nextMarkupSource,
      inventory_eligible: newInventoryEligible,
      notes: newNotes,
    };

    function snapshot(
      pricingVendorHubspotCompanyId: string | null,
      pricingVendorNameSnapshot: string | null,
      supplier: string | null,
      qty: string | null,
      category: string | null,
      markupPct: string | null,
      markupPctSource: "category_default" | "manual_override" | null,
      inventoryEligible: boolean,
      notes: string | null,
    ): PackagingLineSnapshot {
      return {
        lineGroupId,
        pricingVendorHubspotCompanyId,
        pricingVendorNameSnapshot,
        supplier,
        qtyPerSellableUnit: qty,
        category,
        markupPct,
        markupPctSource,
        inventoryEligible,
        notes,
      };
    }

    const diff = diffOf(before, after);
    if (Object.keys(diff).length === 0) {
      return snapshot(
        beforeRow.pricingVendorHubspotCompanyId,
        beforeRow.pricingVendorNameSnapshot,
        beforeRow.supplier,
        beforeRow.qtyPerSellableUnit,
        beforeRow.category,
        beforeRow.markupPct,
        beforeRow.markupPctSource,
        beforeRow.inventoryEligible,
        beforeRow.notes,
      );
    }

    await db
      .update(assemblyLeafInputs)
      .set({
        pricingVendorHubspotCompanyId: newPricingVendor?.id ?? null,
        pricingVendorNameSnapshot: newPricingVendor?.name ?? null,
        qtyPerSellableUnit: newQtyPerSellableUnit,
        category: newCategory,
        markupPct: nextMarkupPct,
        markupPctSource: nextMarkupSource,
        inventoryEligible: newInventoryEligible,
        notes: newNotes,
        updatedAt: new Date(),
      })
      .where(eq(assemblyLeafInputs.lineGroupId, lineGroupId));

    await logAudit({
      userId: user.id,
      entityType: "assembly_leaf_input_line",
      entityId: lineGroupId,
      action: "assembly_leaf_input_line_updated",
      diffJson: {
        quote_leaf_id: attachment.quoteLeafId,
        assembly_leaf_id: attachment.assemblyLeafId,
        ...diff,
      },
    });

    // Per-cell metadata autosave returns the canonical persisted receipt and
    // realtime reconciles other sessions. Revalidating the quote tree here can
    // remount sibling inputs and cancel a second pending debounced edit.
    return snapshot(
      newPricingVendor?.id ?? null,
      newPricingVendor?.name ?? null,
      beforeRow.supplier,
      newQtyPerSellableUnit,
      newCategory,
      nextMarkupPct,
      nextMarkupSource,
      newInventoryEligible,
      newNotes,
    );
  });
}

// Replaces OLD deletePackagingLine.
export async function deleteAssemblyLeafInputLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
    if (!lineGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

    const user = await ensureUser();
    const { quote, attachment } = await quoteForAssemblyLeafInputLineGroup(lineGroupId);

    const beforeRow = (
      await db
        .select({
          supplier: assemblyLeafInputs.supplier,
          category: assemblyLeafInputs.category,
        })
        .from(assemblyLeafInputs)
        .where(eq(assemblyLeafInputs.lineGroupId, lineGroupId))
        .limit(1)
    )[0];

    await db
      .delete(assemblyLeafInputs)
      .where(eq(assemblyLeafInputs.lineGroupId, lineGroupId));

    await logAudit({
      userId: user.id,
      entityType: "assembly_leaf_input_line",
      entityId: lineGroupId,
      action: "assembly_leaf_input_line_deleted",
      diffJson: {
        quote_leaf_id: attachment.quoteLeafId,
        assembly_leaf_id: attachment.assemblyLeafId,
        supplier: beforeRow?.supplier ?? null,
        category: beforeRow?.category ?? null,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// ---------- per-tier cell actions ----------

// Replaces OLD updatePackagingTierCell. FormData field "rowId"
// carries the assembly_leaf_inputs.id (Q2 (a) — preserve prop
// names).
export async function updateAssemblyLeafInputCell(
  formData: FormData,
): Promise<ActionResult<PackagingCellSnapshot>> {
  return runAction(async () => {
    const rowId = String(formData.get("rowId") ?? "").trim();
    if (!rowId) throw new ActionGuardError(ERR.VALIDATION, "rowId required");

    const user = await ensureUser();

    // Resolve row + quote + draft assertion via direct query (no
    // single-step guard helper for cell-level resolution since the
    // common case is one row).
    const rows = await db
      .select({
        row: assemblyLeafInputs,
        assemblyLeaf: assemblyLeaves,
      })
      .from(assemblyLeafInputs)
      .innerJoin(
        assemblyLeaves,
        eq(assemblyLeaves.id, assemblyLeafInputs.assemblyLeafId),
      )
      .where(eq(assemblyLeafInputs.id, rowId))
      .limit(1);
    if (rows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Cell not found");
    const { row, assemblyLeaf } = rows[0];
    // Reuse quoteForAssemblyLeaf to validate draft + recover quote
    // for the revalidate path.
    const { quote, attachment } = await quoteForAssemblyLeaf(assemblyLeaf.id);

    const newUnitCost = parseUnitMoney(
      formData.get("unitCost"),
      "unitCost",
      "Packaging unit cost",
    );
    const newPurchaseQty = parseDecimalInput(formData.get("purchaseQty"), {
      field: "purchaseQty",
      label: "Purchase quantity",
      nullable: true,
      precision: 18,
      scale: 4,
      min: 0,
    });

    const before = { unit_cost: row.unitCost, purchase_qty: row.purchaseQty };
    const after = { unit_cost: newUnitCost, purchase_qty: newPurchaseQty };
    const diff = diffOf(before, after);
    if (Object.keys(diff).length === 0) {
      return { rowId, unitCost: row.unitCost, purchaseQty: row.purchaseQty };
    }

    await db
      .update(assemblyLeafInputs)
      .set({
        unitCost: newUnitCost,
        purchaseQty: newPurchaseQty,
        updatedAt: new Date(),
      })
      .where(eq(assemblyLeafInputs.id, rowId));

    // Slice 9.5 — reconcile validation warnings on action commit
    // (NULL-safe: reconcileWarnings reads from costing-bundle and
    // is model-agnostic post-Step-3 adapter migration).
    const cascade = await reconcileWarnings({ quoteId: quote.id });

    await logAudit({
      userId: user.id,
      entityType: "assembly_leaf_input",
      entityId: rowId,
      action: "assembly_leaf_input_cell_updated",
      diffJson:
        cascade.inserted + cascade.resolved + cascade.evaluated > 0
          ? {
              quote_leaf_id: attachment.quoteLeafId,
              assembly_leaf_id: assemblyLeaf.id,
              ...diff,
              cascaded_warnings: cascade,
            }
          : {
              quote_leaf_id: attachment.quoteLeafId,
              assembly_leaf_id: assemblyLeaf.id,
              ...diff,
            },
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return { rowId, unitCost: newUnitCost, purchaseQty: newPurchaseQty };
  });
}

// `and` and `quoteForAssemblyLeafInputLineGroup`-helper-imports are
// kept even though the v1.1+-banked copyTierValueToAllTiers /
// movePackagingLine analogs aren't implemented yet — see UX_BACKLOG
// "Per-assembly production fan-out" header note for the broader
// deferral list. Re-instate when their NEW analogs ship.
void and;
