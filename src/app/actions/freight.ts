"use server";

import { and, asc, count, eq, isNotNull, max, or } from "drizzle-orm";
import { db } from "@/db";
import { revalidateQuoteTree } from "@/lib/revalidate";
import {
  auditLog,
  freightInputs,
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
  quoteForLeafSku,
  quoteForLineGroup,
  quoteForSku,
  requireDraft,
} from "@/lib/quote-guards";

// Snapshots returned to the client after a save so controlled state
// re-hydrates from canonical server data — never from the form's
// defaultValue (per CLAUDE.md "Form state pattern").

export type FreightLineSnapshot = {
  lineGroupId: string;
  shipmentId: string | null;
  supplier: string | null;
  freightMode:
    | "parcel"
    | "ltl"
    | "ftl"
    | "ocean"
    | "air"
    | "courier"
    | "other"
    | null;
  freightTreatment: "bundled" | "pass_through";
  markupPct: string | null;
  notes: string | null;
  sortOrder: number;
};

export type FreightCellSnapshot = {
  rowId: string;
  totalFreight: string | null;
  unitsInShipment: number | null;
  skuTotalCbm: string | null;
};

export type SkuCustomsSnapshot = {
  quoteSkuId: string;
  dutyPct: string | null;
  tariffPct: string | null;
};

const FREIGHT_MODES = [
  "parcel",
  "ltl",
  "ftl",
  "ocean",
  "air",
  "courier",
  "other",
] as const;
type FreightModeValue = (typeof FREIGHT_MODES)[number];

const FREIGHT_TREATMENTS = ["bundled", "pass_through"] as const;
type FreightTreatmentValue = (typeof FREIGHT_TREATMENTS)[number];

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

// PostgreSQL numeric returns canonical strings ("0.40") while form values
// arrive shorter ("0.4"). Compare numerically to avoid spurious "changes".
function numericEquals(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Number(a) === Number(b);
}

function parseFreightMode(v: FormDataEntryValue | null): FreightModeValue | null {
  const s = trimOrNull(v);
  if (!s) return null;
  if ((FREIGHT_MODES as readonly string[]).includes(s))
    return s as FreightModeValue;
  return null;
}

function parseFreightTreatment(
  v: FormDataEntryValue | null,
): FreightTreatmentValue {
  const s = trimOrNull(v);
  if (s === "pass_through") return "pass_through";
  return "bundled";
}

// Convert a "percent display" string (e.g. "25" for 25%) into the decimal
// stored in DB ("0.2500"). Empty / null → null.
function percentDisplayToDecimal(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (n / 100).toString();
}

// ---------- read helpers ----------

// Counts freight lines (distinct line_group_ids) for the quote. Used by
// the tier-preset confirm dialog warning.
export async function countFreightLinesForQuote(
  quoteId: string,
): Promise<number> {
  const rows = await db
    .selectDistinct({ lineGroupId: freightInputs.lineGroupId })
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .where(eq(quoteSkus.quoteId, quoteId));
  return rows.length;
}

// Counts (line, tier) freight rows with non-null total_freight or
// units_in_shipment — for the tier-preset dialog warning's "data loss"
// signal. Mirrors countProductionCellsWithDataForQuote.
export async function countFreightCellsWithDataForQuote(
  quoteId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(freightInputs)
    .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
    .where(
      and(
        eq(quoteSkus.quoteId, quoteId),
        or(
          isNotNull(freightInputs.totalFreight),
          isNotNull(freightInputs.unitsInShipment),
        ),
      ),
    );
  return row?.count ?? 0;
}

// ---------- line actions ----------

// Generate a new freight line on the given (leaf) SKU. Inserts one row per
// active tier with default per-line metadata: markup_pct = '0.3000',
// freight_treatment = 'bundled'. Per-tier (total_freight, units_in_shipment)
// null. The column itself stays nullable; the action layer writes a sane
// default (per refinement: nullable schema, but seeded at line creation).
export async function addFreightLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");

    const user = await ensureUser();
    const { quote } = await quoteForLeafSku(quoteSkuId, "freight");

    const tiers = await db
      .select({ id: quoteTiers.id })
      .from(quoteTiers)
      .where(eq(quoteTiers.quoteId, quote.id))
      .orderBy(asc(quoteTiers.sortOrder), asc(quoteTiers.createdAt));
    if (tiers.length === 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Add at least one tier to the quote before adding freight lines.",
      );
    }

    const maxRow = await db
      .select({ max: max(freightInputs.sortOrder) })
      .from(freightInputs)
      .where(eq(freightInputs.quoteSkuId, quoteSkuId));
    const sortOrder = (maxRow[0]?.max ?? -1) + 1;

    const lineGroupId = crypto.randomUUID();

    await db.insert(freightInputs).values(
      tiers.map((t) => ({
        quoteSkuId,
        tierId: t.id,
        lineGroupId,
        sortOrder,
        markupPct: "0.3000",
        freightTreatment: "bundled" as const,
      })),
    );

    await logAudit({
      userId: user.id,
      entityType: "freight_line",
      entityId: lineGroupId,
      action: "created",
      diffJson: {
        quote_sku_id: quoteSkuId,
        tier_count: tiers.length,
        sort_order: sortOrder,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// Fan-out update of per-line metadata across all tier rows of a given
// line_group_id. Per-tier fields (total_freight, units_in_shipment) NEVER
// touched here.
export async function updateFreightLineMetadata(
  formData: FormData,
): Promise<ActionResult<FreightLineSnapshot>> {
  return runAction(async () => {
    const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
    if (!lineGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

    const user = await ensureUser();
    const { quote } = await quoteForLineGroup(lineGroupId, "freight_inputs");

    const beforeRows = await db
      .select()
      .from(freightInputs)
      .where(eq(freightInputs.lineGroupId, lineGroupId))
      .limit(1);
    if (beforeRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Line not found");
    const beforeRow = beforeRows[0];

    const newShipmentId = trimOrNull(formData.get("shipmentId"));
    const newSupplier = trimOrNull(formData.get("supplier"));
    const newFreightMode = parseFreightMode(formData.get("freightMode"));
    const newFreightTreatment = parseFreightTreatment(
      formData.get("freightTreatment"),
    );
    // markup_pct arrives as a percent-display string (e.g. "30" for 30%).
    // Store as decimal ("0.3000"). Per CLAUDE.md percent convention.
    const newMarkupPct = percentDisplayToDecimal(formData.get("markupPct"));
    const newNotes = trimOrNull(formData.get("notes"));

    const before = {
      shipment_id: beforeRow.shipmentId,
      supplier: beforeRow.supplier,
      freight_mode: beforeRow.freightMode,
      freight_treatment: beforeRow.freightTreatment,
      markup_pct: beforeRow.markupPct,
      notes: beforeRow.notes,
    };
    const after = {
      shipment_id: newShipmentId,
      supplier: newSupplier,
      freight_mode: newFreightMode,
      freight_treatment: newFreightTreatment,
      markup_pct: newMarkupPct,
      notes: newNotes,
    };

    function snapshot(): FreightLineSnapshot {
      return {
        lineGroupId,
        shipmentId: newShipmentId,
        supplier: newSupplier,
        freightMode: newFreightMode,
        freightTreatment: newFreightTreatment,
        markupPct: newMarkupPct,
        notes: newNotes,
        sortOrder: beforeRow.sortOrder,
      };
    }

    const diff: Diff = {};
    for (const k of [
      "shipment_id",
      "supplier",
      "freight_mode",
      "freight_treatment",
      "notes",
    ] as const) {
      if (before[k] !== after[k]) diff[k] = { from: before[k], to: after[k] };
    }
    if (!numericEquals(before.markup_pct, after.markup_pct))
      diff.markup_pct = { from: before.markup_pct, to: after.markup_pct };

    if (Object.keys(diff).length === 0) {
      // No-op; return canonical snapshot from DB row.
      return {
        lineGroupId,
        shipmentId: beforeRow.shipmentId,
        supplier: beforeRow.supplier,
        freightMode: beforeRow.freightMode,
        freightTreatment: beforeRow.freightTreatment,
        markupPct: beforeRow.markupPct,
        notes: beforeRow.notes,
        sortOrder: beforeRow.sortOrder,
      };
    }

    await db
      .update(freightInputs)
      .set({
        shipmentId: newShipmentId,
        supplier: newSupplier,
        freightMode: newFreightMode,
        freightTreatment: newFreightTreatment,
        markupPct: newMarkupPct,
        notes: newNotes,
        updatedAt: new Date(),
      })
      .where(eq(freightInputs.lineGroupId, lineGroupId));

    await logAudit({
      userId: user.id,
      entityType: "freight_line",
      entityId: lineGroupId,
      action: "updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return snapshot();
  });
}

// Per-cell update for total_freight + units_in_shipment.
export async function updateFreightTierCell(
  formData: FormData,
): Promise<ActionResult<FreightCellSnapshot>> {
  return runAction(async () => {
    const rowId = String(formData.get("rowId") ?? "").trim();
    if (!rowId) throw new ActionGuardError(ERR.VALIDATION, "rowId required");

    const user = await ensureUser();

    const rows = await db
      .select({ row: freightInputs, quote: quotes })
      .from(freightInputs)
      .innerJoin(quoteSkus, eq(quoteSkus.id, freightInputs.quoteSkuId))
      .innerJoin(quotes, eq(quotes.id, quoteSkus.quoteId))
      .where(eq(freightInputs.id, rowId))
      .limit(1);
    if (rows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Cell not found");
    const { row, quote } = rows[0];
    requireDraft(quote);

    const newTotalFreight = parseNumericOrNull(formData.get("totalFreight"));
    const newUnitsInShipment = parseIntOrNull(formData.get("unitsInShipment"));
    const newSkuTotalCbm = parseNumericOrNull(formData.get("skuTotalCbm"));

    const before = {
      total_freight: row.totalFreight,
      units_in_shipment: row.unitsInShipment,
      sku_total_cbm: row.skuTotalCbm,
    };
    const after = {
      total_freight: newTotalFreight,
      units_in_shipment: newUnitsInShipment,
      sku_total_cbm: newSkuTotalCbm,
    };

    const diff: Diff = {};
    if (!numericEquals(before.total_freight, after.total_freight))
      diff.total_freight = {
        from: before.total_freight,
        to: after.total_freight,
      };
    if (before.units_in_shipment !== after.units_in_shipment)
      diff.units_in_shipment = {
        from: before.units_in_shipment,
        to: after.units_in_shipment,
      };
    if (!numericEquals(before.sku_total_cbm, after.sku_total_cbm))
      diff.sku_total_cbm = {
        from: before.sku_total_cbm,
        to: after.sku_total_cbm,
      };

    if (Object.keys(diff).length === 0) {
      return {
        rowId,
        totalFreight: row.totalFreight,
        unitsInShipment: row.unitsInShipment,
        skuTotalCbm: row.skuTotalCbm,
      };
    }

    await db
      .update(freightInputs)
      .set({
        totalFreight: newTotalFreight,
        unitsInShipment: newUnitsInShipment,
        skuTotalCbm: newSkuTotalCbm,
        updatedAt: new Date(),
      })
      .where(eq(freightInputs.id, rowId));

    await logAudit({
      userId: user.id,
      entityType: "freight_input",
      entityId: rowId,
      action: "updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      rowId,
      totalFreight: newTotalFreight,
      unitsInShipment: newUnitsInShipment,
      skuTotalCbm: newSkuTotalCbm,
    };
  });
}

// Update per-SKU customs columns on quote_skus: duty_pct, tariff_pct.
// Per-SKU (no fan-out) — these don't change with shipment/tier. UI
// display convention: percent fields arrive as percent-display strings
// ("25" → "0.2500" stored).
//
// CBM is captured per-(SKU, line, tier) on freight_inputs.sku_total_cbm
// instead — see updateFreightTierCell. The cbm_per_unit column was
// removed in Slice 8 schema correction (didn't match PM workflow).
//
// Both leaves AND assemblies can carry customs values: customs declares
// at whichever SKU level the actual import filing happens at. Roman
// gummies pattern: per-leaf (jars and caps each declared separately).
// Fully-assembled finished-good pattern: per-assembly (one HS code for
// the whole assembly, leaves carry no customs). PM's call.
//
// CUSTOMER-INVISIBLE values; UI surface labels them as "Internal — not
// shown to customer".
export async function updateSkuCustomsData(
  formData: FormData,
): Promise<ActionResult<SkuCustomsSnapshot>> {
  return runAction(async () => {
    const quoteSkuId = String(formData.get("quoteSkuId") ?? "").trim();
    if (!quoteSkuId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteSkuId required");

    const user = await ensureUser();
    // quoteForSku — not quoteForLeafSku — because assemblies can also
    // be the customs-declaration level for fully-assembled imports.
    const { quote, sku } = await quoteForSku(quoteSkuId);

    const newDuty = percentDisplayToDecimal(formData.get("dutyPct"));
    const newTariff = percentDisplayToDecimal(formData.get("tariffPct"));

    const before = {
      duty_pct: sku.dutyPct,
      tariff_pct: sku.tariffPct,
    };
    const after = {
      duty_pct: newDuty,
      tariff_pct: newTariff,
    };

    const diff: Diff = {};
    if (!numericEquals(before.duty_pct, after.duty_pct))
      diff.duty_pct = { from: before.duty_pct, to: after.duty_pct };
    if (!numericEquals(before.tariff_pct, after.tariff_pct))
      diff.tariff_pct = { from: before.tariff_pct, to: after.tariff_pct };

    if (Object.keys(diff).length === 0) {
      return {
        quoteSkuId,
        dutyPct: sku.dutyPct,
        tariffPct: sku.tariffPct,
      };
    }

    await db
      .update(quoteSkus)
      .set({
        dutyPct: newDuty,
        tariffPct: newTariff,
        updatedAt: new Date(),
      })
      .where(eq(quoteSkus.id, quoteSkuId));

    await logAudit({
      userId: user.id,
      entityType: "quote_sku",
      entityId: quoteSkuId,
      action: "customs_updated",
      diffJson: diff,
    });

    revalidateQuoteTree(quote.projectId, quote.id);

    return {
      quoteSkuId,
      dutyPct: newDuty,
      tariffPct: newTariff,
    };
  });
}

// Apply a tier value across all sibling tier rows of the same line group.
// Same affordance as packaging.copyTierValueToAllTiers.
export async function copyFreightTierValueToAllTiers(
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
    if (
      column !== "total_freight" &&
      column !== "units_in_shipment" &&
      column !== "sku_total_cbm"
    )
      throw new ActionGuardError(
        ERR.VALIDATION,
        `unsupported column: ${column}`,
      );

    const user = await ensureUser();
    const { quote } = await quoteForLineGroup(lineGroupId, "freight_inputs");

    const sourceRows = await db
      .select({
        totalFreight: freightInputs.totalFreight,
        unitsInShipment: freightInputs.unitsInShipment,
        skuTotalCbm: freightInputs.skuTotalCbm,
      })
      .from(freightInputs)
      .where(
        and(
          eq(freightInputs.lineGroupId, lineGroupId),
          eq(freightInputs.tierId, sourceTierId),
        ),
      )
      .limit(1);
    if (sourceRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "source tier row not found");
    const sourceValue =
      column === "total_freight"
        ? sourceRows[0].totalFreight
        : column === "units_in_shipment"
          ? sourceRows[0].unitsInShipment
          : sourceRows[0].skuTotalCbm;
    if (sourceValue === null) return;

    const targets = await db
      .select({ id: freightInputs.id, tierId: freightInputs.tierId })
      .from(freightInputs)
      .where(eq(freightInputs.lineGroupId, lineGroupId));

    const updates = targets.filter((t) => t.tierId !== sourceTierId);
    if (updates.length === 0) return;

    await db.transaction(async (tx) => {
      for (const t of updates) {
        const setClause =
          column === "total_freight"
            ? { totalFreight: sourceValue as string, updatedAt: new Date() }
            : column === "units_in_shipment"
              ? { unitsInShipment: sourceValue as number, updatedAt: new Date() }
              : { skuTotalCbm: sourceValue as string, updatedAt: new Date() };
        await tx
          .update(freightInputs)
          .set(setClause)
          .where(eq(freightInputs.id, t.id));
      }
    });

    await logAudit({
      userId: user.id,
      entityType: "freight_line",
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

// Delete an entire freight line (all tier rows for line_group_id).
export async function deleteFreightLine(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const lineGroupId = String(formData.get("lineGroupId") ?? "").trim();
    if (!lineGroupId)
      throw new ActionGuardError(ERR.VALIDATION, "lineGroupId required");

    const user = await ensureUser();
    const { quote } = await quoteForLineGroup(lineGroupId, "freight_inputs");

    const beforeRow = (
      await db
        .select({
          supplier: freightInputs.supplier,
          freightMode: freightInputs.freightMode,
        })
        .from(freightInputs)
        .where(eq(freightInputs.lineGroupId, lineGroupId))
        .limit(1)
    )[0];

    await db
      .delete(freightInputs)
      .where(eq(freightInputs.lineGroupId, lineGroupId));

    await logAudit({
      userId: user.id,
      entityType: "freight_line",
      entityId: lineGroupId,
      action: "deleted",
      diffJson: {
        supplier: beforeRow?.supplier ?? null,
        freight_mode: beforeRow?.freightMode ?? null,
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}

// Reorder freight lines within a SKU via sort_order swap.
export async function moveFreightLine(
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
    const { quote } = await quoteForLineGroup(lineGroupId, "freight_inputs");

    const groupRow = (
      await db
        .select({
          sortOrder: freightInputs.sortOrder,
          quoteSkuId: freightInputs.quoteSkuId,
        })
        .from(freightInputs)
        .where(eq(freightInputs.lineGroupId, lineGroupId))
        .limit(1)
    )[0];
    if (!groupRow) return;

    const siblings = await db
      .selectDistinctOn([freightInputs.lineGroupId], {
        lineGroupId: freightInputs.lineGroupId,
        sortOrder: freightInputs.sortOrder,
      })
      .from(freightInputs)
      .where(eq(freightInputs.quoteSkuId, groupRow.quoteSkuId))
      .orderBy(asc(freightInputs.lineGroupId), asc(freightInputs.sortOrder));

    siblings.sort((a, b) => a.sortOrder - b.sortOrder);

    const idx = siblings.findIndex((s) => s.lineGroupId === lineGroupId);
    const swapWith = direction === "up" ? siblings[idx - 1] : siblings[idx + 1];
    if (!swapWith) return;

    await db.transaction(async (tx) => {
      await tx
        .update(freightInputs)
        .set({ sortOrder: swapWith.sortOrder, updatedAt: new Date() })
        .where(eq(freightInputs.lineGroupId, lineGroupId));
      await tx
        .update(freightInputs)
        .set({ sortOrder: groupRow.sortOrder, updatedAt: new Date() })
        .where(eq(freightInputs.lineGroupId, swapWith.lineGroupId));
    });

    await logAudit({
      userId: user.id,
      entityType: "freight_line",
      entityId: lineGroupId,
      action: "reordered",
      diffJson: {
        sort_order: { from: groupRow.sortOrder, to: swapWith.sortOrder },
      },
    });

    revalidateQuoteTree(quote.projectId, quote.id);
  });
}
