"use server";

import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblyLeaves,
  auditLog,
  freightCustomsBreaks,
  freightCustomsEntries,
  freightDestinationBreaks,
  freightDestinations,
  freightDestinationTracking,
  freightSubcategories,
  freightSubcategoryItems,
  quoteTiers,
  quotes,
} from "@/db/schema";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { ensureUser } from "@/lib/auth/ensure-user";
import { resolveBreakFieldSources } from "@/lib/freight-break-write";
import { quoteByIdDraft, quoteForAssembly } from "@/lib/quote-guards";
import { revalidateQuoteTree } from "@/lib/revalidate";
import { FREIGHT_LEG_MODES, enumLabel, isFreightLegMode } from "@/lib/enum-labels";

type FieldSource = "manual" | "imported" | "corrected_after_import";
const provenance = (fields: string[], source: FieldSource = "manual") =>
  Object.fromEntries(fields.map((field) => [field, { source, capturedAt: new Date().toISOString() }]));
const correctedSource = (source: FieldSource): FieldSource => source === "manual" ? "manual" : "corrected_after_import";
const mergeProvenance = (current: unknown, fields: string[], source: FieldSource) => ({
  ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
  ...provenance(fields, correctedSource(source)),
});
/**
 * Post-commit causal revision — the ordering contract for Freight mutations.
 *
 * The reconciliation pipe cannot tell a fresh snapshot from a stale one by
 * timing alone: a slow read racing a fast second edit, or two operators on one
 * quote, can deliver an OLDER snapshot after a newer write. A monotonic marker
 * minted AFTER the write commits gives the client something to compare against,
 * so an out-of-order snapshot is detectable rather than silently applied.
 *
 * `pg_snapshot_xmax(pg_current_snapshot())` is read outside the transaction, so
 * it reflects state the write is already part of. Every mutation returns it;
 * consumers may ignore it, but no path may omit it — a single path without the
 * marker is a path with no ordering guarantee, which is exactly how this gap
 * went unnoticed on ten of eleven actions (F-3).
 */
async function committedRevision(): Promise<string | null> {
  const rows = await db.execute<{ revision: string | null }>(
    sql`select pg_snapshot_xmax(pg_current_snapshot())::text as revision`,
  );
  return (rows as unknown as Array<{ revision: string | null }>)[0]?.revision ?? null;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const nullable = (fd: FormData, key: string) => str(fd, key) || null;
const numberOrNull = (fd: FormData, key: string) => {
  const raw = str(fd, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new ActionGuardError(ERR.VALIDATION, `${key} must be at least 0`);
  return String(value);
};
// Governed-vocabulary guard for freight mode.
//
// `freight_destination_breaks.mode` is a Postgres enum. Before this guard the
// UI submitted free text, so the DATABASE was the first validator: a plausible
// operator value ("Ocean FCL") produced `invalid input value for enum
// freight_leg_mode`, a 500, and a full-page Costs runtime error.
//
// The UI is now a governed select, but that alone is not a contract — a stale
// client, a replayed action, or a future caller could still submit anything.
// Validate here so an invalid value becomes a controlled field error and never
// reaches persistence.
//
// Empty is valid: mode is optional and clears to NULL.
const modeOrNull = (fd: FormData, key: string) => {
  const raw = str(fd, key);
  if (!raw) return null;
  if (!isFreightLegMode(raw)) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Freight type must be one of: ${FREIGHT_LEG_MODES.map(enumLabel).join(", ")}.`,
    );
  }
  return raw;
};

const markupOrNull = (fd: FormData, key: string) => {
  const raw = str(fd, key);
  if (!raw) return null;
  const pct = Number(raw) / 100;
  if (!Number.isFinite(pct) || pct < 0 || pct > 9.9999) throw new ActionGuardError(ERR.VALIDATION, `${key} must be between 0% and 999.99%`);
  return String(pct);
};
async function audit(userId: string, entityType: string, entityId: string, action: string, diffJson: object) {
  await db.insert(auditLog).values({ userId, entityType, entityId, action, diffJson });
}

export async function createFreightSubcategory(fd: FormData): Promise<ActionResult<{ id: string; quoteId: string; revision: string | null }>> {
  return runAction(async () => {
    const quoteId = str(fd, "quoteId");
    const assemblyId = str(fd, "assemblyId");
    const label = str(fd, "label");
    const destination = str(fd, "destination");
    if (!quoteId || !assemblyId || !label || !destination) throw new ActionGuardError(ERR.VALIDATION, "Shipment context and destination are required");
    const user = await ensureUser();
    const { quote, assembly } = await quoteForAssembly(assemblyId);
    if (quote.id !== quoteId) throw new ActionGuardError(ERR.VALIDATION, "Commercial product does not belong to Quote");
    // Shipment membership — which of this product's components travel in this
    // shipment. Descriptive only: it records what the freight is FOR and never
    // divides the cost (Design Authority, `1a.jsx`: "Assignment says WHICH
    // SKUs the freight is for. It does not divide the cost."). Nothing in the
    // costing path reads it.
    //
    // Previously every eligible component was written unconditionally, so
    // every shipment implicitly contained every SKU and split shipments could
    // not be modelled at creation. Selection now comes from the modal, using
    // the same `assemblyLeafId` field name and product-scope rule that
    // `updateFreightSubcategory` already enforces.
    const members = await db.select({ id: assemblyLeaves.id }).from(assemblyLeaves).where(eq(assemblyLeaves.assemblyId, assemblyId));
    const eligible = new Set(members.map((member) => member.id));
    if (eligible.size === 0) throw new ActionGuardError(ERR.VALIDATION, "Add components in Setup before recording freight");
    const requested = [...new Set(fd.getAll("assemblyLeafId").map(String).filter(Boolean))];
    // `membershipProvided` distinguishes "the operator deselected everything"
    // from "this caller predates the selector". Without it an empty selection
    // is indistinguishable from an absent field, and deselecting every
    // component would silently select all of them.
    const membershipProvided = str(fd, "membershipProvided") === "1";
    if (membershipProvided && requested.length === 0) {
      throw new ActionGuardError(ERR.VALIDATION, "Select at least one component for this shipment.");
    }
    const memberIds = membershipProvided ? requested : [...eligible];
    if (memberIds.some((memberId) => !eligible.has(memberId))) {
      throw new ActionGuardError(ERR.VALIDATION, "Shipment membership must belong to its commercial product");
    }
    const [order] = await db.select({ value: max(freightSubcategories.displayOrder) }).from(freightSubcategories).where(eq(freightSubcategories.quoteId, quoteId));
    const created = await db.transaction(async (tx) => {
      const [subcategory] = await tx.insert(freightSubcategories).values({
        quoteId, assemblyId, label, origin: nullable(fd, "origin"), carrierForwarder: nullable(fd, "carrierForwarder"),
        incoterm: (nullable(fd, "incoterm") as "DDP" | "DAP" | "FOB" | "EXW" | "FCA" | "CIF" | null),
        cargoReadyDate: nullable(fd, "cargoReadyDate"), journeyLabel: nullable(fd, "journeyLabel"),
        treatment: (nullable(fd, "treatment") as "bundled" | "pass_through" | null) ?? "bundled",
        crossesInternationalBorder: str(fd, "crossesInternationalBorder") === "true",
        displayOrder: (order?.value ?? -1) + 1,
        fieldProvenance: provenance(["label", "origin", "carrierForwarder", "incoterm", "cargoReadyDate", "journeyLabel", "treatment", "crossesInternationalBorder"]),
      }).returning({ id: freightSubcategories.id });
      await tx.insert(freightSubcategoryItems).values(memberIds.map((assemblyLeafId) => ({ freightSubcategoryId: subcategory.id, assemblyLeafId, fieldProvenance: provenance(["assemblyLeafId"]) })));
      const [dest] = await tx.insert(freightDestinations).values({
        freightSubcategoryId: subcategory.id, destination, transitDays: nullable(fd, "transitDays"), internalNotes: nullable(fd, "internalNotes"),
        fieldProvenance: provenance(["destination", "transitDays", "internalNotes"]),
      }).returning({ id: freightDestinations.id });
      await tx.update(freightSubcategories).set({ selectedDestinationId: dest.id, fieldProvenance: provenance(["selectedDestinationId"]) }).where(eq(freightSubcategories.id, subcategory.id));
      const tiers = await tx.select({ id: quoteTiers.id }).from(quoteTiers).where(eq(quoteTiers.quoteId, quoteId)).orderBy(asc(quoteTiers.sortOrder));
      if (tiers.length) await tx.insert(freightDestinationBreaks).values(tiers.map((tier) => ({ freightDestinationId: dest.id, tierId: tier.id })));
      return subcategory;
    });
    await audit(user.id, "freight_subcategory", created.id, "freight_subcategory_created", { quoteId, assemblyId, memberIds });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quoteId);
    return { revision, id: created.id, quoteId };
  });
}

async function draftSubcategory(id: string) {
  const [row] = await db.select({ subcategory: freightSubcategories, quote: quotes }).from(freightSubcategories).innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId)).where(eq(freightSubcategories.id, id)).limit(1);
  if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Freight subcategory not found");
  await quoteByIdDraft(row.quote.id);
  return row;
}

export async function updateFreightSubcategory(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const id = str(fd, "freightSubcategoryId");
    const label = str(fd, "label");
    const memberIds = [...new Set(fd.getAll("assemblyLeafId").map(String).filter(Boolean))];
    if (!id || !label || memberIds.length === 0) throw new ActionGuardError(ERR.VALIDATION, "Shipment and at least one included component are required");
    const user = await ensureUser();
    const { subcategory, quote } = await draftSubcategory(id);
    const allowedRows = await db.select({ id: assemblyLeaves.id }).from(assemblyLeaves).where(eq(assemblyLeaves.assemblyId, subcategory.assemblyId));
    const allowed = new Set(allowedRows.map((row) => row.id));
    if (memberIds.some((memberId) => !allowed.has(memberId))) throw new ActionGuardError(ERR.VALIDATION, "Shipment membership must belong to its commercial product");
    const beforeMembers = await db.select({ id: freightSubcategoryItems.assemblyLeafId }).from(freightSubcategoryItems).where(eq(freightSubcategoryItems.freightSubcategoryId, id));
    const fields = ["label", "origin", "carrierForwarder", "incoterm", "cargoReadyDate", "journeyLabel", "treatment", "crossesInternationalBorder"];
    await db.transaction(async (tx) => {
      await tx.update(freightSubcategories).set({
        label, origin: nullable(fd, "origin"), carrierForwarder: nullable(fd, "carrierForwarder"),
        incoterm: nullable(fd, "incoterm") as typeof subcategory.incoterm, cargoReadyDate: nullable(fd, "cargoReadyDate"),
        journeyLabel: nullable(fd, "journeyLabel"), treatment: (nullable(fd, "treatment") as typeof subcategory.treatment) ?? "bundled",
        crossesInternationalBorder: str(fd, "crossesInternationalBorder") === "true", updatedAt: new Date(),
        source: correctedSource(subcategory.source), fieldProvenance: mergeProvenance(subcategory.fieldProvenance, fields, subcategory.source),
      }).where(eq(freightSubcategories.id, id));
      await tx.delete(freightSubcategoryItems).where(eq(freightSubcategoryItems.freightSubcategoryId, id));
      await tx.insert(freightSubcategoryItems).values(memberIds.map((assemblyLeafId) => ({
        freightSubcategoryId: id, assemblyLeafId, source: correctedSource(subcategory.source),
        fieldProvenance: provenance(["assemblyLeafId"], correctedSource(subcategory.source)),
      })));
      await tx.insert(auditLog).values({ userId: user.id, entityType: "freight_subcategory", entityId: id, action: "freight_subcategory_updated", diffJson: { fields, membership: { from: beforeMembers.map((row) => row.id), to: memberIds } } });
    });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quote.id);
    return { revision, id };
  });
}

export async function updateFreightDestination(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const id = str(fd, "destinationId");
    const destination = str(fd, "destination");
    if (!id || !destination) throw new ActionGuardError(ERR.VALIDATION, "Destination is required");
    const user = await ensureUser();
    const [row] = await db.select({ destination: freightDestinations, subcategory: freightSubcategories, quote: quotes }).from(freightDestinations)
      .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightDestinations.freightSubcategoryId))
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId)).where(eq(freightDestinations.id, id)).limit(1);
    if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Freight destination not found");
    await quoteByIdDraft(row.quote.id);
    const fields = ["destination", "consignee", "transitDays", "quoteReference", "internalNotes"];
    await db.transaction(async (tx) => {
      await tx.update(freightDestinations).set({
        destination, consignee: nullable(fd, "consignee"), transitDays: nullable(fd, "transitDays"),
        quoteReference: nullable(fd, "quoteReference"), internalNotes: nullable(fd, "internalNotes"), updatedAt: new Date(),
        source: correctedSource(row.destination.source), fieldProvenance: mergeProvenance(row.destination.fieldProvenance, fields, row.destination.source),
      }).where(eq(freightDestinations.id, id));
      await tx.insert(auditLog).values({ userId: user.id, entityType: "freight_destination", entityId: id, action: "freight_destination_updated", diffJson: { fields } });
    });
    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, id };
  });
}

export async function addFreightDestination(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const subcategoryId = str(fd, "freightSubcategoryId");
    const destination = str(fd, "destination");
    if (!subcategoryId || !destination) throw new ActionGuardError(ERR.VALIDATION, "Subcategory and destination are required");
    const user = await ensureUser();
    const { subcategory, quote } = await draftSubcategory(subcategoryId);
    const existing = await db.select().from(freightDestinations).where(eq(freightDestinations.freightSubcategoryId, subcategoryId)).orderBy(freightDestinations.displayOrder);
    const previous = existing.at(-1);
    const previousBreaks = previous
      ? await db.select().from(freightDestinationBreaks).where(eq(freightDestinationBreaks.freightDestinationId, previous.id))
      : [];
    const [order] = await db.select({ value: max(freightDestinations.displayOrder) }).from(freightDestinations).where(eq(freightDestinations.freightSubcategoryId, subcategoryId));
    const [created] = await db.insert(freightDestinations).values({
      freightSubcategoryId: subcategoryId, destination, consignee: nullable(fd, "consignee"), transitDays: nullable(fd, "transitDays"),
      quoteReference: nullable(fd, "quoteReference"), internalNotes: nullable(fd, "internalNotes"), displayOrder: (order?.value ?? -1) + 1,
      sameValueAllBreaks: previous?.sameValueAllBreaks ?? true,
      fieldProvenance: provenance(["destination", "consignee", "transitDays", "quoteReference", "internalNotes"]),
    }).returning({ id: freightDestinations.id });
    const tiers = await db.select({ id: quoteTiers.id }).from(quoteTiers).where(eq(quoteTiers.quoteId, quote.id));
    if (tiers.length) await db.insert(freightDestinationBreaks).values(tiers.map((tier) => {
      const prior = previousBreaks.find((row) => row.tierId === tier.id) ?? previousBreaks[0];
      return {
        freightDestinationId: created.id, tierId: tier.id, mode: prior?.mode ?? null,
        freightMarkupPct: prior?.freightMarkupPct ?? null, shipmentNote: prior?.shipmentNote ?? null,
        fieldProvenance: provenance(["mode", "freightMarkupPct", "shipmentNote"]),
      };
    }));
    await audit(user.id, "freight_destination", created.id, "freight_destination_created", { subcategoryId });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quote.id);
    return { revision, id: created.id };
  });
}

export async function selectFreightDestination(fd: FormData): Promise<ActionResult<{ subcategoryId: string; destinationId: string; revision: string | null }>> {
  return runAction(async () => {
    const subcategoryId = str(fd, "freightSubcategoryId");
    const destinationId = str(fd, "destinationId");
    const user = await ensureUser();
    const { subcategory, quote } = await draftSubcategory(subcategoryId);
    const [destination] = await db.select({ id: freightDestinations.id }).from(freightDestinations).where(and(eq(freightDestinations.id, destinationId), eq(freightDestinations.freightSubcategoryId, subcategoryId))).limit(1);
    if (!destination) throw new ActionGuardError(ERR.VALIDATION, "Selected destination does not belong to shipment");
    await db.update(freightSubcategories).set({
      selectedDestinationId: destinationId, selectionReason: nullable(fd, "selectionReason"), updatedAt: new Date(),
      source: correctedSource(subcategory.source), fieldProvenance: mergeProvenance(subcategory.fieldProvenance, ["selectedDestinationId", "selectionReason"], subcategory.source),
    }).where(eq(freightSubcategories.id, subcategoryId));
    await audit(user.id, "freight_subcategory", subcategoryId, "freight_destination_selected", { from: subcategory.selectedDestinationId, to: destinationId });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quote.id);
    return { revision, subcategoryId, destinationId };
  });
}

export async function updateFreightDestinationBreak(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const id = str(fd, "breakId");
    const user = await ensureUser();
    const [row] = await db.select({ item: freightDestinationBreaks, subcategory: freightSubcategories, quote: quotes }).from(freightDestinationBreaks)
      .innerJoin(freightDestinations, eq(freightDestinations.id, freightDestinationBreaks.freightDestinationId))
      .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightDestinations.freightSubcategoryId))
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId)).where(eq(freightDestinationBreaks.id, id)).limit(1);
    if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Freight break not found");
    await quoteByIdDraft(row.quote.id);
    const mode = modeOrNull(fd, "mode") as typeof row.item.mode;
    await db.update(freightDestinationBreaks).set({
      freightAmount: numberOrNull(fd, "freightAmount"), freightMarkupPct: markupOrNull(fd, "freightMarkupPct"), mode,
      shipmentNote: nullable(fd, "shipmentNote"), cbm: numberOrNull(fd, "cbm"), updatedAt: new Date(),
      source: correctedSource(row.item.source), fieldProvenance: mergeProvenance(row.item.fieldProvenance, ["freightAmount", "freightMarkupPct", "mode", "shipmentNote", "cbm"], row.item.source),
    }).where(eq(freightDestinationBreaks.id, id));
    await audit(user.id, "freight_destination_break", id, "freight_destination_break_updated", { destinationId: row.item.freightDestinationId });
    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, id };
  });
}

export async function updateFreightDestinationBreakGroup(fd: FormData): Promise<ActionResult<{ destinationId: string; revision: string | null }>> {
  return runAction(async () => {
    const destinationId = str(fd, "destinationId");
    const sourceTierId = str(fd, "sourceTierId");
    const flat = str(fd, "breakMode") === "flat";
    const user = await ensureUser();
    const [owner] = await db.select({ quote: quotes }).from(freightDestinations)
      .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightDestinations.freightSubcategoryId))
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId)).where(eq(freightDestinations.id, destinationId)).limit(1);
    if (!owner) throw new ActionGuardError(ERR.NOT_FOUND, "Freight destination not found");
    await quoteByIdDraft(owner.quote.id);
    // Trace point 2 — what the server actually received, before any coercion.
    const rows = await db.select().from(freightDestinationBreaks).where(eq(freightDestinationBreaks.freightDestinationId, destinationId));
    if (!rows.length || !rows.some((row) => row.tierId === sourceTierId)) throw new ActionGuardError(ERR.VALIDATION, "Freight quantity breaks are incomplete");
    const fields = ["freightAmount", "freightMarkupPct", "mode", "shipmentNote"];
    const submittedKeys = new Set(Array.from(fd.keys()));
    await db.transaction(async (tx) => {
      await tx.update(freightDestinations).set({ sameValueAllBreaks: flat, updatedAt: new Date() }).where(eq(freightDestinations.id, destinationId));
      for (const row of rows) {
        // "One value, all breaks" governs the freight AMOUNT only. Amount and
        // markup source from the flat tier; mode and description always
        // persist against the row's own tier.
        //
        // The same shipment family may legitimately be LTL at one break and
        // FTL at another while carrying one negotiated amount across all of
        // them — the operational identity of a break is not collapsed by
        // sharing a price. This is why the authoritative worksheet puts mode
        // and description on the break row, not on the shipment.
        //
        // Absent fields are PRESERVED, not nulled, so toggling flat on or off
        // never destroys tier-specific operational values.
        const { amountKey, modeKey, noteKey } = resolveBreakFieldSources({
          flat, sourceTierId, rowTierId: row.tierId, submittedKeys,
        });
        // Trace point 2b — the normalized values about to be persisted, per
        // break. Emitted per row so a flat-mode fan-out is visible as N rows
        // rather than one aggregate.
        const nextAmount = numberOrNull(fd, `freightAmount:${amountKey}`);
        const nextMarkup = markupOrNull(fd, `freightMarkupPct:${amountKey}`);
        await tx.update(freightDestinationBreaks).set({
          freightAmount: nextAmount, freightMarkupPct: nextMarkup,
          mode: (modeKey ? modeOrNull(fd, `mode:${modeKey}`) : row.mode) as typeof row.mode,
          shipmentNote: noteKey ? nullable(fd, `shipmentNote:${noteKey}`) : row.shipmentNote,
          updatedAt: new Date(),
          source: correctedSource(row.source), fieldProvenance: mergeProvenance(row.fieldProvenance, fields, row.source),
        }).where(eq(freightDestinationBreaks.id, row.id));
      }
      await tx.insert(auditLog).values({ userId: user.id, entityType: "freight_destination", entityId: destinationId, action: "freight_breaks_updated", diffJson: { breakMode: flat ? "one_value_all_breaks" : "differs_by_break", tierIds: rows.map((row) => row.tierId) } });
    });
    const revision = await committedRevision();
    revalidateQuoteTree(owner.quote.projectId, owner.quote.id);
    return { destinationId, revision };
  });
}

export async function deleteFreightDestination(fd: FormData): Promise<ActionResult<{ subcategoryId: string; deletedDestination: string; selectionCleared: boolean; revision: string | null }>> {
  return runAction(async () => {
    const destinationId = str(fd, "destinationId");
    const user = await ensureUser();
    const [row] = await db.select({ destination: freightDestinations, subcategory: freightSubcategories, quote: quotes }).from(freightDestinations)
      .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightDestinations.freightSubcategoryId))
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId)).where(eq(freightDestinations.id, destinationId)).limit(1);
    if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Freight destination not found");
    await quoteByIdDraft(row.quote.id);
    const destinationCount = await db.select({ id: freightDestinations.id }).from(freightDestinations).where(eq(freightDestinations.freightSubcategoryId, row.subcategory.id));
    if (destinationCount.length < 2) throw new ActionGuardError(ERR.VALIDATION, "A shipment must retain at least one destination");
    await db.transaction(async (tx) => {
      if (row.subcategory.selectedDestinationId === destinationId) await tx.update(freightSubcategories).set({ selectedDestinationId: null, selectionReason: null, updatedAt: new Date(), fieldProvenance: mergeProvenance(row.subcategory.fieldProvenance, ["selectedDestinationId", "selectionReason"], row.subcategory.source) }).where(eq(freightSubcategories.id, row.subcategory.id));
      await tx.delete(freightDestinations).where(eq(freightDestinations.id, destinationId));
      await tx.insert(auditLog).values({ userId: user.id, entityType: "freight_destination", entityId: destinationId, action: "freight_destination_deleted", diffJson: { subcategoryId: row.subcategory.id, destination: row.destination.destination, wasSelected: row.subcategory.selectedDestinationId === destinationId } });
    });
    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, subcategoryId: row.subcategory.id, deletedDestination: row.destination.destination, selectionCleared: row.subcategory.selectedDestinationId === destinationId };
  });
}

export async function updateFreightCustomsEntry(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const subcategoryId = str(fd, "freightSubcategoryId");
    const user = await ensureUser();
    const { quote } = await draftSubcategory(subcategoryId);
    const [current] = await db.select().from(freightCustomsEntries).where(eq(freightCustomsEntries.freightSubcategoryId, subcategoryId)).limit(1);
    const [saved] = await db.insert(freightCustomsEntries).values({
      freightSubcategoryId: subcategoryId, invoiceReference: nullable(fd, "invoiceReference"), entryDescription: nullable(fd, "entryDescription"),
      fieldProvenance: provenance(["invoiceReference", "entryDescription"]),
    }).onConflictDoUpdate({ target: freightCustomsEntries.freightSubcategoryId, set: {
      invoiceReference: nullable(fd, "invoiceReference"), entryDescription: nullable(fd, "entryDescription"), updatedAt: new Date(),
      source: correctedSource(current?.source ?? "manual"), fieldProvenance: mergeProvenance(current?.fieldProvenance, ["invoiceReference", "entryDescription"], current?.source ?? "manual"),
    } }).returning({ id: freightCustomsEntries.id });
    await audit(user.id, "freight_customs_entry", saved.id, "freight_customs_entry_updated", { subcategoryId });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quote.id);
    return { revision, id: saved.id };
  });
}

export async function updateFreightCustomsBreak(fd: FormData): Promise<ActionResult<{ id: string; revision: string | null }>> {
  return runAction(async () => {
    const subcategoryId = str(fd, "freightSubcategoryId");
    const tierId = str(fd, "tierId");
    const chargeType = str(fd, "chargeType") as "duty" | "tariff";
    if (!tierId || !["duty", "tariff"].includes(chargeType)) throw new ActionGuardError(ERR.VALIDATION, "Tier and customs charge type are required");
    const user = await ensureUser();
    const { quote } = await draftSubcategory(subcategoryId);
    const [entry] = await db.insert(freightCustomsEntries).values({
      freightSubcategoryId: subcategoryId, fieldProvenance: provenance([]),
    }).onConflictDoUpdate({ target: freightCustomsEntries.freightSubcategoryId, set: { updatedAt: new Date() } }).returning({ id: freightCustomsEntries.id });
    const [currentBreak] = await db.select().from(freightCustomsBreaks).where(and(eq(freightCustomsBreaks.freightCustomsEntryId, entry.id), eq(freightCustomsBreaks.tierId, tierId), eq(freightCustomsBreaks.chargeType, chargeType))).limit(1);
    const [saved] = await db.insert(freightCustomsBreaks).values({
      freightCustomsEntryId: entry.id, tierId, chargeType, amount: numberOrNull(fd, "amount"), markupPct: markupOrNull(fd, "markupPct"),
      detail: nullable(fd, "detail"), fieldProvenance: provenance(["amount", "markupPct", "detail"]),
    }).onConflictDoUpdate({ target: [freightCustomsBreaks.freightCustomsEntryId, freightCustomsBreaks.chargeType, freightCustomsBreaks.tierId], set: {
      amount: numberOrNull(fd, "amount"), markupPct: markupOrNull(fd, "markupPct"), detail: nullable(fd, "detail"), updatedAt: new Date(),
      source: correctedSource(currentBreak?.source ?? "manual"), fieldProvenance: mergeProvenance(currentBreak?.fieldProvenance, ["amount", "markupPct", "detail"], currentBreak?.source ?? "manual"),
    }}).returning({ id: freightCustomsBreaks.id });
    await audit(user.id, "freight_customs_break", saved.id, "freight_customs_break_updated", { chargeType, tierId });
    const revision = await committedRevision();
    revalidateQuoteTree(quote.projectId, quote.id);
    return { ...saved, revision };
  });
}

// Tracking is operational metadata: selected-destination guard applies, while
// sent commercial snapshots remain immutable and pricing is never recomputed.
export async function updateFreightTracking(fd: FormData): Promise<ActionResult<{ destinationId: string; revision: string | null }>> {
  return runAction(async () => {
    const destinationId = str(fd, "destinationId");
    const user = await ensureUser();
    const [row] = await db.select({ destination: freightDestinations, subcategory: freightSubcategories, quote: quotes, tracking: freightDestinationTracking }).from(freightDestinations)
      .innerJoin(freightSubcategories, eq(freightSubcategories.id, freightDestinations.freightSubcategoryId))
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId))
      .leftJoin(freightDestinationTracking, eq(freightDestinationTracking.freightDestinationId, freightDestinations.id))
      .where(eq(freightDestinations.id, destinationId)).limit(1);
    if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Freight destination not found");
    if (row.subcategory.selectedDestinationId !== destinationId && !row.tracking) throw new ActionGuardError(ERR.VALIDATION, "Tracking belongs only to the selected destination");
    const values = { etd: nullable(fd, "etd"), eta: nullable(fd, "eta"), actualDeliveryDate: nullable(fd, "actualDeliveryDate") };
    if (!values.etd && !values.eta && !values.actualDeliveryDate) {
      await db.delete(freightDestinationTracking).where(eq(freightDestinationTracking.freightDestinationId, destinationId));
      await audit(user.id, "freight_destination_tracking", destinationId, "freight_tracking_cleared", { operational: true });
      const revision = await committedRevision();
      revalidateQuoteTree(row.quote.projectId, row.quote.id);
      return { revision, destinationId };
    }
    await db.insert(freightDestinationTracking).values({
      freightDestinationId: destinationId, ...values,
      source: correctedSource(row.tracking?.source ?? "manual"), fieldProvenance: mergeProvenance(row.tracking?.fieldProvenance, ["etd", "eta", "actualDeliveryDate"], row.tracking?.source ?? "manual"),
    }).onConflictDoUpdate({ target: freightDestinationTracking.freightDestinationId, set: {
      ...values, updatedAt: new Date(),
      source: correctedSource(row.tracking?.source ?? "manual"), fieldProvenance: mergeProvenance(row.tracking?.fieldProvenance, ["etd", "eta", "actualDeliveryDate"], row.tracking?.source ?? "manual"),
    }});
    await audit(user.id, "freight_destination_tracking", destinationId, "freight_tracking_updated", { operational: true });
    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, destinationId };
  });
}
