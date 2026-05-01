"use server";

import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  auditLog,
  markupDefaults,
  packagingInputs,
  quotes,
  quoteSkus,
  quoteTiers,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  quoteForLineGroup,
  quoteForSku,
  requireDraft,
} from "@/lib/quote-guards";

// Canonical line-level snapshot returned to the client after any line-level
// update. The client uses this to hydrate its controlled state — never
// the form's defaultValue (which races with React 19's auto-reset).
export type PackagingLineSnapshot = {
  lineGroupId: string;
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

// PostgreSQL numeric returns canonical strings ("0.4000") while form values
// arrive shorter ("0.4"). Compare numerically to avoid spurious "changes".
function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

async function lookupCategoryDefault(category: string | null): Promise<string | null> {
  if (!category) return null;
  const rows = await db
    .select({ pct: markupDefaults.defaultMarkupPct })
    .from(markupDefaults)
    .where(eq(markupDefaults.category, category))
    .limit(1);
  return rows[0]?.pct ?? null;
}

// ---------- line actions ----------

export async function addPackagingLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    if (!quoteSkuId) throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");

    const user = await ensureUser();
    const { quote, sku } = await quoteForSku(quoteSkuId);

    const tiers = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));
    if (tiers.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Add at least one tier to the quote before adding packaging lines.",
      );
    }

    const maxRow = await db
      .select({ max: max(packagingInputs.sortOrder) })
      .from(packagingInputs)
      .where(eq(packagingInputs.quoteSkuId, quoteSkuId));
    const sortOrder = (maxRow[0]?.max ?? -1) + 1;

    const lineGroupId = crypto.randomUUID();

    await db.insert(packagingInputs).values(
      tiers.map((t) => ({
        quoteSkuId,
        tierId: t.id,
        lineGroupId,
        sortOrder,
        inventoryEligible: false,
      })),
    );

    await logAudit({
      userId: user.id,
      entityType: "packaging_line",
      entityId: lineGroupId,
      action: "created",
      diffJson: { quote_sku_id: quoteSkuId, tier_count: tiers.length, sort_order: sortOrder },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
    void sku;
  });
}

export async function updatePackagingLineMetadata(
  formData: FormData,
): Promise<ActionResult<PackagingLineSnapshot>> {
  return runAction(async () => {
  const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
  if (!lineGroupId)
    throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

  const user = await ensureUser();
  const { quote } = await quoteForLineGroup(lineGroupId, "packaging_inputs");

  const beforeRows = await db
    .select()
    .from(packagingInputs)
    .where(eq(packagingInputs.lineGroupId, lineGroupId))
    .limit(1);
  if (beforeRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Line not found");
  const beforeRow = beforeRows[0];

  const newSupplier = trimOrNull(formData.get("supplier"));
  const newQtyPerSellableUnit = parseNumericOrNull(formData.get("qtyPerSellableUnit"));
  const newCategory = trimOrNull(formData.get("category"));
  const newInventoryEligible = formData.get("inventoryEligible") === "on" ||
    formData.get("inventoryEligible") === "true";
  const newNotes = trimOrNull(formData.get("notes"));


  // Markup propagation — sticky override is *tracked state*, not derived
  // from value comparison. Read existing source from the DB and decide
  // explicitly based on what changed:
  //
  //   1. category changed AND db.source == 'category_default'
  //        → markup = markup_defaults[newCategory], source stays 'category_default'
  //   2. category changed AND db.source == 'manual_override'
  //        → markup untouched, source stays 'manual_override' (sticky)
  //   3. markup changed (independent of category)
  //        → compare new value to NEW category's default
  //          equal → source = 'category_default'
  //          else  → source = 'manual_override'
  //   4. nothing changed → preserve as-is
  //
  // Note: revert-to-default is handled by a separate explicit action
  // (revertMarkupToDefault) — this handler never auto-flips sticky overrides.
  const formMarkup = trimOrNull(formData.get("markupPct"));
  const dbMarkup = beforeRow.markupPct;
  const dbCategory = beforeRow.category;
  const dbSource = beforeRow.markupPctSource;

  const markupChanged = !numericEquals(formMarkup, dbMarkup);
  const categoryChanged = newCategory !== dbCategory;

  let nextMarkupPct: string | null = dbMarkup;
  let nextMarkupSource: "category_default" | "manual_override" | null = dbSource;

  if (markupChanged) {
    // Rule 3: PM explicitly set a markup value. Source is determined by
    // comparing against the (post-update) category's default.
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
      // Rule 2: sticky override — preserve markup AND source.
    } else {
      // Rule 1: auto-update markup to new category's default.
      const newCategoryDefault = await lookupCategoryDefault(newCategory);
      nextMarkupPct = newCategoryDefault;
      nextMarkupSource = newCategoryDefault !== null ? "category_default" : null;
    }
  }
  // Rule 4 (nothing changed) — fallthrough preserves dbMarkup / dbSource.

  const before = {
    supplier: beforeRow.supplier,
    qty_per_sellable_unit: beforeRow.qtyPerSellableUnit,
    category: beforeRow.category,
    markup_pct: beforeRow.markupPct,
    markup_pct_source: beforeRow.markupPctSource,
    inventory_eligible: beforeRow.inventoryEligible,
    notes: beforeRow.notes,
  };
  const after = {
    supplier: newSupplier,
    qty_per_sellable_unit: newQtyPerSellableUnit,
    category: newCategory,
    markup_pct: nextMarkupPct,
    markup_pct_source: nextMarkupSource,
    inventory_eligible: newInventoryEligible,
    notes: newNotes,
  };

  function snapshot(
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
    .update(packagingInputs)
    .set({
      supplier: newSupplier,
      qtyPerSellableUnit: newQtyPerSellableUnit,
      category: newCategory,
      markupPct: nextMarkupPct,
      markupPctSource: nextMarkupSource,
      inventoryEligible: newInventoryEligible,
      notes: newNotes,
      updatedAt: new Date(),
    })
    .where(eq(packagingInputs.lineGroupId, lineGroupId));

  await logAudit({
    userId: user.id,
    entityType: "packaging_line",
    entityId: lineGroupId,
    action: "updated",
    diffJson: diff,
  });

  revalidateQuoteTree(quote.projectId, quote.id);

  return snapshot(
    newSupplier,
    newQtyPerSellableUnit,
    newCategory,
    nextMarkupPct,
    nextMarkupSource,
    newInventoryEligible,
    newNotes,
  );
  });
}

export async function revertMarkupToDefault(
  formData: FormData,
): Promise<ActionResult<PackagingLineSnapshot | null>> {
  return runAction(async () => {
  const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
  if (!lineGroupId)
    throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

  const user = await ensureUser();
  const { quote } = await quoteForLineGroup(lineGroupId, "packaging_inputs");

  const rows = await db
    .select()
    .from(packagingInputs)
    .where(eq(packagingInputs.lineGroupId, lineGroupId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  function rowSnapshot(
    markupPct: string | null,
    src: "category_default" | "manual_override" | null,
  ): PackagingLineSnapshot {
    return {
      lineGroupId,
      supplier: row.supplier,
      qtyPerSellableUnit: row.qtyPerSellableUnit,
      category: row.category,
      markupPct,
      markupPctSource: src,
      inventoryEligible: row.inventoryEligible,
      notes: row.notes,
    };
  }

  if (row.markupPctSource !== "manual_override")
    return rowSnapshot(row.markupPct, row.markupPctSource);

  const def = await lookupCategoryDefault(row.category);
  if (def === null) return rowSnapshot(row.markupPct, row.markupPctSource);

  await db
    .update(packagingInputs)
    .set({
      markupPct: def,
      markupPctSource: "category_default",
      updatedAt: new Date(),
    })
    .where(eq(packagingInputs.lineGroupId, lineGroupId));

  await logAudit({
    userId: user.id,
    entityType: "packaging_line",
    entityId: lineGroupId,
    action: "markup_reverted_to_default",
    diffJson: {
      markup_pct: { from: row.markupPct, to: def },
      markup_pct_source: { from: "manual_override", to: "category_default" },
    },
  });

  revalidateQuoteTree(quote.projectId, quote.id);

  return rowSnapshot(def, "category_default");
  });
}

export async function deletePackagingLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
  if (!lineGroupId)
    throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

  const user = await ensureUser();
  const { quote, sku } = await quoteForLineGroup(lineGroupId, "packaging_inputs");

  const beforeRow = (
    await db
      .select({
        supplier: packagingInputs.supplier,
        category: packagingInputs.category,
      })
      .from(packagingInputs)
      .where(eq(packagingInputs.lineGroupId, lineGroupId))
      .limit(1)
  )[0];

  await db.delete(packagingInputs).where(eq(packagingInputs.lineGroupId, lineGroupId));

  await logAudit({
    userId: user.id,
    entityType: "packaging_line",
    entityId: lineGroupId,
    action: "deleted",
    diffJson: {
      supplier: beforeRow?.supplier ?? null,
      category: beforeRow?.category ?? null,
    },
  });

  revalidateQuoteTree(quote.projectId, quote.id);
  void sku;
  });
}

export async function movePackagingLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") as "up" | "down";
  if (!lineGroupId)
    throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");
  if (direction !== "up" && direction !== "down")
    throw new ActionGuardError(ERR.VALIDATION, "direction must be up or down");

  const user = await ensureUser();
  const { quote, sku } = await quoteForLineGroup(lineGroupId, "packaging_inputs");

  const groupRow = (
    await db
      .select({ sortOrder: packagingInputs.sortOrder, quoteSkuId: packagingInputs.quoteSkuId })
      .from(packagingInputs)
      .where(eq(packagingInputs.lineGroupId, lineGroupId))
      .limit(1)
  )[0];
  if (!groupRow) return;

  // Distinct line groups under this SKU, ordered.
  const siblings = await db
    .selectDistinctOn([packagingInputs.lineGroupId], {
      lineGroupId: packagingInputs.lineGroupId,
      sortOrder: packagingInputs.sortOrder,
    })
    .from(packagingInputs)
    .where(eq(packagingInputs.quoteSkuId, groupRow.quoteSkuId))
    .orderBy(asc(packagingInputs.lineGroupId), asc(packagingInputs.sortOrder));

  // Sort by sortOrder for swap logic.
  siblings.sort((a, b) => a.sortOrder - b.sortOrder);

  const idx = siblings.findIndex((s) => s.lineGroupId === lineGroupId);
  const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
  if (!swapWith) return;

  await db.transaction(async (tx) => {
    await tx
      .update(packagingInputs)
      .set({ sortOrder: swapWith.sortOrder, updatedAt: new Date() })
      .where(eq(packagingInputs.lineGroupId, lineGroupId));
    await tx
      .update(packagingInputs)
      .set({ sortOrder: groupRow.sortOrder, updatedAt: new Date() })
      .where(eq(packagingInputs.lineGroupId, swapWith.lineGroupId));
  });

  await logAudit({
    userId: user.id,
    entityType: "packaging_line",
    entityId: lineGroupId,
    action: "reordered",
    diffJson: { sort_order: { from: groupRow.sortOrder, to: swapWith.sortOrder } },
  });

  revalidateQuoteTree(quote.projectId, quote.id);
  void sku;
  });
}

// ---------- per-tier cell actions ----------

export async function updatePackagingTierCell(
  formData: FormData,
): Promise<ActionResult<PackagingCellSnapshot>> {
  return runAction(async () => {
  const rowId = String(formData.get("rowId") ?? "").trim();
  if (!rowId) throw new ActionGuardError(ERR.VALIDATION, "rowId required");

  const user = await ensureUser();

  const rows = await db
    .select({ row: packagingInputs, quote: quotes })
    .from(packagingInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
    .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
    .where(eq(packagingInputs.id, rowId))
    .limit(1);
  if (rows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "Cell not found");
  const { row, quote } = rows[0];
  requireDraft(quote);

  const newUnitCost = parseNumericOrNull(formData.get("unitCost"));
  const newPurchaseQty = parseNumericOrNull(formData.get("purchaseQty"));

  const before = { unit_cost: row.unitCost, purchase_qty: row.purchaseQty };
  const after = { unit_cost: newUnitCost, purchase_qty: newPurchaseQty };
  const diff = diffOf(before, after);
  if (Object.keys(diff).length === 0) {
    return { rowId, unitCost: row.unitCost, purchaseQty: row.purchaseQty };
  }

  await db
    .update(packagingInputs)
    .set({
      unitCost: newUnitCost,
      purchaseQty: newPurchaseQty,
      updatedAt: new Date(),
    })
    .where(eq(packagingInputs.id, rowId));

  await logAudit({
    userId: user.id,
    entityType: "packaging_input",
    entityId: rowId,
    action: "updated",
    diffJson: diff,
  });

  revalidateQuoteTree(quote.projectId, quote.id);

  return { rowId, unitCost: newUnitCost, purchaseQty: newPurchaseQty };
  });
}

export async function copyTierValueToAllTiers(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
  const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
  const sourceTierId = String(formData.get("sourceTierId") ?? "").trim();
  const column = String(formData.get("column") ?? "").trim();
  if (!lineGroupId)
    throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");
  if (!sourceTierId)
    throw new ActionGuardError(ERR.VALIDATION, "sourceTierId required");
  if (column !== "unit_cost" && column !== "purchase_qty")
    throw new ActionGuardError(ERR.VALIDATION, `unsupported column: ${column}`);

  const user = await ensureUser();
  const { quote } = await quoteForLineGroup(lineGroupId, "packaging_inputs");

  const sourceRows = await db
    .select({
      unitCost: packagingInputs.unitCost,
      purchaseQty: packagingInputs.purchaseQty,
    })
    .from(packagingInputs)
    .where(
      and(
        eq(packagingInputs.lineGroupId, lineGroupId),
        eq(packagingInputs.tierId, sourceTierId),
      ),
    )
    .limit(1);
  if (sourceRows.length === 0)
    throw new ActionGuardError(ERR.NOT_FOUND, "source tier row not found");
  const sourceValue =
    column === "unit_cost" ? sourceRows[0].unitCost : sourceRows[0].purchaseQty;
  if (sourceValue === null) return;

  // Apply to all sibling tier rows in the same line group except the source.
  const targets = await db
    .select({ id: packagingInputs.id, tierId: packagingInputs.tierId })
    .from(packagingInputs)
    .where(eq(packagingInputs.lineGroupId, lineGroupId));

  const updates = targets.filter((t) => t.tierId !== sourceTierId);
  if (updates.length === 0) return;

  await db.transaction(async (tx) => {
    for (const t of updates) {
      const setClause =
        column === "unit_cost"
          ? { unitCost: sourceValue, updatedAt: new Date() }
          : { purchaseQty: sourceValue, updatedAt: new Date() };
      await tx.update(packagingInputs).set(setClause).where(eq(packagingInputs.id, t.id));
    }
  });

  await logAudit({
    userId: user.id,
    entityType: "packaging_line",
    entityId: lineGroupId,
    action: "tier_value_copied",
    diffJson: {
      column,
      source_tier_id: sourceTierId,
      value: sourceValue,
      target_count: updates.length,
    },
  });

  revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// ---------- read helpers (used by pages and other actions) ----------

/**
 * Count distinct packaging lines for a quote — used by the
 * applyTierPreset confirm dialog ("…will also delete X packaging lines").
 */
export async function countPackagingLinesForQuote(quoteId: string): Promise<number> {
  const rows = await db
    .select({ lineGroupId: packagingInputs.lineGroupId })
    .from(packagingInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, packagingInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));
  const distinct = new Set(rows.map((r) => r.lineGroupId));
  return distinct.size;
}


