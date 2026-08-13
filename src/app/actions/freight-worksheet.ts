"use server";

import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  freightCustomsBreaks,
  freightCustomsEntries,
  freightDestinationBreaks,
  actionIdempotency,
  freightDestinations,
  freightDestinationTracking,
  freightSubcategories,
  freightSubcategoryItems,
  quoteLeaves,
  quoteTiers,
  quotes,
} from "@/db/schema";
import { ActionGuardError, ERR, assertNotFrozen, runAction, type ActionResult } from "@/lib/action-result";
import { writeAuditEntry } from "@/lib/audit";
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
/**
 * Delegates to the single audit writer (src/lib/audit.ts).
 *
 * The POSITIONAL signature is kept deliberately. Its five parameters are
 * userId, entityType, entityId, action -- four strings in a row -- so rewriting
 * the seven call sites to an object form risks a transposition that would
 * typecheck cleanly and only surface as mislabelled history. Converting the
 * body alone leaves every call site byte-identical.
 */
async function audit(userId: string, entityType: string, entityId: string, action: string, diffJson: object) {
  await writeAuditEntry({ userId, entityType, entityId, action, diffJson });
}

export async function createFreightSubcategory(fd: FormData): Promise<ActionResult<{ id: string; quoteId: string; revision: string | null }>> {
  return runAction(async () => {
    const quoteId = str(fd, "quoteId");
    // OD-017 · a shipment is a CONTAINER, not an ASY-owned object. `assemblyId`
    // is OPTIONAL: a quote made only of Direct Components must be able to record
    // freight without inventing a Finished Product to hang it on. When it IS
    // supplied it is still fully validated — ownership is recorded where it is
    // real, and is simply no longer a precondition.
    const assemblyId = str(fd, "assemblyId") || null;
    const label = str(fd, "label");
    const destination = str(fd, "destination");
    if (!quoteId || !label || !destination) throw new ActionGuardError(ERR.VALIDATION, "Shipment context and destination are required");
    const user = await ensureUser();
    const { quote, assembly } = assemblyId
      ? await quoteForAssembly(assemblyId)
      : { quote: await quoteByIdDraft(quoteId), assembly: null };
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
    //
    // OD-017 · eligibility is QUOTE-scoped through the canonical commercial
    // leaf, not assembly-scoped through the junction. A Direct Component has no
    // junction row, so the previous rule made it permanently unshippable. The
    // `assemblyLeafId` form field name is unchanged for wire stability; what it
    // carries is now a `quote_leaf_id`.
    const members = await db.select({ id: quoteLeaves.id }).from(quoteLeaves).where(eq(quoteLeaves.quoteId, quote.id));
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
      await tx.insert(freightSubcategoryItems).values(memberIds.map((quoteLeafId) => ({ freightSubcategoryId: subcategory.id, quoteLeafId, fieldProvenance: provenance(["assemblyLeafId"]) })));
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
    // OD-017 · quote-scoped eligibility (see createFreightSubcategory). The
    // membership rule is "belongs to this Quote", not "belongs to this
    // assembly" — the latter cannot express a Direct Component at all.
    const allowedRows = await db.select({ id: quoteLeaves.id }).from(quoteLeaves).where(eq(quoteLeaves.quoteId, quote.id));
    const allowed = new Set(allowedRows.map((row) => row.id));
    if (memberIds.some((memberId) => !allowed.has(memberId))) throw new ActionGuardError(ERR.VALIDATION, "Shipment membership must belong to its Quote");
    const beforeMembers = await db.select({ id: freightSubcategoryItems.quoteLeafId }).from(freightSubcategoryItems).where(eq(freightSubcategoryItems.freightSubcategoryId, id));
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
      await tx.insert(freightSubcategoryItems).values(memberIds.map((quoteLeafId) => ({
        freightSubcategoryId: id, quoteLeafId, source: correctedSource(subcategory.source),
        fieldProvenance: provenance(["assemblyLeafId"], correctedSource(subcategory.source)),
      })));
      await writeAuditEntry({ userId: user.id, entityType: "freight_subcategory", entityId: id, action: "freight_subcategory_updated", diffJson: { fields, membership: { from: beforeMembers.map((row) => row.id), to: memberIds } } }, tx);
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
      await writeAuditEntry({ userId: user.id, entityType: "freight_destination", entityId: id, action: "freight_destination_updated", diffJson: { fields } }, tx);
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
    const { quote } = await draftSubcategory(subcategoryId);

    // Request idempotency, not business-field uniqueness.
    //
    // Two intentional commercial alternatives for one destination and
    // consignee ARE the comparison workflow, and at creation time they are
    // byte-identical to an accidental repeat — a new destination carries no
    // amounts yet. Timing cannot separate them either: a rapid deliberate
    // alternative is valid and a delayed retry is still a duplicate. So the
    // discriminator is the SUBMISSION, carried by a client-minted key that is
    // reused across retries and replaced for a deliberate second Add.
    const idempotencyKey = str(fd, "idempotencyKey") || null;

    // Claim and work commit together. A concurrent request holding the same
    // key blocks on the primary-key insert until this transaction commits,
    // then sees the conflict and reads a result that is already durable.
    // Claiming in a separate statement would leave a window where the loser
    // finds a claimed key whose result column is still null.
    const outcome = await db.transaction(async (tx) => {
      if (idempotencyKey) {
        const claimed = await tx
          .insert(actionIdempotency)
          .values({ key: idempotencyKey, action: "add_freight_destination" })
          .onConflictDoNothing()
          .returning({ key: actionIdempotency.key });
        if (claimed.length === 0) {
          const [prior] = await tx
            .select({ result: actionIdempotency.result })
            .from(actionIdempotency)
            .where(eq(actionIdempotency.key, idempotencyKey))
            .limit(1);
          const replayed = prior?.result as { id: string; revision: string | null } | null | undefined;
          // A claimed key with no result means the original attempt failed and
          // rolled the row back with it, so there is nothing to replay. Fall
          // through and do the work under this request instead.
          if (replayed?.id) return { replayed };
        }
      }

      const existing = await tx.select().from(freightDestinations).where(eq(freightDestinations.freightSubcategoryId, subcategoryId)).orderBy(freightDestinations.displayOrder);
      const previous = existing.at(-1);
      const previousBreaks = previous
        ? await tx.select().from(freightDestinationBreaks).where(eq(freightDestinationBreaks.freightDestinationId, previous.id))
        : [];
      const [order] = await tx.select({ value: max(freightDestinations.displayOrder) }).from(freightDestinations).where(eq(freightDestinations.freightSubcategoryId, subcategoryId));
      const [created] = await tx.insert(freightDestinations).values({
        freightSubcategoryId: subcategoryId, destination, consignee: nullable(fd, "consignee"), transitDays: nullable(fd, "transitDays"),
        quoteReference: nullable(fd, "quoteReference"), internalNotes: nullable(fd, "internalNotes"), displayOrder: (order?.value ?? -1) + 1,
        sameValueAllBreaks: previous?.sameValueAllBreaks ?? true,
        fieldProvenance: provenance(["destination", "consignee", "transitDays", "quoteReference", "internalNotes"]),
      }).returning({ id: freightDestinations.id });
      const tiers = await tx.select({ id: quoteTiers.id }).from(quoteTiers).where(eq(quoteTiers.quoteId, quote.id));
      if (tiers.length) await tx.insert(freightDestinationBreaks).values(tiers.map((tier) => {
        const prior = previousBreaks.find((row) => row.tierId === tier.id) ?? previousBreaks[0];
        return {
          freightDestinationId: created.id, tierId: tier.id, mode: prior?.mode ?? null,
          freightMarkupPct: prior?.freightMarkupPct ?? null, shipmentNote: prior?.shipmentNote ?? null,
          fieldProvenance: provenance(["mode", "freightMarkupPct", "shipmentNote"]),
        };
      }));
      await writeAuditEntry({ userId: user.id, entityType: "freight_destination", entityId: created.id, action: "freight_destination_created", diffJson: { subcategoryId } }, tx);
      return { createdId: created.id };
    });

    if ("replayed" in outcome && outcome.replayed) return outcome.replayed;

    const createdId = (outcome as { createdId: string }).createdId;
    const revision = await committedRevision();
    if (idempotencyKey) {
      await db
        .update(actionIdempotency)
        .set({ result: { id: createdId, revision } })
        .where(eq(actionIdempotency.key, idempotencyKey));
    }
    revalidateQuoteTree(quote.projectId, quote.id);
    return { revision, id: createdId };
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
      await writeAuditEntry({ userId: user.id, entityType: "freight_destination", entityId: destinationId, action: "freight_breaks_updated", diffJson: { breakMode: flat ? "one_value_all_breaks" : "differs_by_break", tierIds: rows.map((row) => row.tierId) } }, tx);
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
      await writeAuditEntry({ userId: user.id, entityType: "freight_destination", entityId: destinationId, action: "freight_destination_deleted", diffJson: { subcategoryId: row.subcategory.id, destination: row.destination.destination, wasSelected: row.subcategory.selectedDestinationId === destinationId } }, tx);
    });
    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, subcategoryId: row.subcategory.id, deletedDestination: row.destination.destination, selectionCleared: row.subcategory.selectedDestinationId === destinationId };
  });
}

/**
 * Delete a Freight shipment and its owned subtree.
 *
 * Hard delete, following the discipline `deleteFreightDestination` already
 * established one level down: draft-only, refuse rather than cascade over
 * anything load-bearing, snapshot before removing, all in one transaction.
 * A shipment is quote-owned and single-parented with every child cascaded, so
 * archive/void would add a lifecycle filter to every read while preserving
 * nothing referenced from outside the quote.
 *
 * SAFETY COMES FROM REFUSAL, NOT FROM RESTORE. This runs against a shared
 * production database with no staging split, so the delete is unrecoverable.
 * The guard below is what makes that acceptable: an operator can only remove a
 * shipment carrying no commercial or operational evidence. Clearing those
 * values first is a deliberate act; a confirmed cascade that destroys priced
 * freight is not, which is why one is not offered.
 *
 * Frozen quotes are refused even though no freight column appears in the
 * Pattern 52 freeze list. Freight reaches the customer through derived totals
 * rather than a snapshot column, so absence from that list is not permission.
 * See the "Pattern 52 derived-output coverage" governance finding.
 */
export async function deleteFreightSubcategory(fd: FormData): Promise<ActionResult<{
  quoteId: string; deletedLabel: string; destinationCount: number; revision: string | null;
}>> {
  return runAction(async () => {
    const subcategoryId = str(fd, "freightSubcategoryId");
    if (!subcategoryId) throw new ActionGuardError(ERR.VALIDATION, "Shipment is required");
    const user = await ensureUser();

    const [row] = await db
      .select({ subcategory: freightSubcategories, quote: quotes })
      .from(freightSubcategories)
      .innerJoin(quotes, eq(quotes.id, freightSubcategories.quoteId))
      .where(eq(freightSubcategories.id, subcategoryId))
      .limit(1);
    if (!row) throw new ActionGuardError(ERR.NOT_FOUND, "Shipment not found");

    // Frozen check before any evaluation, let alone mutation.
    assertNotFrozen(row.quote);
    await quoteByIdDraft(row.quote.id);

    const destinations = await db
      .select({ id: freightDestinations.id, destination: freightDestinations.destination })
      .from(freightDestinations)
      .where(eq(freightDestinations.freightSubcategoryId, subcategoryId));
    const destinationIds = destinations.map((d) => d.id);

    const breaks = destinationIds.length
      ? await db
          .select({
            id: freightDestinationBreaks.id,
            amount: freightDestinationBreaks.freightAmount,
            markup: freightDestinationBreaks.freightMarkupPct,
          })
          .from(freightDestinationBreaks)
          .where(inArray(freightDestinationBreaks.freightDestinationId, destinationIds))
      : [];
    const tracking = destinationIds.length
      ? await db
          .select({ id: freightDestinationTracking.id })
          .from(freightDestinationTracking)
          .where(inArray(freightDestinationTracking.freightDestinationId, destinationIds))
      : [];
    const customsEntries = await db
      .select({ id: freightCustomsEntries.id })
      .from(freightCustomsEntries)
      .where(eq(freightCustomsEntries.freightSubcategoryId, subcategoryId));
    const customsBreaks = customsEntries.length
      ? await db
          .select({ id: freightCustomsBreaks.id, amount: freightCustomsBreaks.amount })
          .from(freightCustomsBreaks)
          .where(inArray(freightCustomsBreaks.freightCustomsEntryId, customsEntries.map((e) => e.id)))
      : [];
    const items = await db
      .select({ id: freightSubcategoryItems.id })
      .from(freightSubcategoryItems)
      .where(eq(freightSubcategoryItems.freightSubcategoryId, subcategoryId));

    // Commercial and operational evidence. Each is something an operator
    // entered or a downstream system recorded; none should disappear as a side
    // effect of removing a structural container.
    //
    // NOT guarded: selectedDestinationId. It is assigned automatically when the
    // first destination is created -- every shipment in the database has one --
    // so treating it as evidence would refuse every shipment including empty
    // ones, contradicting the requirement that an empty shipment be deletable.
    // `selectionReason` IS guarded: that text is operator-authored
    // justification and exists only when someone wrote it.
    const blockers: string[] = [];
    const pricedBreaks = breaks.filter((b) => b.amount !== null).length;
    const markedUpBreaks = breaks.filter((b) => b.markup !== null).length;
    const pricedCustoms = customsBreaks.filter((c) => c.amount !== null).length;
    if (pricedBreaks > 0) blockers.push(`${pricedBreaks} priced freight ${pricedBreaks === 1 ? "break" : "breaks"}`);
    if (markedUpBreaks > 0) blockers.push(`${markedUpBreaks} freight ${markedUpBreaks === 1 ? "markup" : "markups"}`);
    if (pricedCustoms > 0) blockers.push(`${pricedCustoms} customs ${pricedCustoms === 1 ? "amount" : "amounts"}`);
    if (tracking.length > 0) blockers.push(`${tracking.length} tracking ${tracking.length === 1 ? "record" : "records"}`);
    if (row.subcategory.selectionReason) blockers.push("a recorded selection reason");
    if (blockers.length > 0) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${row.subcategory.label}" still holds ${blockers.join(", ")}. Clear those values first — removing the shipment would destroy them.`,
      );
    }

    await db.transaction(async (tx) => {
      // Snapshot inside the same transaction as the delete, so the audit row is
      // the only surviving record of what existed and cannot commit without the
      // deletion it describes.
      await writeAuditEntry({
        userId: user.id,
        entityType: "freight_subcategory",
        entityId: subcategoryId,
        action: "freight_shipment_deleted",
        diffJson: {
          shipment: {
            id: subcategoryId,
            label: row.subcategory.label,
            origin: row.subcategory.origin,
            carrierForwarder: row.subcategory.carrierForwarder,
            incoterm: row.subcategory.incoterm,
            treatment: row.subcategory.treatment,
            crossesInternationalBorder: row.subcategory.crossesInternationalBorder,
            assemblyId: row.subcategory.assemblyId,
            displayOrder: row.subcategory.displayOrder,
          },
          quoteId: row.quote.id,
          projectId: row.quote.projectId,
          hadSelectedDestination: row.subcategory.selectedDestinationId !== null,
          destinations: destinations.map((d) => ({ id: d.id, destination: d.destination })),
          cascadeCounts: {
            destinations: destinations.length,
            destinationBreaks: breaks.length,
            destinationTracking: tracking.length,
            customsEntries: customsEntries.length,
            customsBreaks: customsBreaks.length,
            subcategoryItems: items.length,
          },
        },
      }, tx);
      // Children fall to schema cascades: items, destinations (-> breaks,
      // tracking) and customs entries (-> customs breaks). The boundary is the
      // shipment subtree; nothing outside the owning quote references it.
      await tx.delete(freightSubcategories).where(eq(freightSubcategories.id, subcategoryId));
    });

    const revision = await committedRevision();
    revalidateQuoteTree(row.quote.projectId, row.quote.id);
    return { revision, quoteId: row.quote.id, deletedLabel: row.subcategory.label, destinationCount: destinations.length };
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
